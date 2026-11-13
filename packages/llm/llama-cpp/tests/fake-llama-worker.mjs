#!/usr/bin/env node
// Stand-in for jan-llama-worker: same flags, JAN_LLAMA_API_KEY bearer auth, the stdout handshake,
// `--list-devices`, lifecycle routes and an OpenAI-style stream; stops on stdin end of file.
// Behaviour switches are read from `fake-mode.json` next to this script; events go to `fake-events.jsonl`.
import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let mode = {}
try { mode = JSON.parse(readFileSync(join(here, 'fake-mode.json'), 'utf8')) } catch {}
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const key = process.env.JAN_LLAMA_API_KEY
const log = event => appendFileSync(join(here, 'fake-events.jsonl'), `${JSON.stringify({ pid: process.pid, ...event })}\n`)

if (args.includes('--list-devices')) {
  // Lists `mode.devices` (memory in MiB), the real worker's stdout format; logs no event.
  console.error('fake worker: enumerating devices')
  if (mode.listDevicesExitCode !== undefined) process.exit(mode.listDevicesExitCode)
  process.stdout.write(`${JSON.stringify(mode.devices ?? [])}\n`)
  process.exit(0)
}

/** Parse a preset into `{ shared, sections: { [id]: { key: value } } }`. */
function readPreset(path) {
  const sections = {}
  let current
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) { current = sections[header[1]] = {}; continue }
    const pair = /^([\w-]+)\s*=\s*(.*)$/.exec(line)
    if (pair && current) current[pair[1]] = pair[2]
  }
  const { '*': shared = {}, ...models } = sections
  return { shared, models }
}

let preset = readPreset(flag('--preset'))
log({ type: 'start', argv: process.argv.slice(1), hasKey: Boolean(key), keyInArgv: process.argv.some(arg => arg === key), cwd: process.cwd(), preset })
console.error('fake worker: reading preset')
if (mode.exitCode !== undefined) { console.error('fake worker: failed to start'); process.exit(mode.exitCode) }

const loaded = new Map()
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)) }
const body = req => new Promise(resolve => { let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => { resolve(text ? JSON.parse(text) : {}) }) })

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${key}`) { json(res, 401, { error: { message: 'invalid api key', code: 401 } }); return }
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    json(res, 200, { object: 'list', data: Object.keys(preset.models).map(id => ({ id, status: { value: loaded.has(id) ? 'loaded' : 'unloaded' } })) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/models/reload') {
    const { preset_path: path, models_max: modelsMax } = await body(req)
    const next = readPreset(path)
    for (const id of Object.keys(next.models)) {
      if (JSON.stringify(next.models[id]) !== JSON.stringify(preset.models[id])) loaded.delete(id)
    }
    preset = next
    log({ type: 'reload', modelsMax, preset })
    json(res, 200, { added: [], changed: [], removed: [], kept: [], models_max: modelsMax })
    return
  }
  if (req.method === 'POST' && url.pathname === '/models/load') {
    const { model } = await body(req)
    const section = preset.models[model]
    if (!section) { json(res, 400, { error: { message: `no such model: ${model}`, code: 400 } }); return }
    await new Promise(resolve => setTimeout(resolve, mode.loadingMs ?? 0))
    if (mode.loadError) { json(res, 400, { error: { message: mode.loadError, code: 400 } }); return }
    loaded.set(model, section.model)
    log({ type: 'load', model, path: section.model })
    json(res, 200, { status: 'loaded', model })
    return
  }
  if (req.method === 'GET' && url.pathname === '/props') {
    // A real worker reports the context fit settled on; the fake reports ctx-size, or 20000 when fit chose.
    const section = preset.models[url.searchParams.get('model') ?? ''] ?? {}
    json(res, 200, { default_generation_settings: { n_ctx: Number(section['ctx-size'] ?? preset.shared['ctx-size'] ?? 20000) } })
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const { model } = await body(req)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = delta => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    res.write(chunk({ role: 'assistant', content: `hello from ${loaded.get(model) ?? 'nothing'}` }))
    res.end('data: [DONE]\n\n')
    return
  }
  json(res, 404, { error: { message: `no such route: ${url.pathname}`, code: 404 } })
})

const stop = reason => { log({ type: 'exit', reason }); server.close(); process.exit(0) }
process.stdin.on('end', () => { if (!mode.ignoreStdinEnd) stop('stdin-end') })
process.stdin.resume()
process.on('SIGTERM', () => { stop('sigterm') })

setTimeout(() => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    if (mode.badHandshake) process.stdout.write('not json\n')
    else process.stdout.write(`${JSON.stringify({ port, pid: process.pid, models: Object.keys(preset.models).sort(), cuda_toolkit: null, devices: [] })}\n`)
  })
  if (mode.crashAfterMs) setTimeout(() => { console.error('fake worker: segfault'); process.exit(139) }, mode.crashAfterMs)
}, mode.handshakeDelayMs ?? 50)
