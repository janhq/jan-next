/**
 * Managed local llama.cpp: downloads any number of verified GGUF models (curated, from a Hugging
 * Face repository, or imported from disk) and supervises the bundled `jan-llama-worker`, which
 * serves every installed model on an OS-assigned loopback port, loading each on first use and
 * keeping at most {@link Config.modelsMax} resident.
 *
 * The models are served through an `llm-pi-ai` route (`local` by default) whose `apiKeyEnv` and
 * `baseURLEnv` name {@link Config.apiKeyRef} and {@link Config.baseURLRef}. A fresh key and the
 * worker's endpoint are stored through the credentials service each time the worker becomes ready
 * and withdrawn when it stops, so the route offers no models while nothing serves. Each model is
 * `<provider>/<model id>`; `<provider>/<routeModelId>` is an alias of the default model. When a
 * settings service is mounted, the route's model list is kept equal to the installed models
 * ({@link Config.routeNamespace}).
 */
import { randomBytes } from 'node:crypto'
import { constants, access, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { arch, platform, totalmem } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { Artifact } from './artifacts.ts'
import { CATALOG, catalogModel, DEFAULT_MODEL_ID, SMALL_MODEL_ID, type CatalogModel } from './catalog.ts'
import { Config } from './config.ts'
import { download } from './download.ts'
import { HuggingFaceLookupError, lookupRepo, type HuggingFaceRepo } from './huggingface.ts'
import { estimateKvBytes, readModelFacts, UnsupportedModelError, type ModelFacts } from './gguf.ts'
import { accelerators, assessFit, backendOf, type MachineMemory } from './memory.ts'
import { plannedContext, renderPreset, resolvePresetSettings, type PresetSettings } from './preset.ts'
import { RateMeter } from './rate.ts'
import type {
  HuggingFaceRepoInfo, LlamaCppDownload, LlamaCppHostPlatform, LlamaCppPhase, LlamaCppProgress, LlamaCppState, LocalModelEntry,
  LocalModelSource, LocalModelStatus, ModelFit,
} from './types.ts'
import {
  describeExit, parseDeviceList, parseHandshake, readFirstLine, WorkerClient, WorkerProtocolError, type WorkerModelEvent,
} from './worker.ts'

export type * from './types.ts'
export { Config } from './config.ts'
export { CATALOG, catalogModel, DEFAULT_MODEL_ID, SMALL_MODEL_ID } from './catalog.ts'
export type { CatalogModel } from './catalog.ts'
export { download, DownloadError, isVerified } from './download.ts'
export { HuggingFaceLookupError, lookupRepo, parseRepo } from './huggingface.ts'
export type { HuggingFaceFile, HuggingFaceRepo } from './huggingface.ts'
export { estimateKvBytes, modelFacts, readModelFacts, UnsupportedModelError } from './gguf.ts'
export type { KvCacheType, ModelFacts } from './gguf.ts'
export { accelerators, assessFit, backendOf } from './memory.ts'
export type { MachineMemory } from './memory.ts'
export { plannedContext, renderPreset, resolvePresetSettings } from './preset.ts'
export type { PresetModel, PresetSettings } from './preset.ts'
export { RateMeter } from './rate.ts'
export { describeExit, parseDeviceList, parseHandshake, parseModelEvent, WorkerProtocolError } from './worker.ts'
export type { WorkerDevice, WorkerHandshake, WorkerModelEvent } from './worker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Managed local llama.cpp model. */
    llamaCpp: LlamaCpp
  }
}

/** One installed model. `file` is relative to `dataRoot`, or absolute for an imported file left in place. */
interface ModelRecord {
  id: string
  name: string
  file: string
  bytes: number
  /** Absent for an imported file, which is not hashed. */
  sha256?: string
  source: LocalModelSource
  /** Hugging Face repository, for catalog and repository downloads. */
  repo?: string
  /** Read from the GGUF header when the model was installed. */
  facts: ModelFacts
}

/** Installed facts written after verification, so boot does not re-hash multi-GB files or re-read headers. */
interface InstallRecord {
  version: 3
  models: ModelRecord[]
  active?: string
}

/** The multi-model record of earlier builds, without header facts; read and converted, never written. */
interface InstallRecordV2 {
  version: 2
  models: Array<Omit<ModelRecord, 'facts'>>
  active?: string
}

/** The one-model record earlier builds wrote; read and converted, never written. */
interface InstallRecordV1 {
  version: 1
  model: { sha256: string; bytes: number; file: string }
}

/** What a download fetches and how it is recorded once verified. */
interface ModelSpec extends Artifact {
  id: string
  name: string
  source: Exclude<LocalModelSource, 'import'>
  repo: string
}

interface Job {
  spec: ModelSpec
  abort: AbortController
  progress?: LlamaCppProgress
  error?: string
}

const LOG_LINES = 20
/** Longest handshake line accepted. */
const HANDSHAKE_MAX_BYTES = 64 * 1024

interface Running {
  handle: SubprocessHandle
  /** Key this worker requires; withdrawn from the route once it stops. */
  key: string
  /** Present once the handshake named the port. */
  client?: WorkerClient
  /** Model ids the worker reported loading or loaded through `/models/sse`; absent ones are unloaded. */
  resident: Map<string, Exclude<LocalModelStatus, 'unloaded'>>
  /** Ends the `/models/sse` subscription. */
  feed: AbortController
  stopping: boolean
  /** Set when {@link LlamaCpp.terminate} had to kill it. */
  forced?: boolean
  outcome?: SubprocessOutcome
}

/** One `llm-pi-ai` route model entry. */
interface RouteModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
}

/** Worker-side fields of the state; the model list, downloads and catalog are derived on publish. */
interface ServerState {
  phase: LlamaCppPhase
  error?: string
  logTail?: string
}

function tail(text: string | undefined): string | undefined {
  if (text === undefined || text.trim() === '') return undefined
  return text.trimEnd().split('\n').slice(-LOG_LINES).join('\n')
}

/**
 * Settle a promise, or reject with the signal's reason once it aborts.
 * @param promise - the operation.
 * @param signal - cancellation.
 * @returns the operation's value.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/**
 * Turn a file or display name into a route model id.
 * @param name - source name.
 * @returns lowercase letters, digits, `.`, `_` and `-`.
 */
