/**
 * Local credentials provider over `$JAN_HOME/.credentials.yaml` and optionally
 * the OS keychain, layered over the environment in this precedence order:
 *
 * ```text
 * $JAN_HOME/.credentials.yaml        (provider-managed, written by set/unset)
 * > inherited process environment    (fallback; this provider never writes it)
 * > <invocation cwd>/.env            (fallback; this provider never writes it)
 * > $JAN_HOME/.env                   (fallback; this provider never writes it)
 * ```
 *
 * The managed store wins because a credential the user explicitly saved in
 * the product must take effect consistently for every provider. The launch
 * environment, CI secrets included, applies only while the file stores no
 * value for the reference. See
 * `.agents/notes/implemented/architecture/2026-10-09-stored-credential-precedence.md`.
 *
 * The invoking project may supply a key, because the product trusts the
 * project it is launched in. It ranks below the managed store, so a key stored
 * through the Models page is never displaced by one a checkout happens to carry.
 *
 * The file is the provider-managed writable source: every write re-reads the
 * document under a cross-process writer lock before patching only its own key
 * — comments and the formatting of every untouched entry survive — external
 * edits hot-publish through the seam, and each reload replaces the snapshot
 * wholesale so a deleted entry never lingers in memory.
 *
 * The document holds credentials, which is why `refs` is a strict
 * `CredentialRef`-to-value mapping rather than a dotenv file. Unknown
 * top-level keys stay on disk and resolve nothing.
 * @module @janhq/jan-credentials-local
 */

import { Context, Service } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { watch as chokidarWatch } from 'chokidar'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Document, isMap, isScalar, parseDocument, type YAMLError } from 'yaml'
import { withFileLock, writeFileAtomic } from '@janhq/jan-atomic-write'
import { canonicalizeWatchPath, resolveJanHome } from '@janhq/jan-home-paths'
import { launchEnvironmentOf } from '@janhq/jan-launch-environment'
import { CredentialProvider, credentialRef, parseCredentialKey } from '@janhq/jan-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@janhq/jan-credentials'
import type { LaunchEnvironmentEntry } from '@janhq/jan-launch-environment'
import { KEYCHAIN_ENTRY_ID, KEYCHAIN_REMOVE_FAILURE, keychainService, loadKeychain } from './keychain.ts'
import type { KeychainBackend } from './keychain.ts'
import { resolvePasswordManagerValue, vaultCli } from './password-manager.ts'

const KEYCHAIN_UNREADABLE = 'Jan could not read this saved credential from the OS keychain. Unlock it or save the credential again.'
const KEYCHAIN_FALLBACK = 'The OS keychain is unavailable. Jan will save new credentials in its private file for this run.'
const PENDING_REMOVALS = 'keychainPendingRemovals'

/** Basename of the credentials document inside the harness home. */
export const CREDENTIALS_FILENAME = '.credentials.yaml'

/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Credentials document path; defaults to `.credentials.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$JAN_HOME` or `~/.config/jan-alpha`. */
  janHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
  /** Store new values in the OS keychain; defaults to false. Existing keychain entries remain readable. */
  keychain?: boolean
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  filename: string
  watch: boolean
  debounceMs: number
  keychain: boolean
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the document lives at `<harness home>/.credentials.yaml`.
 * @param config - raw plugin config.
 * @returns the resolved file location and watch behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  return {
    filename: resolve(config.path ?? join(resolveJanHome(config.janHome), CREDENTIALS_FILENAME)),
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
    keychain: config.keychain ?? false,
  }
}

/** Permission bits outside the owner; a credentials document must have none of them. */
const GROUP_OTHER_BITS = 0o077

/**
 * How long a record write waits for the cross-process writer lock. A record
 * mutation runs its caller's decision while holding the lock, and for the
 * operation this half exists to serve — an owner refreshing an expired token —
 * that decision includes a network round trip. The file-work default would
 * fail every other writer of this document for its duration. A contender's
 * wait is sized by the longest holder it can meet, and refs and records share
 * one file and one lock, so every writer of this document — reference writes
 * and record deletes included — waits this long, not only the mutation that
 * holds it. Like the retry cadence in `jan-atomic-write`, this is a
 * robustness bound of the write protocol rather than a deployment choice: it
 * is sized by what a provider request costs, which no deployment varies.
 */
const DOCUMENT_LOCK_WAIT_MS = 30_000

/**
 * Reject a credentials document other OS users can read, before its contents
 * are read at all. The provider creates and replaces the file at `0600`, but a
 * hand-written or externally generated one carries whatever umask produced it,
 * and silently serving secrets out of a world-readable file would make the
 * mode the provider promises meaningless.
 *
 * POSIX only: Windows has no mode to inspect — its ACLs are not expressible
 * here — so the check is skipped rather than faked, and the file's protection
 * there is whatever the create and replace APIs express.
 * @param filename - absolute path of the document.
 * @throws when the path hierarchy is invalid or the file exists with group or other permission bits set.
 */
