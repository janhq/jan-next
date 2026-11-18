/**
 * Startup health: plugins and MCP servers that failed to start are switched
 * off so the next launch does not try them again, recorded for the browser's
 * failure notices, and written with every warning and error to a log file the
 * notice can open.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { format } from 'node:util'
import { registerApi } from '@janhq/jan-plugin-api'

// Process-wide: a saved setting reloads this plugin, and the notices and log
// must survive that reload until the person dismisses them or Jan restarts.
const failures = new Map()
const dismissed = new Set()
let logPath
let pendingStarts = 0
// Only the first mount after launch is startup; later mounts follow a settings
// save, where a failure is the person's own fresh change and must stay on.
let launchAuditTaken = false

/**
 * Claim the once-per-launch startup audit.
 * @returns whether this mount is the launch mount and should switch failures off.
 */
export function takeLaunchAudit() {
  if (launchAuditTaken) return false
  launchAuditTaken = true
  return true
}

const FAILED = 3 // Cordis FiberState.FAILED
const MAX_LOG_BYTES = 2 * 1024 * 1024
let loggedBytes = 0

function writeLog(line) {
  if (logPath === undefined || loggedBytes > MAX_LOG_BYTES) return
  try {
    appendFileSync(logPath, line)
    loggedBytes += Buffer.byteLength(line)
  } catch (error) {
    // The log is a diagnostic aid; a full or read-only disk must not break startup.
    console.error('jan-theme: startup log write failed', error)
  }
}

/**
 * One plain sentence for the notice; the full chain goes to the log. Only
 * message lines are read: stack frames name files such as cross-spawn's
 * `enoent.js` and would match the wrong cause.
 */
function reasonOf(message) {
  const text = message.split('\n').filter(line => !/^\s*at\s/.test(line)).join('\n')
  if (/\bENOENT\b|not found|not recognized|cannot find/i.test(text)) return 'Its command wasn\'t found.'
  if (/timed out|timeout/i.test(text)) return 'It didn\'t respond in time.'
  if (/\bEACCES\b|permission denied/i.test(text)) return 'Jan wasn\'t allowed to run it.'
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(text)) return 'Its server couldn\'t be reached.'
  if (/Connection closed/i.test(text)) return 'It closed right after starting.'
  return 'It stopped while starting.'
}

/**
 * Record one failure and write it to the log.
 * @param {{ kind: 'mcp' | 'plugin', id: string, name: string, message: string, disabled: boolean }} failure
 */
export function recordFailure(failure) {
  const key = `${failure.kind}:${failure.id}`
  const previous = failures.get(key)
  // A later record about the same item (turning it off failed) keeps the original reason.
  failures.set(key, { ...failure, key, reason: previous?.reason ?? reasonOf(failure.message), at: Date.now() })
  dismissed.delete(key)
  writeLog(`${new Date().toISOString()} [startup] ${failure.kind} ${failure.name} failed${failure.disabled ? ' and was turned off' : ''}: ${failure.message}\n`)
}

/** Forget a failure once the thing it names was changed or removed. @param {string} key */
export function clearFailure(key) { failures.delete(key) }

/**
 * Count one background start, so the browser keeps asking until it settles.
 * @template T
 * @param {Promise<T>} task
 * @returns {Promise<T>}
 */
export function trackStart(task) {
  pendingStarts++
  return task.finally(() => { pendingStarts-- })
}

function openWithSystem(path) {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [path]]
    : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', error => { console.error('jan-theme: opening the log failed', error) })
  child.unref()
}

/** Failed Loader entries other than this plugin, switched off when the plugin manager can address them. */
async function auditPlugins(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return
  await loader.await()
  const manager = ctx.get('pluginManager')
  let rows = []
  try { rows = manager === undefined ? [] : await manager.listPlugins() } catch (error) {
    writeLog(`${new Date().toISOString()} [startup] plugin list unavailable: ${String(error)}\n`)
  }
  for (const entry of loader.entries()) {
    const fiber = entry.fiber
    // A settings save reloads this plugin and audits again; a known failure keeps its dismissal.
    if (entry.disabled || fiber === undefined || fiber.state !== FAILED || entry === ctx.fiber.entry || failures.has(`plugin:${entry.id}`)) continue
    let message = 'unknown error'
    try { await fiber.await() } catch (error) { message = error instanceof Error ? (error.stack ?? error.message) : String(error) }
    const row = rows.find(item => item.entryId === entry.id)
    let disabled = false
    if (row !== undefined && row.readOnlyReason === undefined) {
      try { disabled = (await manager.setPluginEnabled(row.entryId, false)).application === 'applied' } catch (error) {
        message += `\nTurning it off failed: ${String(error)}`
      }
    }
    const name = row?.meta?.title ?? entry.options.name
    recordFailure({ kind: 'plugin', id: entry.id, name: typeof name === 'string' ? name : entry.options.name, message, disabled })
  }
}

/**
 * Start the log, audit failed plugins once the tree settles, and serve the notices.
 * @param {import('@janhq/cordis').Context} ctx
 */
export function mountStartupHealth(ctx) {
  if (logPath === undefined) {
    const resolve = ctx.get('janHomePath')
    if (resolve !== undefined) {
      logPath = resolve('logs', 'jan.log')
      try {
        mkdirSync(dirname(logPath), { recursive: true })
        writeFileSync(logPath, `${new Date().toISOString()} Jan started (pid ${process.pid})\n`)
      } catch (error) {
        console.error('jan-theme: startup log unavailable', error)
        logPath = undefined
      }
    }
  }
  ctx.effect(() => ctx.logger.exporter({
    levels: { default: 2 },
    export: ({ ts, name, type, args }) => {
      if (type === 'warn' || type === 'error') writeLog(`${new Date(ts).toISOString()} [${type}] ${name}: ${format(...args)}\n`)
    },
  }), 'jan-theme: startup log')
  // Detached: the tree settles only after this plugin's own apply returns.
  void trackStart(auditPlugins(ctx).catch(error => { writeLog(`${new Date().toISOString()} [startup] plugin audit failed: ${String(error)}\n`) }))
  ctx.effect(() => registerApi(ctx, 'startup-health', {
    list: () => ({
      pending: pendingStarts > 0,
      logAvailable: logPath !== undefined,
      failures: [...failures.values()].filter(item => !dismissed.has(item.key))
        .map(({ key, kind, id, name, reason, disabled }) => ({ key, kind, id, name, reason, disabled })),
    }),
    dismiss: ({ key }) => { if (typeof key === 'string') dismissed.add(key); return { dismissed: true } },
    openLog: () => {
      if (logPath === undefined) throw new Error('Jan has no log file for this run.')
      openWithSystem(logPath)
      return { path: logPath }
    },
  }), 'jan-theme: startup health')
}
