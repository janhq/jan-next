/**
 * Diagnostics, Host half. Remembers the chats that failed since Jan started,
 * writes each failure once to Jan's log, and serves `/jan-api/diagnostics`:
 * a redacted report to copy or save, and the log folder to open. Nothing is
 * sent anywhere; the browser half's "Send diagnostics" is a disabled placeholder.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { arch, freemem, homedir, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '@janhq/jan-plugin-api'
import { canOpenNativePath, openNativePath, revealNativePath } from '@janhq/jan-native-command'
import { formatReport, readLogTail, redact } from './report.mjs'

/** Cordis identity of the diagnostics plugin. */
export const name = 'jan-diagnostics'
export const inject = ['webServer', 'connection']

/** Failed turns kept for the report, newest last. */
const MAX_FAILURES = 20
/** How long a native open may take before it is abandoned. */
const OPEN_TIMEOUT_MS = 15_000
const FAILED = 3 // Cordis FiberState.FAILED

/** The failure a `turn/end` records, or undefined for a turn that did not fail. */
function failureOf(reason) {
  if (reason?.kind === 'error') return { code: reason.error?.code, message: String(reason.error?.message ?? '') }
  if (reason?.kind === 'interrupted') return { code: 'INTERRUPTED', message: 'The Jan process exited before this turn finished.' }
  return undefined
}

/** Plugins whose start failed, by their configured name. */
function failedPlugins(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return []
  return [...loader.entries()].filter(entry => !entry.disabled && entry.fiber?.state === FAILED).map(entry => String(entry.options.name))
}

/** Timestamp safe in a file name on every system. */
function fileStamp(date) {
  return date.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-')
}

/**
 * @param {import('@janhq/cordis').Context} ctx
 */
export function apply(ctx) {
  const logger = ctx.logger('diagnostics')
  /** @type {import('./report.mjs').TurnFailure[]} */
  const failures = []
  const resolveHome = ctx.get('janHomePath')
  const janHome = resolveHome?.()
  const logDirectory = resolveHome?.('logs')
  const places = { home: homedir(), janHome }
  // Shown only in this person's own window: a real path, with just the home folder shortened.
  const shown = path => redact(path, { home: places.home })

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const failure = failureOf(event.data.reason)
    if (failure === undefined) return
    failures.push({ time: event.time, session: session.id, ...failure })
    if (failures.length > MAX_FAILURES) failures.shift()
    // Startup health writes warnings to <JAN_HOME>/logs/jan.log, so the failure lands beside its context.
    logger.warn(`turn ${String(event.data.turn)} failed in chat ${String(session.id).slice(0, 8)}: ${failure.code ?? 'no code'} ${redact(failure.message, places)}`)
  }, { global: true }), 'jan-diagnostics: failed turns')

  const requireLogs = () => {
    if (logDirectory === undefined) throw new Error('This Jan has no log folder.')
    return logDirectory
  }

  async function version() {
    if (process.env.JAN_CLIENT_VERSION) return process.env.JAN_CLIENT_VERSION
    const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
    return manifest.version
  }

  async function report(focus) {
    const logPath = logDirectory === undefined ? 'no log folder' : join(logDirectory, 'jan.log')
    return formatReport({
      now: new Date(),
      version: await version(),
      system: { platform: process.platform, release: release(), arch: arch(), node: process.version },
      memory: { rss: process.memoryUsage.rss(), free: freemem(), total: totalmem() },
      uptime: process.uptime(),
      failedPlugins: failedPlugins(ctx),
      focus,
      failures: [...failures].reverse(),
      log: logDirectory === undefined ? undefined : await readLogTail(logPath),
      logPath,
    }, places)
  }

  const focusOf = ({ code, message }) => typeof message === 'string'
    ? { ...(typeof code === 'string' ? { code } : {}), message: message.slice(0, 2000) }
    : undefined

  ctx.effect(() => registerApi(ctx, 'diagnostics', {
    info: async () => ({
      version: await version(),
      system: `${process.platform} ${release()} (${arch()})`,
      logDirectory: logDirectory === undefined ? null : shown(logDirectory),
      canOpen: canOpenNativePath(),
    }),
    report: async params => ({ text: await report(focusOf(params)) }),
    openLogs: async () => {
      const directory = requireLogs()
      await mkdir(directory, { recursive: true })
      if (!canOpenNativePath()) throw new Error(`This computer has no desktop to open folders on. The logs are in ${shown(directory)}.`)
      await openNativePath(directory, AbortSignal.timeout(OPEN_TIMEOUT_MS))
      return { path: shown(directory) }
    },
    saveReport: async (params) => {
      const directory = requireLogs()
      await mkdir(directory, { recursive: true })
      const path = join(directory, `diagnostics-${fileStamp(new Date())}.txt`)
      await writeFile(path, await report(focusOf(params)), 'utf8')
      let revealed = false
      if (canOpenNativePath()) {
        try {
          await revealNativePath(path, AbortSignal.timeout(OPEN_TIMEOUT_MS))
          revealed = true
        } catch (error) {
          logger.warn(`showing the saved report failed: ${String(error)}`)
        }
      }
      return { path: shown(path), revealed }
    },
  }), 'jan-diagnostics: route')
}