async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (!isENOENT(error)) throw error
    await canonicalizeWatchPath(filename)
    return
  }
  /* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows has no POSIX mode enforcement; POSIX behavior tests enforce this peer. */
  const offending = mode & GROUP_OTHER_BITS
  if (offending === 0) return
  throw new Error(
    `credentials-local: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
    + ` run "chmod 600 ${filename}" before starting again`,
  )
  /* v8 ignore stop */
}

/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Describe one YAML parse failure without quoting the source. The parser's own
 * message embeds the offending line, which here holds a secret.
 * @param error - the parser's error.
 * @returns the error code with its line and column.
 */
function describeYamlError(error: YAMLError): string {
  const at = error.linePos?.[0]
  /* v8 ignore next -- `prettyErrors` populates linePos on every error; the guard answers its optional type */
  const where = at === undefined ? '' : ` at line ${String(at.line)}, column ${String(at.col)}`
  return `${error.code}${where}`
}

/** The document layout this build reads and writes. */
export const DOCUMENT_VERSION = 1

interface KeychainMarker { keychain: string }
type StoredRef = string | KeychainMarker
type StoredRecord = CredentialRecord | (KeychainMarker & { kind: CredentialRecord['kind'] })

function readMarker(value: unknown, where: string, fieldCount: number): KeychainMarker | undefined {
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, 'keychain')) return undefined
  const { keychain } = value as Record<string, unknown>
  if (Array.isArray(value) || Object.keys(value).length !== fieldCount || typeof keychain !== 'string' || !KEYCHAIN_ENTRY_ID.test(keychain)) {
    throw new TypeError(`credentials-local: invalid OS keychain marker for ${where}`)
  }
  return { keychain }
}

/** Parsed credential entries and native cleanup metadata. */
export interface CredentialsDocument {
  /** Reference entries, keyed by {@link CredentialRef}. */
  refs: Map<string, StoredRef>
  /** Stored records, keyed by {@link CredentialKey}. */
  records: Map<string, StoredRecord>
  /** Native entry IDs no longer referenced by a credential but not confirmed removed. */
  pendingRemovals: Set<string>
  /** Top-level keys this build does not read; they stay on disk and resolve nothing. */
  ignoredKeys: string[]
}

/**
 * Parse one credentials document. Inside `refs` and `records` everything is
 * rejected rather than skipped — a key that is not addressable, a wrong-typed
 * value, an unknown record tag or field — because a silently ignored entry
 * reads as "the credential I stored has no effect"; an unversioned root is
 * rejected too. An unknown top-level key is returned in `ignoredKeys` for the
 * caller to report, so a foreign entry another tool wrote does not stop boot.
 * Duplicate keys surface as parser errors. An empty document is an empty store
 * and needs no version.
 * @param text - the document's text.
 * @param filename - absolute path, quoted in errors.
 * @returns the parsed references, records, pending native removals, and ignored top-level keys.
 */
export function parseCredentialsDocument(text: string, filename: string): CredentialsDocument {
  // `prettyErrors` is on only for `linePos`; `error.message` is never used,
  // because the parser quotes the offending source line and in this document
  // that line is a secret. Only the code and position leave this function, and
  // the same rule governs every other diagnostic here — a key name is safe to
  // print, a value is not.
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`credentials-local: invalid document at ${filename}: ${
      document.errors.map(describeYamlError).join('; ')}`)
  }
  const root: unknown = document.toJS() ?? {}
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new TypeError(`credentials-local: ${filename} must be a mapping`)
  }
  const fields = root as Record<string, unknown>
  const keys = Object.keys(fields)
  // An empty (or comment-only) document is the empty store and needs no
  // version: there is nothing in it a later layout could have meant.
  if (keys.length === 0) return emptyCredentialsDocument()
  if (!('version' in fields)) {
    throw new Error(
      `credentials-local: ${filename} uses the pre-release flat layout. Add \`version: ${DOCUMENT_VERSION}\``
      + ` and nest the existing ${keys.length} ${keys.length === 1 ? 'entry' : 'entries'} under \`refs:\`.`
      + ' No values need to change.',
    )
  }
  if (fields['version'] !== DOCUMENT_VERSION) {
    throw new Error(
      `credentials-local: ${filename} declares version ${JSON.stringify(fields['version'])};`
      + ` this build reads version ${DOCUMENT_VERSION}`,
    )
  }
  return {
    refs: parseRefs(fields['refs'], filename),
    records: parseRecords(fields['records'], filename),
    pendingRemovals: parsePendingRemovals(fields[PENDING_REMOVALS], filename),
    ignoredKeys: keys.filter(key => key !== 'version' && key !== 'refs' && key !== 'records' && key !== PENDING_REMOVALS),
  }
}

function emptyCredentialsDocument(): CredentialsDocument {
  return { refs: new Map(), records: new Map(), pendingRemovals: new Set(), ignoredKeys: [] }
}

function parsePendingRemovals(value: unknown, filename: string): Set<string> {
  if (value === undefined) return new Set()
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && KEYCHAIN_ENTRY_ID.test(id))) {
    throw new TypeError(`credentials-local: invalid pending OS keychain removals in ${filename}`)
  }
  return new Set<string>(value)
}

