/**
 * The diagnostic report: plain text a person can paste into a bug report.
 * Everything that reaches it passes through `redact` first, so paths under
 * the person's home folder, keys, tokens and email addresses never leave
 * the machine through a copy or a saved file.
 */
import { open } from 'node:fs/promises'

const REDACTED = '<redacted>'

/** Values that carry their own shape: provider keys, tokens and signed blobs. */
const SECRET_SHAPES = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS = /(\/\/)[^/\s:@]+:[^/\s@]+@/g
const SECRET_QUERY = /([?&](?:token|key|api[_-]?key|access[_-]?token|sig|signature|code|secret|password)=)[^&\s#]+/gi
// `tokens: 4096` and `keyboard=` stay: the name must end where the separator starts.
const SECRET_ASSIGNMENT = /((?:api[_-]?key|secret|password|passwd|token|authorization|cookie|session[_-]?id)["']?\s*[:=]\s*["']?)(?!<redacted>)[^\s"',;}]+/gi
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/**
 * Remove what identifies the person or unlocks their accounts.
 * @param {string} text - any report text.
 * @param {{ home?: string, janHome?: string }} places - folders to write as `~` and `<JAN_HOME>`.
 * @returns {string} the text with paths shortened and secrets replaced.
 */
export function redact(text, { home, janHome } = {}) {
  let value = text
  // The Jan folder usually sits inside home; replace the longer path first.
  if (janHome) value = value.split(janHome).join('<JAN_HOME>')
  if (home) value = value.split(home).join('~')
  value = value.replace(URL_CREDENTIALS, `$1${REDACTED}@`)
  value = value.replace(SECRET_QUERY, `$1${REDACTED}`)
  value = value.replace(BEARER, `Bearer ${REDACTED}`)
  for (const shape of SECRET_SHAPES) value = value.replace(shape, REDACTED)
  value = value.replace(SECRET_ASSIGNMENT, `$1${REDACTED}`)
  return value.replace(EMAIL, '<email>')
}

/**
 * The end of a log file, cut to whole lines.
 * @param {string} path - the log file.
 * @param {{ maxBytes?: number, maxLines?: number }} limits - how much of the end to keep.
 * @returns {Promise<string | undefined>} the last lines, or undefined when the file cannot be read.
 */
export async function readLogTail(path, { maxBytes = 64 * 1024, maxLines = 200 } = {}) {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - maxBytes)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    let lines = buffer.toString('utf8').split(/\r?\n/)
    // A read that starts mid-file starts mid-line; drop the partial first line.
    if (start > 0) lines = lines.slice(1)
    if (lines.at(-1) === '') lines.pop()
    return lines.slice(-maxLines).join('\n')
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

const MB = 1024 * 1024
const GB = 1024 * MB

/**
 * @typedef {object} TurnFailure
 * @property {number} time - Unix epoch milliseconds.
 * @property {string} session - Session id.
 * @property {string} [code] - stable failure code.
 * @property {string} message - provider or Jan message.
 */

/**
 * @typedef {object} ReportFacts
 * @property {Date} now
 * @property {string} version - Jan version.
 * @property {{ platform: string, release: string, arch: string, node: string }} system
 * @property {{ rss: number, free: number, total: number }} memory - bytes.
 * @property {number} uptime - Host seconds.
 * @property {string[]} failedPlugins - plugins that failed to start.
 * @property {{ code?: string, message: string } | undefined} focus - the failure the person reported from.
 * @property {TurnFailure[]} failures - recent failed turns, newest first.
 * @property {string | undefined} log - the end of Jan's log.
 * @property {string} logPath - where the log lives.
 */

/**
 * Write the report. Callers pass raw facts; the whole text is redacted here.
 * @param {ReportFacts} facts
 * @param {{ home?: string, janHome?: string }} places
 * @returns {string}
 */
export function formatReport(facts, places) {
  const { system, memory } = facts
  const minutes = Math.round(facts.uptime / 60)
  const lines = [
    'Jan diagnostics report',
    `Generated: ${facts.now.toISOString()}`,
    `Jan: ${facts.version}`,
    `System: ${system.platform} ${system.release} (${system.arch}), Node ${system.node}`,
    `Memory: Jan ${Math.round(memory.rss / MB)} MB, system ${(memory.free / GB).toFixed(1)} of ${(memory.total / GB).toFixed(1)} GB free`,
    `Running for: ${minutes} min`,
    `Plugins that failed to start: ${facts.failedPlugins.length === 0 ? 'none' : facts.failedPlugins.join(', ')}`,
  ]
  if (facts.focus !== undefined) {
    lines.push('', 'Reported failure:', `  ${facts.focus.code ?? 'no code'}  ${facts.focus.message || '(no message)'}`)
  }
  lines.push('', `Recent failed turns (${facts.failures.length}, newest first):`)
  if (facts.failures.length === 0) lines.push('  none since Jan started')
  for (const failure of facts.failures) {
    lines.push(`  ${new Date(failure.time).toISOString()}  chat ${failure.session.slice(0, 8)}  ${failure.code ?? 'no code'}  ${failure.message || '(no message)'}`)
  }
  lines.push('', facts.log === undefined ? `Log: unavailable (${facts.logPath})` : `Log (end of ${facts.logPath}):`)
  if (facts.log !== undefined) lines.push(facts.log)
  return redact(`${lines.join('\n')}\n`, places)
}
