/**
 * Managed local llama.cpp: downloads any number of verified GGUF models (curated, from a Hugging
 * Face repository, or imported from disk) and supervises the bundled `jan-llama-worker`, which
 * serves the active model on an OS-assigned loopback port.
 *
 * The active model is served through an `llm-pi-ai` route (`local` by default) whose `apiKeyEnv`
 * and `baseURLEnv` name {@link Config.apiKeyRef} and {@link Config.baseURLRef}. A fresh key and the
 * worker's endpoint are stored through the credentials service each time the worker becomes ready
 * and withdrawn when it stops, so the route offers no models while nothing serves. When a settings
 * service is mounted, the route's model list is kept equal to the active model
 * ({@link Config.routeNamespace}).
 */
import { randomBytes } from 'node:crypto'
import { constants, open as openFile, access, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
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
import { renderPreset } from './preset.ts'
import { isGguf, RateMeter } from './rate.ts'
import type {
  HuggingFaceRepoInfo, LlamaCppDownload, LlamaCppPhase, LlamaCppProgress, LlamaCppState, LocalModelEntry, LocalModelSource,
} from './types.ts'
import { describeExit, parseHandshake, readFirstLine, WorkerClient, WorkerProtocolError } from './worker.ts'

export type * from './types.ts'
export { Config } from './config.ts'
export { CATALOG, catalogModel, DEFAULT_MODEL_ID, SMALL_MODEL_ID } from './catalog.ts'
export type { CatalogModel } from './catalog.ts'
export { download, DownloadError, isVerified } from './download.ts'
export { HuggingFaceLookupError, lookupRepo, parseRepo } from './huggingface.ts'
export type { HuggingFaceFile, HuggingFaceRepo } from './huggingface.ts'
export { renderPreset } from './preset.ts'
export type { PresetDefaults, PresetModel } from './preset.ts'
export { isGguf, RateMeter } from './rate.ts'
export { describeExit, parseHandshake, WorkerProtocolError } from './worker.ts'
export type { WorkerDevice, WorkerHandshake } from './worker.ts'

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
}

/** Installed facts written after verification, so boot does not re-hash multi-GB files. */
interface InstallRecord {
  version: 2
  models: ModelRecord[]
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
  /** Installed model id the worker's route section was last loaded with. */
  served?: string
  stopping: boolean
  /** Set when {@link LlamaCpp.terminate} had to kill it. */
  forced?: boolean
  outcome?: SubprocessOutcome
}

