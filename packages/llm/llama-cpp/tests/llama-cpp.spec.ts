import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { platform, tmpdir, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@janhq/cordis'
import LocalSubprocess from '@janhq/jan-subprocess-local'
import { LocalCredentialProvider } from '@janhq/jan-credentials-local'
import {
  describeExit, download, DownloadError, hostPlatformOf, LlamaCpp, lookupRepo, modelFacts, parseHandshake, parseModelList, parseRepo,
  RateMeter, WorkerProtocolError, type LlamaCppState,
} from '../src/index.ts'
import { chatModel, ggufFile } from './gguf-fixture.ts'

const FAKE = new URL('./fake-llama-worker.mjs', import.meta.url).pathname
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/** Static file server with Range support and a request log. */
async function files(entries: Record<string, Buffer>, options: { ignoreRange?: boolean; throttle?: boolean } = {}) {
  const requests: Array<{ path: string; range?: string }> = []
  const server: Server = createServer((req, res) => {
    const body = entries[req.url ?? '']
    requests.push({ path: req.url ?? '', ...req.headers.range ? { range: req.headers.range } : {} })
    if (!body) { res.writeHead(404).end(); return }
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    const start = match && !options.ignoreRange ? Number(match[1]) : 0
    res.writeHead(start > 0 ? 206 : 200, { 'content-length': String(body.length - start) })
    if (!options.throttle) { res.end(body.subarray(start)); return }
    let at = start
    const tick = setInterval(() => {
      if (res.destroyed) { clearInterval(tick); return }
      const next = Math.min(body.length, at + 1024)
      res.write(body.subarray(at, next))
      at = next
      if (at >= body.length) { clearInterval(tick); res.end() }
    }, 5)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { origin, requests }
}

// ── worker protocol ─────────────────────────────────────────────────────────

it('parses the worker handshake and refuses anything else', () => {
  expect(parseHandshake('{"port":39271,"pid":12,"models":["qwen"],"aliases":{"local":"qwen"},"cuda_toolkit":null,"devices":[{"id":"Vulkan0","name":"GPU"}]}'))
    .toEqual({ port: 39271, pid: 12, models: ['qwen'], aliases: { local: 'qwen' }, devices: [{ id: 'Vulkan0', name: 'GPU' }] })
  expect(parseHandshake('{"port":1,"pid":1,"models":[],"aliases":{},"devices":null}').devices).toBeNull()
  expect(() => parseHandshake('{"port":1,"pid":1,"models":[],"devices":null}')).toThrow(/invalid handshake/)
  expect(() => parseHandshake('{"port":1,"pid":1,"models":[],"aliases":{"local":3},"devices":null}')).toThrow(/invalid handshake/)
  expect(() => parseHandshake('listening')).toThrow(WorkerProtocolError)
  expect(() => parseHandshake('{"port":0,"pid":1,"models":[],"devices":[]}')).toThrow(/invalid handshake/)
  expect(() => parseHandshake('{"port":80,"pid":1,"models":[3],"devices":[]}')).toThrow(/invalid handshake/)
})

it('names the Host platform clients write model paths for', () => {
  expect(['darwin', 'win32', 'linux', 'freebsd'].map(os => hostPlatformOf(os as NodeJS.Platform))).toEqual(['macos', 'windows', 'linux', 'linux'])
})

it('names the worker exit codes it documents', () => {
  expect(describeExit(4, null)).toBe('exited with code 4: it could not read its preset')
  expect(describeExit(3, null)).toMatch(/pinned/)
  expect(describeExit(139, null)).toBe('exited with code 139')
  expect(describeExit(null, 'SIGKILL')).toBe('was ended by SIGKILL')
})

// ── downloads ───────────────────────────────────────────────────────────────

it('downloads, verifies and resumes a partial file with a Range request', async () => {
  const body = Buffer.alloc(64 * 1024, 7)
  const server = await files({ '/m.gguf': body })
  const dir = await temp('llama-dl-')
  const dest = join(dir, 'm.gguf')
  await writeFile(`${dest}.partial`, body.subarray(0, 10_000))
  const progress: number[] = []
  await download({ url: `${server.origin}/m.gguf`, sha256: sha(body), bytes: body.length }, dest, 'model',
    new AbortController().signal, (received) => { progress.push(received) })
  expect((await readFile(dest)).equals(body)).toBe(true)
  expect(server.requests).toEqual([{ path: '/m.gguf', range: 'bytes=10000-' }])
  expect(progress[0]).toBe(10_000)
  expect(progress.at(-1)).toBe(body.length)
  await expect(stat(`${dest}.partial`)).rejects.toThrow()
})

it('restarts from zero when the server ignores the range', async () => {
  const body = Buffer.alloc(32 * 1024, 3)
  const server = await files({ '/m.gguf': body }, { ignoreRange: true })
  const dest = join(await temp('llama-dl-'), 'm.gguf')
  await writeFile(`${dest}.partial`, body.subarray(0, 5000))
  await download({ url: `${server.origin}/m.gguf`, sha256: sha(body), bytes: body.length }, dest, 'model',
    new AbortController().signal, () => {})
  expect((await readFile(dest)).equals(body)).toBe(true)
})

it('rejects and discards a file whose checksum does not match', async () => {
  const body = Buffer.alloc(4096, 1)
  const server = await files({ '/m.gguf': body })
  const dest = join(await temp('llama-dl-'), 'm.gguf')
  const failure = download({ url: `${server.origin}/m.gguf`, sha256: '0'.repeat(64), bytes: body.length }, dest, 'model',
    new AbortController().signal, () => {})
  await expect(failure).rejects.toBeInstanceOf(DownloadError)
  await expect(failure).rejects.toMatchObject({ reason: 'integrity' })
  await expect(stat(dest)).rejects.toThrow()
  await expect(stat(`${dest}.partial`)).rejects.toThrow()
})

it('reports an HTTP failure without leaking the URL', async () => {
  const server = await files({})
  const dest = join(await temp('llama-dl-'), 'm.gguf')
  await expect(download({ url: `${server.origin}/missing?token=secret`, sha256: '0'.repeat(64), bytes: 1 }, dest, 'model',
    new AbortController().signal, () => {})).rejects.toThrow(/^Could not download model: HTTP 404$/)
})

// ── service ─────────────────────────────────────────────────────────────────

const MODEL = ggufFile(chatModel(40960), 256 * 1024)

/** One line the fake worker appends to `fake-events.jsonl`. */
interface FakeEvent {
  pid: number
  type: 'start' | 'reload' | 'load' | 'unload' | 'exit' | 'subscribe'
  argv?: string[]
  hasKey?: boolean
  keyInArgv?: boolean
  cwd?: string
  preset?: { shared: Record<string, string>; models: Record<string, { model?: string; mmproj?: string; 'ctx-size'?: string }>; aliases: Record<string, string> }
  model?: string
  modelsMax?: number
  reason?: string
}

interface FixtureOptions {
  mode?: Record<string, unknown>
  throttle?: boolean
  /** More files the download server serves, keyed by request path. */
  extraFiles?: Record<string, Buffer>
  /** Plugins loaded before the service, e.g. a settings stand-in. */
  before?: (ctx: Context) => Promise<unknown>
  config?: Record<string, unknown> | ((modelOrigin: string) => Record<string, unknown>)
  home?: string
}

async function fixture(options: FixtureOptions = {}) {
  const server = await files({ '/model.gguf': MODEL, ...options.extraFiles }, { throttle: options.throttle ?? false })
  const home = options.home ?? await temp('llama-home-')
  const bin = join(home, 'fake-bin')
  const worker = join(bin, 'jan-llama-worker')
  await mkdir(bin, { recursive: true })
  await copyFile(FAKE, worker)
  execFileSync('chmod', ['+x', worker])
  await writeFile(join(bin, 'fake-mode.json'), JSON.stringify(options.mode ?? {}))
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  await options.before?.(ctx)
  const plugin = ctx.plugin(LlamaCpp, {
    dataRoot: join(home, 'data'), workerPath: worker, graceMs: 2000, stopTimeoutMs: 3000, progressIntervalMs: 1,
    startTimeoutMs: 15_000, huggingFaceURL: server.origin,
    firstModelOverride: { url: `${server.origin}/model.gguf`, sha256: sha(MODEL), bytes: MODEL.length },
    ...typeof options.config === 'function' ? options.config(server.origin) : options.config,
  })
  await plugin
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await plugin.dispose(); await credentials.dispose()
  }
  cleanups.push(dispose)
  const llama = ctx.llamaCpp
  const watching = new AbortController()
  cleanups.push(async () => { watching.abort() })
  const seen: LlamaCppState[] = []
  const until = async (predicate: (state: LlamaCppState) => boolean): Promise<LlamaCppState> => {
    for await (const state of llama.follow(watching.signal)) {
      seen.push(state)
      if (predicate(state)) return state
    }
    throw new Error('follow ended')
  }
  // Read the file, not the service: some checks run after the plugins are disposed.
  const stored = async (): Promise<string> => readFile(join(home, 'credentials.yaml'), 'utf8').catch(() => '')
  const key = async (): Promise<string | undefined> => /(llamacpp-[\w-]+)/.exec(await stored())?.[1]
  const endpoint = async (): Promise<string | undefined> => /(http:\/\/127\.0\.0\.1:\d+\/v1)/.exec(await stored())?.[1]
  const events = async (): Promise<FakeEvent[]> => (await readFile(join(bin, 'fake-events.jsonl'), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(line => JSON.parse(line) as FakeEvent)
  return { ctx, llama, home, bin, server, until, seen, key, endpoint, events, dispose }
}

/** Whether a process is still alive. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch { return false }
}

it('lists only Jan model artifacts and deletes exactly one listed partial file', async () => {
  const { home, llama } = await fixture()
  const directory = join(home, 'data', 'models', 'interrupted')
  const partial = join(directory, '0123456789abcdef.gguf.partial')
  const other = join(directory, 'fedcba9876543210.gguf.partial')
  const personal = join(directory, 'personal.gguf')
  const outside = join(await temp('llama-outside-'), '0123456789abcdef.gguf.partial')
  const session = join(home, 'sessions', '0123456789abcdef.gguf.partial')
  await mkdir(directory, { recursive: true })
  await mkdir(join(home, 'sessions'))
  await Promise.all([partial, other, personal, outside, session].map(path => writeFile(path, '1234')))
  await symlink(dirname(outside), join(home, 'data', 'models', 'linked'), 'junction')
  await symlink(outside, join(directory, '9876543210abcdef.gguf.partial'), 'file')

  const items = await llama.listStoredDownloads(home)
  expect(items).toHaveLength(2)
  expect(items).toContainEqual(expect.objectContaining({ kind: 'partial', bytes: 4, path: 'data/models/interrupted/0123456789abcdef.gguf.partial' }))
  for (const path of [outside, '../outside', 'sessions/0123456789abcdef.gguf.partial', 'data/models/interrupted/personal.gguf',
    'data/models/linked/0123456789abcdef.gguf.partial', 'data/models/interrupted/9876543210abcdef.gguf.partial']) {
    await expect(llama.deleteStoredDownload(home, path)).rejects.toThrow('not a Jan download')
  }
  await llama.deleteStoredDownload(home, 'data/models/interrupted/0123456789abcdef.gguf.partial')
  await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await Promise.all([other, personal, outside, session].map(path => readFile(path, 'utf8')))).toEqual(Array(4).fill('1234'))
})

it('refuses to delete a downloaded model while it is loaded, then removes it once unloaded', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  f.llama.install()
  await f.until(s => s.models[0]?.status === 'loaded')
  const [item] = await f.llama.listStoredDownloads(f.home)
  expect(item).toMatchObject({ name: 'Jan v3.5 4B', kind: 'model', bytes: MODEL.length })
  await expect(f.llama.deleteStoredDownload(f.home, item!.path)).rejects.toThrow('loaded or in use')
  expect((await f.events()).filter(e => e.type === 'unload')).toHaveLength(0)
  await f.llama.unloadModel('jan-v3.5-4b')
  await f.until(s => s.models[0]?.status === 'unloaded')
  await f.llama.deleteStoredDownload(f.home, item!.path)
  expect(f.llama.snapshot().models).toHaveLength(0)
  await expect(stat(join(f.home, item!.path))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('installs the model, publishes the worker endpoint and key, and serves the route through them', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  expect(await f.key()).toBeUndefined()
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({
    phase: 'running', hostPlatform: hostPlatformOf(process.platform), provider: 'local', model: { id: 'jan-v3.5-4b', modelBytes: MODEL.length },
  })
  expect(f.seen.some(s => s.phase === 'downloading' && s.progress?.totalBytes === MODEL.length)).toBe(true)

  const key = await f.key()
  const endpoint = await f.endpoint()
  expect(key).toMatch(/^llamacpp-/)
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  expect((await fetch(`${endpoint}/models`)).status).toBe(401)
  const models = await fetch(`${endpoint}/models`, { headers: { authorization: `Bearer ${key}` } })
  expect(await models.json()).toMatchObject({ data: [{ id: 'jan-v3.5-4b', status: { value: 'loaded' } }] })
  expect(running.models).toMatchObject([{ id: 'jan-v3.5-4b', active: true, contextSize: 32768 }])
  expect((await f.until(s => s.models[0]?.status === 'loaded')).models[0]?.status).toBe('loaded')

  const [start] = await f.events()
  const preset = join(f.home, 'data', 'run', 'preset.ini')
  expect(start).toMatchObject({ type: 'start', hasKey: true, keyInArgv: false })
  expect(start?.argv?.slice(1)).toEqual(['--preset', preset, '--port', '0', '--models-max', '1', '--slot-cache-mib', '0'])
  // macOS reports the realpath of a symlinked tmpdir (/var -> /private/var) as the child's cwd.
  expect(start?.cwd).toBe(await realpath(f.bin))
  expect(start?.preset?.shared).toMatchObject({
    'ctx-size': '32768', fit: platform() === 'darwin' ? 'off' : 'on', 'flash-attn': 'on', 'cache-type-k': 'q8_0',
    'slot-save-path': join(f.home, 'data', 'slots'),
  })
  if (platform() !== 'darwin') expect(start?.preset?.shared).toMatchObject({ 'fit-target': '1024' })
  if (platform() !== 'darwin') expect(start?.preset?.shared).not.toHaveProperty('n-gpu-layers')
  expect(start?.preset?.shared).not.toHaveProperty('jinja')
  expect(start?.preset?.models['jan-v3.5-4b']?.model).toBe(join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf`))
  expect(start?.preset?.aliases).toEqual({ local: 'jan-v3.5-4b' })
  expect(running.contextSize).toBe(32768)
})

it('persists a model context and auto-fit choice, reloads the worker, and restores both after boot', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = 'jan-v3.5-4b'
  await f.llama.setModelContext(id, 40960)
  await f.llama.setModelFit(id, false)
  expect(f.llama.getModelContext(id)).toMatchObject({ current: 40960, maximum: 40960, fit: false })
  expect(f.llama.snapshot().models[0]).toMatchObject({ contextSize: 40960, configuredContextSize: 40960, autoFit: false })
  expect((await f.events()).filter(event => event.type === 'reload').at(-1)?.preset?.models[id]).toMatchObject({ 'ctx-size': '40960', fit: 'off' })
  const install = JSON.parse(await readFile(join(f.home, 'data', 'install.json'), 'utf8')) as { models: object[] }
  expect(install.models[0]).toMatchObject({ ctxSize: 40960, autoFit: false })
  await f.dispose()
  const restored = await fixture({ home: f.home })
  await restored.until(s => s.phase === 'running')
  expect(restored.llama.getModelContext(id)).toMatchObject({ current: 40960, maximum: 40960, fit: false })
  expect((await restored.events()).filter(event => event.type === 'start').at(-1)?.preset?.models[id]).toMatchObject({ 'ctx-size': '40960', fit: 'off' })
})

it('increases context to the trained maximum and refuses further increases', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  expect(await f.llama.increaseModelContext('local')).toBe(40960)
  expect(f.llama.snapshot().models[0]?.configuredContextSize).toBe(40960)
  expect(await f.llama.increaseModelContext('jan-v3.5-4b')).toBeNull()
  await expect(f.llama.setModelContext('jan-v3.5-4b', 40961)).rejects.toThrow(/maximum/)
  await expect(f.llama.setModelContext('jan-v3.5-4b', -1)).rejects.toThrow(/positive/)
})

it('lets fit choose the context when ctxSize is 0, and passes the resident model bound', async () => {
  const f = await fixture({ config: { ctxSize: 0, fit: true, modelsMax: 3, slotCacheMiB: 512 } })
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  const [start] = await f.events()
  expect(start?.argv?.slice(-4)).toEqual(['--models-max', '3', '--slot-cache-mib', '512'])
  expect(start?.preset?.shared).toMatchObject({ 'fit-ctx': '16384' })
  expect(start?.preset?.shared).not.toHaveProperty('ctx-size')
  expect(running.contextSize).toBe(20000)
})

it('stops through stdin, starts again, and starts by itself on the next boot', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const endpoint = await f.endpoint()
  await f.llama.stop()
  expect(f.llama.snapshot().phase).toBe('stopped')
  expect((await f.events()).at(-1)).toMatchObject({ type: 'exit', reason: 'stdin-end' })
  expect(await f.endpoint()).toBeUndefined()
  await expect(fetch(`${endpoint}/models`)).rejects.toThrow()
  await f.llama.start()
  expect(f.llama.snapshot().phase).toBe('running')
  const key = await f.key()
  expect(key).toMatch(/^llamacpp-/)
  await f.dispose()
  // Shutting down withdraws the route credentials, so the route offers nothing while no worker runs.
  expect(await f.key()).toBeUndefined()
  expect(await f.endpoint()).toBeUndefined()

  const again = await fixture({ home: f.home })
  const state = await again.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state.phase).toBe('running')
  expect(again.server.requests).toEqual([]) // nothing downloaded on the second boot
  const next = await again.key()
  expect(next).toMatch(/^llamacpp-/)
  expect(next).not.toBe(key) // a fresh key per launch
}, 20_000)

it('withholds the route credentials until the model loads, and a Stop survives the next boot', async () => {
  const f = await fixture({ mode: { loadingMs: 1500 } })
  f.llama.install()
  await f.until(s => s.phase === 'starting')
  expect(await f.key()).toBeUndefined()
  await f.until(s => s.phase === 'running')
  expect(await f.key()).toMatch(/^llamacpp-/)
  await f.llama.stop()
  expect(await f.key()).toBeUndefined()
  await f.dispose()
  const again = await fixture({ home: f.home })
  expect((await again.until(s => s.phase !== 'checking')).phase).toBe('installed')
  expect(await again.key()).toBeUndefined()
}, 20_000)

it('stops a worker that is still loading without waiting for the load', async () => {
  const f = await fixture({ mode: { loadingMs: 60_000 } })
  f.llama.install()
  await f.until(s => s.phase === 'starting')
  await new Promise(resolve => setTimeout(resolve, 500))
  const started = Date.now()
  await f.llama.stop()
  expect(Date.now() - started).toBeLessThan(5000)
  expect(f.llama.snapshot().phase).toBe('stopped')
  const [start] = await f.events()
  expect(alive(start!.pid)).toBe(false)
}, 20_000)

it('leaves no worker behind when disposed during start', async () => {
  const f = await fixture({ mode: { loadingMs: 60_000 } })
  f.llama.install()
  await f.until(s => s.phase === 'starting')
  await new Promise(resolve => setTimeout(resolve, 500))
  const started = Date.now()
  await f.dispose()
  expect(Date.now() - started).toBeLessThan(5000)
  const [start] = await f.events()
  expect(alive(start!.pid)).toBe(false)
  expect(await f.key()).toBeUndefined()
}, 20_000)

it('terminates a worker that ignores the end of its stdin once the stop timeout passes', async () => {
  const f = await fixture({ mode: { ignoreStdinEnd: true }, config: { stopTimeoutMs: 500 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const started = Date.now()
  await f.llama.stop()
  expect(Date.now() - started).toBeGreaterThanOrEqual(450)
  expect((await f.events()).at(-1)).toMatchObject({ type: 'exit', reason: 'sigterm' })
  expect(f.llama.snapshot().phase).toBe('stopped')
}, 20_000)

it('withdraws the route credentials and reports a crash after start with its log tail', async () => {
  const f = await fixture({ mode: { crashAfterMs: 1500 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  expect(await f.key()).toMatch(/^llamacpp-/)
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toBe('the local model worker exited with code 139')
  expect(failed.logTail).toContain('segfault')
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(await f.key()).toBeUndefined()
  expect(await f.endpoint()).toBeUndefined()
}, 20_000)

it('reports a worker that exits before its handshake with the meaning of its exit code', async () => {
  const f = await fixture({ mode: { exitCode: 4 } })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toBe('the local model worker exited with code 4: it could not read its preset')
  expect(failed.logTail).toContain('failed to start')
})

it('refuses a worker whose handshake does not follow the protocol, and stops it', async () => {
  const f = await fixture({ mode: { badHandshake: true } })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/unreadable handshake: not json/)
  const [start] = await f.events()
  expect(alive(start!.pid)).toBe(false)
  expect(await f.key()).toBeUndefined()
})

it('reports a model the worker cannot load and stops the worker', async () => {
  const f = await fixture({ mode: { loadError: 'invalid magic characters' } })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toBe('could not load Jan v3.5 4B: invalid magic characters')
  expect(failed.models.map(model => model.id)).toEqual(['jan-v3.5-4b'])
  expect((await f.events()).at(-1)).toMatchObject({ type: 'exit', reason: 'stdin-end' })
})

it('reports a start that does not finish in time', async () => {
  const f = await fixture({ mode: { loadingMs: 60_000 }, config: { startTimeoutMs: 800 } })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toBe('the local model worker did not become ready in time')
  expect(failed.logTail).toContain('reading preset')
}, 20_000)

it('fails loud at boot without a usable worker, and downloads nothing for it', async () => {
  const absent = await fixture({ config: { workerPath: undefined } })
  const failed = await absent.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/^No local model worker is configured; set workerPath/)
  absent.llama.install()
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(absent.llama.snapshot()).toMatchObject({ phase: 'failed', downloads: [] })
  expect(absent.server.requests).toEqual([])

  const home = await temp('llama-noexec-')
  await writeFile(join(home, 'worker'), 'not a program')
  const unusable = await fixture({ config: { workerPath: join(home, 'worker') } })
  const refused = await unusable.until(s => s.phase === 'failed')
  expect(refused.error).toMatch(/^The bundled local model worker is missing or not executable/)
  expect(refused.error).not.toContain(home)
  await expect(fixture({ config: { workerPath: 'relative/worker' } })).rejects.toThrow(/workerPath must be absolute/)
})

it('cancels a download and discards its partial file, so the next install starts over', async () => {
  const f = await fixture({ throttle: true })
  f.llama.install()
  await f.until(s => s.phase === 'downloading' && (s.progress?.receivedBytes ?? 0) > 20_000)
  await f.llama.cancel()
  expect(f.llama.snapshot().phase).toBe('missing')
  await expect(stat(join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf.partial`))).rejects.toThrow()
  f.llama.install()
  await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(f.llama.snapshot().phase).toBe('running')
  expect(f.server.requests.at(-1)?.range).toBeUndefined()
}, 30_000)

it('pauses a download keeping its partial file, then resumes it from that byte or discards it on cancel', async () => {
  const f = await fixture({ throttle: true })
  const partial = join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf.partial`)
  f.llama.install()
  await f.until(s => s.phase === 'downloading' && (s.progress?.receivedBytes ?? 0) > 20_000)
  f.llama.pause('jan-v3.5-4b')
  const paused = await f.until(s => s.phase === 'missing')
  expect(paused.downloads).toMatchObject([{ id: 'jan-v3.5-4b', paused: true, progress: { totalBytes: MODEL.length } }])
  expect(paused.progress).toBeUndefined()
  const kept = (await stat(partial)).size
  expect(kept).toBeGreaterThan(20_000)
  expect(() => { f.llama.pause('jan-v3.5-4b') }).toThrow(/no running download/)

  f.llama.retry('jan-v3.5-4b')
  await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(f.llama.snapshot().phase).toBe('running')
  expect(f.server.requests.at(-1)?.range).toBe(`bytes=${String(kept)}-`)

  // A paused download that is then cancelled leaves no file behind.
  const g = await fixture({ throttle: true })
  g.llama.install()
  await g.until(s => s.phase === 'downloading' && (s.progress?.receivedBytes ?? 0) > 20_000)
  g.llama.pause('jan-v3.5-4b')
  await g.until(s => s.phase === 'missing')
  await g.llama.cancel('jan-v3.5-4b')
  expect(g.llama.snapshot().downloads).toEqual([])
  await expect(stat(join(g.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf.partial`))).rejects.toThrow()
}, 30_000)

it('keeps a download interrupted by shutting down and resumes it on the next launch', async () => {
  const f = await fixture({ throttle: true })
  f.llama.install()
  await f.until(s => s.phase === 'downloading' && (s.progress?.receivedBytes ?? 0) > 20_000)
  await f.dispose()
  const partial = await stat(join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf.partial`))
  expect(partial.size).toBeGreaterThan(0)
  const again = await fixture({ home: f.home })
  again.llama.install()
  await again.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(again.llama.snapshot().phase).toBe('running')
  expect(again.server.requests.at(-1)?.range).toMatch(/^bytes=\d+-$/)
}, 30_000)

it('removes the install and the route credentials', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await f.llama.uninstall()
  expect(f.llama.snapshot().phase).toBe('missing')
  expect(await f.key()).toBeUndefined()
  await expect(stat(join(f.home, 'data', 'models'))).rejects.toThrow()
  await expect(stat(join(f.home, 'data', 'run'))).rejects.toThrow()
  const [start] = await f.events()
  expect(alive(start!.pid)).toBe(false)
})

// ── model manager ───────────────────────────────────────────────────────────

/** A small chat model trained with an 8192-token context; the fake worker never reads it. */
const TINY = ggufFile(chatModel(8192), 64 * 1024)
const REVISION = 'abc123'

/** A Hugging Face repository listing: one usable file, plus files the lookup must leave out; it has no projector. */
const HF_FILES = {
  '/api/models/acme/tiny-GGUF?blobs=true': Buffer.from(JSON.stringify({
    id: 'acme/tiny-GGUF', sha: REVISION,
    siblings: [
      { rfilename: 'README.md', size: 10 },
      { rfilename: 'tiny-Q4_K_M.gguf', size: TINY.length, lfs: { sha256: sha(TINY), size: TINY.length } },
      { rfilename: 'big-Q8_0-00001-of-00002.gguf', size: 100, lfs: { sha256: 'b'.repeat(64), size: 100 } },
      { rfilename: 'unverified-Q2_K.gguf', size: 100 },
      { rfilename: 'imatrix_unsloth.gguf', size: 100, lfs: { sha256: 'd'.repeat(64), size: 100 } },
      { rfilename: 'dflash-tiny-Q8_0.gguf', size: 100, lfs: { sha256: 'e'.repeat(64), size: 100 } },
    ],
  })),
  [`/acme/tiny-GGUF/resolve/${REVISION}/tiny-Q4_K_M.gguf`]: TINY,
}

/** The model sections and the `local` alias target of the fake worker's preset after its last start or reload. */
async function lastPreset(f: { events: () => Promise<FakeEvent[]> }): Promise<{ models: string[]; local?: string }> {
  const last = (await f.events()).filter(event => event.type === 'start' || event.type === 'reload').at(-1)
  const local = last?.preset?.aliases.local
  return { models: Object.keys(last?.preset?.models ?? {}), ...local === undefined ? {} : { local } }
}


it('makes another model the default by moving the alias, without restarting the worker or reloading a model', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  // A new model joins the running worker's preset; the default stays loaded.
  expect(await lastPreset(f)).toEqual({ models: ['jan-v3.5-4b', id], local: 'jan-v3.5-4b' })
  expect((await f.events()).filter(event => event.type === 'unload')).toEqual([])
  const endpoint = await f.endpoint()
  const key = await f.key()
  await f.llama.setDefault(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id }, contextSize: 8192 })
  const events = await f.events()
  expect(events.filter(event => event.type === 'start')).toHaveLength(1)
  expect(new Set(events.map(event => event.pid)).size).toBe(1)
  expect(events.filter(event => event.type === 'reload')).toMatchObject([{ modelsMax: 1 }, { modelsMax: 1 }])
  expect(await lastPreset(f)).toEqual({ models: ['jan-v3.5-4b', id], local: id })
  // Only the one resident model is unloaded, by the bound of 1, when the new default loads.
  expect(events.filter(event => event.type === 'unload' || event.type === 'load').slice(-2)).toMatchObject([
    { type: 'unload', model: 'jan-v3.5-4b' },
    { type: 'load', model: id, path: join(f.home, 'data', 'models', id, `${sha(TINY).slice(0, 16)}.gguf`) },
  ])
  expect(await f.endpoint()).toBe(endpoint)
  expect(await f.key()).toBe(key)
  // Making the default the default again changes nothing.
  await f.llama.setDefault(id)
  expect((await f.events()).filter(event => event.type === 'reload')).toHaveLength(2)
}, 30_000)

/** Stream one chat completion from the worker and read the text it answers. */
type Route = { endpoint: () => Promise<string | undefined>; key: () => Promise<string | undefined> }

async function chat(f: Route, model: string): Promise<string> {
  const response = await fetch(`${await f.endpoint()}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${await f.key()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })
  return await response.text()
}

it('serves each model under its own id and the default under the alias, keeping at most modelsMax resident', async () => {
  const f = await fixture({ extraFiles: HF_FILES, config: { modelsMax: 2 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.llama.snapshot().models.map(model => model.status)).toEqual(['loaded', 'unloaded'])
  expect(await chat(f, id)).toContain(join('models', id))
  // The second model loaded on first use, beside the first, and its settled context was read.
  const both = await f.until(s => s.models.every(model => model.status === 'loaded') && s.models[1]?.contextSize !== undefined)
  expect(both.models).toMatchObject([{ id: 'jan-v3.5-4b', contextSize: 32768 }, { id, contextSize: 8192 }])
  expect(await chat(f, 'local')).toContain(join('models', 'jan-v3.5-4b'))
  expect((await f.events()).filter(event => event.type === 'load').map(event => event.model)).toEqual(['jan-v3.5-4b', id])

  await f.llama.unloadModel(id)
  await f.until(s => s.models[1]?.status === 'unloaded')
  await f.llama.loadModel(id)
  await f.until(s => s.models[1]?.status === 'loaded')
  await f.llama.stop()
  expect(f.llama.snapshot().models.map(model => model.status)).toEqual(['unloaded', 'unloaded'])
  // Loading while stopped starts the worker with the default first.
  await f.llama.loadModel(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', models: [{ status: 'loaded' }, { status: 'loaded' }] })
}, 30_000)

it.each(['end', 'destroy'] as const)('resubscribes after the worker\'s model feed is lost (%s) and resynchronises from its model list', async (dropFeed) => {
  const f = await fixture({ extraFiles: HF_FILES, config: { feedRetryMs: 20 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.llama.snapshot().models.map(model => model.status)).toEqual(['loaded', 'unloaded'])

  // The feed drops on the eviction; the swap that follows happens while no feed is open.
  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({ dropFeed }))
  expect(await chat(f, id)).toContain(join('models', id))
  await expect.poll(async () => (await f.events()).filter(event => event.type === 'subscribe').length).toBeGreaterThan(2)
  expect(f.llama.snapshot().models.map(model => model.status)).toEqual(['loaded', 'unloaded'])

  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({}))
  await f.until(s => s.models[0]?.status === 'unloaded' && s.models[1]?.status === 'loaded')
  // Transitions after the resubscription arrive through the new feed.
  expect(await chat(f, 'local')).toContain(join('models', 'jan-v3.5-4b'))
  await f.until(s => s.models[0]?.status === 'loaded' && s.models[1]?.status === 'unloaded')
  expect(f.llama.snapshot().phase).toBe('running')
}, 30_000)

it('stops resubscribing to a lost model feed once the plugin is disposed', async () => {
  const f = await fixture({ config: { feedRetryMs: 20 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({ dropFeed: 'destroy' }))
  await f.llama.unloadModel('jan-v3.5-4b')
  await expect.poll(async () => (await f.events()).filter(event => event.type === 'subscribe').length).toBeGreaterThan(2)
  const fetches = vi.spyOn(globalThis, 'fetch')
  cleanups.push(async () => { fetches.mockRestore() })
  await f.dispose()
  const after = fetches.mock.calls.length
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fetches.mock.calls.slice(after)).toEqual([])
}, 30_000)

it('skips SSE comments such as keepalives in the worker\'s model feed', async () => {
  const f = await fixture({ mode: { keepaliveMs: 10 }, extraFiles: HF_FILES, config: { modelsMax: 2 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  await new Promise(resolve => setTimeout(resolve, 50))
  await f.llama.loadModel(id)
  await f.until(s => s.models.every(model => model.status === 'loaded'))
}, 30_000)

it('reads the worker\'s model list and refuses anything else', () => {
  expect(parseModelList('{"object":"list","data":[{"id":"a","status":{"value":"loaded","failed":false}},{"id":"b","status":{"value":"unloaded"}}]}'))
    .toEqual(new Map([['a', 'loaded'], ['b', 'unloaded']]))
  expect(() => parseModelList('{"data":[{"id":"a","status":{"value":"gone"}}]}')).toThrow(WorkerProtocolError)
  expect(() => parseModelList('not json')).toThrow(WorkerProtocolError)
})

it('evicts the least recently used model at a bound of one', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(await chat(f, id)).toContain(join('models', id))
  const swapped = await f.until(s => s.models[0]?.status === 'unloaded' && s.models[1]?.status === 'loaded')
  // The worker keeps serving the route while the default is not resident.
  expect(swapped).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(await chat(f, 'local')).toContain(join('models', 'jan-v3.5-4b'))
  await f.until(s => s.models[0]?.status === 'loaded' && s.models[1]?.status === 'unloaded')
}, 30_000)

it('downloads a model from a Hugging Face repository, makes it the default, and removes it', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const repo = await f.llama.lookupHuggingFace(`${f.server.origin}/acme/tiny-GGUF/tree/main`)
  expect(repo).toMatchObject({ repo: 'acme/tiny-GGUF', files: [{ file: 'tiny-Q4_K_M.gguf', bytes: TINY.length, quant: 'Q4_K_M', recommended: true, installed: false }] })
  expect(repo.files).toHaveLength(1)
  expect(repo).not.toHaveProperty('projector')

  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  expect(id).toBe('tiny-q4_k_m')
  const added = await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.seen.some(s => s.downloads[0]?.progress?.totalBytes === TINY.length)).toBe(true)
  // A second model does not become the default.
  expect(added).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(added.models).toMatchObject([
    { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', bytes: MODEL.length, source: 'catalog', active: true, architecture: 'qwen3', contextLength: 40960 },
    { id, name: 'tiny-Q4_K_M', bytes: TINY.length, source: 'huggingface', vision: false, active: false, status: 'unloaded', architecture: 'qwen3', contextLength: 8192 },
  ])
  expect((await f.llama.lookupHuggingFace('acme/tiny-GGUF')).files[0]?.installed).toBe(true)
  // Asking again for an installed file names the installed model.
  expect(await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')).toBe(id)

  await f.llama.setDefault(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id, name: 'tiny-Q4_K_M' } })
  expect((await lastPreset(f)).local).toBe(id)
  await f.until(s => s.models[1]?.status === 'loaded')

  await f.llama.removeModel(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(f.llama.snapshot().models.map(model => model.id)).toEqual(['jan-v3.5-4b'])
  expect(await lastPreset(f)).toEqual({ models: ['jan-v3.5-4b'], local: 'jan-v3.5-4b' })
  // The resident model was unloaded before its file went, and the new default loaded after the reload.
  const events = await f.events()
  expect(events.findIndex(event => event.type === 'unload' && event.model === id))
    .toBeLessThan(events.findLastIndex(event => event.type === 'reload'))
  expect(events.findLastIndex(event => event.type === 'reload'))
    .toBeLessThan(events.findLastIndex(event => event.type === 'load' && event.model === 'jan-v3.5-4b'))
  await f.until(s => s.models[0]?.status === 'loaded')
  await expect(stat(join(f.home, 'data', 'models', id))).rejects.toThrow()
  await expect(f.llama.downloadHuggingFace('acme/tiny-GGUF', 'missing.gguf')).rejects.toThrow(/no downloadable file/)
  await expect(f.llama.lookupHuggingFace('acme/absent')).rejects.toMatchObject({ reason: 'not-found' })
}, 30_000)

it('removes the default and rejects when the running worker cannot load the new default, staying running', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  await f.llama.setDefault(id)
  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({ loadError: 'out of memory' }))
  await expect(f.llama.removeModel(id)).rejects.toThrow('could not load Jan v3.5 4B: out of memory')
  expect(f.llama.snapshot()).toMatchObject({
    phase: 'running', model: { id: 'jan-v3.5-4b' }, models: [{ id: 'jan-v3.5-4b', active: true }],
  })
  expect(f.llama.snapshot().error).toBeUndefined()
  await expect(stat(join(f.home, 'data', 'models', id))).rejects.toThrow()

  // The worker still serves: once the load succeeds, Make default loads the model.
  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({}))
  await f.llama.setDefault('jan-v3.5-4b')
  await f.until(s => s.models[0]?.status === 'loaded')
}, 30_000)

it('rejects a new default the running worker cannot load, keeping the worker running and the default chosen', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  await writeFile(join(f.bin, 'fake-mode.json'), JSON.stringify({ loadError: 'out of memory' }))
  await expect(f.llama.setDefault(id)).rejects.toThrow(/^could not load .*: out of memory$/)
  const state = f.llama.snapshot()
  expect(state.phase).toBe('running')
  expect(state.error).toBeUndefined()
  expect(state.models.find(model => model.id === id)).toMatchObject({ active: true })
}, 30_000)

it('keeps a model whose unload the worker refuses while it serves requests', async () => {
  const f = await fixture({ mode: { unloadBusy: true } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await expect(f.llama.removeModel('jan-v3.5-4b')).rejects.toThrow(/requests in flight/)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', models: [{ id: 'jan-v3.5-4b' }] })
  await expect(f.llama.unloadModel('jan-v3.5-4b')).rejects.toThrow(/requests in flight/)
  expect((await stat(join(f.home, 'data', 'models', 'jan-v3.5-4b'))).isDirectory()).toBe(true)
})

it('moves a model installed under the alias id to a free id', async () => {
  const home = await temp('llama-clash-')
  const file = join('models', 'local', 'm.gguf')
  await mkdir(join(home, 'data', 'models', 'local'), { recursive: true })
  await writeFile(join(home, 'data', file), TINY)
  await writeFile(join(home, 'data', 'install.json'), JSON.stringify({
    version: 2, active: 'local', models: [{ id: 'local', name: 'Local', file, bytes: TINY.length, source: 'import' }],
  }))
  const f = await fixture({ home })
  const state = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state).toMatchObject({ phase: 'running', model: { id: 'local-2' }, models: [{ id: 'local-2', active: true }] })
  expect(await lastPreset(f)).toEqual({ models: ['local-2'], local: 'local-2' })
  expect(JSON.parse(await readFile(join(home, 'data', 'install.json'), 'utf8'))).toMatchObject({ version: 3, active: 'local-2' })
})

it('imports a GGUF file in place, refuses other files, and only forgets it on removal', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  const dir = await temp('llama-import-')
  const model = join(dir, 'My Model.gguf')
  await writeFile(model, TINY)
  await writeFile(join(dir, 'notes.gguf'), 'not a model')
  await writeFile(join(dir, 'mmproj.gguf'), ggufFile({ 'general.architecture': 'clip' }))
  await writeFile(join(dir, 'embed.gguf'), ggufFile({ 'general.architecture': 'bert', 'bert.pooling_type': 1 }))
  await expect(f.llama.importModel('relative.gguf')).rejects.toThrow(/full path/)
  await expect(f.llama.importModel(join(dir, 'absent.gguf'))).rejects.toThrow(/No file/)
  await expect(f.llama.importModel(join(dir, 'notes.gguf'))).rejects.toThrow(/not a GGUF model file/)
  await expect(f.llama.importModel(join(dir, 'mmproj.gguf'))).rejects.toThrow(/mmproj.gguf cannot be used for chat: it is a vision projector/)
  await expect(f.llama.importModel(join(dir, 'embed.gguf'))).rejects.toThrow(/embed.gguf cannot be used for chat: it is an embedding model/)
  expect(f.llama.snapshot().models).toEqual([])

  const id = await f.llama.importModel(model)
  expect(id).toBe('my-model')
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({ phase: 'running', model: { id, name: 'My Model' }, models: [{ id, source: 'import', active: true }] })
  expect((await f.events())[0]?.preset?.models[id]?.model).toBe(model)
  // Trained with 8192 tokens, so the section caps the configured 32768 and the worker reports 8192.
  const [start] = await f.events()
  expect(start?.preset?.models[id]?.['ctx-size']).toBe('8192')
  expect(running.contextSize).toBe(8192)
  expect(await f.llama.importModel(model)).toBe(id)

  await f.llama.removeModel(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'missing', models: [] })
  expect(await f.key()).toBeUndefined()
  expect((await stat(model)).size).toBe(TINY.length)
})

it('reads the one-model record of earlier builds and serves its model', async () => {
  const home = await temp('llama-v1-')
  const file = join('models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf`)
  await mkdir(join(home, 'data', 'models', 'jan-v3.5-4b'), { recursive: true })
  await writeFile(join(home, 'data', file), MODEL)
  await writeFile(join(home, 'data', 'install.json'), JSON.stringify({
    version: 1, engine: { version: 'b0', backend: 'cpu', sha256: '', binary: 'unused' },
    model: { sha256: sha(MODEL), bytes: MODEL.length, file },
  }))
  const f = await fixture({ home })
  const state = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state).toMatchObject({ phase: 'running', models: [{ id: 'jan-v3.5-4b', source: 'catalog', active: true }] })
  expect(f.server.requests).toEqual([])
  // The next record write is the current version.
  await f.llama.stop()
  const dir = await temp('llama-v1-import-')
  await writeFile(join(dir, 'x.gguf'), TINY)
  await f.llama.importModel(join(dir, 'x.gguf'))
  const record = JSON.parse(await readFile(join(home, 'data', 'install.json'), 'utf8')) as { version: number; models: unknown[]; active: string }
  expect(record).toMatchObject({ version: 3, active: 'jan-v3.5-4b' })
  expect(record.models).toHaveLength(2)
}, 20_000)

