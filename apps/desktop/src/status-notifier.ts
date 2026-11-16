/** Linux StatusNotifierItem host detection: whether a tray icon created now would be visible to the user. */

import { execFile } from 'node:child_process'
import { resolveDurationMs } from './duration-env.ts'

/** Validated host query settings. */
export interface DesktopStatusNotifierConfig {
  /** Deadline for each query command, in milliseconds; the command is killed when it passes. */
  readonly timeoutMs: number
}

/** Result of one query command. */
export type DesktopCommandOutcome =
  | { readonly kind: 'completed'; readonly stdout: string }
  /** The executable is not installed; the next query command is tried. */
  | { readonly kind: 'missing' }
  /** `exit <code>`, `timeout`, `output too large`, a terminating signal name, or a spawn error message. */
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * Run one command without a shell.
 * @param file - Executable name resolved through `PATH`.
 * @param args - Arguments passed verbatim.
 * @param timeoutMs - Deadline after which the command is killed and reported as `timeout`.
 * @returns The outcome; never rejects.
 */
export type DesktopCommandRunner = (file: string, args: readonly string[], timeoutMs: number) => Promise<DesktopCommandOutcome>

/** Whether a host is registered, with the reason when it is not. */
export type DesktopStatusNotifierHost =
  | { readonly present: true }
  | { readonly present: false; readonly reason: string }

const WATCHER = 'org.kde.StatusNotifierWatcher'
const WATCHER_PATH = '/StatusNotifierWatcher'
const PROPERTY = 'IsStatusNotifierHostRegistered'

interface HostQuery {
  readonly file: string
  readonly args: (timeoutMs: number) => readonly string[]
  /** `true` or `false` from the reply, or `undefined` when the reply has another form. */
  readonly parse: (stdout: string) => boolean | undefined
}

const parseBoolean = (pattern: RegExp) => (stdout: string): boolean | undefined => {
  const value = pattern.exec(stdout)?.[1]
  return value === undefined ? undefined : value === 'true'
}

/** gdbus ships with GLib; dbus-send ships with the reference D-Bus tools. Either suffices. */
const HOST_QUERIES: readonly HostQuery[] = [
  {
    file: 'gdbus',
    args: () => ['call', '--session', '--dest', WATCHER, '--object-path', WATCHER_PATH,
      '--method', 'org.freedesktop.DBus.Properties.Get', WATCHER, PROPERTY],
    parse: parseBoolean(/^\(<(true|false)>,\)\s*$/u),
  },
  {
    file: 'dbus-send',
    args: timeoutMs => ['--session', '--print-reply=literal', `--reply-timeout=${String(timeoutMs)}`, `--dest=${WATCHER}`,
      WATCHER_PATH, 'org.freedesktop.DBus.Properties.Get', `string:${WATCHER}`, `string:${PROPERTY}`],
    parse: parseBoolean(/^\s*variant\s+boolean\s+(true|false)\s*$/u),
  },
]

/**
 * Read host query settings from the Desktop process environment.
 * @param env - Desktop process environment.
 * @returns Settings with `JAN_DESKTOP_STATUS_NOTIFIER_TIMEOUT_MS`, default 2000.
 */
export function resolveDesktopStatusNotifierConfig(env: NodeJS.ProcessEnv): DesktopStatusNotifierConfig {
  return { timeoutMs: resolveDurationMs(env, 'JAN_DESKTOP_STATUS_NOTIFIER_TIMEOUT_MS', 2_000) }
}

/**
 * Ask the session bus whether a StatusNotifierWatcher has a registered host. Without one, Electron still
 * creates a tray without error but no icon appears.
 * @param config - Per-command deadline.
 * @param run - Command runner; {@link runDesktopCommand} in production.
 * @returns `present: true` only for an explicit `true` reply; a missing watcher, a missing tool, a failed or
 * timed-out query, and an unrecognized reply all report absence.
 */
export async function detectStatusNotifierHost(config: DesktopStatusNotifierConfig,
  run: DesktopCommandRunner = runDesktopCommand): Promise<DesktopStatusNotifierHost> {
  for (const query of HOST_QUERIES) {
    const outcome = await run(query.file, query.args(config.timeoutMs), config.timeoutMs)
    if (outcome.kind === 'missing') continue
    if (outcome.kind === 'failed') return { present: false, reason: `${query.file}: ${outcome.reason}` }
    const registered = query.parse(outcome.stdout)
    if (registered === undefined) return { present: false, reason: `${query.file}: unrecognized reply` }
    return registered ? { present: true } : { present: false, reason: `${query.file}: no host registered` }
  }
  return { present: false, reason: `none of ${HOST_QUERIES.map(query => query.file).join(', ')} is installed` }
}

/** {@link DesktopCommandRunner} backed by `execFile`. */
export const runDesktopCommand: DesktopCommandRunner = (file, args, timeoutMs) => new Promise((resolve) => {
  execFile(file, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 65_536, encoding: 'utf8' },
    (error, stdout) => {
      if (error === null) resolve({ kind: 'completed', stdout })
      else if (error.code === 'ENOENT') resolve({ kind: 'missing' })
      else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve({ kind: 'failed', reason: 'output too large' })
      else if (error.killed) resolve({ kind: 'failed', reason: 'timeout' })
      else if (typeof error.code === 'number') resolve({ kind: 'failed', reason: `exit ${String(error.code)}` })
      else resolve({ kind: 'failed', reason: error.signal ?? error.message })
    })
})