/** Worker-side fields of the state; the model list, downloads and catalog are derived on publish. */
interface ServerState {
  phase: LlamaCppPhase
  error?: string
  logTail?: string
  contextSize?: number
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
  private record: InstallRecord = { version: 2, models: [] }
  /** Record writes in order. */
  private recordWrite: Promise<unknown> = Promise.resolve()
  private readonly keyRef: CredentialRef
  private readonly baseURLRef: CredentialRef
  /** The model the first-run offer installs. */
  private readonly firstModel: CatalogModel

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'llamaCpp')
    if (!isAbsolute(config.dataRoot)) throw new Error(`llama-cpp: dataRoot must be absolute: ${config.dataRoot}`)
    if (config.workerPath !== undefined && !isAbsolute(config.workerPath)) {
      throw new Error(`llama-cpp: workerPath must be absolute: ${config.workerPath}`)
    }
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
        try { await this.workerExecutable() }
        catch (error) { this.fail(error); return }
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
  private modelPath(model: ModelRecord): string { return isAbsolute(model.file) ? model.file : join(this.config.dataRoot, model.file) }

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
    return {
      phase: this.server.phase, provider: this.config.provider,
      model: { id: offered.id, name: offered.name, modelBytes: offered.bytes },
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
    // Earlier builds downloaded a llama-server engine here; the bundled worker replaces it.
    for (const legacy of ['engine', 'downloads']) await rm(join(this.config.dataRoot, legacy), { recursive: true, force: true })
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
    this.record = { version: 2, models, ...active === undefined ? {} : { active } }
  }

  /** Convert the one-model record of earlier builds; its model file stays where it is. */
  private fromV1(v1: InstallRecordV1): InstallRecord {
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
    const taken = (id: string): boolean => this.record.models.some(model => model.id === id) || this.jobs.has(id)
      || catalogModel(id) !== undefined
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
      await this.task(async () => {
        // Cancel or uninstall may have landed while this commit waited behind another task.
        signal.throwIfAborted()
        const previous = this.record
        const first = previous.active === undefined
        this.record = {
          ...previous,
          models: [...previous.models, {
            id: job.spec.id, name: job.spec.name, file: relative(this.config.dataRoot, path), bytes: job.spec.bytes,
            sha256: job.spec.sha256, source: job.spec.source, repo: job.spec.repo,
          }],
          ...first ? { active: job.spec.id } : {},
        }
        try { await this.writeRecord() }
        catch (error) { this.record = previous; throw error }
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
      const previous = this.record
      const first = previous.active === undefined
      this.record = {
        ...previous, models: [...previous.models, { id, name: label, file, bytes: info.size, source: 'import' }],
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
      }
      return id
    })
  }

  /**
   * Make an installed model the active one and serve it. A running worker reloads its preset instead
   * of restarting.
   * @param id - installed model id.
   * @returns once the worker serves it or has failed.
   * @throws Error for an id that is not installed.
   */
  select(id: string): Promise<void> {
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
        await this.syncRoute()
      }
      await this.rememberStart(true)
      await this.serveActive()
    }).catch((error: unknown) => { this.fail(error) })
  }

  /**
   * Remove an installed model. A downloaded file is deleted; an imported file is only forgotten.
   * Removing the active model makes the next installed model active and, if the worker was serving,
   * serves that one.
   * @param id - installed model id.
   * @returns once the record and the worker reflect the removal.
   */
  removeModel(id: string): Promise<void> {
    if (this.record.active === id) this.launching?.abort()
    return this.task(async () => {
      const model = this.record.models.find(candidate => candidate.id === id)
      if (model === undefined) return
      const wasActive = this.record.active === id
      const wasServing = wasActive && this.running !== undefined
      this.record.models = this.record.models.filter(candidate => candidate.id !== id)
      if (wasActive) {
        const next = this.record.models[0]?.id
        if (next === undefined) delete this.record.active
        else this.record.active = next
      }
      await this.writeRecord()
      if (wasActive) {
        if (this.activeModel() === undefined) {
          await this.terminate()
          this.setServer({ phase: 'missing' })
        } else {
          this.setServer({ phase: wasServing ? 'installed' : 'stopped' })
          await this.syncRoute()
          // Before the file goes: Windows cannot delete a model the worker still maps.
          if (wasServing) await this.serveActive()
        }
      } else {
        this.emit()
      }
      if (model.source !== 'import') {
        const file = this.modelPath(model)
        await rm(file, { force: true })
        await rm(`${file}.partial`, { force: true })
        try { await rmdir(dirname(file)) }
        catch (_notEmpty) { /* The directory still holds another file of this model id; it stays. */ }
      }
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
   * Keep the route's model list equal to the active model, so the picker names what the worker
   * serves. Skipped without a settings service or namespace, and when the list already matches.
   */
  private async syncRoute(): Promise<void> {
    const settings = this.ctx.get('settings')
    const ns = this.config.routeNamespace
    const active = this.activeModel()
    if (settings === undefined || ns === '' || active === undefined) return
    const models = [{
      id: this.config.routeModelId, name: `${active.name} (local)`,
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

  /** Stop the worker, cancel downloads, delete downloaded models and partial files, and remove the route credentials. */
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
      for (const dir of ['models', 'run']) await rm(join(this.config.dataRoot, dir), { recursive: true, force: true })
      await rm(this.recordPath, { force: true })
      await rm(this.runPath, { force: true })
      await this.withdrawRoute(undefined)
      this.record = { version: 2, models: [] }
      this.setServer({ phase: 'missing' })
    })
  }

  /**
   * Start the worker with the active model. Never rejects: a failure is published as the `failed`
   * phase, so every caller (start, select, a finished first download, import, removal) reports it alike.
   */
  private async launch(): Promise<void> {
    try { await this.launchOnce() }
    catch (error) { this.fail(error) }
  }

  /** Serve the active model: reload a running worker's preset, or start one. Never rejects. */
  private async serveActive(): Promise<void> {
    const running = this.running
    const active = this.activeModel()
    if (running?.client === undefined || running.stopping || active === undefined) { await this.launch(); return }
    if (running.served === active.id && this.server.phase === 'running') return
    const switching = new AbortController()
    this.launching = switching
    try {
      this.setServer({ phase: 'starting' })
      await this.writePreset(active)
      const signal = this.startSignal(switching)
      await abortable(running.client.reload(this.presetPath, this.config.modelsMax, signal), signal)
      await this.loadActive(running, running.client, signal)
    } catch (error) {
      await this.terminate()
      this.reportStartFailure(error, switching, running)
    } finally {
      if (this.launching === switching) this.launching = undefined
    }
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
      await this.writePreset(model)
      // Dispose or Stop may have landed during the awaits above; never spawn an orphan.
      if (aborted(launching.signal) || aborted(this.lifetime.signal)) return
      const signal = this.startSignal(launching)
      const key = `llamacpp-${randomBytes(32).toString('base64url')}`
      const handle = this.ctx.subprocess.spawn({
        argv: [worker, '--preset', this.presetPath, '--port', '0', '--models-max', String(this.config.modelsMax)],
        cwd: dirname(worker), graceMs: this.config.graceMs,
        // The key travels in the environment so it never shows in `ps`.
        env: { JAN_LLAMA_API_KEY: key },
        // Closing stdin is the worker's graceful stop; its end of file also stops an orphan.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
      })
      handle.stdin?.on('error', (_closed: unknown) => { /* EPIPE once the worker exited; its exit is reported through `done`. */ })
      const current: Running = { handle, key, stopping: false }
      running = current
      this.running = current
      const logs = (): string | undefined => tail(handle.collected.stderr?.readFrom(0).text)
      const exited = (failure: Error): void => {
        if (this.running === current) this.running = undefined
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
      if (!handshake.models.includes(this.config.routeModelId)) {
        throw new WorkerProtocolError(`the local model worker serves no "${this.config.routeModelId}" model`)
      }
      const client = new WorkerClient(`http://127.0.0.1:${String(handshake.port)}`, key)
      current.client = client
      await this.loadActive(current, client, signal)
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
   * Publish why a start or switch ended early. Stop, select, removal and disposal end it on purpose
   * and publish their own phase.
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
   * Load the active model in a ready worker, publish the route, and report `running`.
   * @param running - the worker.
   * @param client - its lifecycle client.
   * @param signal - the start's signal.
   */
  private async loadActive(running: Running, client: WorkerClient, signal: AbortSignal): Promise<void> {
    const model = this.activeModel()
    if (model === undefined) throw new Error('no model is active')
    const id = this.config.routeModelId
    try { await abortable(client.load(id, signal), signal) }
    catch (error) {
      if (signal.aborted) throw error
      throw new Error(`could not load ${model.name}: ${messageOf(error)}`, { cause: error })
    }
    running.served = model.id
    const contextSize = await abortable(client.contextSize(id, signal), signal)
    await this.publishRoute(running, client)
    this.setServer({ phase: 'running', ...contextSize === undefined ? {} : { contextSize } })
    if (contextSize !== undefined && contextSize < this.config.fitCtx) {
      this.ctx.logger.warn(`llama-cpp: the worker runs with a ${String(contextSize)}-token context; the harness prompt needs about 12k`)
    }
    await this.adoptDefault(id)
  }

  /** Write the preset for the active model through a temporary file, so the worker never reads half of it. */
  private async writePreset(model: ModelRecord): Promise<void> {
    await mkdir(dirname(this.presetPath), { recursive: true })
    const temp = `${this.presetPath}.tmp`
    await writeFile(temp, renderPreset(this.config, [{ id: this.config.routeModelId, path: this.modelPath(model) }]), { mode: 0o600 })
    await rename(temp, this.presetPath)
  }

  /**
   * Point the default model at the local route's model when the default is another local model id
   * (an earlier build served each model under its own id), or when the configured default route
   * cannot serve (e.g. Tokamak with no key). A usable default on another route is left alone.
   * @param id - the route's model id.
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

  /**
   * Stop the worker: close its stdin so it drains requests and saves KV state, then terminate it if
   * it has not exited within {@link Config.stopTimeoutMs}.
   */
  private async terminate(): Promise<void> {
    const running = this.running
    if (running === undefined) return
    running.stopping = true
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
    if (this.running === running) this.running = undefined
    await this.withdrawRoute(running.key)
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
