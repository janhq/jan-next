/**
 * Parent-owned durable subagent catalog events and their chunked projection.
 *
 * @module @janhq/jan-subagent/catalog
 */

import { z } from 'zod'
import { appendChunkedList, chunkedListSchema, iterateChunkedList } from '@janhq/jan-chunked-list'
import type { ChunkedList } from '@janhq/jan-chunked-list'
import type { SandboxMode } from '@janhq/jan-sandbox'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
} from '@janhq/jan-session'
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import type { ContinuableSubagentDescriptorData } from './descriptor.ts'
import { isAgentName } from './names.ts'
import type { SubagentCatalogEntry } from './projection-types.ts'

/** Catalog payload version emitted by local and external child creation. */
export const SUBAGENT_CATALOG_VERSION = 3

type KnownCatalogMode =
  | { readonly mode: 'one-shot'; readonly label?: string }
  | { readonly mode: 'continuable'; readonly label: string }

/**
 * Parent catalog v0 records local modes, v1 adds unknown children, v2 records
 * external executions, and v3 adds sibling-unique names, profile ids, and capped sandbox modes.
 */
export type SubagentCatalogEvent =
  & {
    readonly childId: SessionId
    readonly childCreatedAt: number
  } & (
    | ({ readonly version: 0 } & KnownCatalogMode)
    | ({ readonly version: 1 } & (KnownCatalogMode | { readonly mode: 'unknown'; readonly label?: string }))
    | { readonly version: 2; readonly mode: 'external'; readonly label?: string }
    | ({ readonly version: 3; readonly name: string; readonly agent?: string } & (
      | { readonly mode: 'continuable'; readonly label: string; readonly sandboxMode?: SandboxMode }
      | { readonly mode: 'external'; readonly label?: string }
    ))
  )

declare module '@janhq/jan-session/types' {
  interface SessionEventMap {
    /**
     * A direct child's identity and available discovery fields.
     * @param data - versioned parent-owned catalog entry.
     */
    'subagent/catalog': SubagentCatalogEvent
  }
}

/** Host fold state for one parent catalog. */
export interface SubagentCatalogState {
  readonly inheritedEventCount: SessionLogOffset
  readonly head?: ChunkedList<SubagentCatalogEvent> | undefined
}

const sessionIdSchema = z.string() as unknown as z.ZodType<SessionId>
const oneShotCatalogSchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('one-shot'),
  label: z.string().optional(),
}).strict()
const continuableCatalogSchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('continuable'),
  label: z.string(),
}).strict()
const externalCatalogSchema = oneShotCatalogSchema.extend({ version: z.literal(2), mode: z.literal('external') })
const unknownCatalogSchema = oneShotCatalogSchema.extend({ version: z.literal(1), mode: z.literal('unknown') })
const nameSchema = z.string().refine(isAgentName, 'invalid agent name')
const namedCatalogFields = { name: nameSchema, agent: z.string().optional() }
const namedContinuableCatalogSchema = continuableCatalogSchema.extend({
  version: z.literal(3),
  ...namedCatalogFields,
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
})
const namedExternalCatalogSchema = externalCatalogSchema.extend({ version: z.literal(3), ...namedCatalogFields })
const eventDataSchema = z.union([
  oneShotCatalogSchema,
  externalCatalogSchema,
  continuableCatalogSchema,
  unknownCatalogSchema,
  namedContinuableCatalogSchema,
  namedExternalCatalogSchema,
]) as z.ZodType<SubagentCatalogEvent>
const viewSchema = z.array(z.union([
  oneShotCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: oneShotCatalogSchema.shape.childCreatedAt,
  }),
  externalCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: externalCatalogSchema.shape.childCreatedAt,
    name: nameSchema.optional(),
    agent: namedCatalogFields.agent,
  }),
  continuableCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: continuableCatalogSchema.shape.childCreatedAt,
    name: nameSchema.optional(),
    agent: namedCatalogFields.agent,
    sandboxMode: namedContinuableCatalogSchema.shape.sandboxMode,
  }),
  unknownCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: unknownCatalogSchema.shape.childCreatedAt,
  }),
])) as z.ZodType<SubagentCatalogEntry[]>
const stateSchema: z.ZodType<SubagentCatalogState> = z.object({
  inheritedEventCount: z.number().int().nonnegative() as unknown as z.ZodType<SessionLogOffset>,
  head: chunkedListSchema(eventDataSchema).optional(),
}).strict()

/**
 * Materialize complete and unknown-mode child identities from parent catalog events.
 * @param state - parent catalog fold state.
 * @returns current direct-child rows in parent catalog event order.
 */
function subagentCatalogEntries(state: SubagentCatalogState): SubagentCatalogEntry[] {
  const entries: SubagentCatalogEntry[] = []
  for (const data of iterateChunkedList(state.head)) {
    const { version: _version, childId, childCreatedAt, ...descriptor } = data
    entries.push({ id: childId, createdAt: childCreatedAt, ...descriptor })
  }
  return entries
}

/** Parent-owned catalog; version-6 checkpoints retain historical facts without profile metadata. */
export const subagentCatalogProjectionDefinition = {
  key: 'subagentCatalog',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => ({ inheritedEventCount }),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'subagent/catalog' || event.seq < state.inheritedEventCount) return state
    return { ...state, head: appendChunkedList(state.head, eventDataSchema.parse(event.data)) }
  },
  stateVersion: 6,
  wire: { viewSchema, view: subagentCatalogEntries },
} satisfies ProjectionDefinition<'subagentCatalog', SubagentCatalogState>

/**
 * Append a complete direct-child discovery fact to its parent Session.
 * @param parent - durable direct parent receiving the discovery fact.
 * @param child - established child's immutable Session metadata.
 * @param descriptor - immutable creation fields saved by the child.
 * @param name - the child's name, reserved unique among the parent's children.
 */
export function establishCatalogChild(
  parent: Session,
  child: SessionHeader,
  descriptor: Pick<ContinuableSubagentDescriptorData, 'mode' | 'label' | 'agent' | 'sandboxMode'>,
  name: string,
): void {
  parent.append('subagent/catalog', {
    version: SUBAGENT_CATALOG_VERSION,
    childId: child.id,
    childCreatedAt: child.createdAt,
    mode: descriptor.mode,
    label: descriptor.label,
    name,
    ...descriptor.agent !== undefined ? { agent: descriptor.agent } : {},
    ...descriptor.sandboxMode !== undefined ? { sandboxMode: descriptor.sandboxMode } : {},
  })
}

/**
 * Record an external execution without a local child Session.
 * @param parent - durable direct parent receiving the discovery fact.
 * @param childId - identity returned by the external provider.
 * @param label - display label assigned by the caller.
 * @param name - the child's name, reserved unique among the parent's children.
 * @param agent - optional profile id supplied at creation.
 */
export function establishExternalCatalogChild(parent: Session, childId: SessionId, label: string, name: string, agent?: string): void {
  parent.append('subagent/catalog', {
    version: SUBAGENT_CATALOG_VERSION,
    childId,
    childCreatedAt: Date.now(),
    mode: 'external',
    label,
    name,
    ...agent !== undefined ? { agent } : {},
  })
}

/**
 * Collect the names recorded in one parent's catalog.
 * @param entries - the parent's current catalog rows.
 * @returns names of every named child; historical entries contribute none.
 */
export function catalogNames(entries: readonly SubagentCatalogEntry[]): Set<string> {
  const names = new Set<string>()
  for (const entry of entries) {
    if ('name' in entry) names.add(entry.name)
  }
  return names
}