/**
 * Render the version-1 layout for a pre-release flat document, or `undefined`
 * for anything else. The flat layout is recognized exactly — a non-empty
 * top-level mapping of addressable reference names to non-empty string
 * scalars, with no `version` key and no document directives — and the rewrite
 * nests the original lines verbatim under `refs:` at two spaces' indent, so
 * comments, blank lines, and each value's spelling survive byte for byte.
 * Anything the recognizer declines keeps {@link parseCredentialsDocument}'s
 * loud rejection: a document this build cannot prove it understands is never
 * rewritten. Remove with the pre-release stance at the first tagged release.
 * @param text - the document's text.
 * @returns the migrated text, or `undefined` when the text is not the recognized flat layout.
 */
export function renderFlatLayoutMigration(text: string): string | undefined {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) return undefined
  const flat = document.contents
  if (!isMap(flat) || flat.items.length === 0) return undefined
  for (const line of text.split('\n')) {
    // A directive or document marker would not survive being indented into
    // the `refs:` block; no shipped writer ever emitted one here.
    if (/^(%|---|\.\.\.)/.test(line)) return undefined
  }
  for (const pair of flat.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === 'version') return undefined
    try {
      credentialRef(pair.key.value)
    } catch {
      // Only credentialRef's rejection of a non-POSIX name lands here; the
      // flat reader refused such a key too, so this is not the recognized
      // layout and the loud rejection stands.
      return undefined
    }
    if (!isScalar(pair.value) || typeof pair.value.value !== 'string' || pair.value.value.length === 0) return undefined
  }
  const body = text.split('\n').map(line => (line.length === 0 ? line : `  ${line}`)).join('\n')
  return `version: ${DOCUMENT_VERSION}\nrefs:\n${body}${text.endsWith('\n') ? '' : '\n'}`
}

/** Admit a `refs` section: POSIX-identifier keys over non-empty strings or keychain markers. */
function parseRefs(section: unknown, filename: string): Map<string, StoredRef> {
  const entries = new Map<string, StoredRef>()
  for (const [key, value] of Object.entries(asSection(section, 'refs', filename))) {
    // credentialRef throws on anything that is not a POSIX identifier, which
    // is exactly the constraint a stored reference must satisfy to be
    // addressable through the seam.
    credentialRef(key)
    const marker = readMarker(value, `"${key}" in ${filename}`, 1)
    if (marker !== undefined) {
      entries.set(key, marker)
      continue
    }
    // The key name is quoted, never the value: a wrong-typed entry is still a
    // secret the user meant to store.
    if (typeof value !== 'string') {
      throw new TypeError(`credentials-local: the value for "${key}" in ${filename} must be a string`)
    }
    if (value.length === 0) {
      throw new Error(`credentials-local: the value for "${key}" in ${filename} is empty; remove the key instead`)
    }
    entries.set(key, value)
  }
  return entries
}

/** Admit a `records` section: `<scope>/<id>` keys over tagged record mappings. */
function parseRecords(section: unknown, filename: string): Map<string, StoredRecord> {
  const entries = new Map<string, StoredRecord>()
  for (const [key, value] of Object.entries(asSection(section, 'records', filename))) {
    parseCredentialKey(key)
    const where = `record "${key}" in ${filename}`
    const marker = readMarker(value, where, 2)
    if (marker === undefined) {
      entries.set(key, parseRecord(key, value, filename))
    } else {
      const { kind } = value as Record<string, unknown>
      if (kind !== 'api-key' && kind !== 'grant') {
        throw new TypeError(`credentials-local: invalid OS keychain marker for ${where}`)
      }
      entries.set(key, { kind, ...marker })
    }
  }
  return entries
}

/**
 * Remove the credentials document and its indexed native entries while holding its writer lock.
 * When cleanup fails, keep the document so the same reset can be retried.
 * @param filename - absolute path of the credentials document to remove.
 */
export async function resetCredentialDocument(filename: string): Promise<void> {
  try {
    await withFileLock(filename, async () => {
      await assertOwnerOnly(filename)
      const text = await readFile(filename, 'utf8').catch((error: unknown) => {
        if (isENOENT(error)) return undefined
        throw error
      })
      if (text === undefined) return
      if (renderFlatLayoutMigration(text) === undefined) {
        const { refs, records, pendingRemovals: entries } = parseCredentialsDocument(text, filename)
        for (const value of refs.values()) if (typeof value === 'object') entries.add(value.keychain)
        for (const record of records.values()) if ('keychain' in record) entries.add(record.keychain)
        if (entries.size > 0) {
          try {
            const backend = await loadKeychain(await keychainService(filename))
            for (const id of entries) await backend.remove(id)
          } catch {
            throw new Error(KEYCHAIN_REMOVE_FAILURE)
          }
        }
      }
      await rm(filename, { force: true })
    }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
  } catch (error) {
    if (!isENOENT(error)) throw error
  }
}

/** One section of the document as a plain mapping; absent and null both mean empty. */
function asSection(section: unknown, name: string, filename: string): Record<string, unknown> {
  if (section === undefined || section === null) return {}
  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError(`credentials-local: "${name}" in ${filename} must be a mapping`)
  }
  return section as Record<string, unknown>
}

