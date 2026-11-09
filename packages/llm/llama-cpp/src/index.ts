/**
 * Managed local llama.cpp: downloads a pinned `llama-server` build and one pinned GGUF model,
 * verifies both, and supervises the server on a fixed loopback port.
 *
 * The model is served through an `llm-pi-ai` route (`local` by default) whose `apiKeyEnv` names
 * {@link Config.apiKeyRef}. The key is generated on first install and stored through the
 * credentials service; until then the route resolves no key and offers no models, so nothing
 * appears in the model picker before the install finishes.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import { DEFAULT_MODEL, ENGINE_VERSION, engineFor, SMALL_MODEL, type EngineArtifact, type ModelArtifact } from './artifacts.ts'
import { Config } from './config.ts'
import { download } from './download.ts'
import type { LlamaCppPhase, LlamaCppProgress, LlamaCppState } from './types.ts'

export type * from './types.ts'
export { Config } from './config.ts'
export { DEFAULT_MODEL, ENGINE_VERSION, ENGINES, engineFor, SMALL_MODEL } from './artifacts.ts'
export type { EngineArtifact, EngineTarget } from './artifacts.ts'
export { download, DownloadError, isVerified } from './download.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Managed local llama.cpp model. */
    llamaCpp: LlamaCpp
  }
}

/** Installed facts written after verification, so boot does not re-hash a multi-GB file. */
interface InstallRecord {
  version: 1
  engine: { version: string; backend: string; sha256: string; binary: string }
  model: { sha256: string; bytes: number; file: string }
}

const LOG_LINES = 20

interface Running {
  handle: SubprocessHandle
  stopping: boolean
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

/** One local engine with one model; every mutation is serialized through {@link LlamaCpp.task}. */
export class LlamaCpp extends Service {
  static inject = ['subprocess', 'credentials']
  static Config = Config