function slug(name: string): string {
  const id = name.replace(/\.gguf$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return id.length > 0 ? id.slice(0, 80) : 'model'
}

/**
 * Read `signal.aborted` after an await, where narrowing from an earlier check no longer holds.
 * @param signal - the signal.
 * @returns whether it has aborted.
 */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Name the Host operating system for clients.
 * @param os - Node's platform name.
 * @returns `macos`, `windows`, or `linux` for every other platform.
 */
export function hostPlatformOf(os: NodeJS.Platform): LlamaCppHostPlatform {
  if (os === 'darwin') return 'macos'
  return os === 'win32' ? 'windows' : 'linux'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Local worker with an installed model set. Record and process mutations are serialized through
 * {@link LlamaCpp.task}; downloads run outside it and commit through it.
 */
export class LlamaCpp extends Service {
  static inject = ['subprocess', 'credentials']
  static Config = Config

  private server: ServerState = { phase: 'checking' }
  private state: LlamaCppState
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Aborts the start or model switch in progress (stop, select, remove, dispose). */
  private launching: AbortController | undefined
  private running: Running | undefined
  private queue: Promise<unknown> = Promise.resolve()
  /** Downloads run one at a time, outside {@link queue}, so Stop and Start stay responsive. */
  private downloadQueue: Promise<unknown> = Promise.resolve()
  private readonly jobs = new Map<string, Job>()
  private lastProgressAt = 0
  private record: InstallRecord = { version: 3, models: [] }
  /** Record writes in order. */
  private recordWrite: Promise<unknown> = Promise.resolve()
  private readonly keyRef: CredentialRef
  private readonly baseURLRef: CredentialRef
  /** The model the first-run offer installs. */
  private readonly firstModel: CatalogModel
  private readonly preset: PresetSettings
  /** Present once the worker listed its devices. */
  private machine: MachineMemory | undefined
  /** The device listing in progress; disposal waits for it. */
  private probing: Promise<void> = Promise.resolve()
  /** Context the worker last settled on per model id; kept across unloads so the route list stays stable. */
  private readonly contexts = new Map<string, number>()
  private readonly hostPlatform = hostPlatformOf(platform())

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'llamaCpp')
    if (!isAbsolute(config.dataRoot)) throw new Error(`llama-cpp: dataRoot must be absolute: ${config.dataRoot}`)
    if (config.workerPath !== undefined && !isAbsolute(config.workerPath)) {
      throw new Error(`llama-cpp: workerPath must be absolute: ${config.workerPath}`)
    }
    this.preset = resolvePresetSettings(config, platform(), join(config.dataRoot, 'slots'))
    this.keyRef = credentialRef(config.apiKeyRef)
    this.baseURLRef = credentialRef(config.baseURLRef)
    const pinned = catalogModel(config.model === 'small' ? SMALL_MODEL_ID : DEFAULT_MODEL_ID)
    if (pinned === undefined) throw new Error('llama-cpp: the catalog has no first-run model')
    this.firstModel = config.firstModelOverride === undefined ? pinned : { ...pinned, ...config.firstModelOverride }
    this.state = this.view()
    ctx.effect(() => {
      void this.task(async () => {
        // A key left by a crash or kill belongs to no worker.
        await this.withdrawRoute(undefined)
        await this.readInstall()
        const active = this.activeModel()
        if (active !== undefined) await this.syncRoute()
        let worker: string
        try { worker = await this.workerExecutable() }
        catch (error) { this.fail(error); return }
        this.probing = this.probeHardware(worker)
        this.setServer({ phase: active === undefined ? 'missing' : 'installed' })
        if (active !== undefined && config.autoStart && await this.wantsStart()) await this.launch()
      }).catch((error: unknown) => { this.fail(error) })
      return async () => {
        this.lifetime.abort(new Error('llama-cpp disposed'))
        for (const job of this.jobs.values()) job.abort.abort()
        this.launching?.abort()
        // Joining both queues guarantees no launch spawns a worker and no download writes after this point.
        await this.downloadQueue
        await this.queue
        await this.probing
        await this.terminate()
        this.listeners.clear()
      }
    })
  }

  // ── paths ──────────────────────────────────────────────────────────────

  private get recordPath(): string { return join(this.config.dataRoot, 'install.json') }
  private get runPath(): string { return join(this.config.dataRoot, 'run.json') }
  private get presetPath(): string { return join(this.config.dataRoot, 'run', 'preset.ini') }
  private modelDir(id: string): string { return join(this.config.dataRoot, 'models', id) }
  private modelFile(spec: { id: string; sha256: string }): string { return join(this.modelDir(spec.id), `${spec.sha256.slice(0, 16)}.gguf`) }
  private modelPath(model: Pick<ModelRecord, 'file'>): string { return isAbsolute(model.file) ? model.file : join(this.config.dataRoot, model.file) }

  /** @returns whether the user left the worker running (install and Start say yes, Stop says no). */
  private async wantsStart(): Promise<boolean> {
    try { return (JSON.parse(await readFile(this.runPath, 'utf8')) as { start?: unknown }).start !== false }
    catch { return true }
  }

  private async rememberStart(start: boolean): Promise<void> {
    await mkdir(this.config.dataRoot, { recursive: true })
    await writeFile(this.runPath, `${JSON.stringify({ start })}\n`, { mode: 0o600 })
  }

  /**
   * @returns the configured worker executable.
   * @throws Error, with a message that names no path, when none is configured or it is not an executable file.
   */
  private async workerExecutable(): Promise<string> {
    const path = this.config.workerPath
    if (path === undefined) {
      throw new Error('No local model worker is configured; set workerPath on the llama-cpp plugin (the desktop app and `pnpm run dev:web` set it from JAN_LLAMA_WORKER)')
    }
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file')
      await access(path, constants.X_OK)
    } catch (error) {
      this.ctx.logger.warn(`llama-cpp: the worker at ${path} is unusable: ${messageOf(error)}`)
      throw new Error('The bundled local model worker is missing or not executable; reinstall the app, or from source run `pnpm run stage:llama-worker`', { cause: error })
    }
    return path
  }

  /**
   * List the worker's offload devices once (`--list-devices`) and publish them with system memory,
   * so model fit can be judged. A failed listing is logged and leaves fit unknown. Never rejects.
   * @param worker - the worker executable.
   */
  private async probeHardware(worker: string): Promise<void> {
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [worker, '--list-devices'], cwd: dirname(worker), graceMs: this.config.graceMs,
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.startTimeoutMs)]),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      })
      const outcome = await handle.done
      if (this.lifetime.signal.aborted) return
      if (outcome.exitCode !== 0) {
        throw new Error(`it ${describeExit(outcome.exitCode, outcome.signal)}: ${tail(handle.collected.stderr?.readFrom(0).text) ?? ''}`)
      }
      const devices = parseDeviceList(handle.collected.stdout?.readFrom(0).text ?? '')
      this.machine = { unified: platform() === 'darwin' && arch() === 'arm64', ramBytes: totalmem(), devices }
      this.emit()
    } catch (error) {
      this.ctx.logger.warn(`llama-cpp: could not list the worker's devices: ${messageOf(error)}`)
    }
  }

  // ── state ──────────────────────────────────────────────────────────────

  /**
   * Read the current state.
   * @returns phase, model facts, installed models, downloads and catalog; never paths or keys.
   */
  snapshot(): LlamaCppState { return this.state }

  /**
   * Observe state changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Stream complete snapshots: the current one first, then one per change.
   * @param caller - observation lifetime.
   * @returns an async stream of states that ends when the caller or the service stops.
   */
  async *follow(caller: AbortSignal): AsyncIterable<LlamaCppState> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted) {
        if (!changed) await wake.promise
        if (aborted(signal)) break
        wake = Promise.withResolvers<undefined>()
        changed = false
        yield this.state
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  private activeModel(): ModelRecord | undefined {
    return this.record.models.find(model => model.id === this.record.active)
  }

  private view(): LlamaCppState {
    const active = this.activeModel()
    const offered = active ?? { id: this.firstModel.id, name: this.firstModel.name, bytes: this.firstModel.bytes }
    const downloads: LlamaCppDownload[] = [...this.jobs.values()].map(job => ({
      id: job.spec.id, name: job.spec.name,
      ...job.progress === undefined ? {} : { progress: job.progress },
      ...job.error === undefined ? {} : { error: job.error },
    }))
    const installed = new Set(this.record.models.map(model => model.id))
    const progress = downloads.find(item => item.error === undefined && item.progress !== undefined)?.progress
    const contextSize = this.server.phase === 'running' && active !== undefined ? this.contexts.get(active.id) : undefined
    return {
      phase: this.server.phase, hostPlatform: this.hostPlatform, provider: this.config.provider,
      model: { id: offered.id, name: offered.name, modelBytes: offered.bytes },
      ...progress === undefined ? {} : { progress },
      ...this.server.error === undefined ? {} : { error: this.server.error },
      ...this.server.logTail === undefined ? {} : { logTail: this.server.logTail },
      ...contextSize === undefined ? {} : { contextSize },
      models: this.record.models.map((model): LocalModelEntry => {
        const kvBytes = estimateKvBytes(model.facts, plannedContext(this.preset, model.facts), this.preset.cacheType) ?? 0
        const settled = this.contexts.get(model.id)
        return {
          id: model.id, name: model.name, bytes: model.bytes, source: model.source, active: model.id === this.record.active,
          status: this.running?.resident.get(model.id) ?? 'unloaded',
          ...settled === undefined ? {} : { contextSize: settled },
          architecture: model.facts.architecture,
          ...model.facts.contextLength === undefined ? {} : { contextLength: model.facts.contextLength },
          ...this.fitOf(model.bytes + kvBytes),
        }
      }),
      downloads,
      catalog: CATALOG.map((entry) => {
        const bytes = entry.id === this.firstModel.id ? this.firstModel.bytes : entry.bytes
        return {
          id: entry.id, name: entry.name, bytes, repo: entry.repo, recommended: entry.recommended, installed: installed.has(entry.id),
          ...this.fitOf(bytes),
        }
      }),
      ...this.machine === undefined ? {} : {
        hardware: {
          backend: backendOf(this.machine.devices), devices: accelerators(this.machine.devices), memoryBytes: this.machine.ramBytes,
        },
      },
    }
  }

  /**
   * @param requiredBytes - memory a model needs.
   * @returns its fit on this machine, or nothing while the hardware is unknown.
   */
  private fitOf(requiredBytes: number): { fit?: ModelFit } {
    return this.machine === undefined ? {} : { fit: assessFit(requiredBytes, this.machine) }
  }

  /**
   * Rebuild the snapshot and notify. Progress-only changes are throttled to
   * {@link Config.progressIntervalMs}; the last chunk of a step always goes out.
   * @param progressOnly - the change is a byte count.
   * @param final - the byte count completes its step.
   */
  private emit(progressOnly = false, final = false): void {
    this.state = this.view()
    if (progressOnly && !final && performance.now() - this.lastProgressAt < this.config.progressIntervalMs) return
    this.lastProgressAt = performance.now()
    for (const listener of this.listeners) listener()
  }

  private setServer(next: ServerState): void {
    this.server = next
    this.emit()
  }

  private fail(error: unknown, logTail?: string): void {
    if (this.lifetime.signal.aborted) return
    const message = messageOf(error)
    this.ctx.logger.warn(`llama-cpp: ${message}`)
    this.setServer({ phase: 'failed', error: message, ...logTail === undefined ? {} : { logTail } })
  }

  private task<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  // ── install record ─────────────────────────────────────────────────────

  /**
   * Load the record, keeping only models whose files are still present at their recorded size.
   * Records of earlier builds gain the header facts of each file and are written back once.
   */
  private async readInstall(): Promise<void> {
    // Earlier builds downloaded a llama-server engine here; the bundled worker replaces it.
    for (const legacy of ['engine', 'downloads']) await rm(join(this.config.dataRoot, legacy), { recursive: true, force: true })
    let raw: InstallRecord | InstallRecordV2 | InstallRecordV1 | undefined
    try { raw = JSON.parse(await readFile(this.recordPath, 'utf8')) as InstallRecord | InstallRecordV2 | InstallRecordV1 }
    catch { raw = undefined }
    const record: InstallRecord | InstallRecordV2 = raw === undefined ? { version: 3, models: [] }
      : raw.version === 1 ? this.fromV1(raw)
        : Array.isArray(raw.models) ? raw : { version: 3, models: [] }
    const models: ModelRecord[] = []
    for (const model of record.models) {
      const size = await stat(this.modelPath(model)).then(info => info.size, () => undefined)
      if (size !== model.bytes) {
        this.ctx.logger.warn(`llama-cpp: ${model.name} is missing or changed on disk; it is no longer listed`)
        continue
      }
      if ('facts' in model) { models.push(model); continue }
      try { models.push({ ...model, facts: await readModelFacts(this.modelPath(model)) }) }
      catch (error) { this.ctx.logger.warn(`llama-cpp: ${model.name} cannot be served (${messageOf(error)}); it is no longer listed`) }
    }
    // The alias section takes the route model id, so a model installed under it moves to a free id.
    const clash = models.find(model => model.id === this.config.routeModelId)
    let active = record.active
    if (clash !== undefined) {
      this.record = { version: 3, models }
      const id = this.freeId(slug(clash.name))
      if (active === clash.id) active = id
      models.splice(models.indexOf(clash), 1, { ...clash, id })
    }
    if (!models.some(model => model.id === active)) active = models[0]?.id
    this.record = { version: 3, models, ...active === undefined ? {} : { active } }
    if (record.version !== 3 || clash !== undefined) await this.writeRecord()
  }

  /** Convert the one-model record of earlier builds; its model file stays where it is. */
  private fromV1(v1: InstallRecordV1): InstallRecordV2 {
    const entry = [this.firstModel, ...CATALOG].find(model => model.sha256 === v1.model.sha256)
    // A file no curated entry matches keeps an id of its own, so the curated model stays downloadable.
    const id = entry?.id ?? 'earlier-local-model'
    return {
      version: 2, active: id,
      models: [{ id, name: entry?.name ?? 'Earlier local model', file: v1.model.file, bytes: v1.model.bytes, sha256: v1.model.sha256, source: 'catalog', ...entry === undefined ? {} : { repo: entry.repo } }],
    }
  }

  /**
   * Write the current record through a temporary file, so a crash leaves the previous one intact.
   * Writes are chained, so the file always ends up holding the latest record.
   */
  private writeRecord(): Promise<void> {
    const write = async (): Promise<void> => {
      await mkdir(this.config.dataRoot, { recursive: true })
      const temp = `${this.recordPath}.tmp`
      await writeFile(temp, `${JSON.stringify(this.record, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, this.recordPath)
    }
    const next = this.recordWrite.then(write, write)
    this.recordWrite = next.catch(() => undefined)
    return next
  }

  // ── downloads ──────────────────────────────────────────────────────────

  /**
   * First-run install: download the first-run model, then start the worker. With a model already
   * installed it starts the active model instead. Returns once accepted; progress and outcome arrive
   * through {@link follow}. Nothing downloads while the worker is unavailable.
   */
  install(): void {
    // The boot check decides between starting what is installed and downloading.
    if (this.server.phase === 'checking') { void this.queue.then(() => { this.install() }); return }
    if (this.running !== undefined || this.server.phase === 'starting') return
    if (this.activeModel() !== undefined) { void this.start(); return }
    void this.workerExecutable().then(
      () => { this.enqueue({ ...this.firstModel, source: 'catalog' }) },
      (error: unknown) => { this.fail(error) },
    )
  }

  /**
   * Download a curated model. Ignored when it is installed or already downloading.
   * @param id - catalog id.
   * @throws Error for an unknown id.
   */
  downloadCatalog(id: string): void {
    const entry = id === this.firstModel.id ? this.firstModel : catalogModel(id)
    if (entry === undefined) throw new Error(`no curated model "${id}"`)
    this.enqueue({ ...entry, source: 'catalog' })
  }

  /**
   * Look up a Hugging Face repository's downloadable GGUF files.
   * @param input - `owner/name` or a huggingface.co link.
   * @param signal - cancellation.
   * @returns the repository and its files, marking those already installed.
   * @throws {@link HuggingFaceLookupError} for bad input, a missing repository or an unreachable API.
   */
  async lookupHuggingFace(input: string, signal?: AbortSignal): Promise<HuggingFaceRepoInfo> {
    const repo = await lookupRepo(this.config.huggingFaceURL, input, signal)
    const installed = new Set(this.record.models.filter(model => model.repo === repo.repo).map(model => model.sha256))
    return {
      repo: repo.repo,
      files: repo.files.map(file => ({
        file: file.file, bytes: file.bytes, recommended: file.recommended, installed: installed.has(file.sha256),
        ...file.quant === undefined ? {} : { quant: file.quant },
        ...this.fitOf(file.bytes),
      })),
    }
  }

  /**
   * Download one file of a Hugging Face repository, re-reading the repository so the digest and size
   * come from Hugging Face, not the caller.
   * @param input - `owner/name` or a huggingface.co link.
   * @param file - file name inside the repository.
   * @param signal - cancellation of the lookup.
   * @returns the model id the download installs as.
   * @throws {@link HuggingFaceLookupError} when the repository or file cannot be found.
   */
  async downloadHuggingFace(input: string, file: string, signal?: AbortSignal): Promise<string> {
    const repo: HuggingFaceRepo = await lookupRepo(this.config.huggingFaceURL, input, signal)
    const found = repo.files.find(candidate => candidate.file === file)
    if (found === undefined) throw new HuggingFaceLookupError('not-found', `${repo.repo} has no downloadable file ${file}`)
    const existing = this.record.models.find(model => model.sha256 === found.sha256)
    if (existing !== undefined) return existing.id
    // The same file already downloading (or failed) keeps its id; a failed one starts again.
    const pending = [...this.jobs.values()].find(job => job.spec.sha256 === found.sha256)
    if (pending !== undefined) {
      if (pending.error !== undefined) this.enqueue(pending.spec)
      return pending.spec.id
    }
    const name = basename(found.file).replace(/\.gguf$/i, '')
    const id = this.freeId(slug(name))
    this.enqueue({ id, name, url: found.url, sha256: found.sha256, bytes: found.bytes, source: 'huggingface', repo: repo.repo })
    return id
  }

  /**
   * Start a failed download again, from its partial file.
   * @param id - model id of the failed download.
   * @throws Error when no failed download has that id.
   */
  retry(id: string): void {
    const job = this.jobs.get(id)
    if (job?.error === undefined) throw new Error(`no failed download "${id}"`)
    this.enqueue(job.spec)
  }

  /**
   * Stop downloads: one by id, or all, discarding their partial files (a download interrupted by
   * shutting down is kept and resumes instead); a failed entry is dismissed.
   * @param id - model id, or undefined for every download.
   */
  async cancel(id?: string): Promise<void> {
    for (const [key, job] of this.jobs) {
      if (id !== undefined && key !== id) continue
      if (job.error !== undefined) this.jobs.delete(key)
      else job.abort.abort(new Error('cancelled'))
    }
    this.emit()
    await this.downloadQueue
  }

  /** @returns an id no installed model, download or curated model uses, derived from `base`. */
  private freeId(base: string): string {
    const taken = (id: string): boolean => id === this.config.routeModelId || this.record.models.some(model => model.id === id)
      || this.jobs.has(id) || catalogModel(id) !== undefined
    if (!taken(base)) return base
    let n = 2
    while (taken(`${base}-${String(n)}`)) n++
    return `${base}-${String(n)}`
  }

  private enqueue(spec: ModelSpec): void {
    if (this.lifetime.signal.aborted || this.record.models.some(model => model.id === spec.id)) return
    const current = this.jobs.get(spec.id)
    // A cancelled job still unwinding is replaced, so asking again right after Cancel starts it again.
    if (current !== undefined && current.error === undefined && !current.abort.signal.aborted) return
    const job: Job = { spec, abort: new AbortController() }
    this.jobs.set(spec.id, job)
    if (this.activeModel() === undefined && (this.server.phase === 'missing' || this.server.phase === 'failed')) {
      this.server = { phase: 'downloading' }
    }
    this.emit()
    const run = (): Promise<void> => this.runJob(job)
    this.downloadQueue = this.downloadQueue.then(run, run)
  }

  private async runJob(job: Job): Promise<void> {
    if (this.jobs.get(job.spec.id) !== job) return
    const signal = AbortSignal.any([job.abort.signal, this.lifetime.signal])
    try {
      signal.throwIfAborted()
      const meter = new RateMeter()
      const report = (receivedBytes: number, totalBytes: number): void => {
        job.progress = { receivedBytes, totalBytes, bytesPerSecond: meter.sample(receivedBytes, performance.now()) }
        this.emit(true, receivedBytes === totalBytes)
      }
      report(0, job.spec.bytes)
      const path = this.modelFile(job.spec)
      await download(job.spec, path, 'model', signal, report)
      signal.throwIfAborted()
      let facts: ModelFacts
      try { facts = await readModelFacts(path) }
      catch (error) {
        await rm(path, { force: true })
        throw new Error(`${job.spec.name} cannot be served: ${messageOf(error)}`, { cause: error })
      }
      await this.task(async () => {
        // Cancel or uninstall may have landed while this commit waited behind another task.
        signal.throwIfAborted()
        const previous = this.record
        const first = previous.active === undefined
        this.record = {
          ...previous,
          models: [...previous.models, {
            id: job.spec.id, name: job.spec.name, file: relative(this.config.dataRoot, path), bytes: job.spec.bytes,
            sha256: job.spec.sha256, source: job.spec.source, repo: job.spec.repo, facts,
          }],
          ...first ? { active: job.spec.id } : {},
        }
        try { await this.writeRecord() }
        catch (error) { this.record = previous; throw error }
        if (!first) await this.modelsChanged()
        this.jobs.delete(job.spec.id)
        this.emit()
        if (!first) return
        // The first model installed starts serving right away, as the first-run offer promises.
        // The job is gone now, so a failure here is reported as the worker's, not the download's.
        try { await this.rememberStart(true) }
        catch (error) { this.fail(error); return }
        this.setServer({ phase: 'installed' })
        await this.syncRoute()
        await this.launch()
      })
    } catch (error) {
      if (this.jobs.get(job.spec.id) !== job) return
      const cancelled = job.abort.signal.aborted || this.lifetime.signal.aborted
      // A user's Cancel discards the partial file; shutting down keeps it so the next launch resumes.
      if (job.abort.signal.aborted && !this.lifetime.signal.aborted) {
        await rm(`${this.modelFile(job.spec)}.partial`, { force: true }).catch(() => undefined)
      }
      if (cancelled) this.jobs.delete(job.spec.id)
      else job.error = messageOf(error)
      if (this.lifetime.signal.aborted) return
      if (this.activeModel() === undefined && this.server.phase === 'downloading' && ![...this.jobs.values()].some(other => other.error === undefined)) {
        if (cancelled) this.setServer({ phase: 'missing' })
        else this.fail(error)
        return
      }
      this.emit()
    }
  }

  // ── installed models ───────────────────────────────────────────────────

  /**
   * Add a GGUF file from disk, left where it is, recording its header facts. The first model added
   * becomes the default and starts; a later one joins the running worker's preset.
   * @param path - absolute path of a `.gguf` file.
   * @param name - display name; defaults to the file name.
   * @returns the model id.
   * @throws Error when the path is not an absolute path to a readable GGUF file, or the file is a
   * vision projector or embedding model rather than a chat model.
   */
  importModel(path: string, name?: string): Promise<string> {
    return this.task(async () => {
      const file = path.trim()
      if (!isAbsolute(file)) throw new Error('Enter the full path of a .gguf file')
      const info = await stat(file).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new Error(`No file at ${file}`)
      const existing = this.record.models.find(model => model.source === 'import' && model.file === file)
      if (existing !== undefined) return existing.id
      let facts: ModelFacts
      try { facts = await readModelFacts(file) }
      catch (error) {
        if (error instanceof UnsupportedModelError) throw new Error(`${basename(file)} cannot be used for chat: ${error.message}`, { cause: error })
        throw new Error(`${basename(file)} is not a GGUF model file`, { cause: error })
      }
      const label = name?.trim() || basename(file).replace(/\.gguf$/i, '')
      const id = this.freeId(slug(label))
      const previous = this.record
      const first = previous.active === undefined
      this.record = {
        ...previous, models: [...previous.models, { id, name: label, file, bytes: info.size, source: 'import', facts }],
        ...first ? { active: id } : {},
      }
      try { await this.writeRecord() }
      catch (error) { this.record = previous; throw error }
      this.emit()
      if (first) {
        await this.rememberStart(true)
        this.setServer({ phase: 'installed' })
        await this.syncRoute()
        await this.launch()
      } else {
        await this.modelsChanged()
      }
      return id
    })
  }

  /**
   * Make an installed model the default: the route's alias id serves it and it loads when the worker
   * starts. A running worker retargets the alias without reloading any model, then loads it; a
   * stopped one starts. An agent default on another model of this route moves to the alias id.
   * @param id - installed model id.
   * @returns once the worker serves it; a failed start is published as the `failed` phase.
   * @throws Error for an id that is not installed, or carrying the worker's reason when a running
   * worker could not load it.
   */
  setDefault(id: string): Promise<void> {
    if (!this.record.models.some(model => model.id === id)) return Promise.reject(new Error(`no installed model "${id}"`))
    this.launching?.abort()
    return this.task(async () => {
      if (!this.record.models.some(model => model.id === id)) throw new Error(`no installed model "${id}"`)
      if (this.record.active !== id) {
        const previous = this.record
        this.record = { ...previous, active: id }
        try { await this.writeRecord() }
        catch (error) { this.record = previous; throw error }
        this.emit()
        await this.modelsChanged()
      }
      await this.rememberStart(true)
      const running = this.running
      if (running?.client === undefined || running.stopping) await this.launch()
      else await this.loadInto(running, running.client, id)
      await this.adoptDefault(true)
    }).catch((error: unknown) => { this.fail(error) })
  }

  /**
   * Load an installed model into the running worker, starting the worker first when it is stopped.
   * With {@link Config.modelsMax} models resident, the least recently used idle one is unloaded.
   * @param id - installed model id.
   * @returns once the model is loaded.
   * @throws Error for an id that is not installed, or carrying the worker's reason when it could not
   * load the model (all resident models busy, or a load failure).
   */
  loadModel(id: string): Promise<void> {
    return this.task(async () => {
      const model = this.record.models.find(candidate => candidate.id === id)
      if (model === undefined) throw new Error(`no installed model "${id}"`)
      if (this.running?.client === undefined) {
        await this.rememberStart(true)
        await this.launch()
      }
      const running = this.running
      if (running?.client === undefined || running.stopping) throw new Error('the local model worker is not running')
      await this.loadInto(running, running.client, id)
    })
  }

  /**
   * Unload a model from the running worker; it loads again on its next request.
   * @param id - installed model id.
   * @returns once it is unloaded, or at once when the worker does not hold it.
   * @throws Error carrying the worker's reason when the model has requests in flight.
   */
  unloadModel(id: string): Promise<void> {
    return this.task(async () => {
      const running = this.running
      if (running?.client === undefined || running.stopping) return
      await running.client.unload(id, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.stopTimeoutMs)]))
    })
  }

  /**
   * Remove an installed model. A downloaded file is deleted; an imported file is only forgotten. A
   * resident model is unloaded first, because Windows cannot delete a file the worker maps.
   * Removing the default makes the next installed model the default and loads it into a running worker,
   * as {@link setDefault} does; removing the last stops the worker.
   * @param id - installed model id.
   * @returns once the record and the worker reflect the removal; a failed load of the new default is
   * published as the `failed` phase.
   * @throws Error carrying the worker's reason when the model has requests in flight.
   */
  removeModel(id: string): Promise<void> {
    if (this.record.active === id) this.launching?.abort()
    return this.task(async () => {
      const model = this.record.models.find(candidate => candidate.id === id)
      if (model === undefined) return
      const running = this.running
      // Asked even when the feed has not reported it resident yet; the worker answers that case at once.
      if (running?.client !== undefined && !running.stopping) {
        await running.client.unload(id, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.stopTimeoutMs)]))
      }
      const wasActive = this.record.active === id
      this.record.models = this.record.models.filter(candidate => candidate.id !== id)
      this.contexts.delete(id)
      if (wasActive) {
        const next = this.record.models[0]?.id
        if (next === undefined) delete this.record.active
        else this.record.active = next
      }
      await this.writeRecord()
      if (this.activeModel() === undefined) {
        await this.terminate()
        this.setServer({ phase: 'missing' })
      } else {
        this.emit()
        await this.modelsChanged()
        await this.adoptDefault(false)
      }
      if (model.source !== 'import') {
        const file = this.modelPath(model)
        await rm(file, { force: true })
        await rm(`${file}.partial`, { force: true })
        try { await rmdir(dirname(file)) }
        catch (_notEmpty) { /* The directory still holds another file of this model id; it stays. */ }
      }
      const current = this.running
      const successor = this.record.active
      if (!wasActive || successor === undefined || current?.client === undefined || current.stopping) return
      try { await this.loadInto(current, current.client, successor) }
      catch (error) { this.fail(error) }
    })
  }

  /**
   * Publish the worker's endpoint and key for the route, endpoint first so a key never names an
   * endpoint that is not there.
   * @param running - the ready worker.
   * @param client - its lifecycle client.
   */
  private async publishRoute(running: Running, client: WorkerClient): Promise<void> {
    await this.ctx.credentials.set(this.baseURLRef, `${client.origin}/v1`)
    await this.ctx.credentials.set(this.keyRef, running.key)
  }

  /**
   * Remove the route credentials if the key is still one this plugin issued (`expected`, or any
   * `llamacpp-` key when undefined), so a stopped worker leaves no usable-looking route behind.
   * @param expected - the key of the worker that stopped, if known.
   */
  private async withdrawRoute(expected: string | undefined): Promise<void> {
    try {
      const current = (await this.ctx.credentials.resolve(this.keyRef))?.value
      if (current === undefined || (expected === undefined ? !current.startsWith('llamacpp-') : current !== expected)) return
      await this.ctx.credentials.unset(this.keyRef)
      await this.ctx.credentials.unset(this.baseURLRef)
    } catch (error) {
      this.ctx.logger.warn('llama-cpp: could not remove the route credentials')
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Keep the route's model list equal to the installed models, so the picker names every model the
   * worker serves: the alias id of the default model first, then each model under its own id, with
   * the context the worker last settled on for it, otherwise the planned one, never above the trained
   * context. Skipped without a settings service or namespace, and when the list already matches.
   */
  private async syncRoute(): Promise<void> {
    const settings = this.ctx.get('settings')
    const ns = this.config.routeNamespace
    const active = this.activeModel()
    if (settings === undefined || ns === '' || active === undefined) return
    const entry = (id: string, name: string, model: ModelRecord): RouteModel => ({
      id, name, contextWindow: this.routeContext(model), maxTokens: this.config.routeMaxTokens,
    })
    const models = [
      entry(this.config.routeModelId, `${active.name} (local default)`, active),
      ...this.record.models.map(model => entry(model.id, `${model.name} (local)`, model)),
    ]
    try {
      type Section = { providers?: Record<string, { models?: unknown }> } | undefined
      const value = settings.describe().find(row => row.ns === ns)?.value as Section
      if (value?.providers?.[this.config.provider] === undefined) return
      if (JSON.stringify(value.providers[this.config.provider]?.models) === JSON.stringify(models)) return
      await settings.mutate(ns, [{ op: 'set', path: ['providers', this.config.provider, 'models'], value: models }])
    } catch (error) {
      this.ctx.logger.warn(`llama-cpp: could not list the local models on the ${this.config.provider} route`)
      this.ctx.logger.warn(error)
    }
  }

  private routeContext(model: ModelRecord): number {
    const settled = this.contexts.get(model.id) ?? plannedContext(this.preset, model.facts)
    return Math.min(settled, model.facts.contextLength ?? Number.POSITIVE_INFINITY)
  }

  /**
   * Bring the route list and a running worker's preset up to date with the installed models and the
   * default. The worker reloads only sections whose options changed, so moving the alias or adding a
   * model unloads nothing. Never rejects: a worker that refuses the preset is stopped and reported.
   */
  private async modelsChanged(): Promise<void> {
    await this.syncRoute()
    const running = this.running
    if (running?.client === undefined || running.stopping) return
    const owner = new AbortController()
    try {
      await this.writePreset()
      const signal = this.startSignal(owner)
      await abortable(running.client.reload(this.presetPath, this.config.modelsMax, signal), signal)
    } catch (error) {
      await this.terminate()
      this.reportStartFailure(error, owner, running)
    }
  }

  // ── process ────────────────────────────────────────────────────────────

  /** Start the worker with the active model, now and on later boots. No-op while it is running or starting. */
  start(): Promise<void> {
    return this.task(async () => {
      await this.rememberStart(true)
      await this.launch()
    }).catch((error: unknown) => { this.fail(error) })
  }

  /** Stop the worker, also while it is still starting; the install stays and later boots leave it stopped. */
  stop(): Promise<void> {
    this.launching?.abort()
    return this.task(async () => {
      await this.rememberStart(false)
      await this.terminate()
      if (this.activeModel() !== undefined) this.setServer({ phase: 'stopped' })
    })
  }

  /** Stop the worker, cancel downloads, delete downloaded models, partial files and saved KV state, and remove the route credentials. */
  async uninstall(): Promise<void> {
    for (const job of this.jobs.values()) job.abort.abort(new Error('cancelled'))
    this.launching?.abort()
    // Outside the task: a finishing download commits through the task queue.
    await this.downloadQueue
    await this.task(async () => {
      // A download enqueued since the wait above must not write into the deleted directories.
      for (const job of this.jobs.values()) job.abort.abort(new Error('cancelled'))
      this.jobs.clear()
      await this.terminate()
      for (const dir of ['models', 'run', 'slots']) await rm(join(this.config.dataRoot, dir), { recursive: true, force: true })
      await rm(this.recordPath, { force: true })
      await rm(this.runPath, { force: true })
      await this.withdrawRoute(undefined)
      this.record = { version: 3, models: [] }
      this.setServer({ phase: 'missing' })
    })
  }

  /**
   * Start the worker and load the default model. Never rejects: a failure is published as the
   * `failed` phase, so every caller (start, a new default, a finished first download, import) reports it alike.
   */
  private async launch(): Promise<void> {
    try { await this.launchOnce() }
    catch (error) { this.fail(error) }
  }

  private async launchOnce(): Promise<void> {
    if (this.running !== undefined || this.lifetime.signal.aborted) return
    const model = this.activeModel()
    if (model === undefined) { this.setServer({ phase: 'missing' }); return }
    // Assigned before the first await, so Stop, select and removal can interrupt the whole start.
    const launching = new AbortController()
    this.launching = launching
    let running: Running | undefined
    try {
      const worker = await this.workerExecutable()
      this.setServer({ phase: 'starting' })
      await this.writePreset()
      // Dispose or Stop may have landed during the awaits above; never spawn an orphan.
      if (aborted(launching.signal) || aborted(this.lifetime.signal)) return
      const signal = this.startSignal(launching)
      const key = `llamacpp-${randomBytes(32).toString('base64url')}`
      const handle = this.ctx.subprocess.spawn({
        argv: [
          worker, '--preset', this.presetPath, '--port', '0', '--models-max', String(this.config.modelsMax),
          '--slot-cache-mib', String(this.config.slotCacheMiB),
        ],
        cwd: dirname(worker), graceMs: this.config.graceMs,
        // The key travels in the environment so it never shows in `ps`.
        env: { JAN_LLAMA_API_KEY: key },
        // Closing stdin is the worker's graceful stop; its end of file also stops an orphan.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
      })
      handle.stdin?.on('error', (_closed: unknown) => { /* EPIPE once the worker exited; its exit is reported through `done`. */ })
      const current: Running = { handle, key, resident: new Map(), feed: new AbortController(), stopping: false }
      running = current
      this.running = current
      const logs = (): string | undefined => tail(handle.collected.stderr?.readFrom(0).text)
      const exited = (failure: Error): void => {
        current.feed.abort()
        if (this.running === current) { this.running = undefined; this.emit() }
        void this.withdrawRoute(key).then(() => {
          if (current.stopping || this.lifetime.signal.aborted) return
          this.fail(failure, logs())
        })
      }
      void handle.done.then(
        (outcome) => {
          current.outcome = outcome
          exited(new Error(`the local model worker ${describeExit(outcome.exitCode, outcome.signal)}`))
        },
        (error: unknown) => { exited(new Error(`the local model worker could not start: ${messageOf(error)}`)) },
      )
      if (handle.stdout === undefined) throw new WorkerProtocolError('the worker was spawned without a stdout pipe')
      const line = await abortable(readFirstLine(handle.stdout, HANDSHAKE_MAX_BYTES), signal)
      // The exit handler reports a worker that ended before its handshake.
      if (line === undefined) return
      const handshake = parseHandshake(line)
      if (handshake.aliases[this.config.routeModelId] !== model.id) {
        throw new WorkerProtocolError(`the local model worker does not serve ${model.name} as "${this.config.routeModelId}"`)
      }
      const client = new WorkerClient(`http://127.0.0.1:${String(handshake.port)}`, key)
      current.client = client
      const feed = await abortable(client.events(current.feed.signal), signal)
      void this.mirrorResidency(current, client, feed)
      await this.loadInto(current, client, model.id, signal)
      await this.publishRoute(current, client)
      this.setServer({ phase: 'running' })
      await this.syncRoute()
      await this.adoptDefault(false)
    } catch (error) {
      if (running !== undefined) await this.terminate()
      this.reportStartFailure(error, launching, running)
    } finally {
      if (this.launching === launching) this.launching = undefined
    }
  }

  /**
   * @param owner - the start or switch's own controller.
   * @returns a signal for one start: aborted by its owner, by disposal, or by {@link Config.startTimeoutMs}.
   */
  private startSignal(owner: AbortController): AbortSignal {
    return AbortSignal.any([owner.signal, this.lifetime.signal, AbortSignal.timeout(this.config.startTimeoutMs)])
  }

  /**
   * Publish why a start or preset reload ended early. Stop, a new default, removal and disposal end
   * it on purpose and publish their own phase.
   * @param error - what ended it.
   * @param owner - the start or switch's own controller.
   * @param running - the worker it spawned or switched, for its log tail.
   */
  private reportStartFailure(error: unknown, owner: AbortController, running: Running | undefined): void {
    if (owner.signal.aborted || this.lifetime.signal.aborted) return
    const logTail = tail(running?.handle.collected.stderr?.readFrom(0).text)
    const outcome = running?.outcome
    // A worker that died on its own explains a failed request better than the request does.
    if (outcome !== undefined && running?.forced !== true && outcome.exitCode !== 0) {
      this.fail(new Error(`the local model worker ${describeExit(outcome.exitCode, outcome.signal)}`), logTail)
      return
    }
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    this.fail(timedOut ? new Error('the local model worker did not become ready in time') : error, logTail)
  }

  /**
   * Mirror which models the worker holds from its `/models/sse` feed, and read the context each one
   * settled on once it loads. A feed that ends while the worker runs is logged, leaving the last state.
   * @param running - the worker.
   * @param client - its lifecycle client.
   * @param feed - its subscribed transitions.
   */
  private async mirrorResidency(running: Running, client: WorkerClient, feed: AsyncIterable<WorkerModelEvent>): Promise<void> {
    try {
      for await (const event of feed) {
        if (event.status === 'unloaded') running.resident.delete(event.model)
        else running.resident.set(event.model, event.status)
        this.emit()
        if (event.status === 'loaded') void this.readContext(running, client, event.model)
      }
    } catch (error) {
      if (running.feed.signal.aborted) return
      this.ctx.logger.warn(`llama-cpp: lost the worker's model feed: ${messageOf(error)}`)
    }
  }

  /**
   * Record the context a loaded model settled on and list it on the route. Never rejects.
   * @param running - the worker.
   * @param client - its lifecycle client.
   * @param id - installed model id.
   */
  private async readContext(running: Running, client: WorkerClient, id: string): Promise<void> {
    const signal = AbortSignal.any([running.feed.signal, AbortSignal.timeout(this.config.startTimeoutMs)])
    const contextSize = await client.contextSize(id, signal).catch(() => undefined)
    if (contextSize === undefined || this.contexts.get(id) === contextSize) return
    this.contexts.set(id, contextSize)
    if (contextSize < this.config.fitCtx) {
      this.ctx.logger.warn(`llama-cpp: the worker runs ${id} with a ${String(contextSize)}-token context; the harness prompt needs about 12k`)
    }
    this.emit()
    await this.syncRoute()
  }

  /**
   * Load an installed model into a ready worker and record its context.
   * @param running - the worker.
   * @param client - its lifecycle client.
   * @param id - installed model id.
   * @param signal - cancellation; defaults to disposal or {@link Config.startTimeoutMs}.
   * @throws Error naming the model and carrying the worker's reason.
   */
  private async loadInto(running: Running, client: WorkerClient, id: string, signal?: AbortSignal): Promise<void> {
    const model = this.record.models.find(candidate => candidate.id === id)
    if (model === undefined) throw new Error(`no installed model "${id}"`)
    const loading = signal ?? AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.startTimeoutMs)])
    try { await abortable(client.load(id, loading), loading) }
    catch (error) {
      if (loading.aborted) throw error
      throw new Error(`could not load ${model.name}: ${messageOf(error)}`, { cause: error })
    }
    await this.readContext(running, client, id)
  }

  /**
   * Write the preset through a temporary file, so the worker never reads half of it: one section per
   * installed model and the route's alias section for the default.
   */
  private async writePreset(): Promise<void> {
    const active = this.activeModel()
    if (active === undefined) throw new Error('no model is installed')
    await mkdir(dirname(this.presetPath), { recursive: true })
    const temp = `${this.presetPath}.tmp`
    const sections = this.record.models.map(model => ({ id: model.id, path: this.modelPath(model), facts: model.facts }))
    await writeFile(temp, renderPreset(this.preset, sections, { [this.config.routeModelId]: active.id }), { mode: 0o600 })
    await rename(temp, this.presetPath)
  }

  /**
   * Point the agent default model at the route's alias id when the default names no model this route
   * serves, or names another route that cannot serve (e.g. Tokamak with no key). A usable default on
   * another route is left alone.
   * @param chosen - the user made a model the local default, so a default on another local model
   * id moves to the alias too.
   */
  private async adoptDefault(chosen: boolean): Promise<void> {
    const defaults = this.ctx.get('agentDefaultModel')
    const llm = this.ctx.get('llm')
    if (defaults === undefined || llm === undefined) return
    const alias = this.config.routeModelId
    try {
      const current = defaults.currentSelection()
      if (current.provider === this.config.provider) {
        if (current.model === alias) return
        if (!chosen && this.record.models.some(model => model.id === current.model)) return
      } else {
        const usable = await llm.listModels(current.provider).then(models => models.length > 0, () => false)
        if (usable) return
      }
      await defaults.saveSelection({ provider: this.config.provider, model: alias })
      this.ctx.logger.info(`llama-cpp: default model set to ${this.config.provider}/${alias}`)
    } catch (error) {
      this.ctx.logger.warn('llama-cpp: could not update the default model')
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Stop the worker: close its stdin so it drains requests and saves KV state, then terminate it if
   * it has not exited within {@link Config.stopTimeoutMs}.
   */
  private async terminate(): Promise<void> {
    const running = this.running
    if (running === undefined) return
    running.stopping = true
    running.feed.abort()
    running.handle.stdin?.end()
    let timer: NodeJS.Timeout | undefined
    const exited = await Promise.race([
      running.handle.done.then(() => true, () => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false) }, this.config.stopTimeoutMs) }),
    ])
    clearTimeout(timer)
    if (!exited) {
      this.ctx.logger.warn(`llama-cpp: the worker did not exit within ${String(this.config.stopTimeoutMs)} ms of closing its stdin; terminating it`)
      running.forced = true
      running.handle.terminate()
      await running.handle.done.catch(() => undefined)
    }
    if (this.running === running) { this.running = undefined; this.emit() }
    await this.withdrawRoute(running.key)
  }
}

export default LlamaCpp
