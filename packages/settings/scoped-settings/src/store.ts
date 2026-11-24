/** Load, validate and atomically replace the scoped-settings document. */
import { readFile, rename } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import z from '@janhq/schemastery'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import {
  SCOPE_LIST_KEYS, type ScopedModel, type ScopedSettingsDocument, type ScopedValues, type ScopedValuesPatch, type ScopeListKey,
  type SettingScope,
} from './types.ts'

const Names = z.array(z.string().min(1))
const Model: z<ScopedModel> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string(),
})
const LISTS = { toolsDisabled: Names, skillsDisabled: Names, skillFoldersDisabled: Names }
const ListValues = z.object(LISTS)
const ProjectValues = z.object({ model: Model, mode: z.string().min(1), ...LISTS })
const Document: z<ScopedSettingsDocument> = z.object({
  version: z.const(1).required(),
  global: ListValues,
  projects: z.dict(ProjectValues),
  sessions: z.dict(ListValues),
})

/** Keys each scope stores; model and mode choose how a new chat starts, so only projects carry them. */
const SCOPE_KEYS: Readonly<Record<SettingScope, readonly string[]>> = {
  global: SCOPE_LIST_KEYS,
  project: ['model', 'mode', ...SCOPE_LIST_KEYS],
  session: SCOPE_LIST_KEYS,
}

/** Document a missing file reads as. */
export function emptyDocument(): ScopedSettingsDocument {
  return { version: 1, global: {}, projects: {}, sessions: {} }
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
  const lists: { -readonly [K in ScopeListKey]?: string[] | null } = {}
  for (const key of SCOPE_LIST_KEYS) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) lists[key] = null
    else if (key !== 'skillFoldersDisabled') lists[key] = Names(value)
    else {
      lists[key] = Names(value).map((folder) => {
        if (!isAbsolute(folder)) throw new TypeError(`skill folder "${folder}" is not an absolute path`)
        return resolve(folder)
      })
    }
  }
  return {
    ...patch.model === undefined ? {} : { model: patch.model === null ? null : Model(patch.model) },
    ...patch.mode === undefined ? {} : { mode: patch.mode === null ? null : z.string().min(1)(patch.mode) },
    ...lists,
  }
}

/**
 * Apply a patch to stored values: a `null` or an empty list removes the key.
 * @param current - values the scope stores now.
 * @param patch - keys to replace or remove.
 * @returns the next stored values, with switch lists deduplicated and sorted.
 */
export function patchValues(current: ScopedValues, patch: ScopedValuesPatch): ScopedValues {
  const next: { -readonly [K in keyof ScopedValues]: ScopedValues[K] } = {}
  const model = patch.model === undefined ? current.model : patch.model ?? undefined
  const mode = patch.mode === undefined ? current.mode : patch.mode ?? undefined
  if (model !== undefined) next.model = model
  if (mode !== undefined) next.mode = mode
  for (const key of SCOPE_LIST_KEYS) {
    const value = patch[key] === undefined ? current[key] : patch[key]
    if (value !== null && value !== undefined && value.length > 0) next[key] = [...new Set(value)].sort()
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
  // Hand-edited files get the same checks as writes: relative skill folders reject the file, others are normalized.
  const pick = (scope: SettingScope, values: ScopedValues): ScopedValues => patchValues({}, checkPatch(scope, Object.fromEntries(
    Object.entries(values).filter(([key]) => SCOPE_KEYS[scope].includes(key)))))
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
