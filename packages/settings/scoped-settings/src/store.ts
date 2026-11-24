/** Load, validate and atomically replace the scoped-settings document. */
import { readFile, rename } from 'node:fs/promises'
import z from '@janhq/schemastery'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import type { ScopedModel, ScopedSettingsDocument, ScopedValues, ScopedValuesPatch, SettingScope } from './types.ts'

const Names = z.array(z.string().min(1))
const Model: z<ScopedModel> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string(),
})
const ToolValues = z.object({ toolsDisabled: Names })
const ProjectValues = z.object({ model: Model, mode: z.string().min(1), toolsDisabled: Names })
const Document: z<ScopedSettingsDocument> = z.object({
  version: z.const(1).required(),
  global: ToolValues,
  projects: z.dict(ProjectValues),
  sessions: z.dict(ToolValues),
})

/** Keys each scope stores; model and mode choose how a new chat starts, so only projects carry them. */
const SCOPE_KEYS: Readonly<Record<SettingScope, readonly string[]>> = {
  global: ['toolsDisabled'],
  project: ['model', 'mode', 'toolsDisabled'],
  session: ['toolsDisabled'],
}

/** Document a missing file reads as. */
export function emptyDocument(): ScopedSettingsDocument {
  return { version: 1, global: {}, projects: {}, sessions: {} }
}

/** Drop the empty lists the schema fills in, so absent keys keep inheriting. */
function compact(values: ScopedValues): ScopedValues {
  return patchValues({}, values)
}

/**
 * Validate one write against the keys its scope stores.
 * @param scope - scope the patch writes.
 * @param patch - requested keys; `null` removes one.
 * @returns the patch with list entries checked and the model normalized.
 * @throws when the scope does not store a key or a value is malformed.
 */
export function checkPatch(scope: SettingScope, patch: ScopedValuesPatch): ScopedValuesPatch {
  const unknown = Object.keys(patch).filter(key => !SCOPE_KEYS[scope].includes(key))
  if (unknown.length > 0) throw new TypeError(`${scope} scope does not store ${unknown.map(key => `"${key}"`).join(', ')}`)
  return {
    ...patch.model === undefined ? {} : { model: patch.model === null ? null : Model(patch.model) },
    ...patch.mode === undefined ? {} : { mode: patch.mode === null ? null : z.string().min(1)(patch.mode) },
    ...patch.toolsDisabled === undefined ? {} : { toolsDisabled: patch.toolsDisabled === null ? null : Names(patch.toolsDisabled) },
  }
}

/**
 * Apply a patch to stored values: a `null` or an empty list removes the key.
 * @param current - values the scope stores now.
 * @param patch - keys to replace or remove.
 * @returns the next stored values, with tool lists deduplicated and sorted.
 */
export function patchValues(current: ScopedValues, patch: ScopedValuesPatch): ScopedValues {
  const next: { -readonly [K in keyof ScopedValues]: ScopedValues[K] } = { ...current }
  if (patch.model !== undefined) {
    if (patch.model === null) delete next.model
    else next.model = patch.model
  }
  if (patch.mode !== undefined) {
    if (patch.mode === null) delete next.mode
    else next.mode = patch.mode
  }
  if (patch.toolsDisabled !== undefined) {
    if (patch.toolsDisabled === null || patch.toolsDisabled.length === 0) delete next.toolsDisabled
    else next.toolsDisabled = [...new Set(patch.toolsDisabled)].sort()
  }
  return next
}

/** Result of reading the document from disk. */
export interface LoadedDocument {
  readonly document: ScopedSettingsDocument
  /** Where an unreadable file was moved, so the user can recover it. */
  readonly quarantined?: string
  /** Why the file was unreadable. */
  readonly problem?: string
}

function parseDocument(text: string): ScopedSettingsDocument {
  const parsed = Document(JSON.parse(text) as ScopedSettingsDocument)
  const pick = (scope: SettingScope, values: ScopedValues): ScopedValues => compact(Object.fromEntries(
    Object.entries(values).filter(([key]) => SCOPE_KEYS[scope].includes(key))))
  const each = (scope: SettingScope, entries: Readonly<Record<string, ScopedValues>>): Record<string, ScopedValues> =>
    Object.fromEntries(Object.entries(entries).map(([id, values]) => [id, pick(scope, values)]))
  return { version: 1, global: pick('global', parsed.global), projects: each('project', parsed.projects), sessions: each('session', parsed.sessions) }
}

/**
 * Read the document. A missing file is empty; an invalid one is renamed aside and reads as empty.
 * @param file - absolute document path.
 * @param now - timestamp for the quarantine name.
 * @returns the document and, for an invalid file, where it went.
 */
export async function loadDocument(file: string, now: () => number = Date.now): Promise<LoadedDocument> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { document: emptyDocument() }
    throw error
  }
  try {
    return { document: parseDocument(text) }
  } catch (error) {
    const quarantined = `${file}.invalid-${String(now())}`
    await rename(file, quarantined)
    return { document: emptyDocument(), quarantined, problem: (error as Error).message }
  }
}

/**
 * Replace the document in one atomic step, readable only by the user.
 * @param file - absolute document path.
 * @param document - complete next document.
 */
export async function saveDocument(file: string, document: ScopedSettingsDocument): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
