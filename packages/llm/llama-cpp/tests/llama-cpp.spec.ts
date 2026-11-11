import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { download, DownloadError, engineFor, LlamaCpp, parseRepo, RateMeter, type LlamaCppState } from '../src/index.ts'

const FAKE = new URL('./fake-llama-server.mjs', import.meta.url).pathname
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise(resolve => server.close(resolve))
  return port
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

// ── engines ─────────────────────────────────────────────────────────────────

it('pins an engine per platform: Metal on Apple Silicon, zips on Windows, none where llama.cpp has no build', () => {
  expect(engineFor({ platform: 'darwin', arch: 'arm64', backend: 'vulkan' })).toMatchObject({ flavor: 'metal', gpu: true, executable: 'llama-server' })
  expect(engineFor({ platform: 'darwin', arch: 'x64', backend: 'cpu' })).toMatchObject({ flavor: 'cpu', gpu: false })
  expect(engineFor({ platform: 'linux', arch: 'x64', backend: 'cpu' })?.url).toMatch(/bin-ubuntu-x64\.tar\.gz$/)
  expect(engineFor({ platform: 'linux', arch: 'x64', backend: 'vulkan' })).toMatchObject({ flavor: 'vulkan', gpu: true })
  expect(engineFor({ platform: 'win32', arch: 'x64', backend: 'cpu' })).toMatchObject({ executable: 'llama-server.exe', gpu: false })
  expect(engineFor({ platform: 'win32', arch: 'x64', backend: 'cpu' })?.url).toMatch(/bin-win-cpu-x64\.zip$/)
  expect(engineFor({ platform: 'freebsd', arch: 'x64', backend: 'cpu' })).toBeUndefined()
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

it('falls back to a mirror, with its headers, when the primary URL fails', async () => {
  const body = Buffer.alloc(8192, 5)
  const seen: Array<string | undefined> = []
  const server = createServer((req, res) => {
    seen.push(`${req.url ?? ''} ${req.headers.accept ?? ''}`)
    if (req.url === '/primary') { res.writeHead(504).end('gateway timeout'); return }
    if (req.headers.accept !== 'application/octet-stream') { res.writeHead(415).end(); return }
    res.writeHead(200, { 'content-length': String(body.length) }).end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const dest = join(await temp('llama-dl-'), 'm.gguf')
  await download({ url: `${origin}/primary`, sha256: sha(body), bytes: body.length,
    mirrors: [{ url: `${origin}/mirror`, headers: { accept: 'application/octet-stream' } }] }, dest, 'engine', new AbortController().signal, () => {})
  expect((await readFile(dest)).equals(body)).toBe(true)
  expect(seen).toEqual(['/primary */*', '/mirror application/octet-stream'])
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
  await mkdir(bin, { recursive: true })
  await copyFile(FAKE, join(bin, 'llama-server'))
  execFileSync('chmod', ['+x', join(bin, 'llama-server')])
  await writeFile(join(bin, 'fake-mode.json'), JSON.stringify(options.mode ?? {}))
  const port = await freePort()
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  await options.before?.(ctx)
  const plugin = ctx.plugin(LlamaCpp, {
    dataRoot: join(home, 'data'), port, binaryPath: join(bin, 'llama-server'), graceMs: 2000, progressIntervalMs: 1,
    startTimeoutMs: 15_000, huggingFaceURL: server.origin,
    artifactOverrides: { model: { url: `${server.origin}/model.gguf`, sha256: sha(MODEL), bytes: MODEL.length } },
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
  const key = async (): Promise<string | undefined> => {
    const text = await readFile(join(home, 'credentials.yaml'), 'utf8').catch(() => '')
    return /(llamacpp-[\w-]+)/.exec(text)?.[1]
  }
  return { ctx, llama, port, home, bin, server, until, seen, key, dispose }
}

it('installs the model, stores a route key, and serves it on the loopback port with that key', async () => {
  const f = await fixture()
  await f.until(s => s.phase === 'missing')
  expect(await f.key()).toBeUndefined()
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(running).toMatchObject({ phase: 'running', provider: 'local', model: { id: 'jan-v3.5-4b' } })
  expect(f.seen.some(s => s.phase === 'downloading' && s.progress?.phase === 'model')).toBe(true)

  const key = await f.key()
  expect(key).toMatch(/^llamacpp-/)
  const origin = `http://127.0.0.1:${f.port}`
  expect((await fetch(`${origin}/v1/models`)).status).toBe(401)
  const models = await fetch(`${origin}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  expect(await models.json()).toEqual({ data: [{ id: 'jan-v3.5-4b' }] })

  const launch = JSON.parse(await readFile(join(f.bin, 'fake-launch.json'), 'utf8')) as { argv: string[]; hasKey: boolean; cwd: string }
  expect(launch.hasKey).toBe(true)
  expect(launch.argv.join(' ')).not.toContain(key)
  expect(launch.argv).toEqual(expect.arrayContaining(['--host', '127.0.0.1', '--alias', 'jan-v3.5-4b', '--jinja', '--no-webui']))
  // Fit sizes the GPU layers; the context stays pinned for the route.
  expect(launch.argv.join(' ')).toContain('-c 32768 --fit on --fit-target 1024')
  expect(launch.argv).not.toContain('-ngl')
  expect(running.contextSize).toBe(32768)
  // macOS reports the realpath of a symlinked tmpdir (/var -> /private/var) as the child's cwd.
  expect(launch.cwd).toBe(await realpath(f.bin))
})

it('lets --fit choose the context when ctxSize is 0, and pins layers when fit is off', async () => {
  const f = await fixture({ config: { ctxSize: 0 } })
  f.llama.install()
  const running = await f.until(s => s.phase === 'running' || s.phase === 'failed')
  const launch = JSON.parse(await readFile(join(f.bin, 'fake-launch.json'), 'utf8')) as { argv: string[] }
  expect(launch.argv).not.toContain('-c')
  expect(launch.argv.join(' ')).toContain('--fit on --fit-target 1024 --fit-ctx 16384')
  expect(running.contextSize).toBe(20000)
  await f.dispose()

  const off = await fixture({ home: f.home, config: { fit: false, gpuLayers: 20 } })
  await off.until(s => s.phase === 'running' || s.phase === 'failed')
  const relaunch = JSON.parse(await readFile(join(off.bin, 'fake-launch.json'), 'utf8')) as { argv: string[] }
  expect(relaunch.argv.join(' ')).toContain('-c 32768 --fit off -ngl 20')
}, 20_000)

it('stops, starts again, and starts by itself on the next boot', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await f.llama.stop()
  expect(f.llama.snapshot().phase).toBe('stopped')
  await expect(fetch(`http://127.0.0.1:${f.port}/health`)).rejects.toThrow()
  await f.llama.start()
  expect(f.llama.snapshot().phase).toBe('running')
  const key = await f.key()
  expect(key).toMatch(/^llamacpp-/)
  await f.dispose()
  // Shutting down withdraws the key, so the route offers nothing while no server runs.
  expect(await f.key()).toBeUndefined()

  const again = await fixture({ home: f.home })
  const state = await again.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state.phase).toBe('running')
  expect(again.server.requests).toEqual([]) // nothing downloaded on the second boot
  const next = await again.key()
  expect(next).toMatch(/^llamacpp-/)
  expect(next).not.toBe(key) // a fresh key per launch
}, 20_000)

it('withholds the route key until the server serves, and a Stop survives the next boot', async () => {
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

it('stops a server that is still loading without waiting for it', async () => {
  const f = await fixture({ mode: { loadingMs: 60_000 } })
  f.llama.install()
  await f.until(s => s.phase === 'starting')
  await new Promise(resolve => setTimeout(resolve, 300))
  const started = Date.now()
  await f.llama.stop()
  expect(Date.now() - started).toBeLessThan(5000)
  expect(f.llama.snapshot().phase).toBe('stopped')
  await expect(fetch(`http://127.0.0.1:${f.port}/health`)).rejects.toThrow()
}, 20_000)

it('leaves no server behind when disposed during start', async () => {
  const f = await fixture({ mode: { loadingMs: 60_000 } })
  f.llama.install()
  await f.until(s => s.phase === 'starting')
  await new Promise(resolve => setTimeout(resolve, 300))
  const started = Date.now()
  await f.dispose()
  expect(Date.now() - started).toBeLessThan(5000)
  await expect(fetch(`http://127.0.0.1:${f.port}/health`)).rejects.toThrow()
  expect(await f.key()).toBeUndefined()
}, 20_000)

it('withdraws the key when the server crashes', async () => {
  const f = await fixture({ mode: { crashAfterMs: 1500 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  expect(await f.key()).toMatch(/^llamacpp-/)
  await f.until(s => s.phase === 'failed')
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(await f.key()).toBeUndefined()
}, 20_000)

it('refuses to start when the port is taken by something else', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await f.dispose()
  const other = createServer((_req, res) => { res.writeHead(200).end() })
  const g = await fixture({ home: f.home, config: { autoStart: false } })
  await g.until(s => s.phase === 'installed')
  await new Promise<void>(resolve => other.listen(g.port, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => other.close(resolve)))
  await g.llama.start()
  const failed = g.llama.snapshot()
  expect(failed.phase).toBe('failed')
  expect(failed.error).toMatch(/port \d+ is already in use/)
})

it('reports a server that exits before it is ready, with its log tail', async () => {
  const f = await fixture({ mode: { exitImmediately: true } })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/exited \(code 3\)/)
  expect(failed.logTail).toContain('failed to load model')
})

it('reports a crash after start', async () => {
  const f = await fixture({ mode: { crashAfterMs: 2000 } })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/exited \(code 139\)/)
  expect(failed.logTail).toContain('segfault')
}, 15_000)

it('cancels a download, keeps the partial file, and resumes it on the next install', async () => {
  const f = await fixture({ throttle: true })
  f.llama.install()
  await f.until(s => s.phase === 'downloading' && (s.progress?.receivedBytes ?? 0) > 20_000)
  await f.llama.cancel()
  expect(f.llama.snapshot().phase).toBe('missing')
  const partial = await stat(join(f.home, 'data', 'models', 'jan-v3.5-4b', `${sha(MODEL).slice(0, 16)}.gguf.partial`))
  expect(partial.size).toBeGreaterThan(0)
  f.llama.install()
  await f.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(f.llama.snapshot().phase).toBe('running')
  expect(f.server.requests.at(-1)?.range).toMatch(/^bytes=\d+-$/)
}, 30_000)

it('removes the install and the route key', async () => {
  const f = await fixture()
  f.llama.install()
  await f.until(s => s.phase === 'running')
  await f.llama.uninstall()
  expect(f.llama.snapshot().phase).toBe('missing')
  expect(await f.key()).toBeUndefined()
  await expect(stat(join(f.home, 'data', 'models'))).rejects.toThrow()
  await expect(fetch(`http://127.0.0.1:${f.port}/health`)).rejects.toThrow()
})

it('unpacks a downloaded engine archive and runs the server inside it', async () => {
  const home = await temp('llama-engine-')
  const stage = join(home, 'stage', 'llama-b0')
  await mkdir(stage, { recursive: true })
  await copyFile(FAKE, join(stage, 'llama-server'))
  execFileSync('chmod', ['644', join(stage, 'llama-server')]) // the plugin must make it executable
  const archive = join(home, 'engine.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', join(home, 'stage'), 'llama-b0'])
  const tarball = await readFile(archive)
  const engine = await files({ '/engine.tar.gz': tarball })
  const g = await fixture({ home, config: modelOrigin => ({
    binaryPath: undefined,
    artifactOverrides: {
      engine: { url: `${engine.origin}/engine.tar.gz`, sha256: sha(tarball), bytes: tarball.length },
      model: { url: `${modelOrigin}/model.gguf`, sha256: sha(MODEL), bytes: MODEL.length },
    },
  }) })
  await g.until(s => s.phase === 'missing')
  g.llama.install()
  const state = await g.until(s => s.phase === 'running' || s.phase === 'failed')
  expect(state).toMatchObject({ phase: 'running' })
  expect(g.seen.some(s => s.progress?.phase === 'engine')).toBe(true)
  const record = JSON.parse(await readFile(join(home, 'data', 'install.json'), 'utf8')) as { engine: { binary: string } }
  expect(record.engine.binary).toBe(join('llama-b0', 'llama-server'))
  await expect(stat(join(home, 'data', 'downloads', 'engine.tar.gz'))).rejects.toThrow()
}, 30_000)

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
    ],
  })),
  [`/acme/tiny-GGUF/resolve/${REVISION}/tiny-Q4_K_M.gguf`]: TINY,
}

async function launchArgv(bin: string): Promise<string[]> {
  return (JSON.parse(await readFile(join(bin, 'fake-launch.json'), 'utf8')) as { argv: string[] }).argv
}

async function launchedAlias(bin: string): Promise<string | undefined> {
  const argv = await launchArgv(bin)
  return argv[argv.indexOf('--alias') + 1]
}

it('downloads a model from a Hugging Face repository, switches to it, and removes it', async () => {
  const f = await fixture({ extraFiles: HF_FILES })
  f.llama.install()
  await f.until(s => s.phase === 'running')
  const repo = await f.llama.lookupHuggingFace(`${f.server.origin}/acme/tiny-GGUF/tree/main`)
  expect(repo).toEqual({ repo: 'acme/tiny-GGUF', files: [{ file: 'tiny-Q4_K_M.gguf', bytes: TINY.length, quant: 'Q4_K_M', recommended: true, installed: false }] })

  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  expect(id).toBe('tiny-q4_k_m')
  const added = await f.until(s => s.models.length === 2 && s.downloads.length === 0)
  expect(f.seen.some(s => s.downloads[0]?.progress?.overallTotalBytes === TINY.length)).toBe(true)
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
  expect(await launchedAlias(f.bin)).toBe(id)

  await f.llama.removeModel(id)
  expect(f.llama.snapshot()).toMatchObject({ phase: 'running', model: { id: 'jan-v3.5-4b' } })
  expect(f.llama.snapshot().models.map(model => model.id)).toEqual(['jan-v3.5-4b'])
  expect(await launchedAlias(f.bin)).toBe('jan-v3.5-4b')
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
  const argv = await launchArgv(f.bin)
  expect(argv[argv.indexOf('-m') + 1]).toBe(model)
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
    artifactOverrides: { model: { url: `${modelOrigin}/absent.gguf`, sha256: sha(MODEL), bytes: MODEL.length } },
  }) })
  f.llama.install()
  const failed = await f.until(s => s.phase === 'failed')
  expect(failed.error).toMatch(/HTTP 404/)
  expect(failed.downloads).toHaveLength(1)
  expect(failed.downloads[0]?.error).toMatch(/HTTP 404/)
  await f.llama.cancel('jan-v3.5-4b')
  expect(f.llama.snapshot().downloads).toEqual([])
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
  const entry = { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B (local)', contextWindow: 32768, maxTokens: 8192 }
  expect(settings.current?.writes).toEqual([{ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'local', 'models'], value: [entry] }] }])
  const id = await f.llama.downloadHuggingFace('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  await f.until(s => s.models.length === 2)
  await f.llama.select(id)
  expect(settings.current?.value.providers.local?.models).toEqual([{ ...entry, id, name: 'tiny-Q4_K_M (local)' }])
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
