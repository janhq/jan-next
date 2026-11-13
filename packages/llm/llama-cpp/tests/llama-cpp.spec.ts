import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import {
  describeExit, download, DownloadError, LlamaCpp, parseHandshake, parseRepo, RateMeter, renderPreset, WorkerProtocolError,
  type LlamaCppState,
} from '../src/index.ts'

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
  expect(parseHandshake('{"port":39271,"pid":12,"models":["local"],"cuda_toolkit":null,"devices":[{"id":"Vulkan0","name":"GPU"}]}'))
    .toEqual({ port: 39271, pid: 12, models: ['local'], devices: [{ id: 'Vulkan0', name: 'GPU' }] })
  expect(parseHandshake('{"port":1,"pid":1,"models":[],"devices":null}').devices).toBeNull()
  expect(() => parseHandshake('listening')).toThrow(WorkerProtocolError)
  expect(() => parseHandshake('{"port":0,"pid":1,"models":[],"devices":[]}')).toThrow(/invalid handshake/)
  expect(() => parseHandshake('{"port":80,"pid":1,"models":[3],"devices":[]}')).toThrow(/invalid handshake/)
})

it('names the worker exit codes it documents', () => {
  expect(describeExit(4, null)).toBe('exited with code 4: it could not read its preset')
  expect(describeExit(3, null)).toMatch(/pinned/)
  expect(describeExit(139, null)).toBe('exited with code 139')
  expect(describeExit(null, 'SIGKILL')).toBe('was ended by SIGKILL')
})