  private state: LlamaCppState
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private installing: AbortController | undefined
  private running: Running | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private lastProgressAt = 0
  private readonly keyRef: CredentialRef
  /** Pinned engine for this machine; undefined where llama.cpp publishes no prebuilt build. */
  private readonly engine: EngineArtifact | undefined
  private readonly model: ModelArtifact

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'llamaCpp')
    if (!isAbsolute(config.dataRoot)) throw new Error(`llama-cpp: dataRoot must be absolute: ${config.dataRoot}`)
    this.keyRef = credentialRef(config.apiKeyRef)
    const pinned = config.model === 'small' ? SMALL_MODEL : DEFAULT_MODEL
    const pinnedEngine = engineFor({ platform: process.platform, arch: process.arch, backend: config.backend })
    const override = config.artifactOverrides?.engine
    this.engine = override === undefined ? pinnedEngine : {
      executable: process.platform === 'win32' ? 'llama-server.exe' : 'llama-server', gpu: false, flavor: 'cpu',
      ...pinnedEngine, ...override,
    }
    if (this.engine === undefined && config.binaryPath === undefined) {
      ctx.logger.warn(`llama-cpp: llama.cpp publishes no prebuilt ${config.backend} build for ${process.platform}-${process.arch}; set binaryPath`)
    }
    this.model = config.artifactOverrides?.model ? { ...pinned, ...config.artifactOverrides.model } : pinned
    this.state = {
      phase: 'checking',
      provider: config.provider,
      model: {
        id: this.model.id, name: this.model.name, modelBytes: this.model.bytes,
        engineBytes: config.binaryPath === undefined ? this.engine?.bytes ?? 0 : 0,
        backend: this.engine?.flavor ?? 'cpu', engineVersion: ENGINE_VERSION,
      },
    }
    ctx.effect(() => {
      void this.task(async () => {
        const installed = await this.readInstall()
        this.publish({ phase: installed ? 'installed' : 'missing' })
        if (installed && config.autoStart) await this.launch()
      }).catch((error: unknown) => { this.fail(error) })
      return async () => {
        this.lifetime.abort(new Error('llama-cpp disposed'))
        this.installing?.abort()
        await this.terminate()
        this.listeners.clear()
      }
    })
  }

  // ── paths ──────────────────────────────────────────────────────────────

  private get engineDir(): string { return join(this.config.dataRoot, 'engine', `${ENGINE_VERSION}-${this.engine?.flavor ?? 'custom'}`) }
  private get modelPath(): string { return join(this.config.dataRoot, 'models', this.model.id, `${this.model.sha256.slice(0, 16)}.gguf`) }
  private get recordPath(): string { return join(this.config.dataRoot, 'install.json') }
  private get downloads(): string { return join(this.config.dataRoot, 'downloads') }

  // ── state ──────────────────────────────────────────────────────────────

  /**
   * Read the current state.
   * @returns phase, model facts and progress; never paths or keys.
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
        if (signal.aborted) break
        wake = Promise.withResolvers<undefined>()
        changed = false
        yield this.state
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  private publish(next: { phase: LlamaCppPhase; progress?: LlamaCppProgress; error?: string; logTail?: string }): void {
    const previous = this.state
    this.state = {
      phase: next.phase, provider: previous.provider, model: previous.model,
      ...next.progress ? { progress: next.progress } : {},
      ...next.error === undefined ? {} : { error: next.error },
      ...next.logTail === undefined ? {} : { logTail: next.logTail },
    }
    if (next.phase === 'downloading' && previous.phase === 'downloading' && next.progress
      && next.progress.receivedBytes !== next.progress.totalBytes
      && performance.now() - this.lastProgressAt < this.config.progressIntervalMs) return
    this.lastProgressAt = performance.now()
    for (const listener of this.listeners) listener()
  }

  private fail(error: unknown, logTail?: string): void {
    if (this.lifetime.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    this.ctx.logger.warn(`llama-cpp: ${message}`)
    this.publish({ phase: 'failed', error: message, ...logTail === undefined ? {} : { logTail } })
  }

  private task<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  // ── install ────────────────────────────────────────────────────────────

  private async readInstall(): Promise<InstallRecord | undefined> {
    if (this.config.binaryPath !== undefined) {
      return await exists(this.modelPath) ? this.recordFor(this.config.binaryPath) : undefined
    }
    let record: InstallRecord
    try { record = JSON.parse(await readFile(this.recordPath, 'utf8')) as InstallRecord }
    catch { return undefined }
    if (this.engine === undefined || record.version !== 1 || record.engine.version !== ENGINE_VERSION
      || record.engine.backend !== this.engine.flavor || record.engine.sha256 !== this.engine.sha256
      || record.model.sha256 !== this.model.sha256) return undefined
    const binary = join(this.engineDir, record.engine.binary)
    const size = await stat(this.modelPath).then(info => info.size, () => undefined)
    if (size !== this.model.bytes || !await exists(binary)) return undefined
    return record
  }

  private recordFor(binary: string): InstallRecord {
    return {
      version: 1,
      engine: { version: ENGINE_VERSION, backend: this.engine?.flavor ?? 'custom', sha256: this.engine?.sha256 ?? '', binary },
      model: { sha256: this.model.sha256, bytes: this.model.bytes, file: relative(this.config.dataRoot, this.modelPath) },
    }
  }

  /**
   * Download what is missing, then start the server. Joins an install already in progress.
   * Resolves when the install task is accepted; progress and outcome arrive through {@link follow}.
   */
  install(): void {
    if (this.installing || this.state.phase === 'running' || this.state.phase === 'starting') return
    const abort = new AbortController()
    this.installing = abort
    void this.task(async () => {
      const signal = AbortSignal.any([abort.signal, this.lifetime.signal])
      let binary = this.config.binaryPath
      if (binary === undefined) binary = await this.installEngine(signal)
      this.publish({ phase: 'downloading', progress: { phase: 'model', receivedBytes: 0, totalBytes: this.model.bytes } })
      await download(this.model, this.modelPath, 'model', signal, (receivedBytes, totalBytes) => {
        this.publish({ phase: 'downloading', progress: { phase: 'model', receivedBytes, totalBytes } })
      })
      signal.throwIfAborted()
      const record = this.recordFor(this.config.binaryPath === undefined ? relative(this.engineDir, binary) : binary)
      await writeFile(this.recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      await this.ensureKey()
      this.publish({ phase: 'installed' })
      this.installing = undefined
      await this.launch()
    }).catch((error: unknown) => {
      const cancelled = abort.signal.aborted
      if (this.installing === abort) this.installing = undefined
      if (cancelled) {
        if (!this.lifetime.signal.aborted) this.publish({ phase: 'missing' })
        return
      }
      this.fail(error)
    })
  }

  /** Stop an install in progress; the partial download is kept and resumed by the next {@link install}. */
  async cancel(): Promise<void> {
    this.installing?.abort(new Error('cancelled'))
    await this.queue
  }

  private async installEngine(signal: AbortSignal): Promise<string> {
    const engine = this.engine
    if (engine === undefined) {
      throw new Error(`llama.cpp has no prebuilt ${this.config.backend} build for ${process.platform}-${process.arch}`)
    }
    const existing = await findFile(this.engineDir, engine.executable).catch(() => undefined)
    if (existing !== undefined) return existing
    const archive = join(this.downloads, basename(new URL(engine.url, 'file:///').pathname) || `llama-${ENGINE_VERSION}.tar.gz`)
    this.publish({ phase: 'downloading', progress: { phase: 'engine', receivedBytes: 0, totalBytes: engine.bytes } })
    await download(engine, archive, 'engine', signal, (receivedBytes, totalBytes) => {
      this.publish({ phase: 'downloading', progress: { phase: 'engine', receivedBytes, totalBytes } })
    })
    const staging = `${this.engineDir}.extracting`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    const tar = this.ctx.subprocess.spawn({
      // `-xf` lets GNU tar and bsdtar detect gzip; bsdtar (macOS, Windows 10+) also reads the Windows zips.
      argv: [await this.ctx.subprocess.resolveExecutable('tar'), '-xf', archive, '-C', staging],
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
    await rm(archive, { force: true })
    const binary = join(this.engineDir, relative(staging, found))
    if (process.platform !== 'win32') await chmod(binary, 0o755)
    return binary
  }

  private async ensureKey(): Promise<string> {
    const current = (await this.ctx.credentials.resolve(this.keyRef))?.value
    if (current !== undefined && current.length > 0) return current
    const key = `llamacpp-${randomBytes(32).toString('base64url')}`
    await this.ctx.credentials.set(this.keyRef, key)
    return key
  }

  // ── process ────────────────────────────────────────────────────────────

  /** Start the installed server. No-op while it is running or starting. */
  start(): Promise<void> {
    return this.task(() => this.launch()).catch((error: unknown) => { this.fail(error) })
  }

  /** Stop the server; the install stays. */
  stop(): Promise<void> {
    return this.task(async () => {
      await this.terminate()
      if (await this.readInstall()) this.publish({ phase: 'stopped' })
    })
  }

  /** Stop the server, delete the engine, model and partial downloads, and remove the route key. */
  uninstall(): Promise<void> {
    this.installing?.abort(new Error('cancelled'))
    return this.task(async () => {
      await this.terminate()
      for (const dir of ['engine', 'models', 'downloads']) await rm(join(this.config.dataRoot, dir), { recursive: true, force: true })
      await rm(this.recordPath, { force: true })
      await this.ctx.credentials.unset(this.keyRef).catch(() => undefined)
      this.publish({ phase: 'missing' })
    })
  }

  private async launch(): Promise<void> {
    if (this.running !== undefined) return
    const record = await this.readInstall()
    if (record === undefined) { this.publish({ phase: 'missing' }); return }
    this.publish({ phase: 'starting' })
    const origin = `http://127.0.0.1:${this.config.port}`
    if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
      throw new Error(`port ${this.config.port} is already in use; stop what is using it or move the local model to another port`)
    }
    const key = await this.ensureKey()
    const binary = this.config.binaryPath ?? join(this.engineDir, record.engine.binary)
    const cwd = dirname(binary)
    const argv = [
      binary, '-m', this.modelPath, '--alias', this.model.id,
      '--host', '127.0.0.1', '--port', String(this.config.port),
      '-c', String(this.config.ctxSize), '--jinja', '--no-webui',
      // Flash attention lets the V cache be quantized too.
      '-fa', 'on', '-ctk', this.config.cacheType, '-ctv', this.config.cacheType,
      ...this.config.threads === undefined ? [] : ['-t', String(this.config.threads)],
      // Metal (Apple Silicon) and Vulkan builds offload layers; CPU builds keep them in RAM.
      '-ngl', this.engine?.gpu === true ? String(this.config.gpuLayers) : '0',
    ]
    const handle = this.ctx.subprocess.spawn({
      argv, cwd, graceMs: this.config.graceMs,
      // The key travels in the environment so it never shows in `ps`.
      env: { LLAMA_API_KEY: key, ...libraryPath(cwd) },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
    })
    const running: Running = { handle, stopping: false }
    this.running = running
    const logs = (): string | undefined => tail(
      [handle.collected.stdout?.readFrom(0).text, handle.collected.stderr?.readFrom(0).text].filter(Boolean).join('\n'))
    let exited = false
    void handle.done.then((outcome) => {
      exited = true
      if (this.running === running) this.running = undefined
      if (running.stopping || this.lifetime.signal.aborted) return
      this.fail(new Error(`the local model server exited (${outcome.signal ?? `code ${String(outcome.exitCode)}`})`), logs())
    })
    const deadline = Date.now() + this.config.startTimeoutMs
    while (!exited) {
      const ok = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })
        .then(response => response.ok, () => false)
      if (ok) {
        this.publish({ phase: 'running' })
        await this.adoptDefault()
        return
      }
      if (Date.now() > deadline) {
        running.stopping = true
        await this.terminate()
        const logTail = logs()
        this.publish({ phase: 'failed', error: 'the local model server did not become ready in time', ...logTail === undefined ? {} : { logTail } })
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    // The exit handler has published the failure with its log tail.
  }

  /**
   * Make the local model the default for new sessions when the configured default
   * route cannot serve (e.g. Tokamak with no key). A usable default is left alone.
   */
  private async adoptDefault(): Promise<void> {
    const defaults = this.ctx.get('agentDefaultModel')
    const llm = this.ctx.get('llm')
    if (defaults === undefined || llm === undefined) return
    try {
      const current = defaults.currentSelection()
      if (current.provider === this.config.provider) return
      const usable = await llm.listModels(current.provider).then(models => models.length > 0, () => false)
      if (usable) return
      await defaults.saveSelection({ provider: this.config.provider, model: this.model.id })
      this.ctx.logger.info(`llama-cpp: default model set to ${this.config.provider}/${this.model.id}`)
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
  }
}

export default LlamaCpp
