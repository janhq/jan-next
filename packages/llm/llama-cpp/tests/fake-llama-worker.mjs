#!/usr/bin/env node
// Stand-in for jan-llama-worker: same flags, JAN_LLAMA_API_KEY bearer auth, the stdout handshake,
// `--list-devices`, `alias-of` sections, lifecycle routes with `--models-max` LRU eviction, `/models/sse`
// and an OpenAI-style stream that loads its model on demand; stops on stdin end of file.
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

/** Parse a preset into `{ shared, models: { [id]: { key: value } }, aliases: { [alias]: id } }`. */
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
  const { '*': shared = {}, ...rest } = sections
  const models = {}
  const aliases = {}
  for (const [id, section] of Object.entries(rest)) {
    if (section['alias-of'] === undefined) models[id] = section
    else aliases[id] = section['alias-of']
  }
  return { shared, models, aliases }
}

let preset = readPreset(flag('--preset'))
let modelsMax = Number(flag('--models-max') ?? 0)
log({ type: 'start', argv: process.argv.slice(1), hasKey: Boolean(key), keyInArgv: process.argv.some(arg => arg === key), cwd: process.cwd(), preset })
console.error('fake worker: reading preset')
if (mode.exitCode !== undefined) { console.error('fake worker: failed to start'); process.exit(mode.exitCode) }

/** Resident model id → its gguf path, least recently used first. */
const loaded = new Map()
const feeds = new Set()
const emit = (model, status) => {
  const frame = `data: ${JSON.stringify({ model, event: 'status_change', data: { status, ...status === 'unloaded' ? { exit_code: 0 } : {} } })}\n\n`
  for (const res of feeds) res.write(frame)
}
const resolve = name => preset.aliases[name] ?? name
const drop = (id) => { if (loaded.delete(id)) { emit(id, 'unloaded'); log({ type: 'unload', model: id }) } }
/** Load a section like the worker: evict the least recently used model at the bound, else mark it used. */
async function acquire(id) {
  if (loaded.has(id)) { const path = loaded.get(id); loaded.delete(id); loaded.set(id, path); return }
  const section = preset.models[id]
  if (!section) throw new Error(`no such model: ${id}`)
  while (modelsMax > 0 && loaded.size >= modelsMax) drop(loaded.keys().next().value)
  emit(id, 'loading')
  await new Promise(resolve => setTimeout(resolve, mode.loadingMs ?? 0))
  if (mode.loadError) { emit(id, 'unloaded'); throw new Error(mode.loadError) }
  loaded.set(id, section.model)
  emit(id, 'loaded')
  log({ type: 'load', model: id, path: section.model })
}
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)) }
const body = req => new Promise(resolve => { let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => { resolve(text ? JSON.parse(text) : {}) }) })

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${key}`) { json(res, 401, { error: { message: 'invalid api key', code: 401 } }); return }
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    json(res, 200, { object: 'list', data: Object.keys(preset.models).map(id => ({ id, status: { value: loaded.has(id) ? 'loaded' : 'unloaded' } })) })
    return
  }
  if (req.method === 'GET' && url.pathname === '/models/sse') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': subscribed\n\n')
    feeds.add(res)
    res.on('close', () => { feeds.delete(res) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/models/reload') {
    const { preset_path: path, models_max: max } = await body(req)
    const next = readPreset(path)
    for (const id of loaded.keys()) {
      if (JSON.stringify(next.models[id]) !== JSON.stringify(preset.models[id])) drop(id)
    }
    preset = next
    modelsMax = max
    log({ type: 'reload', modelsMax, preset })
    json(res, 200, { added: [], changed: [], removed: [], kept: [], models_max: modelsMax })
    return
  }
  if (req.method === 'POST' && url.pathname === '/models/load') {
    const model = resolve((await body(req)).model)
    try { await acquire(model) }
    catch (error) { json(res, 400, { error: { message: error.message, code: 400 } }); return }
    json(res, 200, { status: 'loaded', model })
    return
  }
  if (req.method === 'POST' && url.pathname === '/models/unload') {
    const model = resolve((await body(req)).model)
    if (mode.unloadBusy) { json(res, 409, { error: { message: 'the model has requests in flight; retry once they finish', code: 409 } }); return }
    drop(model)
    json(res, 200, { status: 'unloaded', model })
    return
  }
  if (req.method === 'GET' && url.pathname === '/props') {
    // A real worker reports the context fit settled on; the fake reports ctx-size, or 20000 when fit chose.
    const section = preset.models[resolve(url.searchParams.get('model') ?? '')] ?? {}
    json(res, 200, { default_generation_settings: { n_ctx: Number(section['ctx-size'] ?? preset.shared['ctx-size'] ?? 20000) } })
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const model = resolve((await body(req)).model)
    try { await acquire(model) }
    catch (error) { json(res, 400, { error: { message: error.message, code: 400 } }); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = delta => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    res.write(chunk({ role: 'assistant', content: `hello from ${loaded.get(model) ?? 'nothing'}` }))
    res.end('data: [DONE]\n\n')
    return
  }
  json(res, 404, { error: { message: `no such route: ${url.pathname}`, code: 404 } })
})

const stop = reason => { log({ type: 'exit', reason }); for (const res of feeds) res.end(); server.close(); process.exit(0) }
process.stdin.on('end', () => { if (!mode.ignoreStdinEnd) stop('stdin-end') })
process.stdin.resume()
process.on('SIGTERM', () => { stop('sigterm') })

setTimeout(() => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    if (mode.badHandshake) process.stdout.write('not json\n')
    else process.stdout.write(`${JSON.stringify({ port, pid: process.pid, models: Object.keys(preset.models).sort(), aliases: preset.aliases, cuda_toolkit: null, devices: [] })}\n`)
  })
  if (mode.crashAfterMs) setTimeout(() => { console.error('fake worker: segfault'); process.exit(139) }, mode.crashAfterMs)
}, mode.handshakeDelayMs ?? 50)
