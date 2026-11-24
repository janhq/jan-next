/** Bounded, redacted client diagnostics shared by toast and inline failure surfaces. */

const REDACTED = '<redacted>'
const FIELD_LIMIT = 2_000
const MAX_INPUT = 64 * 1024
const MAX_CAUSES = 5
const MAX_LOG_LINES = 40
const MAX_LOG_CHARS = 8 * 1024
const MAX_REPORT_CHARS = 24 * 1024
const SECRET_NAME = String.raw`(?:[\w-]*(?:token|password|passwd|secret)|(?:[\w-]*[-_])?(?:api[-_]?key|session[-_]?id)|(?:proxy[-_])?authorization|(?:set[-_])?cookie)`
const SECRET_KEY = new RegExp(`^${SECRET_NAME}$`, 'i')
const QUOTED = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`
const QUOTED_SECRET = new RegExp(String.raw`((?:["']${SECRET_NAME}["']|\b${SECRET_NAME})[ \t]*[:=][ \t]*)(${QUOTED})`, 'gi')
const HEADER_SECRET = /((?:["']?(?:(?:proxy[-_])?authorization|(?:set[-_])?cookie|x[-_]api[-_]key)["']?)[ \t]*:[ \t]*)(?!"|')[^\r\n]+/gi
const SECRET_ASSIGNMENT = new RegExp(String.raw`(\b${SECRET_NAME}[ \t]*[:=][ \t]*)(?!["']|<redacted>)[^\s,;&}\]]+`, 'gi')
const SECRET_QUERY = /([?&](?:[\w.-]*(?:token|secret|password)|(?:api[-_])?key|sig|signature|code)=)[^&\s#"'<>]+/gi
const SECRET_SHAPES = /\b(?:(?:sk|pk|rk)-[\w-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[\w]{20,}|xox[abpr]-[\w-]{10,})\b/g
const CLOUD_KEYS_AND_JWT = /\b(?:AKIA[A-Z0-9]{16}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})\b/g

/** One captured rejection, including a known remote wrapper and its causal chain. */
interface FailureError {
  readonly code?: string | undefined
  readonly message: string
  readonly data?: string | undefined
  readonly stack?: string | undefined
}

/** Immutable redacted failure facts. No raw exception is retained by an overlay or store. */
export interface FailureDetails {
  readonly operation: string
  readonly timestamp: string
  readonly version?: string | undefined
  readonly platform?: string | undefined
  readonly connection?: string | undefined
  readonly errors: readonly FailureError[]
}

/** Host capabilities installed by the diagnostics client plugin, not required by the primitives. */
export interface FailureLogSource {
  /** Reads a redacted tail from the connected Host, or no lines if unavailable. */
  readTail: (signal: AbortSignal) => Promise<string | undefined>
  /** Reveals the Host log folder. Rejects if the Host cannot reveal it. */
  open: (signal: AbortSignal) => Promise<void>
}

let logSource: FailureLogSource | undefined
let environment: (() => { version?: string | undefined; connection?: string | undefined }) | undefined

/**
 * Bind the diagnostics provider for future actions. A failure can still be opened offline.
 * @param source - The connected Host's log read and open actions.
 * @returns Disposer for this registration.
 */
export function registerFailureLogSource(source: FailureLogSource): () => void {
  logSource = source
  return () => { if (logSource === source) logSource = undefined }
}

/**
 * Bind the Web shell's live diagnostics facts.
 * @param read - Retrieves release and connection state synchronously at failure time.
 * @returns Disposer for this registration.
 */
export function registerFailureEnvironment(read: NonNullable<typeof environment>): () => void {
  environment = read
  return () => { if (environment === read) environment = undefined }
}

/**
 * Resolve the currently installed diagnostic log actions.
 * @returns Optional Host log actions, looked up only on user interaction.
 */
export function failureLogSource(): FailureLogSource | undefined {
  return logSource
}

/**
 * Remove credentials from diagnostic or failure-summary text. Redact before slicing values.
 * @param text - Untrusted diagnostic text.
 * @returns Redacted text; oversized individual fields are omitted, not partially disclosed.
 */
export function redactFailureText(text: string): string {
  if (text.length > MAX_INPUT) return '[…]'
  return text
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${REDACTED}@`)
    .replace(SECRET_QUERY, `$1${REDACTED}`)
    .replace(/\bBearer[ \t]+[^\s"'<>,;\]}]+/gi, `Bearer ${REDACTED}`)
    .replace(SECRET_SHAPES, REDACTED)
    .replace(CLOUD_KEYS_AND_JWT, REDACTED)
    .replace(QUOTED_SECRET, `$1"${REDACTED}"`)
    .replace(HEADER_SECRET, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, `$1${REDACTED}`)
}

function bounded(text: string, limit = FIELD_LIMIT): string {
  const safe = redactFailureText(text)
  return safe.length > limit ? `${safe.slice(0, limit - 1)}…` : safe
}

function properties(value: object): PropertyDescriptorMap {
  try { return Object.getOwnPropertyDescriptors(value) }
  catch (_error) { return {} }
}

// Newer V8 exposes Error.stack as an own accessor. Only the engine's own getter is trusted; page getters are never run.
// oxlint-disable-next-line typescript/unbound-method -- we compare the getter, then call it with the actual error as receiver.
const nativeStack = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get

function stringField(fields: PropertyDescriptorMap, key: string, limit = FIELD_LIMIT, owner?: object): string | undefined {
  const field = fields[key]
  let value: unknown = field?.value
  if (key === 'stack' && owner !== undefined && nativeStack !== undefined && field?.get === nativeStack) {
    try { value = nativeStack.call(owner) }
    catch (_error) { value = undefined }
  }
  return typeof value === 'string' ? bounded(value, limit) : undefined
}

// Inspect own data, not getters or custom stringification. Cap depth and breadth before encoding.
function diagnosticData(value: unknown, budget: { left: number }, depth = 0): unknown {
  if (--budget.left < 0) return '[…]'
  if (typeof value === 'string') return bounded(value, 320)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return undefined
  if (depth >= 4) return '[…]'
  const fields = properties(value)
  if (Array.isArray(value)) {
    const first: unknown = fields['0']?.value
    if (typeof first === 'string' && SECRET_KEY.test(first)) return [bounded(first, 100), REDACTED]
    return Object.keys(fields).slice(0, 12).map(key => diagnosticData(fields[key]?.value, budget, depth + 1))
  }
  const safe: Record<string, unknown> = { __proto__: null }
  for (const key of Object.keys(fields).slice(0, 12)) {
    const field = fields[key]
    if (field?.enumerable && 'value' in field) {
      safe[bounded(key, 100)] = SECRET_KEY.test(key) ? REDACTED : diagnosticData(field.value, budget, depth + 1)
    }
  }
  return safe
}

function failureErrors(error: unknown): readonly FailureError[] {
  const errors: FailureError[] = []
  const seen = new Set<object>()
  while (errors.length < MAX_CAUSES) {
    if (error === null) { errors.push({ message: 'null' }); break }
    if (typeof error !== 'object') {
      if (typeof error === 'string' || typeof error === 'boolean' || typeof error === 'number'
        || typeof error === 'bigint' || typeof error === 'symbol') errors.push({ message: bounded(String(error)) })
      else if (typeof error === 'function') errors.push({ message: '[…]' })
      break
    }
    if (seen.has(error)) break
    seen.add(error)
    const fields = properties(error)
    const remote: unknown = fields.rpcError?.value
    const payload: unknown = fields.details?.value ?? fields.data?.value
    const inspectError = payload === undefined && fields.message === undefined && remote === undefined
    const data = diagnosticData(inspectError ? error : payload, { left: 40 })
    errors.push({
      code: stringField(fields, 'code', 128),
      message: stringField(fields, 'message') ?? stringField(fields, 'name', 128) ?? '',
      data: data === undefined ? undefined : bounded(JSON.stringify(data)),
      stack: stringField(fields, 'stack', 2_400, error),
    })
    const cause: unknown = fields.cause?.value
    if (cause === undefined && remote === undefined) break
    error = cause ?? remote
  }
  return errors
}

/**
 * Snapshot a failure at the rejection, before the connection or exception can change.
 * @param operation - Stable operation identifier, not a user-controlled URL or path.
 * @param error - Caught error or structured refusal, including native Error causes.
 * @param facts - Optional metadata from the caller's environment.
 * @returns Safe, bounded data for the visible failure report.
 */
export function captureFailure(operation: string, error: unknown, facts: Partial<Omit<FailureDetails, 'operation' | 'errors'>> = {}): FailureDetails {
  const platform = facts.platform ?? (typeof document === 'undefined' ? undefined
    : document.documentElement.dataset.platform ?? navigator.platform)
  const current = environment?.()
  const version = facts.version ?? process.env.JAN_CLIENT_VERSION ?? current?.version
  const connection = facts.connection ?? current?.connection
  return {
    operation: bounded(operation, 256),
    timestamp: bounded(facts.timestamp ?? new Date().toISOString(), 128),
    version: version ? bounded(version, 128) : undefined,
    platform: platform ? bounded(platform, 128) : undefined,
    connection: connection ? bounded(connection, 128) : undefined,
    errors: failureErrors(error),
  }
}

function logLines(tail: string): string {
  const lines = redactFailureText(tail).trimEnd().split(/\r?\n/)
  let first = lines.length
  let length = 0
  while (first > 0 && lines.length - first < MAX_LOG_LINES) {
    length += (lines[first - 1]?.length ?? 0) + 1
    if (length > MAX_LOG_CHARS) break
    first--
  }
  return lines.slice(first).join('\n')
}

/**
 * Format the text shown by the details dialog and offered to the clipboard.
 * @param failure - Diagnostics captured when the operation failed.
 * @param tail - Optional recent Host log, newest lines last.
 * @returns Plain text, at most 24 Ki characters, with a bounded redacted log tail.
 */
export function buildFailureDetails(failure: FailureDetails, tail?: string): string {
  const lines = [
    `Operation: ${failure.operation}`,
    `Timestamp: ${failure.timestamp}`,
    `Jan: ${failure.version ?? 'unknown'}`,
    `OS: ${failure.platform ?? 'unavailable'}`,
    `Connection: ${failure.connection ?? 'unavailable'}`,
  ]
  for (const [index, error] of failure.errors.entries()) {
    lines.push('', `${index === 0 ? 'Error' : 'Caused by'}: ${[error.code, error.message].filter(Boolean).join(': ')}`)
    if (error.data !== undefined) lines.push(`Data: ${error.data}`)
  }
  for (const [index, error] of failure.errors.entries()) {
    if (error.stack !== undefined) lines.push('', `Client stack ${index + 1}:`, error.stack)
  }
  const log = tail === undefined ? '' : logLines(tail)
  const logSection = log ? `\n\nHost log (recent lines):\n${log}` : ''
  const report = lines.join('\n')
  const remaining = MAX_REPORT_CHARS - logSection.length
  return `${report.length <= remaining ? report : `${report.slice(0, remaining - 1)}…`}${logSection}`
}
