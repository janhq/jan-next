/** Durable Host-wide Schedule tasks, independently of Session activation. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { SessionId } from '@janhq/jan-session'
import { MessageId } from '@janhq/jan-llm/brand'
import { defineDomain, domainTable } from '@janhq/jan-storage-domain'
import { WorkspaceId } from '@janhq/jan-workspace'
import { decodeScheduleRecord } from './domain.ts'
import type { ScheduleDeliveryRecord, ScheduleId, ScheduleRecord, ScheduleTarget } from './types.ts'

const recordSchema = z.unknown().transform((value, context): ScheduleRecord => {
  try {
    return decodeScheduleRecord(value)
  } catch (error: unknown) {
    context.addIssue({ code: 'custom', message: String(error) })
  }
  return z.NEVER
})

/** Canonical millisecond UTC instant with a four-digit year. */
const instantSchema = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
  message: 'Expected a canonical four-digit-year UTC calendar instant',
})

/** Identity of one delivered inbox message: non-empty, without surrounding whitespace. */
const messageIdSchema = z.string().min(1).refine(value => value.trim() === value).transform(MessageId)

/** Non-empty saved Session identity. */
const sessionIdSchema = z.string().min(1).transform(SessionId)

const deliveryReceiptSchema = z.object({
  scheduledAt: instantSchema,
  deliveredAt: instantSchema,
  messageId: messageIdSchema,
  targetSessionId: sessionIdSchema.optional(),
  owner: z.string().min(1).optional(),
  outcome: z.literal('accepted').optional(),
}).strict()

const deliveryHistorySchema = z.object({
  records: z.array(deliveryReceiptSchema.extend({ prompt: z.string().exactOptional() }).strict()),
  earlierRecordsUnavailable: z.boolean(),
  earlierRecordsPruned: z.boolean().default(false),
}).strict().refine(history => new Set(history.records.map(record => record.messageId)).size === history.records.length, {
  message: 'Delivery history message identities must be unique within a task',
})

const workspaceIdSchema = z.string().min(1).transform(WorkspaceId)

const createSpecSchema = z.object({
  cwd: z.string().min(1).exactOptional(),
  workspaceId: workspaceIdSchema.exactOptional(),
  agentPreset: z.string().min(1).exactOptional(),
}).strict()

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: sessionIdSchema, workspaceId: workspaceIdSchema.exactOptional() }).strict(),
  z.object({ kind: z.literal('new_once'), sessionId: sessionIdSchema.optional(), create: createSpecSchema.default({}) }).strict(),
  z.object({ kind: z.literal('new'), create: createSpecSchema.default({}) }).strict(),
  z.object({ kind: z.literal('plugin'), owner: z.string().min(1) }).strict(),
])

/**
 * Read the saved project binding, including after a create-once target became a reused Session.
 * @param target - stored delivery destination.
 * @returns the Workspace id, or undefined for a plugin or an unbound Session target.
 */
export function targetWorkspaceId(target: ScheduleTarget): WorkspaceId | undefined {
  if (target.kind === 'plugin') return undefined
  return target.kind === 'session' ? target.workspaceId : target.create.workspaceId
}

/** Stable reservation for a task without a saved destination; reads never allocate or persist a Session. */
function defaultSessionId(id: ScheduleId): SessionId {
  return SessionId(`session-schedule-${createHash('sha256').update(id).digest('hex')}`)
}

/**
 * Version-3 task schema accepting version-1 and version-2 rows. New metadata is optional on disk. An explicit target
 * ignores the former Session binding; a missing target uses that binding or a stable create-once destination.
 * Normal decoding does not write. The next edit or delivery writes this current shape without `sessionId`.
 */
