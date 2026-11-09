#!/usr/bin/env node
// Stand-in for llama-server: same flags, LLAMA_API_KEY auth, /health and an OpenAI-style stream.
// Behaviour switches are read from `fake-mode.json` next to this script.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let mode = {}
try { mode = JSON.parse(readFileSync(join(here, 'fake-mode.json'), 'utf8')) } catch {}
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const port = Number(flag('--port'))
const alias = flag('--alias')
const key = process.env.LLAMA_API_KEY
writeFileSync(join(here, 'fake-launch.json'), JSON.stringify({ argv: process.argv.slice(1), hasKey: Boolean(key), cwd: process.cwd() }))
console.error('fake llama-server: loading model')
if (mode.exitImmediately) { console.error('fake llama-server: failed to load model'); process.exit(3) }

const loadedAt = Date.now() + (mode.loadingMs ?? 0)
const server = createServer((req, res) => {
  if (req.url === '/health') {
    // Like llama-server: 503 while the model loads, 200 once it serves.
    if (Date.now() < loadedAt) { res.writeHead(503).end('{"error":{"message":"Loading model"}}'); return }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}')
    return
  }
  if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401).end('{"error":"unauthorized"}'); return }
  if (req.url === '/props') {
    // Real servers report the context --fit settled on; the fake reports -c, or 20000 when fit chose.
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ default_generation_settings: { n_ctx: Number(flag('-c') ?? 20000) } }))
    return
  }
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: alias }] })); return }
  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = delta => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: alias, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    res.write(chunk({ role: 'assistant', content: 'hello from local' }))
    res.end('data: [DONE]\n\n')
    return
  }
  res.writeHead(404).end()
})
setTimeout(() => {
  server.listen(port, '127.0.0.1', () => { console.error(`main: server is listening on http://127.0.0.1:${port}`) })
  if (mode.crashAfterMs) setTimeout(() => { console.error('fake llama-server: segfault'); process.exit(139) }, mode.crashAfterMs)
}, mode.readyDelayMs ?? 50)
process.on('SIGTERM', () => { server.close(); process.exit(0) })
