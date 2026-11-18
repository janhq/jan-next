/**
 * Cross-Session index of presented files, so a library can list every Session's
 * deliveries from the Session list without opening any history.
 *
 * Registered by an always-mounted plugin (the `present` tool itself is mounted
 * per agent, so a cold list would otherwise lose the key), and summarized into
 * list rows because a row carries one entry per distinct path, not the log.
 */
import { z } from 'zod'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@janhq/jan-session'
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import type { PresentedFile, PresentedFileEntry } from './types.ts'

/** Host fold state: the fork-inherited prefix and the distinct files declared after it. */
export interface PresentedFilesState {
  readonly inheritedEventCount: SessionLogOffset
  readonly files: PresentedFileEntry[]
}

const entrySchema = z.object({
  path: z.string(),
  description: z.string().optional(),
  turn: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  time: z.number(),
}).strict()
const viewSchema = z.array(entrySchema) as unknown as z.ZodType<PresentedFileEntry[]>
const stateSchema = z.object({
  inheritedEventCount: z.number().int().nonnegative() as unknown as z.ZodType<SessionLogOffset>,
  files: viewSchema,
}).strict() as z.ZodType<PresentedFilesState>

/** A persisted declaration is displayed only with a non-blank path and a string description. */
function isPresentedFile(value: unknown): value is PresentedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, description } = value as Record<string, unknown>
  return typeof path === 'string' && path.trim().length > 0 && (description === undefined || typeof description === 'string')
}

/**
 * Fold a `deliverables/presented` event into the distinct-path list. Events from
 * a fork's inherited prefix belong to the parent's index and are skipped, so a
 * fork does not duplicate the parent's deliveries.
 * @param state - the files declared so far.
 * @param event - the next committed Session event.
 * @returns the same state for any other event or an event with no valid file.
 */
export function applyPresentedFiles(state: PresentedFilesState, event: SessionEvent): PresentedFilesState {
  if (event.type !== 'deliverables/presented' || event.seq < state.inheritedEventCount) return state
  const { turn, files: declared } = event.data
  if (!Number.isSafeInteger(turn) || !Array.isArray(declared)) return state
  let files = state.files
  for (let index = 0; index < declared.length; index += 1) {
    const file: unknown = declared[index]
    if (!isPresentedFile(file)) continue
    const entry: PresentedFileEntry = {
      path: file.path,
      ...file.description === undefined ? {} : { description: file.description },
      turn, seq: event.seq, index, time: event.time,
    }
    files = [...files.filter(existing => existing.path !== file.path), entry]
  }
  return files === state.files ? state : { ...state, files }
}

/** Presented files per Session; a summary key, so cold list rows carry it from the persisted cache. */
export const presentedFilesProjectionDefinition = {
  key: 'presentedFiles',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => ({ inheritedEventCount, files: [] }),
  apply: applyPresentedFiles,
  stateVersion: 1,
  wire: { viewSchema, view: (state: PresentedFilesState) => state.files },
} satisfies ProjectionDefinition<'presentedFiles', PresentedFilesState>
