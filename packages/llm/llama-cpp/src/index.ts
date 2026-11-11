/**
 * Managed local llama.cpp: downloads a pinned `llama-server` build and any number of verified GGUF
 * models (curated, from a Hugging Face repository, or imported from disk), and supervises one
 * server on a fixed loopback port that runs the active model.
 *
 * The active model is served through an `llm-pi-ai` route (`local` by default) whose `apiKeyEnv`
 * names {@link Config.apiKeyRef}. A fresh key is stored through the credentials service each time
 * the server becomes ready and withdrawn when it stops, so the route offers no models while
 * nothing serves. When a settings service is mounted, the route's model list is kept equal to the
 * active model ({@link Config.routeNamespace}).
 */
import { randomBytes } from 'node:crypto'
import { open as openFile, chmod, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { ENGINE_VERSION, engineFor, type Artifact, type EngineArtifact } from './artifacts.ts'
import { CATALOG, catalogModel, DEFAULT_MODEL_ID, SMALL_MODEL_ID, type CatalogModel } from './catalog.ts'
import { Config } from './config.ts'
import { download } from './download.ts'
import { HuggingFaceLookupError, lookupRepo, type HuggingFaceRepo } from './huggingface.ts'
import { isGguf, RateMeter } from './rate.ts'
import type {
  HuggingFaceRepoInfo, LlamaCppDownload, LlamaCppPhase, LlamaCppProgress, LlamaCppState, LocalModelEntry, LocalModelSource,
} from './types.ts'

export type * from './types.ts'
export { Config } from './config.ts'
export { ENGINE_VERSION, ENGINES, engineFor } from './artifacts.ts'
export type { EngineArtifact, EngineTarget } from './artifacts.ts'
export { CATALOG, catalogModel, DEFAULT_MODEL_ID, SMALL_MODEL_ID } from './catalog.ts'
export type { CatalogModel } from './catalog.ts'
export { download, DownloadError, isVerified } from './download.ts'
export { HuggingFaceLookupError, lookupRepo, parseRepo } from './huggingface.ts'
export type { HuggingFaceFile, HuggingFaceRepo } from './huggingface.ts'
export { isGguf, RateMeter } from './rate.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Managed local llama.cpp model. */
    llamaCpp: LlamaCpp
  }
}

/** Installed engine, as recorded after verification. */
interface EngineRecord { version: string; backend: string; sha256: string; binary: string }

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
}

/** Installed facts written after verification, so boot does not re-hash multi-GB files. */
interface InstallRecord {
  version: 2
  engine?: EngineRecord
  models: ModelRecord[]
  active?: string
}

/** The one-model record earlier builds wrote; read and converted, never written. */
interface InstallRecordV1 {
  version: 1
  engine: EngineRecord
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

interface Running {
  handle: SubprocessHandle
  /** Key this server requires; withdrawn from the route once it stops. */
  key: string
  stopping: boolean
}

/** Server-side fields of the state; the model list, downloads and catalog are derived on publish. */
interface ServerState {
  phase: LlamaCppPhase
  error?: string
  logTail?: string
  contextSize?: number
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true }
  catch { return false }
}

async function findFile(root: string, name: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  const hit = entries.find(entry => entry.isFile() && entry.name === name)
  return hit === undefined ? undefined : join(hit.parentPath, hit.name)
}

/**
 * Make the engine's shared libraries, which sit next to the executable, loadable.
 * Windows already searches the executable's directory first.
 * @param dir - directory holding the executable and its libraries.
 * @returns environment entries for this platform.
 */
function libraryPath(dir: string): Record<string, string> {
  const join = (current: string | undefined): string => [dir, current].filter(Boolean).join(':')
  if (process.platform === 'linux') return { LD_LIBRARY_PATH: join(process.env.LD_LIBRARY_PATH) }
  if (process.platform === 'darwin') return { DYLD_LIBRARY_PATH: join(process.env.DYLD_LIBRARY_PATH) }
  return {}
}