/** Admit one record entry, rejecting an unknown tag or field rather than dropping it. */
function parseRecord(key: string, value: unknown, filename: string): CredentialRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`credentials-local: record "${key}" in ${filename} must be a mapping`)
  }
  const fields = value as Record<string, unknown>
  const kind = fields['kind']
  if (kind === 'api-key') {
    assertFields(key, fields, ['kind', 'key', 'env'], filename)
    const apiKey = fields['key']
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length === 0)) {
      throw new TypeError(`credentials-local: record "${key}" in ${filename} has a non-string or empty key`)
    }
    const env = parseRecordEnv(key, fields['env'], filename)
    return {
      kind: 'api-key',
      ...apiKey === undefined ? {} : { key: apiKey },
      ...env === undefined ? {} : { env },
    }
  }
  if (kind === 'grant') {
    assertFields(key, fields, ['kind', 'payload'], filename)
    if (!('payload' in fields)) {
      throw new Error(`credentials-local: record "${key}" in ${filename} has no payload`)
    }
    assertJsonValue(`record "${key}" payload in ${filename}`, fields['payload'], new Set())
    return { kind: 'grant', payload: fields['payload'] }
  }
  if (kind === undefined) throw new Error(`credentials-local: record "${key}" in ${filename} has no kind`)
  throw new Error(`credentials-local: record "${key}" in ${filename} has unknown kind ${JSON.stringify(kind)}`)
}

/** Reject a field the tag does not define, so a typo is not silently dropped. */
function assertFields(key: string, fields: Record<string, unknown>, allowed: string[], filename: string): void {
  for (const field of Object.keys(fields)) {
    if (!allowed.includes(field)) {
      throw new Error(`credentials-local: record "${key}" in ${filename} has unknown field "${field}"`)
    }
  }
}

/** Admit an api-key record's provider environment: POSIX names over non-empty strings. */
function parseRecordEnv(key: string, env: unknown, filename: string): Record<string, string> | undefined {
  if (env === undefined) return undefined
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new TypeError(`credentials-local: record "${key}" in ${filename} has a non-mapping env`)
  }
  const parsed: Record<string, string> = {}
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    credentialRef(name)
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        `credentials-local: record "${key}" env "${name}" in ${filename} must be a non-empty string`,
      )
    }
    parsed[name] = value
  }
  return parsed
}

/**
 * Reject a payload that cannot survive a JSON round trip, on the way in and on
 * the way out. The seam promises owners their payload comes back exactly as
 * written, and both directions can break that: a document may spell `.inf` or
 * an alias cycle, and an owner may hand over a `Date`, a class instance, or a
 * `bigint` that this document has no faithful spelling for. Neither the value
 * nor any nested value is quoted in a diagnostic.
 * @param where - the subject named in a diagnostic, already free of any value.
 * @param value - the payload or nested value to admit.
 * @param seen - objects on the current path, for cycle detection.
 * @throws TypeError naming `where` when the value cannot round-trip.
 */