it('renders the preset: fit sizes what is left unset, and fit off pins context and layers', () => {
  const base = { ctxSize: 32768, fit: true, fitTargetMiB: 1024, fitCtx: 16384, cacheType: 'q8_0' as const }
  const model = [{ id: 'local', path: '/m/a.gguf' }]
  expect(renderPreset(base, model)).toBe([
    '[*]', 'jinja = true', 'flash-attn = on', 'cache-type-k = q8_0', 'cache-type-v = q8_0',
    'fit = on', 'fit-target = 1024', 'ctx-size = 32768', '', '[local]', 'model = /m/a.gguf', '',
  ].join('\n'))
  const auto = renderPreset({ ...base, ctxSize: 0, threads: 4 }, model)
  expect(auto).toContain('threads = 4\nfit = on\nfit-target = 1024\nfit-ctx = 16384\n')
  expect(auto).not.toContain('ctx-size')
  expect(renderPreset({ ...base, fit: false, ctxSize: 0, gpuLayers: 20 }, model)).toContain('fit = off\nctx-size = 16384\nn-gpu-layers = 20\n')
  expect(renderPreset({ ...base, fit: false }, [{ id: 'local', path: '/m/b\n[evil]' }])).toContain('n-gpu-layers = 999\n\n[local]\nmodel = /m/b [evil]\n')
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

const MODEL = Buffer.alloc(256 * 1024, 9)

/** One line the fake worker appends to `fake-events.jsonl`. */
interface FakeEvent {
  pid: number
  type: 'start' | 'reload' | 'load' | 'exit'
  argv?: string[]
  hasKey?: boolean
  keyInArgv?: boolean
  cwd?: string
  preset?: { shared: Record<string, string>; models: Record<string, { model?: string }> }
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

it('installs the model, publishes the worker endpoint and key, and serves the route through them', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  expect(await f.key()).toBeUndefined()
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({ phase: 'running', provider: 'local', model: { id: 'jan-v3.5-4b', modelBytes: MODEL.length } })
  expect(f.seen.some(s => s.phase === 'downloading' && s.progress?.totalBytes === MODEL.length)).toBe(true)

  const key = await f.key()
  const endpoint = await f.endpoint()
  expect(key).toMatch(/^llamacpp-/)
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  expect((await fetch(`${endpoint}/models`)).status).toBe(401)
  const models = await fetch(`${endpoint}/models`, { headers: { authorization: `Bearer ${key}` } })
  expect(await models.json()).toMatchObject({ data: [{ id: 'local', status: { value: 'loaded' } }] })

  const [start] = await f.events()
  const preset = join(f.home, 'data', 'run', 'preset.ini')
  expect(start).toMatchObject({ type: 'start', hasKey: true, keyInArgv: false })
  expect(start?.argv?.slice(1)).toEqual(['--preset', preset, '--port', '0', '--models-max', '1'])
  // macOS reports the realpath of a symlinked tmpdir (/var -> /private/var) as the child's cwd.
  expect(start?.cwd).toBe(await realpath(f.bin))
  expect(start?.preset?.shared).toMatchObject({ 'ctx-size': '32768', fit: 'on', 'fit-target': '1024', jinja: 'true', 'cache-type-k': 'q8_0' })
  expect(start?.preset?.shared).not.toHaveProperty('n-gpu-layers')
  expect(start?.preset?.models.local?.model).toBe(join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf`))
  expect(running.contextSize).toBe(32768)
})

it('lets fit choose the context when ctxSize is 0, and passes the resident model bound', async () => {
  const f = await fixture({ config: { ctxSize: 0, modelsMax: 3 } })
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  const [start] = await f.events()
  expect(start?.argv?.slice(-2)).toEqual(['--models-max', '3'])
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

// ── model manager ───────────────────────────────────────────────────────────

/** A tiny file that passes the GGUF magic check; the fake server never reads it. */
const TINY = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(64 * 1024, 4)])
const REVISION = 'abc123'

/** A Hugging Face repository listing: one usable file, plus files the lookup must leave out. */
const HF_FILES = {
  '/api/models/acme/tiny-GGUF?blobs=true': Buffer.from(JSON.stringify({
    id: 'acme/tiny-GGUF', sha: REVISION,
    siblings: [
      { rfilename: 'README.md', size: 10 },
      { rfilename: 'tiny-Q4_K_M.gguf', size: TINY.length, lfs: { sha256: sha(TINY), size: TINY.length } },
      { rfilename: 'mmproj-tiny-f16.gguf', size: 100, lfs: { sha256: 'a'.repeat(64), size: 100 } },
      { rfilename: 'big-Q8_0-00001-of-00002.gguf', size: 100, lfs: { sha256: 'b'.repeat(64), size: 100 } },
      { rfilename: 'unverified-Q2_K.gguf', size: 100 },
      { rfilename: 'imatrix_unsloth.gguf', size: 100, lfs: { sha256: 'd'.repeat(64), size: 100 } },
      { rfilename: 'dflash-tiny-Q8_0.gguf', size: 100, lfs: { sha256: 'e'.repeat(64), size: 100 } },
    ],
  })),
  [`/acme/tiny-GGUF/resolve/${REVISION}/tiny-Q4_K_M.gguf`]: TINY,
}

/** The model file the fake worker's `local` section names after its last start or reload. */
async function launchedModel(f: { events: () => Promise<FakeEvent[]> }): Promise<string | undefined> {
  const last = (await f.events()).filter(event => event.type === 'start' || event.type === 'reload').at(-1)
  expect(Object.keys(last?.preset?.models ?? {})).toEqual(['local'])
  return last?.preset?.models.local?.model
}


it('switches models by reloading the running worker\'s preset, without restarting it', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  const endpoint = await f.endpoint()
  const key = await f.key()
  await f.llama.select(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id } })
  const events = await f.events()
  expect(events.filter(event => event.type === 'start')).toHaveLength(1)
  expect(new Set(events.map(event => event.pid)).size).toBe(1)
  expect(events.filter(event => event.type === 'reload')).toMatchObject([{ modelsMax: 1 }])
  expect(events.at(-1)).toMatchObject({ type: 'load', model: 'local', path: join(f.home, 'data', 'models', id, `${sha(TINY).slice(0, 16)}.gguf`) })
  // The worker, its port and its key stay; only the model behind `local` changed.
  expect(await f.endpoint()).toBe(endpoint)
  expect(await f.key()).toBe(key)
  // Selecting the model already served reloads nothing.
  await f.llama.select(id)
  expect((await f.events()).filter(event => event.type === 'reload')).toHaveLength(1)
}, 30_000)

it('downloads a model from a Hugging Face repository, switches to it, and removes it', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const repo = await f.llama.lookupHuggingFace(`${f.server.origin}/acme/tiny-GGUF/tree/main`)
  expect(repo).toEqual({ repo: 'acme/tiny-GGUF', files: [{ file: 'tiny-Q4_K_M.gguf', bytes: TINY.length, quant: 'Q4_K_M', recommended: true, installed: false }] })

  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  expect(id).toBe('tiny-q4_k_m')
  const added = await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.seen.some(s => s.downloads[0]?.progress?.totalBytes === TINY.length)).toBe(true)
  // A second model does not take over the running one.
  expect(added).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(added.models).toEqual([
    { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', bytes: MODEL.length, source: 'catalog', active: true },
    { id, name: 'tiny-Q4_K_M', bytes: TINY.length, source: 'huggingface', active: false },
  ])
  expect((await f.llama.lookupHuggingFace('acme/tiny-GGUF')).files[0]?.installed).toBe(true)
  // Asking again for an installed file names the installed model.
  expect(await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')).toBe(id)

  await f.llama.select(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id, name: 'tiny-Q4_K_M' } })
  expect(await launchedModel(f)).toContain(join('models', id))

  await f.llama.removeModel(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(f.llama.snapshot().models.map(model => model.id)).toEqual(['jan-v3.5-4b'])
  expect(await launchedModel(f)).toContain(join('models', 'jan-v3.5-4b'))
  await expect(stat(join(f.home, 'data', 'models', id))).rejects.toThrow()
  await expect(f.llama.downloadHuggingFace('acme/tiny-GGUF', 'missing.gguf')).rejects.toThrow(/no downloadable file/)
  await expect(f.llama.lookupHuggingFace('acme/absent')).rejects.toMatchObject({ reason: 'not-found' })
}, 30_000)

it('imports a GGUF file in place, refuses other files, and only forgets it on removal', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  const dir = await temp('llama-import-')
  const model = join(dir, 'My Model.gguf')
  await writeFile(model, TINY)
  await writeFile(join(dir, 'notes.gguf'), 'not a model')
  await expect(f.llama.importModel('relative.gguf')).rejects.toThrow(/full path/)
  await expect(f.llama.importModel(join(dir, 'absent.gguf'))).rejects.toThrow(/No file/)
  await expect(f.llama.importModel(join(dir, 'notes.gguf'))).rejects.toThrow(/not a GGUF model file/)

  const id = await f.llama.importModel(model)
  expect(id).toBe('my-model')
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({ phase: 'running', model: { id, name: 'My Model' }, models: [{ id, source: 'import', active: true }] })
  expect(await launchedModel(f)).toBe(model)
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
  expect(record).toMatchObject({ version: 2, active: 'jan-v3.5-4b' })
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
  value: { providers: Record<string, { models?: unknown }> } = { providers: { local: { models: [{ id: 'jan-v3.5-4b' }] } } }
  readonly writes: unknown[] = []
  constructor(ctx: Context) { super(ctx, 'settings') }
  describe(): Array<{ ns: string; value: unknown }> { return [{ ns: 'llm-pi-ai', value: this.value }] }
  mutate(ns: string, ops: Array<{ path: string[]; value: unknown }>): Promise<void> {
    this.writes.push({ ns, ops })
    for (const op of ops) this.value.providers.local = { models: op.value }
    return Promise.resolve()
  }
}

it('lists the active model on the local route when a settings service is mounted', async () => {
  const settings: { current?: FakeSettings } = {}
  const f = await fixture({ extraFiles: HF_FILES, before: async (ctx) => {
    await ctx.plugin(FakeSettings)
    settings.current = ctx.get('settings') as never
  } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const entry = { id: 'local', name: 'Jan v3.5 4B (local)', contextWindow: 32768, maxTokens: 8192 }
  expect(settings.current?.writes).toEqual([{ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'local', 'models'], value: [entry] }] }])
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2)
  await f.llama.select(id)
  expect(settings.current?.value.providers.local?.models).toEqual([{ ...entry, name: 'tiny-Q4_K_M (local)' }])
  // An unchanged list is not written again.
  await f.llama.select(id)
  expect(settings.current?.writes).toHaveLength(2)
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
  expect(() => { f.llama.retry('tiny-q4_k_m') }).toThrow(/no failed download/)
}, 30_000)

it('keeps curated ids for curated models', async () => {
  const curated = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(1024, 2)])
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