it('fails the first download visibly, and dismisses the failed entry on cancel', async () => {
  const f = await fixture({ config: modelOrigin => ({
    firstModelOverride: { url: `${modelOrigin}/absent.gguf`, sha256: sha(MODEL), bytes: MODEL.length },
  }) })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/HTTP 404/)
  expect(failed.downloads).toHaveLength(1)
  expect(failed.downloads[0]?.error).toMatch(/HTTP 404/)
  await f.llama.cancel('jan-v3.5-4b')
  expect(f.llama.snapshot().downloads).toEqual([])
})

it('removes the engine directories earlier builds downloaded', async () => {
  const home = await temp('llama-legacy-')
  await mkdir(join(home, 'data', 'engine', 'b12211-cpu'), { recursive: true })
  await mkdir(join(home, 'data', 'downloads'), { recursive: true })
  const f = await fixture({ home })
  await f.until(s => s.phase === 'missing')
  await expect(stat(join(home, 'data', 'engine'))).rejects.toThrow()
  await expect(stat(join(home, 'data', 'downloads'))).rejects.toThrow()
})

/** Settings stand-in holding the `llm-pi-ai` section the route sync reads and writes. */
class FakeSettings extends Service {
  value: { providers: Record<string, Record<string, unknown>> } = { providers: { local: { models: [{ id: 'jan-v3.5-4b' }] } } }
  readonly writes: unknown[] = []
  constructor(ctx: Context) { super(ctx, 'settings') }
  describe(): Array<{ ns: string; value: unknown }> { return [{ ns: 'llm-pi-ai', value: this.value }] }
  mutate(ns: string, ops: Array<{ path: string[]; value: unknown }>): Promise<void> {
    this.writes.push({ ns, ops })
    for (const op of ops) this.value.providers.local = { ...this.value.providers.local, [op.path[2]!]: op.value }
    return Promise.resolve()
  }
}