function tail(text: string | undefined): string | undefined {
  if (text === undefined || text.trim() === '') return undefined
  return text.trimEnd().split('\n').slice(-LOG_LINES).join('\n')
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Local engine with an installed model set; every record and process mutation is serialized through {@link LlamaCpp.task}. */
export class LlamaCpp extends Service {
  static inject = ['subprocess', 'credentials']
  static Config = Config

  private server: ServerState = { phase: 'checking' }
  private state: LlamaCppState
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Aborts the readiness wait of a launch in progress (stop, remove, dispose). */
  private launching: AbortController | undefined
  private running: Running | undefined
  /** Key the running server requires; published as the route credential only while it serves. */
  private servingKey: string | undefined
  private queue: Promise<unknown> = Promise.resolve()
  /** Downloads run one at a time, outside {@link queue}, so Stop and Start stay responsive. */
  private downloadQueue: Promise<unknown> = Promise.resolve()
  private readonly jobs = new Map<string, Job>()
  /** Shared by downloads that need the engine at the same time. */
  private engineInstall: Promise<string> | undefined
  private lastProgressAt = 0
  private record: InstallRecord = { version: 2, models: [] }
  /** Record writes in order; the engine install writes from outside {@link queue}. */
  private recordWrite: Promise<unknown> = Promise.resolve()
  private engineInstalled = false
  private readonly keyRef: CredentialRef
  /** Pinned engine for this machine; undefined where llama.cpp publishes no prebuilt build. */
  private readonly engine: EngineArtifact | undefined
  /** The model the first-run offer installs. */
  private readonly firstModel: CatalogModel

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'llamaCpp')
    if (!isAbsolute(config.dataRoot)) throw new Error(`llama-cpp: dataRoot must be absolute: ${config.dataRoot}`)
    this.keyRef = credentialRef(config.apiKeyRef)
    const pinned = catalogModel(config.model === 'small' ? SMALL_MODEL_ID : DEFAULT_MODEL_ID)
    if (pinned === undefined) throw new Error('llama-cpp: the catalog has no first-run model')
    const pinnedEngine = engineFor({ platform: process.platform, arch: process.arch, backend: config.backend })
    const override = config.artifactOverrides?.engine
    this.engine = override === undefined ? pinnedEngine : {
      executable: process.platform === 'win32' ? 'llama-server.exe' : 'llama-server', gpu: false, flavor: 'cpu',
      ...pinnedEngine, ...override,
    }
    if (this.engine === undefined && config.binaryPath === undefined) {
      ctx.logger.warn(`llama-cpp: llama.cpp publishes no prebuilt ${config.backend} build for ${process.platform}-${process.arch}; set binaryPath`)
    }
    this.firstModel = config.artifactOverrides?.model ? { ...pinned, ...config.artifactOverrides.model } : pinned
    this.state = this.view()
    ctx.effect(() => {
      void this.task(async () => {
        // A key left by a crash or kill belongs to no server.
        await this.withdrawKey(undefined)
        await this.readInstall()
        this.setServer({ phase: this.activeModel() === undefined ? 'missing' : 'installed' })
        if (this.activeModel() !== undefined) await this.syncRoute()
        if (this.activeModel() !== undefined && config.autoStart && await this.wantsStart()) await this.launch()
      }).catch((error: unknown) => { this.fail(error) })
      return async () => {
        this.lifetime.abort(new Error('llama-cpp disposed'))
        for (const job of this.jobs.values()) job.abort.abort()
        this.launching?.abort()
        // Joining both queues guarantees no launch spawns a server and no download writes after this point.
        await this.downloadQueue
        await this.queue
        await this.terminate()
        this.listeners.clear()
      }
    })
  }

  // ── paths ──────────────────────────────────────────────────────────────

  private get engineDir(): string { return join(this.config.dataRoot, 'engine', `${ENGINE_VERSION}-${this.engine?.flavor ?? 'custom'}`) }
  private get recordPath(): string { return join(this.config.dataRoot, 'install.json') }
  private get downloads(): string { return join(this.config.dataRoot, 'downloads') }
  private get runPath(): string { return join(this.config.dataRoot, 'run.json') }
  private modelDir(id: string): string { return join(this.config.dataRoot, 'models', id) }
  private modelFile(spec: { id: string; sha256: string }): string { return join(this.modelDir(spec.id), `${spec.sha256.slice(0, 16)}.gguf`) }
  private modelPath(model: ModelRecord): string { return isAbsolute(model.file) ? model.file : join(this.config.dataRoot, model.file) }

  /** @returns whether the user left the server running (install and Start say yes, Stop says no). */
  private async wantsStart(): Promise<boolean> {
    try { return (JSON.parse(await readFile(this.runPath, 'utf8')) as { start?: unknown }).start !== false }
    catch { return true }
  }

  private async rememberStart(start: boolean): Promise<void> {
    await mkdir(this.config.dataRoot, { recursive: true })
    await writeFile(this.runPath, `${JSON.stringify({ start })}\n`, { mode: 0o600 })
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
    const progress = downloads.find(item => item.error === undefined)?.progress
    return {
      phase: this.server.phase, provider: this.config.provider,
      model: {
        id: offered.id, name: offered.name, modelBytes: offered.bytes,
        engineBytes: this.config.binaryPath !== undefined || this.engineInstalled ? 0 : this.engine?.bytes ?? 0,
        backend: this.engine?.flavor ?? 'cpu', engineVersion: ENGINE_VERSION,
      },
      ...progress === undefined ? {} : { progress },
      ...this.server.error === undefined ? {} : { error: this.server.error },
      ...this.server.logTail === undefined ? {} : { logTail: this.server.logTail },
      ...this.server.contextSize === undefined ? {} : { contextSize: this.server.contextSize },
      models: this.record.models.map((model): LocalModelEntry => ({
        id: model.id, name: model.name, bytes: model.bytes, source: model.source, active: model.id === this.record.active,
      })),
      downloads,
      catalog: CATALOG.map(entry => ({
        id: entry.id, name: entry.name, bytes: entry.id === this.firstModel.id ? this.firstModel.bytes : entry.bytes,
        repo: entry.repo, recommended: entry.recommended, installed: installed.has(entry.id),
      })),
    }
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

  /** Load the record, keeping only models whose files are still present at their recorded size. */
  private async readInstall(): Promise<void> {
    let raw: InstallRecord | InstallRecordV1 | undefined
    try { raw = JSON.parse(await readFile(this.recordPath, 'utf8')) as InstallRecord | InstallRecordV1 }
    catch { raw = undefined }
    const record: InstallRecord = raw === undefined ? { version: 2, models: [] }
      : raw.version === 1 ? this.fromV1(raw)
        : Array.isArray(raw.models) ? raw : { version: 2, models: [] }
    const models: ModelRecord[] = []
    for (const model of record.models) {
      const size = await stat(this.modelPath(model)).then(info => info.size, () => undefined)
      if (size === model.bytes) models.push(model)
      else this.ctx.logger.warn(`llama-cpp: ${model.name} is missing or changed on disk; it is no longer listed`)
    }
    const active = models.some(model => model.id === record.active) ? record.active : models[0]?.id
    this.record = {
      version: 2, models,
      ...record.engine === undefined ? {} : { engine: record.engine },
      ...active === undefined ? {} : { active },
    }
    this.engineInstalled = await this.engineBinary() !== undefined
  }

  /** Convert the one-model record of earlier builds; its model file stays where it is. */
  private fromV1(v1: InstallRecordV1): InstallRecord {
    const entry = CATALOG.find(model => model.sha256 === v1.model.sha256)
    const id = entry?.id ?? DEFAULT_MODEL_ID
    return {
      version: 2, engine: v1.engine, active: id,
      models: [{ id, name: entry?.name ?? id, file: v1.model.file, bytes: v1.model.bytes, sha256: v1.model.sha256, source: 'catalog', ...entry === undefined ? {} : { repo: entry.repo } }],
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

  /** @returns the server executable when the recorded engine matches the pinned one and is on disk. */
  private async engineBinary(): Promise<string | undefined> {
    if (this.config.binaryPath !== undefined) return this.config.binaryPath
    const engine = this.record.engine
    if (this.engine === undefined || engine === undefined || engine.version !== ENGINE_VERSION
      || engine.backend !== this.engine.flavor || engine.sha256 !== this.engine.sha256) return undefined
    const binary = join(this.engineDir, engine.binary)
    return await exists(binary) ? binary : undefined
  }

  // ── downloads ──────────────────────────────────────────────────────────

  /**
   * First-run install: download the engine and the first-run model, then start the server. With a
   * model already installed it starts the active model instead. Returns once accepted; progress and
   * outcome arrive through {@link follow}.
   */
  install(): void {
    // The boot check decides between starting what is installed and downloading.
    if (this.server.phase === 'checking') { void this.queue.then(() => { this.install() }); return }
    if (this.running !== undefined || this.server.phase === 'starting') return
    if (this.activeModel() !== undefined) { void this.start(); return }
    this.enqueue({ ...this.firstModel, source: 'catalog' })
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
    const name = basename(found.file).replace(/\.gguf$/i, '')
    const id = this.freeId(slug(name))
    this.enqueue({ id, name, url: found.url, sha256: found.sha256, bytes: found.bytes, source: 'huggingface', repo: repo.repo })
    return id
  }

  /**
   * Stop downloads: one by id, or all. Partial files are kept and resumed by the next download of
   * the same model; a failed entry is dismissed.
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

  /** @returns an id no installed model or download uses, derived from `base`. */
  private freeId(base: string): string {
    const taken = (id: string): boolean => this.record.models.some(model => model.id === id) || this.jobs.has(id)
    if (!taken(base)) return base
    let n = 2
    while (taken(`${base}-${String(n)}`)) n++
    return `${base}-${String(n)}`
  }

  private enqueue(spec: ModelSpec): void {
    if (this.lifetime.signal.aborted || this.record.models.some(model => model.id === spec.id)) return
    const current = this.jobs.get(spec.id)
    if (current !== undefined && current.error === undefined) return
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
      const engineNeeded = await this.engineBinary() === undefined
      const engineBytes = engineNeeded ? this.engine?.bytes ?? 0 : 0
      const overallTotalBytes = engineBytes + job.spec.bytes
      const meter = new RateMeter()
      const report = (phase: 'engine' | 'model', receivedBytes: number, totalBytes: number): void => {
        const overallReceivedBytes = (phase === 'model' ? engineBytes : 0) + receivedBytes
        job.progress = {
          phase, receivedBytes, totalBytes, overallReceivedBytes, overallTotalBytes,
          bytesPerSecond: meter.sample(overallReceivedBytes, performance.now()),
        }
        this.emit(true, receivedBytes === totalBytes)
      }
      if (engineNeeded) await this.ensureEngine(signal, (received, total) => { report('engine', received, total) })
      report('model', 0, job.spec.bytes)
      const path = this.modelFile(job.spec)
      await download(job.spec, path, 'model', signal, (received, total) => { report('model', received, total) })
      signal.throwIfAborted()
      await this.task(async () => {
        this.jobs.delete(job.spec.id)
        this.record.models.push({
          id: job.spec.id, name: job.spec.name, file: relative(this.config.dataRoot, path), bytes: job.spec.bytes,
          sha256: job.spec.sha256, source: job.spec.source, repo: job.spec.repo,
        })
        const first = this.record.active === undefined
        if (first) this.record.active = job.spec.id
        await this.writeRecord()
        this.emit()
        if (!first) return
        // The first model installed starts serving right away, as the first-run offer promises.
        await this.rememberStart(true)
        this.setServer({ phase: 'installed' })
        await this.syncRoute()
        await this.launch()
      })
    } catch (error) {
      if (this.jobs.get(job.spec.id) !== job) return
      const cancelled = job.abort.signal.aborted || this.lifetime.signal.aborted
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

  /**
   * Download and unpack the pinned engine, once for every download that needs it.
   * @param signal - cancellation of the download that asked first.
   * @param report - byte progress of the archive.
   * @returns the server executable.
   */
  private ensureEngine(signal: AbortSignal, report: (received: number, total: number) => void): Promise<string> {
    this.engineInstall ??= this.installEngine(signal, report).finally(() => { this.engineInstall = undefined })
    return this.engineInstall
  }

  private async installEngine(signal: AbortSignal, report: (received: number, total: number) => void): Promise<string> {
    const engine = this.engine
    if (engine === undefined) {
      throw new Error(`llama.cpp has no prebuilt ${this.config.backend} build for ${process.platform}-${process.arch}`)
    }
    const existing = await findFile(this.engineDir, engine.executable).catch(() => undefined)
    const binary = existing ?? await this.unpackEngine(engine, signal, report)
    // Not through `task`: a launch inside the queue may be what asked for the engine.
    this.record.engine = {
      version: ENGINE_VERSION, backend: engine.flavor, sha256: engine.sha256, binary: relative(this.engineDir, binary),
    }
    this.engineInstalled = true
    await this.writeRecord()
    return binary
  }

  private async unpackEngine(
    engine: EngineArtifact, signal: AbortSignal, report: (received: number, total: number) => void,
  ): Promise<string> {
    const archive = join(this.downloads, basename(new URL(engine.url, 'file:///').pathname) || `llama-${ENGINE_VERSION}.tar.gz`)
    report(0, engine.bytes)
    await download(engine, archive, 'engine', signal, report)
    const staging = `${this.engineDir}.extracting`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    const tar = this.ctx.subprocess.spawn({
      // `-xf` lets GNU tar and bsdtar detect gzip; bsdtar (macOS, Windows 10+) also reads the Windows zips.
      argv: [await this.tarExecutable(), '-xf', archive, '-C', staging],
      cwd: staging, graceMs: this.config.graceMs, signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 16 * 1024 } },
    })
    const outcome = await tar.done
    if (outcome.exitCode !== 0) {
      await rm(staging, { recursive: true, force: true })
      throw new Error(`could not unpack the engine: ${tail(tar.collected.stderr?.readFrom(0).text) ?? `exit ${String(outcome.exitCode)}`}`)
    }
    const found = await findFile(staging, engine.executable)
    if (found === undefined) {
      await rm(staging, { recursive: true, force: true })
      throw new Error(`the engine archive has no ${engine.executable}`)
    }
    await rm(this.engineDir, { recursive: true, force: true })
    await mkdir(dirname(this.engineDir), { recursive: true })
    await rename(staging, this.engineDir)
    // Builds of other versions or flavours are no longer referenced by the install record.
    for (const entry of await readdir(dirname(this.engineDir))) {
      if (entry !== basename(this.engineDir)) await rm(join(dirname(this.engineDir), entry), { recursive: true, force: true })
    }
    await rm(archive, { force: true })
    const binary = join(this.engineDir, relative(staging, found))
    if (process.platform !== 'win32') await chmod(binary, 0o755)
    return binary
  }

  /**
   * Windows must use its bundled bsdtar: a GNU tar earlier on PATH (Git, MSYS2) can't read zips
   * and reads `C:\\…` as a remote host.
   * @returns the tar executable to unpack engine archives with.
   */
  private async tarExecutable(): Promise<string> {
    if (process.platform === 'win32') return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    return await this.ctx.subprocess.resolveExecutable('tar')
  }

  // ── installed models ───────────────────────────────────────────────────

  /**
   * Add a GGUF file from disk, left where it is. The first model added becomes active and starts.
   * @param path - absolute path of a `.gguf` file.
   * @param name - display name; defaults to the file name.
   * @returns the model id.
   * @throws Error when the path is not an absolute path to a readable GGUF file.
   */
  importModel(path: string, name?: string): Promise<string> {
    return this.task(async () => {
      const file = path.trim()
      if (!isAbsolute(file)) throw new Error('Enter the full path of a .gguf file')
      const info = await stat(file).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new Error(`No file at ${file}`)
      if (!await isGgufFile(file)) throw new Error(`${basename(file)} is not a GGUF model file`)
      const existing = this.record.models.find(model => model.source === 'import' && model.file === file)
      if (existing !== undefined) return existing.id
      const label = name?.trim() || basename(file).replace(/\.gguf$/i, '')
      const id = this.freeId(slug(label))
      this.record.models.push({ id, name: label, file, bytes: info.size, source: 'import' })
      const first = this.record.active === undefined
      if (first) this.record.active = id
      await this.writeRecord()
      this.emit()
      if (first) {
        await this.rememberStart(true)
        this.setServer({ phase: 'installed' })
        await this.syncRoute()
        await this.launch()
      }
      return id
    })
  }

  /**
   * Make an installed model the active one and (re)start the server with it.
   * @param id - installed model id.
   * @returns once the server is running with it or has failed.
   * @throws Error for an id that is not installed.
   */
  select(id: string): Promise<void> {
    if (!this.record.models.some(model => model.id === id)) return Promise.reject(new Error(`no installed model "${id}"`))
    this.launching?.abort()
    return this.task(async () => {
      if (!this.record.models.some(model => model.id === id)) throw new Error(`no installed model "${id}"`)
      const changed = this.record.active !== id
      this.record.active = id
      if (changed) {
        await this.writeRecord()
        await this.terminate()
        this.setServer({ phase: 'installed' })
        await this.syncRoute()
      }
      await this.rememberStart(true)
      await this.launch()
    }).catch((error: unknown) => { this.fail(error) })
  }

  /**
   * Remove an installed model. A downloaded file is deleted; an imported file is only forgotten.
   * Removing the active model makes the next installed model active and restarts the server with
   * it if it was running.
   * @param id - installed model id.
   * @returns once the record and the server reflect the removal.
   */
  removeModel(id: string): Promise<void> {
    if (this.record.active === id) this.launching?.abort()
    return this.task(async () => {
      const model = this.record.models.find(candidate => candidate.id === id)
      if (model === undefined) return
      const wasActive = this.record.active === id
      const wasServing = wasActive && (this.running !== undefined || this.server.phase === 'starting')
      if (wasActive) await this.terminate()
      this.record.models = this.record.models.filter(candidate => candidate.id !== id)
      if (wasActive) {
        const next = this.record.models[0]?.id
        if (next === undefined) delete this.record.active
        else this.record.active = next
      }
      await this.writeRecord()
      if (model.source !== 'import') {
        const file = this.modelPath(model)
        await rm(file, { force: true })
        await rm(`${file}.partial`, { force: true })
        try { await rmdir(dirname(file)) }
        catch (_notEmpty) { /* The directory still holds another file of this model id; it stays. */ }
      }
      if (!wasActive) { this.emit(); return }
      if (this.activeModel() === undefined) {
        await this.withdrawKey(undefined)
        this.setServer({ phase: 'missing' })
        return
      }
      this.setServer({ phase: wasServing ? 'installed' : 'stopped' })
      await this.syncRoute()
      if (wasServing) await this.launch()
    })
  }

  /**
   * Remove the route credential if it is still a key this plugin issued (`expected`, or any
   * `llamacpp-` key when undefined), so a stopped server leaves no usable-looking route behind.
   * @param expected - the key of the server that stopped, if known.
   */
  private async withdrawKey(expected: string | undefined): Promise<void> {
    try {
      const current = (await this.ctx.credentials.resolve(this.keyRef))?.value
      if (current === undefined || (expected === undefined ? !current.startsWith('llamacpp-') : current !== expected)) return
      await this.ctx.credentials.unset(this.keyRef)
    } catch (error) {
      this.ctx.logger.warn('llama-cpp: could not remove the route key')
      this.ctx.logger.warn(error)
    }
    if (this.servingKey === expected) this.servingKey = undefined
  }

  /**
   * Keep the route's model list equal to the active model, so the picker names what the server
   * runs. Skipped without a settings service or namespace, and when the list already matches.
   */
  private async syncRoute(): Promise<void> {
    const settings = this.ctx.get('settings')
    const ns = this.config.routeNamespace
    const active = this.activeModel()
    if (settings === undefined || ns === '' || active === undefined) return
    const models = [{
      id: active.id, name: `${active.name} (local)`,
      contextWindow: this.config.ctxSize > 0 ? this.config.ctxSize : this.config.fitCtx, maxTokens: this.config.routeMaxTokens,
    }]
    try {
      type Section = { providers?: Record<string, { models?: unknown }> } | undefined
      const value = settings.describe().find(row => row.ns === ns)?.value as Section
      if (value?.providers?.[this.config.provider] === undefined) return
      if (JSON.stringify(value.providers[this.config.provider]?.models) === JSON.stringify(models)) return
      await settings.mutate(ns, [{ op: 'set', path: ['providers', this.config.provider, 'models'], value: models }])
    } catch (error) {
      this.ctx.logger.warn(`llama-cpp: could not list ${active.name} on the ${this.config.provider} route`)
      this.ctx.logger.warn(error)
    }
  }

  // ── process ────────────────────────────────────────────────────────────

  /** Start the active model's server, and on later boots. No-op while it is running or starting. */
  start(): Promise<void> {
    return this.task(async () => {
      await this.rememberStart(true)
      await this.launch()
    }).catch((error: unknown) => { this.fail(error) })
  }

  /** Stop the server, also while it is still starting; the install stays and later boots leave it stopped. */
  stop(): Promise<void> {
    this.launching?.abort()
    return this.task(async () => {
      await this.rememberStart(false)
      await this.terminate()
      if (this.activeModel() !== undefined) this.setServer({ phase: 'stopped' })
    })
  }

  /** Stop the server, cancel downloads, delete the engine, downloaded models and partial files, and remove the route key. */
  async uninstall(): Promise<void> {
    for (const job of this.jobs.values()) job.abort.abort(new Error('cancelled'))
    this.launching?.abort()
    // Outside the task: a finishing download commits through the task queue.
    await this.downloadQueue
    await this.task(async () => {
      this.jobs.clear()
      await this.terminate()
      for (const dir of ['engine', 'models', 'downloads']) await rm(join(this.config.dataRoot, dir), { recursive: true, force: true })
      await rm(this.recordPath, { force: true })
      await rm(this.runPath, { force: true })
      await this.withdrawKey(undefined)
      this.record = { version: 2, models: [] }
      this.engineInstalled = false
      this.setServer({ phase: 'missing' })
    })
  }

  private async launch(): Promise<void> {
    if (this.running !== undefined || this.lifetime.signal.aborted) return
    const model = this.activeModel()
    if (model === undefined) { this.setServer({ phase: 'missing' }); return }
    let binary = await this.engineBinary()
    if (binary === undefined) {
      // A model outlived its engine (a newer pinned build); fetch the engine before starting.
      const meter = new RateMeter()
      const total = this.engine?.bytes ?? 0
      binary = await this.ensureEngine(this.lifetime.signal, (receivedBytes, totalBytes) => {
        this.server = { phase: 'downloading' }
        const progress: LlamaCppProgress = {
          phase: 'engine', receivedBytes, totalBytes, overallReceivedBytes: receivedBytes, overallTotalBytes: total,
          bytesPerSecond: meter.sample(receivedBytes, performance.now()),
        }
        this.state = { ...this.view(), progress }
        for (const listener of this.listeners) listener()
      })
    }
    const launching = new AbortController()
    this.launching = launching
    const signal = AbortSignal.any([launching.signal, this.lifetime.signal])
    try {
      this.setServer({ phase: 'starting' })
      const origin = `http://127.0.0.1:${this.config.port}`
      if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
        throw new Error(`port ${this.config.port} is already in use; stop what is using it or move the local model to another port`)
      }
      // Dispose or Stop may have landed during the awaits above; never spawn an orphan.
      if (signal.aborted) return
      const key = `llamacpp-${randomBytes(32).toString('base64url')}`
      const cwd = dirname(binary)
      const argv = [
        binary, '-m', this.modelPath(model), '--alias', model.id,
        '--host', '127.0.0.1', '--port', String(this.config.port),
        '--jinja', '--no-webui',
        // Flash attention lets the V cache be quantized too.
        '-fa', 'on', '-ctk', this.config.cacheType, '-ctv', this.config.cacheType,
        ...this.config.threads === undefined ? [] : ['-t', String(this.config.threads)],
        ...this.fitArgs(),
      ]
      const handle = this.ctx.subprocess.spawn({
        argv, cwd, graceMs: this.config.graceMs,
        // The key travels in the environment so it never shows in `ps`.
        env: { LLAMA_API_KEY: key, ...libraryPath(cwd) },
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      })
      const running: Running = { handle, key, stopping: false }
      this.running = running
      const logs = (): string | undefined => tail(
        [handle.collected.stdout?.readFrom(0).text, handle.collected.stderr?.readFrom(0).text].filter(Boolean).join('\n'))
      // Set by the exit handler while the readiness loop below awaits; read through a call so it is re-read.
      let exitSeen = false
      const exited = (): boolean => exitSeen
      void handle.done.then(async (outcome) => {
        exitSeen = true
        if (this.running === running) this.running = undefined
        await this.withdrawKey(key)
        if (running.stopping || this.lifetime.signal.aborted) return
        this.fail(new Error(`the local model server exited (${outcome.signal ?? `code ${String(outcome.exitCode)}`})`), logs())
      })
      const deadline = Date.now() + this.config.startTimeoutMs
      while (!exited()) {
        if (aborted(signal)) { await this.terminate(); return }
        // 503 while the model loads, 200 once it serves.
        const ok = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })
          .then(response => response.ok, () => false)
        if (ok && !exited()) {
          // Another server could have taken the port between the probe and the bind; ours knows the key.
          const ours = await fetch(`${origin}/v1/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2000) })
            .then(response => response.ok, () => false)
          if (!ours) {
            await this.terminate()
            throw new Error(`another server answers on port ${this.config.port}; stop it or move the local model to another port`)
          }
          const contextSize = await this.readContextSize(origin, key)
          this.servingKey = key
          await this.ctx.credentials.set(this.keyRef, key)
          this.setServer({ phase: 'running', ...contextSize === undefined ? {} : { contextSize } })
          if (contextSize !== undefined && contextSize < this.config.fitCtx) {
            this.ctx.logger.warn(`llama-cpp: the server runs with a ${contextSize}-token context; the harness prompt needs about 12k`)
          }
          await this.adoptDefault(model.id)
          return
        }
        if (Date.now() > deadline) {
          await this.terminate()
          const logTail = logs()
          this.setServer({ phase: 'failed', error: 'the local model server did not become ready in time', ...logTail === undefined ? {} : { logTail } })
          return
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      // The exit handler has published the failure with its log tail.
    } finally {
      if (this.launching === launching) this.launching = undefined
    }
  }

  /**
   * Sizing flags. `--fit` only adjusts arguments that are left unset, so with fit on the GPU
   * layer count is omitted (fit offloads as many layers as device memory allows on Metal and
   * Vulkan) and the context is omitted only when `ctxSize` is 0.
   * @returns the `-c`, `-ngl` and `--fit*` arguments.
   */
  private fitArgs(): string[] {
    const { ctxSize, fit, fitTargetMiB, fitCtx, gpuLayers } = this.config
    const gpu = this.engine?.gpu === true || this.config.binaryPath !== undefined
    const context = ctxSize > 0 ? ['-c', String(ctxSize)] : []
    if (fit) {
      return [
        ...context, '--fit', 'on', '--fit-target', String(fitTargetMiB),
        ...ctxSize > 0 ? [] : ['--fit-ctx', String(fitCtx)],
        ...gpu && gpuLayers !== undefined ? ['-ngl', String(gpuLayers)] : gpu ? [] : ['-ngl', '0'],
      ]
    }
    return [
      ...ctxSize > 0 ? context : ['-c', String(fitCtx)],
      '--fit', 'off', '-ngl', gpu ? String(gpuLayers ?? 999) : '0',
    ]
  }

  /**
   * Read the context the server settled on (after `--fit`), for the UI.
   * @param origin - server origin.
   * @param key - server API key.
   * @returns the per-server context size, if the server reports it.
   */
  private async readContextSize(origin: string, key: string): Promise<number | undefined> {
    try {
      const response = await fetch(`${origin}/props`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2000) })
      if (!response.ok) return undefined
      const props = await response.json() as { default_generation_settings?: { n_ctx?: unknown } }
      const value = props.default_generation_settings?.n_ctx
      return typeof value === 'number' && value > 0 ? value : undefined
    } catch { return undefined }
  }

  /**
   * Point the default model at the active local model when the default is a different local
   * model, or when the configured default route cannot serve (e.g. Tokamak with no key). A usable
   * default on another route is left alone.
   * @param id - the active model id.
   */
  private async adoptDefault(id: string): Promise<void> {
    const defaults = this.ctx.get('agentDefaultModel')
    const llm = this.ctx.get('llm')
    if (defaults === undefined || llm === undefined) return
    try {
      const current = defaults.currentSelection()
      if (current.provider === this.config.provider && current.model === id) return
      if (current.provider !== this.config.provider) {
        const usable = await llm.listModels(current.provider).then(models => models.length > 0, () => false)
        if (usable) return
      }
      await defaults.saveSelection({ provider: this.config.provider, model: id })
      this.ctx.logger.info(`llama-cpp: default model set to ${this.config.provider}/${id}`)
    } catch (error) {
      this.ctx.logger.warn('llama-cpp: could not update the default model')
      this.ctx.logger.warn(error)
    }
  }

  private async terminate(): Promise<void> {
    const running = this.running
    if (running === undefined) return
    running.stopping = true
    running.handle.terminate()
    await running.handle.done.catch(() => undefined)
    if (this.running === running) this.running = undefined
    await this.withdrawKey(running.key)
  }
}

/**
 * Whether a file starts with the GGUF magic.
 * @param path - file to read.
 * @returns true for a GGUF file.
 */
async function isGgufFile(path: string): Promise<boolean> {
  const handle = await openFile(path, 'r')
  try {
    const head = Buffer.alloc(4)
    const { bytesRead } = await handle.read(head, 0, 4, 0)
    return bytesRead === 4 && isGguf(head)
  } finally {
    await handle.close()
  }
}

export default LlamaCpp
