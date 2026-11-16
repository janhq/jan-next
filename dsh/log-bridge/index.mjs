// Adapted from dataelement/dsh-desktop `dsh-desktop-log-bridge` (MIT, Copyright (c) 2026 DataElement).
//
// Cordis keeps logger messages in an in-memory ring only, and its default
// level drops warnings, so a failure after startup (a session that cannot
// activate, a plugin that fails to mount) left nothing in Jan's log. Session
// activation failures never reach the logger at all: they go to the client as
// `api-session/error`. This writes both to stderr, which Rust records at warn
// level under `[dsh-web]`.

export const name = 'ow-log-bridge'
export const inject = []

/** Rust picks out these lines and logs them at warn level. */
export const LINE_PREFIX = '[dsh-log]'

// Cordis levels: error 0, warn 1. The exporter admits both.
const EXPORT_LEVEL = 1
// A warning raised in a loop must not flood the log.
const WINDOW_MS = 60_000
const WINDOW_LIMIT = 100

function format(message) {
  const args = message.args.slice()
  if (args[0] instanceof Error) return [args[0].stack || args[0].message, ...args.slice(1).map(String)].join(' ')
  let text = typeof args[0] === 'string' ? args.shift() : '%o'
  text = text.replace(/%([a-zA-Z%])/g, (match, c) => {
    if (match === '%%') return '%'
    if (!args.length) return match
    const value = args.shift()
    if ('oOj'.includes(c)) { try { return JSON.stringify(value) } catch { return String(value) } }
    if ('dif'.includes(c)) return String(Number(value))
    return c === 'c' ? '' : String(value)
  })
  for (const arg of args) text += ' ' + (arg && typeof arg === 'object' ? safeJson(arg) : String(arg))
  return text
}

function safeJson(value) {
  if (value instanceof Error) return value.stack || value.message
  try { return JSON.stringify(value) } catch { return String(value) }
}

function lines(type, source, text) {
  const [first = '', ...rest] = String(text).split(/\r?\n/)
  return [`${LINE_PREFIX} ${type} ${source}: ${first}`, ...rest.filter(l => l.trim()).map(l => `${LINE_PREFIX}   ${l}`)]
}

function limitedWriter(write, now = Date.now) {
  let start = now(), written = 0, dropped = 0
  return (out) => {
    const t = now()
    if (t - start >= WINDOW_MS) {
      if (dropped) write(`${LINE_PREFIX} warn ow-log-bridge: dropped ${dropped} message(s) over the rate limit\n`)
      start = t; written = 0; dropped = 0
    }
    if (written >= WINDOW_LIMIT) { dropped++; return }
    written++
    write(out.join('\n') + '\n')
  }
}

export function apply(ctx) {
  const emit = limitedWriter(text => process.stderr.write(text))
  const exporter = {
    colors: 0,
    levels: { default: EXPORT_LEVEL },
    export(message) {
      if (message.type !== 'error' && message.type !== 'warn') return
      emit(lines(message.type, message.name, format(message)))
    },
  }
  // Errors logged before this plugin loaded are still in the ring.
  for (const message of Array.isArray(ctx.logger.buffer) ? ctx.logger.buffer : []) {
    if (message?.type === 'error') exporter.export(message)
  }
  ctx.logger.exporter(exporter)
  ctx.on('api-session/error', (sessionId, error) => emit(lines('session-error', String(sessionId), error?.stack ?? error)))
  // One notice per launch: a log without it predates the bridge, so a missing
  // error there proves nothing.
  process.stdout.write(`${LINE_PREFIX} ready\n`)
}
