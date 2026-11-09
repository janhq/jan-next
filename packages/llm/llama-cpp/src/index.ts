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
  /** Key this server requires; withdrawn from the route once it stops. */
  key: string
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
  /** Aborts the readiness wait of a launch in progress (stop, remove, dispose). */
  private launching: AbortController | undefined
  private running: Running | undefined
  /** Key the running server requires; published as the route credential only while it serves. */
  private servingKey: string | undefined
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
        // A key left by a crash or kill belongs to no server.
        await this.withdrawKey(undefined)
        const installed = await this.readInstall()
        this.publish({ phase: installed ? 'installed' : 'missing' })
        if (installed && config.autoStart && await this.wantsStart()) await this.launch()
      }).catch((error: unknown) => { this.fail(error) })
      return async () => {
        this.lifetime.abort(new Error('llama-cpp disposed'))
        this.installing?.abort()
        this.launching?.abort()
        // Joining the queue guarantees no launch spawns a server after this point.
        await this.queue
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
  private get runPath(): string { return join(this.config.dataRoot, 'run.json') }

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

  private publish(next: {
    phase: LlamaCppPhase
    progress?: LlamaCppProgress
    error?: string
    logTail?: string
    contextSize?: number
  }): void {
    const previous = this.state
    this.state = {
      phase: next.phase, provider: previous.provider, model: previous.model,
      ...next.progress ? { progress: next.progress } : {},
      ...next.error === undefined ? {} : { error: next.error },
      ...next.logTail === undefined ? {} : { logTail: next.logTail },
      ...next.contextSize === undefined ? {} : { contextSize: next.contextSize },
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
    if (this.installing || this.running !== undefined || this.state.phase === 'starting') return
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
      await this.rememberStart(true)
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

  // ── process ────────────────────────────────────────────────────────────

  /** Start the installed server, and on later boots. No-op while it is running or starting. */
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
      if (await this.readInstall()) this.publish({ phase: 'stopped' })
    })
  }

  /** Stop the server, delete the engine, model and partial downloads, and remove the route key. */
  uninstall(): Promise<void> {
    this.installing?.abort(new Error('cancelled'))
    this.launching?.abort()
    return this.task(async () => {
      await this.terminate()
      for (const dir of ['engine', 'models', 'downloads']) await rm(join(this.config.dataRoot, dir), { recursive: true, force: true })
      await rm(this.recordPath, { force: true })
      await rm(this.runPath, { force: true })
      await this.withdrawKey(undefined)
      this.publish({ phase: 'missing' })
    })
  }

  private async launch(): Promise<void> {
    if (this.running !== undefined || this.lifetime.signal.aborted) return
    const record = await this.readInstall()
    if (record === undefined) { this.publish({ phase: 'missing' }); return }
    const launching = new AbortController()
    this.launching = launching
    const signal = AbortSignal.any([launching.signal, this.lifetime.signal])
    try {
      this.publish({ phase: 'starting' })
      const origin = `http://127.0.0.1:${this.config.port}`
      if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
        throw new Error(`port ${this.config.port} is already in use; stop what is using it or move the local model to another port`)
      }
      // Dispose or Stop may have landed during the awaits above; never spawn an orphan.
      if (signal.aborted) return
      const key = `llamacpp-${randomBytes(32).toString('base64url')}`
      const binary = this.config.binaryPath ?? join(this.engineDir, record.engine.binary)
      const cwd = dirname(binary)
      const argv = [
        binary, '-m', this.modelPath, '--alias', this.model.id,
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
      let exited = false
      void handle.done.then(async (outcome) => {
        exited = true
        if (this.running === running) this.running = undefined
        await this.withdrawKey(key)
        if (running.stopping || this.lifetime.signal.aborted) return
        this.fail(new Error(`the local model server exited (${outcome.signal ?? `code ${String(outcome.exitCode)}`})`), logs())
      })
      const deadline = Date.now() + this.config.startTimeoutMs
      while (!exited) {
        if (signal.aborted) { await this.terminate(); return }
        // 503 while the model loads, 200 once it serves.
        const ok = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })
          .then(response => response.ok, () => false)
        if (ok && !exited) {
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
          this.publish({ phase: 'running', ...contextSize === undefined ? {} : { contextSize } })
          if (contextSize !== undefined && contextSize < this.config.fitCtx) {
            this.ctx.logger.warn(`llama-cpp: the server runs with a ${contextSize}-token context; the harness prompt needs about 12k`)
          }
          await this.adoptDefault()
          return
        }
        if (Date.now() > deadline) {
          await this.terminate()
          const logTail = logs()
          this.publish({ phase: 'failed', error: 'the local model server did not become ready in time', ...logTail === undefined ? {} : { logTail } })
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
    await this.withdrawKey(running.key)
  }
}

export default LlamaCpp