export const scheduleTaskSchema = z.object({
  record: recordSchema,
  sessionId: z.unknown().optional(),
  target: targetSchema.optional(),
  /** A Session inbox that must be mounted before this task may deliver. */
  sessionDestinationOwner: z.string().min(1).exactOptional(),
  pluginPayload: z.string().exactOptional(),
  involvedSessionIds: z.array(sessionIdSchema).optional(),
  status: z.enum(['active', 'paused', 'ended', 'inactive']).default('active'),
  createdAt: instantSchema.optional(),
  updatedAt: instantSchema.optional(),
  lastDelivery: deliveryReceiptSchema.optional(),
  deliveryFailure: z.object({ code: z.literal('project-removed'), failedAt: instantSchema }).strict().exactOptional(),
  deliveryHistory: deliveryHistorySchema.optional(),
  pendingDelivery: z.object({ targetSessionId: sessionIdSchema }).strict().optional(),
}).strict().transform(({ sessionId, target: savedTarget, lastDelivery, deliveryHistory, ...task }, context) => {
  const binding = savedTarget === undefined && sessionId !== undefined ? sessionIdSchema.safeParse(sessionId) : undefined
  if (binding?.success === false) {
    context.addIssue({ code: 'custom', path: ['sessionId'], message: 'A missing target requires a valid stored Session binding' })
    return z.NEVER
  }
  const target: ScheduleTarget = savedTarget === undefined
    ? binding?.success === true
      ? { kind: 'session', sessionId: binding.data }
      : { kind: 'new_once', sessionId: defaultSessionId(task.record.id), create: {} }
    : savedTarget.kind === 'new_once'
      ? { ...savedTarget, sessionId: savedTarget.sessionId ?? defaultSessionId(task.record.id) }
      : savedTarget
  const bindingId = savedTarget === undefined
    ? binding?.data
    : savedTarget.kind === 'session' || savedTarget.kind === 'new_once' ? savedTarget.sessionId : undefined
  const receipt = (value: z.infer<typeof deliveryReceiptSchema> & { prompt?: string } | undefined): ScheduleDeliveryRecord | undefined => {
    if (value === undefined) return undefined
    const { targetSessionId, owner, outcome, ...identity } = value
    if (owner !== undefined || outcome !== undefined) {
      if (owner !== undefined && outcome !== undefined && targetSessionId === undefined) return { ...identity, owner, outcome }
    } else {
      const destination = targetSessionId ?? bindingId
      if (destination !== undefined) return { ...identity, targetSessionId: destination }
    }
    context.addIssue({ code: 'custom', message: 'A saved delivery must name exactly one destination' })
    return undefined
  }
  const last = receipt(lastDelivery)
  const history = { records: [] as ScheduleDeliveryRecord[],
    earlierRecordsUnavailable: deliveryHistory?.earlierRecordsUnavailable ?? true,
    earlierRecordsPruned: deliveryHistory?.earlierRecordsPruned ?? false }
  if (lastDelivery !== undefined && last === undefined) return z.NEVER
  if (deliveryHistory === undefined) {
    if (last !== undefined) history.records.push(last)
  } else {
    for (const saved of deliveryHistory.records) {
      const decoded = receipt(saved)
      if (decoded === undefined) return z.NEVER
      history.records.push(decoded)
    }
  }
  if (target.kind === 'plugin' && (task.sessionDestinationOwner !== undefined || task.pendingDelivery !== undefined
      || history.records.some(value => value.owner !== target.owner))
    || task.sessionDestinationOwner !== undefined && (target.kind !== 'session' || task.pendingDelivery !== undefined)
    || task.pluginPayload !== undefined && target.kind !== 'plugin' && task.sessionDestinationOwner === undefined) {
    context.addIssue({ code: 'custom', message: 'Plugin delivery state must belong to its registered owner' })
    return z.NEVER
  }
  return {
    ...task,
    target,
    status: task.status === 'inactive' ? 'ended' as const : task.status,
    involvedSessionIds: task.involvedSessionIds ?? (target.kind === 'session' || target.kind === 'new_once' ? [target.sessionId] : []),
    ...(last === undefined ? {} : { lastDelivery: last }),
    deliveryHistory: history,
  }
}).refine((task) => {
  const latest = task.deliveryHistory.records.at(-1)
  if (latest === undefined) return task.lastDelivery === undefined
  const { prompt: _prompt, ...receipt } = latest
  return isDeepStrictEqual(receipt, task.lastDelivery)
}, {
  message: 'Last delivery must match the latest saved delivery receipt',
})

/** Persistent task value; a delivery receipt does not record model execution completion. */
export type ScheduleTask = z.infer<typeof scheduleTaskSchema>

/** Authoritative Host tasks retain their domain, backend routing, and envelope; v3 also reads v1 and v2 without startup writes. */
export const scheduleDomain = defineDomain({
  name: 'schedule', version: 3, compatibleVersions: [1, 2],
  tables: { tasks: domainTable<ScheduleId, ScheduleTask>(scheduleTaskSchema) },
})