function assertJsonValue(where: string, value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`credentials-local: ${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError(`credentials-local: ${where} is cyclic`)
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value)
      for (const nested of Object.values(value)) assertJsonValue(where, nested, seen)
      seen.delete(value)
      return
    }
  }
  throw new TypeError(`credentials-local: ${where} holds a value JSON cannot represent`)
}

/**
 * The comment-preserving mutable tree one edit renders from. Editing the
 * parsed document rather than rebuilding it keeps comments and the formatting
 * of every untouched entry; an absent document starts a fresh one.
 * @param text - the current document text, `undefined` while the file is absent.
 * @returns the tree to edit, carrying this build's version stamp.
 */
function mutableDocument(text: string | undefined): Document {
  // `text` only ever caches content that parsed successfully, so this re-parse
  // for the mutable comment-preserving tree cannot fail. `intAsBigInt` keeps an
  // integer beyond 2^53 in a foreign top-level entry exact when re-serialized.
  const document = text === undefined ? new Document({}) : parseDocument(text, { intAsBigInt: true })
  // Stamped on every edit so a document this provider creates is readable by
  // the same parser that admitted the one it edits; an existing stamp is
  // rewritten to the identical value.
  document.setIn(['version'], DOCUMENT_VERSION)
  return document
}

/**
 * Render the next document text with one reference set or deleted.
 * @param text - the current document text, `undefined` while the file is absent.
 * @param ref - the reference to write.
 * @param value - the new value, or `undefined` to delete the key.
 * @returns the document to persist.
 */
function renderRef(text: string | undefined, ref: CredentialRef, value: StoredRef | undefined): Document {
  const document = mutableDocument(text)
  if (value === undefined) deleteSectionEntry(document, 'refs', ref)
  else document.setIn(['refs', ref], value)
  return document
}

/**
 * Render the next document text with one record written or deleted. The record
 * node is replaced wholesale rather than edited field by field: records are
 * machine-written, so there is no hand formatting inside one to preserve.
 * @param text - the current document text, `undefined` while the file is absent.
 * @param key - the record to write.
 * @param record - the new record, or `undefined` to delete it.
 * @returns the document to persist.
 */
function renderRecord(text: string | undefined, key: CredentialKey, record: StoredRecord | undefined): Document {
  const document = mutableDocument(text)
  if (record === undefined) deleteSectionEntry(document, 'records', key)
  else document.setIn(['records', key], record)
  return document
}

function renderPendingRemovals(document: Document, entries: ReadonlySet<string>): void {
  if (entries.size > 0) document.set(PENDING_REMOVALS, [...entries])
  else document.delete(PENDING_REMOVALS)
}

/**
 * Remove one entry from a section, taking its annotation with it. A comment
 * block written above a section's first entry annotates that entry, but the
 * parser attaches it to the section's map rather than to the pair — leaving it
 * behind would move it onto whichever entry became first, which reads as an
 * annotation of a credential nobody wrote it for.
 * @param document - the mutable tree being edited.
 * @param section - the section holding the entry.
 * @param key - the entry to remove.
 */
function deleteSectionEntry(document: Document, section: 'refs' | 'records', key: string): void {
  const map: unknown = document.get(section, true)
  /* v8 ignore next -- both callers render a delete only for an entry they just
     found in the parsed snapshot, so the section it lives in is always a map;
     the guard is what narrows `get`'s `unknown`. */
  if (isMap(map)) {
    const first = map.items[0]
    /* v8 ignore next -- a map that holds the entry has a first item, and the
       parser admits only scalar keys, so only the identity test can be false. */
    if (first !== undefined && isScalar(first.key) && first.key.value === key) {
      map.commentBefore = null
    }
  }
  document.deleteIn([section, key])
}

/**
 * Structural equality over two admitted JSON values. Records reach this after
 * {@link assertJsonValue}, so the walk meets only JSON shapes; key order is
 * ignored because an external editor may reorder a record's fields without
 * changing what it stores.
 * @param left - one value.
 * @param right - the other value.
 * @returns whether the two carry the same JSON content.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => key in right
    && sameJsonValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

/** File-backed credentials provider (`$JAN_HOME/.credentials.yaml`). */
export class LocalCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    path: z.string(),
    janHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
    keychain: z.boolean().default(false),
  })

  private readonly spec: ResolvedSpec
  private backend: Promise<KeychainBackend> | undefined
  private keychainWriteFailed = false
  /**
   * Raw text of the last read or persisted document; `undefined` while the
   * file is absent. Watcher events whose content equals this cache are no-ops,
   * which is also the self-write suppression.
   */
  private text: string | undefined
  /** Parsed reference snapshot; replaced wholesale on every reload. */
  private values = new Map<string, StoredRef>()
  /** Parsed record snapshot; replaced wholesale on every reload. */
  private records = new Map<string, StoredRecord>()
  private pendingRemovals = new Set<string>()
  /**
   * Single exclusive operation chain: watcher reloads and line edits run one
   * at a time in queue order (settled tail), so an edit can never render from
   * text a concurrent reload is busy replacing.
   */
  private operations: Promise<void> = Promise.resolve()
  /** Set at dispose: refuse new writes and let in-flight work no-op. */
  private closed = false

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.spec = resolveSpec(config)
  }

  /** The inherited-environment value for a reference, or `undefined` when empty or unset. */
  private inherited(ref: CredentialRef): string | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
  }

  /**
   * The `.env` fallback for a reference — below the managed store, never above
   * it. The invoking project ranks over the user's home file, matching the
   * environment layering: the more specific location wins.
   */
  private dotenvFallback(ref: CredentialRef): LaunchEnvironmentEntry | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      // Drain: refuse new operations, then settle the queued ones so disposal
      // completes only once storage is quiescent.
      this.closed = true
      await this.operations
    }
    await this.loadInitial()
    if (!this.spec.watch) return
    const watcher = chokidarWatch(await canonicalizeWatchPath(this.spec.filename), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    watcher.on('all', () => {
      if (this.closed) return
      this.queueRefresh()
    })
    watcher.on('ready', () => {
      // The initial load raced the watcher's own setup: a change written
      // between that read and the watcher becoming active never fires an
      // event. One reconcile at ready closes the gap.
      if (this.closed) return
      this.queueRefresh()
    })
    const reportWatcherError = (error: unknown): void => {
      // A watcher error after disposal is not actionable: the watched home is
      // going away with this provider, and logging it would be noise.
      if (this.closed) return
      this.ctx.logger.warn('credentials-local: watcher error on %s', this.spec.filename)
      this.ctx.logger.warn(error)
    }
    watcher.on('error', reportWatcherError)
    yield async () => {
      // Quiesce: stop accepting events, close the watcher, then wait out any
      // queued or in-flight operation so nothing publishes after disposal.
      this.closed = true
      // `close()` drops every listener but leaves a scheduled write-settle
      // poll; its straggler stats the document this teardown is deleting,
      // which Windows reports as EPERM, and an 'error' emission with no
      // listener is rethrown as an uncaught exception. Re-attach across the
      // close so that straggler stays inside this provider.
      const closing = watcher.close()
      watcher.on('error', reportWatcherError)
      await closing
      await this.operations
    }
  }

  override async resolve(ref: CredentialRef, options?: { dereference?: boolean }): Promise<ResolvedCredential | undefined> {
    const stored = this.values.get(ref)
    const value = typeof stored === 'object'
      ? await this.readSealed(stored, document => document.refs.get(ref), value => this.readStoredRef(value))
      : stored
    if (value !== undefined) {
      const pointer = options?.dereference !== false && (value.startsWith('op://') || value.startsWith('bw://'))
      return { value: pointer ? await resolvePasswordManagerValue(value, vaultCli(launchEnvironmentOf(this.ctx))) : value, source: 'file' }
    }
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return { value: inherited, source: 'env' }
    const fallback = this.dotenvFallback(ref)
    return fallback === undefined ? undefined : { value: fallback.value, source: fallback.source }
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const stored = this.values.get(ref)
    if (stored !== undefined) return Promise.resolve({ configured: true, source: 'file', writable: true })
    // Every reference is writable: a set writes the managed file, which
    // outranks every fallback, and an unset exposes the fallback again.
    if (this.inherited(ref) !== undefined) return Promise.resolve({ configured: true, source: 'env', writable: true })
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return Promise.resolve({ configured: true, source: fallback.source, writable: true })
    return Promise.resolve({ configured: false, writable: true })
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`credentials-local: an empty value cannot be stored for "${ref}"; use unset`)
    }
    await this.write(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    await this.write(ref, undefined)
  }

  override async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const stored = this.records.get(key)
    if (stored !== undefined && 'keychain' in stored) {
      return this.readSealed(stored, document => document.records.get(key), value => this.readStoredRecord(value, key))
    }
    return stored
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    // Presence is the whole fact here: no layer ranks above this document for
    // a record, so nothing can shadow one, and an api-key record carrying
    // neither a key nor environment values is a deliberate statement rather
    // than a blank.
    if (stored === undefined) return Promise.resolve({ configured: false, writable: true })
    return Promise.resolve({ configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({
      // The parser has already proven every stored key addressable.
      key: parseCredentialKey(key),
      kind: record.kind,
    })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    if (this.isClosed()) throw new Error(`credentials-local is disposed: cannot modify "${key}"`)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${key}" modify ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      return withFileLock(this.spec.filename, async () => {
        // Read-modify-write: `mutate` must decide against the record as it
        // stands now, not as this process last saw it — another process may
        // have rotated it since.
        await this.reconcileFromDisk()
        const stored = this.records.get(key)
        let current: CredentialRecord | undefined
        if (stored !== undefined && 'keychain' in stored) {
          current = await this.readStoredRecord(stored, key)
          if (current === undefined) throw new Error(KEYCHAIN_UNREADABLE)
        } else {
          current = stored
        }
        const next = await mutate(current)
        if (next === undefined) return current
        const record = parseRecord(key, next, this.spec.filename)
        const marker = await this.seal(record)
        const replacement = marker === undefined ? record : { kind: record.kind, ...marker }
        const retired = stored !== undefined && 'keychain' in stored ? stored : undefined
        await this.publishDocument(() => renderRecord(this.text, key, replacement), marker, retired)
        this.records.set(key, replacement)
        if (retired !== undefined) await this.removeRetired(retired)
        this.notifyRecordUpdated(key)
        return record
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    if (this.isClosed()) throw new Error(`credentials-local is disposed: cannot delete "${key}"`)
    await this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${key}" delete ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        const stored = this.records.get(key)
        if (stored === undefined) return
        const retired = 'keychain' in stored ? stored : undefined
        await this.publishDocument(() => renderRecord(this.text, key, undefined), undefined, retired)
        this.records.delete(key)
        if (retired !== undefined) await this.removeRetired(retired)
        this.notifyRecordUpdated(key)
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  private getKeychain(): Promise<KeychainBackend> {
    return this.backend ??= keychainService(this.spec.filename).then(loadKeychain)
  }

  /** Store a new generation before its marker can appear in the document. */
  private async seal(value: string | CredentialRecord): Promise<KeychainMarker | undefined> {
    if (!this.spec.keychain || this.keychainWriteFailed) return undefined
    const marker = { keychain: randomUUID() }
    const serialized = JSON.stringify(value)
    let backend: KeychainBackend | undefined
    try {
      backend = await this.getKeychain()
      await backend.write(marker.keychain, serialized)
      return marker
    } catch {
      this.keychainWriteFailed = true
      this.ctx.logger.warn(KEYCHAIN_FALLBACK)
      if (backend !== undefined) await this.discard(marker)
      return undefined
    }
  }

  /** Commit the index change with the retired ID before attempting native cleanup. */
  private async publishDocument(render: () => Document, marker: KeychainMarker | undefined, retired?: KeychainMarker): Promise<void> {
    try {
      const document = render()
      if (retired !== undefined) renderPendingRemovals(document, new Set([...this.pendingRemovals, retired.keychain]))
      await this.persistDocument(document)
      if (retired !== undefined) this.pendingRemovals.add(retired.keychain)
    } catch (error) {
      if (marker !== undefined) await this.discard(marker)
      throw error
    }
  }

  private async persistDocument(document: Document): Promise<void> {
    const text = document.toString()
    await writeFileAtomic(this.spec.filename, text, { mode: 0o600, dirMode: 0o700 })
    this.text = text
  }

  private async removeRetired(marker: KeychainMarker): Promise<void> {
    if (!await this.discard(marker)) return
    const remaining = new Set(this.pendingRemovals)
    remaining.delete(marker.keychain)
    try {
      const document = mutableDocument(this.text)
      renderPendingRemovals(document, remaining)
      await this.persistDocument(document)
      this.pendingRemovals = remaining
    } catch {
      // The native entry is gone. Reset can safely retry it if the index update failed.
      this.ctx.logger.warn('Jan could not update the OS keychain cleanup index.')
    }
  }

  private async discard(marker: KeychainMarker): Promise<boolean> {
    try {
      await (await this.getKeychain()).remove(marker.keychain)
      return true
    } catch {
      this.ctx.logger.warn(KEYCHAIN_REMOVE_FAILURE)
      return false
    }
  }

  private async readNative(marker: KeychainMarker): Promise<unknown> {
    try {
      const value = await (await this.getKeychain()).read(marker.keychain)
      if (value === undefined) return undefined
      const parsed: unknown = JSON.parse(value)
      return parsed
    } catch {
      throw new Error(KEYCHAIN_UNREADABLE)
    }
  }

  private async readStoredRef(stored: StoredRef): Promise<string | undefined> {
    if (typeof stored === 'string') return stored
    const value = await this.readNative(stored)
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.length === 0) throw new Error(KEYCHAIN_UNREADABLE)
    return value
  }

  private async readStoredRecord(marker: StoredRecord, key: CredentialKey): Promise<CredentialRecord | undefined> {
    if (!('keychain' in marker)) return marker
    const value = await this.readNative(marker)
    if (value === undefined) return undefined
    try {
      const record = parseRecord(key, value, this.spec.filename)
      if (record.kind === marker.kind) return record
    } catch {
      // Native data is secret just like YAML data; never attach its parse error.
    }
    throw new Error(KEYCHAIN_UNREADABLE)
  }

  /** A writer can remove an old generation before this reader's watcher sees the new YAML. */
  private async readSealed<T, S>(marker: S, locate: (document: CredentialsDocument) => S | undefined,
    read: (value: S) => Promise<T | undefined>): Promise<T | undefined> {
    const value = await read(marker)
    if (value !== undefined) return value
    let next: S | undefined
    try {
      await assertOwnerOnly(this.spec.filename)
      const text = await readFile(this.spec.filename, 'utf8')
      next = locate(parseCredentialsDocument(text, this.spec.filename))
    } catch (error) {
      if (!isENOENT(error)) throw new Error(KEYCHAIN_UNREADABLE)
    }
    if (next === undefined) return undefined
    if (!sameJsonValue(next, marker)) {
      const updated = await read(next)
      if (updated !== undefined) return updated
    }
    throw new Error(KEYCHAIN_UNREADABLE)
  }

  /** Queue one exclusive document operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** Queue a reload; `refresh()` contains its own failures, so the queued task never rejects. */
  private queueRefresh(): void {
    void this.enqueue(() => this.refresh())
  }

  /** Queue one line edit; disposal is checked on entry and again when the queued edit runs. */
  private async write(ref: CredentialRef, value: string | undefined): Promise<void> {
    const verb = value === undefined ? 'unset' : 'set'
    if (this.isClosed()) {
      throw new Error(`credentials-local is disposed: cannot ${verb} "${ref}"`)
    }
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${ref}" ${verb} ran`)
      }
      // The writer lock's exclusive create needs the parent to exist; 0700
      // because the harness home holds user-private data.
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        // Read-modify-write: fold in any on-disk state this process has not
        // observed yet — an external edit still inside the watcher debounce
        // window, a change the watcher missed, or another process's write —
        // so the line edit below can never resurrect a stale document.
        await this.reconcileFromDisk()
        const existing = this.values.get(ref)
        if (value === undefined && existing === undefined) return
        const marker = value === undefined ? undefined : await this.seal(value)
        const replacement = marker ?? value
        const retired = typeof existing === 'object' ? existing : undefined
        await this.publishDocument(() => renderRef(this.text, ref, replacement), marker, retired)
        if (replacement === undefined) this.values.delete(ref)
        else this.values.set(ref, replacement)
        if (retired !== undefined) await this.removeRetired(retired)
        // After the commit: a broken observer must never make the durable
        // write look failed.
        this.notifyUpdated(ref)
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  /**
   * Boot read: an absent file is an empty store; an invalid one fails the
   * plugin's activation, because a credentials document that exists but
   * cannot be trusted must never be treated as "no credentials stored". The
   * one exception is the recognized pre-release flat layout, which is
   * upgraded in place first — a key stored by an earlier build must survive
   * the layout change without a hand edit.
   */
  private async loadInitial(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    if (renderFlatLayoutMigration(text) !== undefined) text = await this.migrateFlatDocument()
    const document = parseCredentialsDocument(text, this.spec.filename)
    this.warnIgnoredKeys(document)
    this.values = document.refs
    this.records = document.records
    this.pendingRemovals = document.pendingRemovals
    this.text = text
  }

  /**
   * One-shot upgrade of the recognized pre-release flat layout, before the
   * watcher exists. The rewrite runs under the document's writer lock and
   * re-reads first — a concurrent boot may have migrated already — and
   * whatever the re-read finds that is not the flat layout is returned
   * untouched for the ordinary parse. Values are carried verbatim; only the
   * enclosing layout changes. Remove with the pre-release stance at the
   * first tagged release.
   * @returns the document text this boot should parse.
   */
  private async migrateFlatDocument(): Promise<string> {
    return withFileLock(this.spec.filename, async () => {
      const current = await readFile(this.spec.filename, 'utf8')
      const migrated = renderFlatLayoutMigration(current)
      /* v8 ignore next 2 -- the losing side of the cross-process migration race:
         another boot rewrote the document between the unlocked recognize and
         this lock. That interleaving cannot be scheduled deterministically
         through a whole boot (migration.spec drives it best-effort); the
         decision itself is the recognizer's covered versioned-document decline. */
      if (migrated === undefined) return current
      // 0600: a document holding secrets is never world-readable.
      await writeFileAtomic(this.spec.filename, migrated, { mode: 0o600, dirMode: 0o700 })
      this.ctx.logger.info(
        'credentials-local: migrated %s to the version %d layout; values are unchanged',
        this.spec.filename,
        DOCUMENT_VERSION,
      )
      return migrated
    }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
  }

  /**
   * Re-read the document after a watcher event. Unchanged content (including
   * this provider's own writes) is a no-op; an unreadable document keeps the
   * last good snapshot and warns — a live hot-reload must never take the
   * process down.
   */
  private async refresh(): Promise<void> {
    if (this.closed) return
    try {
      await this.reconcileFromDisk()
    } catch (error) {
      this.ctx.logger.warn('credentials-local: reload failed at %s; keeping the last good document', this.spec.filename)
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Compare the on-disk text against the cache and publish any difference
   * into the seam. Absence publishes the empty store; an unreadable or
   * invalid document throws, so each caller picks its policy — a reload warns
   * and keeps the last good snapshot, a write fails loud rather than
   * overwriting a document it could not understand.
   */
  private async reconcileFromDisk(): Promise<void> {
    // Re-checked on every reload and before every write: an external editor or
    // a restored backup can loosen the mode after boot.
    await assertOwnerOnly(this.spec.filename)
    let text: string | undefined
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      text = undefined
    }
    if (text === this.text || this.isClosed()) return
    const next = text === undefined
      ? emptyCredentialsDocument()
      : parseCredentialsDocument(text, this.spec.filename)
    this.warnIgnoredKeys(next)
    const changedRefs = this.changedRefs(this.values, next.refs)
    const changedRecords = this.changedRecords(this.records, next.records)
    this.text = text
    this.values = next.refs
    this.records = next.records
    this.pendingRemovals = next.pendingRemovals
    for (const ref of changedRefs) this.notifyUpdated(ref)
    for (const key of changedRecords) this.notifyRecordUpdated(key)
  }

  /** Report top-level keys that resolve nothing; only key names are printed, never values. */
  private warnIgnoredKeys(document: CredentialsDocument): void {
    if (document.ignoredKeys.length === 0) return
    this.ctx.logger.warn(
      'credentials-local: ignoring unknown top-level keys %s in %s; only `refs` and `records` entries resolve',
      document.ignoredKeys.map(key => JSON.stringify(key)).join(', '),
      this.spec.filename,
    )
  }

  /** Entries whose stored value changed; the parser has already proven every key addressable. */
  private changedRefs(prev: Map<string, StoredRef>, next: Map<string, StoredRef>): CredentialRef[] {
    const changed: CredentialRef[] = []
    for (const key of new Set([...prev.keys(), ...next.keys()])) {
      if (sameJsonValue(prev.get(key), next.get(key))) continue
      changed.push(credentialRef(key))
    }
    return changed
  }

  /** Records whose stored value changed; the parser has already proven every key addressable. */
  private changedRecords(
    prev: Map<string, StoredRecord>,
    next: Map<string, StoredRecord>,
  ): CredentialKey[] {
    const changed: CredentialKey[] = []
    for (const key of new Set([...prev.keys(), ...next.keys()])) {
      if (sameJsonValue(prev.get(key), next.get(key))) continue
      changed.push(parseCredentialKey(key))
    }
    return changed
  }
}

export default LocalCredentialProvider