it('lists every installed model and the default\'s alias on the local route when a settings service is mounted', async () => {
  const settings: { current?: FakeSettings } = {}
  const f = await fixture({ extraFiles: HF_FILES, before: async (ctx) => {
    await ctx.plugin(FakeSettings)
    settings.current = ctx.get('settings') as never
  } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const jan = { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B (local)', contextWindow: 32768, maxTokens: 8192, input: ['text'] }
  const alias = { ...jan, id: 'local', name: 'Jan v3.5 4B (local default)' }
  // The first sync also asks the route for prompt-reading progress, once.
  expect(settings.current?.writes).toEqual([{ ns: 'llm-pi-ai', ops: [
    { op: 'set', path: ['providers', 'local', 'models'], value: [alias, jan] },
    { op: 'set', path: ['providers', 'local', 'promptProgress'], value: true },
  ] }])
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2)
  // The new model is listed with its planned context, capped at its trained 8192.
  const tiny = { id, name: 'tiny-Q4_K_M (local)', contextWindow: 8192, maxTokens: 8192, input: ['text'] }
  expect(settings.current?.value.providers.local?.models).toEqual([alias, jan, tiny])
  await f.llama.setDefault(id)
  expect(settings.current?.value.providers.local?.models).toEqual([{ ...tiny, id: 'local', name: 'tiny-Q4_K_M (local default)' }, jan, tiny])
  // An unchanged list is not written again.
  await f.llama.setDefault(id)
  expect(settings.current?.writes).toHaveLength(3)
}, 30_000)

/** Agent default model stand-in; the route it names is usable when listed in `usable`. */
class FakeDefaults extends Service {
  selection = { provider: 'local', model: 'local' }
  constructor(ctx: Context) { super(ctx, 'agentDefaultModel') }
  currentSelection(): { provider: string; model: string } { return this.selection }
  saveSelection(selection: { provider: string; model: string }): Promise<void> { this.selection = selection; return Promise.resolve() }
}

class FakeLlm extends Service {
  usable = new Set<string>()
  constructor(ctx: Context) { super(ctx, 'llm') }
  listModels(provider: string): Promise<unknown[]> { return Promise.resolve(this.usable.has(provider) ? [{}] : []) }
}

it('keeps the agent default on a model this route serves, and moves it to the alias when that model goes', async () => {
  const services: { defaults?: FakeDefaults; llm?: FakeLlm } = {}
  const f = await fixture({ extraFiles: HF_FILES, before: async (ctx) => {
    await ctx.plugin(FakeDefaults)
    await ctx.plugin(FakeLlm)
    services.defaults = ctx.get('agentDefaultModel') as never
    services.llm = ctx.get('llm') as never
  } })
  const defaults = services.defaults!
  defaults.selection = { provider: 'tokamak', model: 'x' }
  f.llama.install()
  await f.until(s => s.phase === 'running')
  // A default route that cannot serve gives way to the local alias.
  expect(defaults.selection).toEqual({ provider: 'local', model: 'local' })
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2)

  defaults.selection = { provider: 'local', model: id }
  await f.llama.stop()
  await f.llama.start()
  expect(defaults.selection).toEqual({ provider: 'local', model: id })
  await f.llama.removeModel(id)
  expect(defaults.selection).toEqual({ provider: 'local', model: 'local' })

  services.llm!.usable.add('tokamak')
  defaults.selection = { provider: 'tokamak', model: 'x' }
  await f.llama.setDefault('jan-v3.5-4b')
  expect(defaults.selection).toEqual({ provider: 'tokamak', model: 'x' })
}, 30_000)

it('reads a repository from typed text and refuses other hosts', () => {
  const origin = 'https://huggingface.co'
  expect(parseRepo(' unsloth/Qwen3-8B-GGUF ', origin)).toBe('unsloth/Qwen3-8B-GGUF')
  expect(parseRepo('https://huggingface.co/unsloth/Qwen3-8B-GGUF/blob/main/x.gguf', origin)).toBe('unsloth/Qwen3-8B-GGUF')
  expect(parseRepo('https://www.huggingface.co/unsloth/Qwen3-8B-GGUF', origin)).toBe('unsloth/Qwen3-8B-GGUF')
  expect(() => parseRepo('https://evil.example/unsloth/Qwen3-8B-GGUF', origin)).toThrow(/Hugging Face repository/)
  expect(() => parseRepo('qwen', origin)).toThrow(/Hugging Face repository/)
  expect(() => parseRepo('../../etc/passwd', origin)).toThrow(/Hugging Face repository/)
})

it('measures the transfer rate over a rolling window', () => {
  const meter = new RateMeter()
  expect(meter.sample(0, 0)).toBe(0)
  expect(meter.sample(1000, 200)).toBe(0) // too short a span to report
  expect(meter.sample(10_000, 1000)).toBe(10_000)
  expect(meter.sample(40_000, 4000)).toBe(10_000)
  expect(meter.sample(40_000, 8000)).toBe(0) // stalled: the window holds no progress
})

it('downloads one Hugging Face file once however often it is asked for, and retries a failed one under its id', async () => {
  const f = await fixture({ throttle: true, extraFiles: { ...HF_FILES, '/api/models/acme/broken-GGUF?blobs=true': Buffer.from(JSON.stringify({
    id: 'acme/broken-GGUF', sha: REVISION,
    siblings: [{ rfilename: 'gone-Q4_K_M.gguf', size: TINY.length, lfs: { sha256: 'c'.repeat(64), size: TINY.length } }],
  })) } })
  await f.until(s => s.phase === 'missing')
  const ids = await Promise.all([
    f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf'),
    f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf'),
  ])
  expect(ids).toEqual(['tiny-q4_k_m', 'tiny-q4_k_m'])
  expect(f.llama.snapshot().downloads.map(item => item.id)).toEqual(['tiny-q4_k_m'])
  await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(f.llama.snapshot().models.map(model => model.id)).toEqual(['tiny-q4_k_m'])

  const broken = await f.llama.downloadHuggingFace('acme/broken-GGUF', 'gone-Q4_K_M.gguf')
  const failed = await f.until(s => s.downloads.some(item => item.id === broken && item.error !== undefined))
  // A failed download in the manager leaves the running model alone.
  expect(failed.phase).toBe('running')
  // Asking again starts the failed download again under the same id.
  expect(await f.llama.downloadHuggingFace('acme/broken-GGUF', 'gone-Q4_K_M.gguf')).toBe(broken)
  expect(f.llama.snapshot().downloads.filter(item => item.id === broken).map(item => item.error)).toEqual([undefined])
  await f.until(s => s.downloads.some(item => item.id === broken && item.error !== undefined))
  f.llama.retry(broken)
  expect(f.llama.snapshot().downloads.filter(item => item.id === broken).map(item => item.error)).toEqual([undefined])
  expect(() => { f.llama.retry('tiny-q4_k_m') }).toThrow(/no failed or paused download/)
}, 30_000)

it('keeps curated ids for curated models', async () => {
  const curated = ggufFile(chatModel(4096), 1024)
  const f = await fixture({ extraFiles: {
    '/api/models/acme/look-alike?blobs=true': Buffer.from(JSON.stringify({ id: 'acme/look-alike', sha: REVISION, siblings: [
      { rfilename: 'Qwen3-0.6B.gguf', size: curated.length, lfs: { sha256: sha(curated), size: curated.length } },
    ] })),
    [`/acme/look-alike/resolve/${REVISION}/Qwen3-0.6B.gguf`]: curated,
  } })
  await f.until(s => s.phase === 'missing')
  expect(await f.llama.downloadHuggingFace('acme/look-alike', 'Qwen3-0.6B.gguf')).toBe('qwen3-0.6b-2')
  const state = await f.until(s => s.models.length === 1)
  expect(state.catalog.find(entry => entry.id === 'qwen3-0.6b')?.installed).toBe(false)
})

it('lists the worker devices with system memory and judges every model against them', async () => {
  const f = await fixture({ extraFiles: HF_FILES, mode: { devices: [{ id: 'BLAS', name: 'BLAS', mem: 0, free: 0 }, { id: 'Vulkan0', name: 'GPU', mem: 24576, free: 20000 }] } })
  const state = await f.until(s => s.hardware !== undefined)
  expect(state.hardware).toEqual({ backend: 'vulkan', devices: [{ id: 'Vulkan0', name: 'GPU', totalMiB: 24576, freeMiB: 20000 }], memoryBytes: totalmem() })
  expect(state.catalog.map(entry => entry.fit)).toEqual(state.catalog.map(() => 'fits'))
  expect((await f.llama.lookupHuggingFace('acme/tiny-GGUF')).files[0]?.fit).toBe('fits')
  f.llama.install()
  const running = await f.until(s => s.phase === 'running')
  expect(running.models[0]?.fit).toBe('fits')
  // The listing is not a worker start.
  expect((await f.events()).filter(event => event.type === 'start')).toHaveLength(1)
})

it('leaves fit unknown when the worker cannot list its devices', async () => {
  const f = await fixture({ mode: { listDevicesExitCode: 6 } })
  f.llama.install()
  const running = await f.until(s => s.phase === 'running')
  expect(running.hardware).toBeUndefined()
  expect(running.models[0]?.fit).toBeUndefined()
})

it('adds header facts to the records of earlier builds and drops a model that cannot serve chat', async () => {
  const home = await temp('llama-v2-')
  const file = join('models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf`)
  const embedder = join(home, 'embed.gguf')
  const embedding = ggufFile({ 'general.architecture': 'bert' }, 1024)
  await mkdir(join(home, 'data', 'models', 'jan-v3.5-4b'), { recursive: true })
  await writeFile(join(home, 'data', file), MODEL)
  await writeFile(embedder, embedding)
  await writeFile(join(home, 'data', 'install.json'), JSON.stringify({
    version: 2, active: 'embed',
    models: [
      { id: 'embed', name: 'Embedder', file: embedder, bytes: embedding.length, source: 'import' },
      { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', file, bytes: MODEL.length, sha256: sha(MODEL), source: 'catalog', repo: 'janhq/Jan-v3.5-4B-gguf' },
    ],
  }))
  const f = await fixture({ home })
  const state = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state).toMatchObject({ phase: 'running', models: [{ id: 'jan-v3.5-4b', active: true, architecture: 'qwen3', contextLength: 40960 }] })
  expect(state.models).toHaveLength(1)
  const record = JSON.parse(await readFile(join(home, 'data', 'install.json'), 'utf8')) as { version: number; models: Array<{ id: string; facts?: { architecture?: string; contextLength?: number } }> }
  expect(record.version).toBe(3)
  expect(record.models.map(model => [model.id, model.facts?.architecture, model.facts?.contextLength])).toEqual([['jan-v3.5-4b', 'qwen3', 40960]])
}, 20_000)

it('fails the download of a file that is not a chat model and keeps nothing of it', async () => {
  const embedding = ggufFile({ 'general.architecture': 'bert' }, 2048)
  const f = await fixture({ extraFiles: {
    '/api/models/acme/embed-GGUF?blobs=true': Buffer.from(JSON.stringify({ id: 'acme/embed-GGUF', sha: REVISION, siblings: [
      { rfilename: 'embed-Q8_0.gguf', size: embedding.length, lfs: { sha256: sha(embedding), size: embedding.length } },
    ] })),
    [`/acme/embed-GGUF/resolve/${REVISION}/embed-Q8_0.gguf`]: embedding,
  } })
  await f.until(s => s.phase === 'missing')
  const id = await f.llama.downloadHuggingFace('acme/embed-GGUF', 'embed-Q8_0.gguf')
  const failed = await f.until(s => s.downloads.some(item => item.error !== undefined))
  expect(failed.downloads[0]?.error).toBe('embed-Q8_0 cannot be served: it is an embedding model, not a chat model')
  expect(failed.models).toEqual([])
  await expect(stat(join(f.home, 'data', 'models', id, `${sha(embedding).slice(0, 16)}.gguf`))).rejects.toThrow()
})

// ── vision projectors ───────────────────────────────────────────────────────

const PROJECTOR = ggufFile({ 'general.architecture': 'clip', 'clip.has_vision_encoder': true }, 32 * 1024)
const VISION = ggufFile(chatModel(4096), 48 * 1024)

/** A repository with a model and two projectors; `MMPROJ-F16` is chosen though another is listed first. */
const VISION_FILES = {
  '/api/models/acme/vision-GGUF?blobs=true': Buffer.from(JSON.stringify({
    id: 'acme/vision-GGUF', sha: REVISION,
    siblings: [
      { rfilename: 'mmproj-vision-BF16.gguf', size: 100, lfs: { sha256: 'a'.repeat(64), size: 100 } },
      { rfilename: 'vision-Q4_K_M.gguf', size: VISION.length, lfs: { sha256: sha(VISION), size: VISION.length } },
      { rfilename: 'MMPROJ-F16.gguf', size: PROJECTOR.length, lfs: { sha256: sha(PROJECTOR), size: PROJECTOR.length } },
    ],
  })),
  [`/acme/vision-GGUF/resolve/${REVISION}/vision-Q4_K_M.gguf`]: VISION,
  [`/acme/vision-GGUF/resolve/${REVISION}/MMPROJ-F16.gguf`]: PROJECTOR,
  '/api/models/acme/first-GGUF?blobs=true': Buffer.from(JSON.stringify({
    id: 'acme/first-GGUF', sha: REVISION,
    siblings: [
      { rfilename: 'mmproj-first-Q8_0.gguf', size: 100, lfs: { sha256: 'b'.repeat(64), size: 100 } },
      { rfilename: 'mmproj-first-BF16.gguf', size: 200, lfs: { sha256: 'c'.repeat(64), size: 200 } },
      { rfilename: 'mmproj-split-00001-of-00002.gguf', size: 50, lfs: { sha256: 'd'.repeat(64), size: 50 } },
    ],
  })),
}

/** Settings holder the route sync writes through, mounted before the service. */
function withSettings(): { holder: { current?: FakeSettings }; before: (ctx: Context) => Promise<unknown> } {
  const holder: { current?: FakeSettings } = {}
  return {
    holder,
    before: async (ctx) => {
      await ctx.plugin(FakeSettings)
      holder.current = ctx.get('settings') as never
    },
  }
}

it('picks the mmproj-f16 projector of a repository, else its first, and offers none as a model', async () => {
  const server = await files(VISION_FILES)
  const vision = await lookupRepo(server.origin, 'acme/vision-GGUF')
  expect(vision.files.map(file => file.file)).toEqual(['vision-Q4_K_M.gguf'])
  expect(vision.projector).toMatchObject({ file: 'MMPROJ-F16.gguf', bytes: PROJECTOR.length, sha256: sha(PROJECTOR) })
  const first = await lookupRepo(server.origin, 'acme/first-GGUF')
  expect(first.files).toEqual([])
  expect(first.projector?.file).toBe('mmproj-first-Q8_0.gguf')
})

it('downloads a Hugging Face model with its projector, serves it with image input, and deletes both on removal', async () => {
  const settings = withSettings()
  const f = await fixture({ extraFiles: VISION_FILES, before: settings.before })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const repo = await f.llama.lookupHuggingFace('acme/vision-GGUF')
  expect(repo).toMatchObject({
    repo: 'acme/vision-GGUF', projector: { file: 'MMPROJ-F16.gguf', bytes: PROJECTOR.length },
    files: [{ file: 'vision-Q4_K_M.gguf', bytes: VISION.length, quant: 'Q4_K_M', recommended: true, installed: false }],
  })

  const id = await f.llama.downloadHuggingFace('acme/vision-GGUF', 'vision-Q4_K_M.gguf')
  const added = await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.seen.some(s => s.downloads[0]?.progress?.totalBytes === VISION.length + PROJECTOR.length)).toBe(true)
  expect(added.models).toMatchObject([
    { id: 'jan-v3.5-4b', vision: false, bytes: MODEL.length },
    { id, vision: true, bytes: VISION.length + PROJECTOR.length },
  ])
  const file = join('models', id, `mmproj-${sha(PROJECTOR).slice(0, 16)}.gguf`)
  const projector = join(f.home, 'data', file)
  expect((await stat(projector)).size).toBe(PROJECTOR.length)
  const record = JSON.parse(await readFile(join(f.home, 'data', 'install.json'), 'utf8')) as { models: Array<{ id: string; mmproj?: unknown }> }
  expect(record.models.find(model => model.id === id)?.mmproj)
    .toEqual({ file, bytes: PROJECTOR.length, sha256: sha(PROJECTOR), vision: true })
  const reload = (await f.events()).filter(event => event.type === 'reload').at(-1)
  expect(reload?.preset?.models[id]).toMatchObject({ model: join(f.home, 'data', 'models', id, `${sha(VISION).slice(0, 16)}.gguf`), mmproj: projector })
  expect(reload?.preset?.models['jan-v3.5-4b']).not.toHaveProperty('mmproj')
  expect(settings.holder.current?.value.providers.local?.models).toEqual([
    expect.objectContaining({ id: 'local', input: ['text'] }),
    expect.objectContaining({ id: 'jan-v3.5-4b', input: ['text'] }),
    expect.objectContaining({ id, input: ['text', 'image'] }),
  ])
  await f.llama.setDefault(id)
  expect(settings.holder.current?.value.providers.local?.models).toContainEqual(expect.objectContaining({ id: 'local', input: ['text', 'image'] }))

  await f.llama.removeModel(id)
  await expect(stat(projector)).rejects.toThrow()
  await expect(stat(join(f.home, 'data', 'models', id))).rejects.toThrow()
}, 30_000)

it('imports a model with a projector in place, refuses other projector files, and attaches one later', async () => {
  const settings = withSettings()
  const f = await fixture({ before: settings.before })
  await f.until(s => s.phase === 'missing')
  const dir = await temp('llama-import-vision-')
  const model = join(dir, 'Seer.gguf')
  const plain = join(dir, 'plain.gguf')
  const projector = join(dir, 'mmproj.gguf')
  await writeFile(model, TINY)
  await writeFile(plain, VISION)
  await writeFile(projector, PROJECTOR)
  await writeFile(join(dir, 'notes.gguf'), 'not a model')
  await expect(f.llama.importModel(model, { projector: 'mmproj.gguf' })).rejects.toThrow(/full path of the vision projector/)
  await expect(f.llama.importModel(model, { projector: join(dir, 'absent.gguf') })).rejects.toThrow(/No file/)
  await expect(f.llama.importModel(model, { projector: plain }))
    .rejects.toThrow('plain.gguf is not a vision projector: it has "qwen3" architecture, not a vision projector (clip)')
  await expect(f.llama.importModel(model, { projector: join(dir, 'notes.gguf') }))
    .rejects.toThrow('notes.gguf is not a vision projector: it is not a GGUF file')
  expect(f.llama.snapshot().models).toEqual([])

  const id = await f.llama.importModel(model, { name: 'Seeing model', projector })
  expect(id).toBe('seeing-model')
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({ phase: 'running', models: [{ id, name: 'Seeing model', vision: true, bytes: TINY.length + PROJECTOR.length }] })
  expect((await f.events())[0]?.preset?.models[id]).toMatchObject({ model, mmproj: projector })
  const routeModels = (): Array<{ id: string; input: unknown }> =>
    settings.holder.current?.value.providers.local?.models as Array<{ id: string; input: unknown }>
  const input = (route: string): unknown => routeModels().find(entry => entry.id === route)?.input
  expect([input('local'), input(id)]).toEqual([['text', 'image'], ['text', 'image']])

  const other = await f.llama.importModel(plain)
  expect(input(other)).toEqual(['text'])
  expect(f.llama.snapshot().models[1]).toMatchObject({ id: other, vision: false })
  // Importing the same file again with a projector attaches it.
  expect(await f.llama.importModel(plain, { projector })).toBe(other)
  expect(f.llama.snapshot().models[1]).toMatchObject({ id: other, vision: true })
  expect(input(other)).toEqual(['text', 'image'])
  expect((await f.events()).filter(event => event.type === 'reload').at(-1)?.preset?.models[other]?.mmproj).toBe(projector)

  await f.llama.removeModel(id)
  expect((await stat(projector)).size).toBe(PROJECTOR.length)
}, 30_000)

it('discards a model verified before its projector when the download is cancelled', async () => {
  const projector = ggufFile({ 'general.architecture': 'clip', 'clip.has_vision_encoder': true }, 256 * 1024)
  const f = await fixture({
    throttle: true,
    extraFiles: {
      '/api/models/acme/slow-GGUF?blobs=true': Buffer.from(JSON.stringify({
        id: 'acme/slow-GGUF', sha: REVISION,
        siblings: [
          { rfilename: 'slow-Q4_K_M.gguf', size: VISION.length, lfs: { sha256: sha(VISION), size: VISION.length } },
          { rfilename: 'mmproj-f16.gguf', size: projector.length, lfs: { sha256: sha(projector), size: projector.length } },
        ],
      })),
      [`/acme/slow-GGUF/resolve/${REVISION}/slow-Q4_K_M.gguf`]: VISION,
      [`/acme/slow-GGUF/resolve/${REVISION}/mmproj-f16.gguf`]: projector,
    },
  })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/slow-GGUF', 'slow-Q4_K_M.gguf')
  await f.until(s => (s.downloads[0]?.progress?.receivedBytes ?? 0) > VISION.length + 20_000)
  await f.llama.cancel(id)
  const dir = join(f.home, 'data', 'models', id)
  await expect(stat(join(dir, `${sha(VISION).slice(0, 16)}.gguf`))).rejects.toThrow()
  await expect(stat(join(dir, `mmproj-${sha(projector).slice(0, 16)}.gguf.partial`))).rejects.toThrow()
  expect(f.llama.snapshot().models.map(model => model.id)).toEqual(['jan-v3.5-4b'])
}, 30_000)

it('keeps a model whose projector is missing or changed on disk, without the projector', async () => {
  const home = await temp('llama-gone-mmproj-')
  const file = join('models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf`)
  await mkdir(join(home, 'data', 'models', 'jan-v3.5-4b'), { recursive: true })
  await writeFile(join(home, 'data', file), MODEL)
  await writeFile(join(home, 'data', 'install.json'), JSON.stringify({
    version: 3, active: 'jan-v3.5-4b',
    models: [{
      id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', file, bytes: MODEL.length, sha256: sha(MODEL), source: 'catalog', repo: 'janhq/Jan-v3.5-4B-gguf',
      facts: modelFacts(chatModel(40960)),
      mmproj: { file: join('models', 'jan-v3.5-4b', 'mmproj-changed.gguf'), bytes: 10, sha256: 'f'.repeat(64), vision: true },
    }],
  }))
  const changed = join(home, 'data', 'models', 'jan-v3.5-4b', 'mmproj-changed.gguf')
  await writeFile(changed, 'short')
  const f = await fixture({ home })
  const state = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state).toMatchObject({ phase: 'running', models: [{ id: 'jan-v3.5-4b', vision: false, bytes: MODEL.length }] })
  expect((await f.events())[0]?.preset?.models['jan-v3.5-4b']).not.toHaveProperty('mmproj')
  const record = JSON.parse(await readFile(join(home, 'data', 'install.json'), 'utf8')) as { models: object[] }
  expect(record.models).toHaveLength(1)
  expect(record.models[0]).not.toHaveProperty('mmproj')
  await expect(stat(changed)).rejects.toThrow()
}, 20_000)
