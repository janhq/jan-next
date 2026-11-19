/**
 * Model-visible messages owned by continuable-subagent orchestration.
 *
 * @module @janhq/jan-subagent/continuation-messages
 */

import type { Agent } from '@janhq/jan-agent'
import { boundContextSummary, createUserMessage } from '@janhq/jan-llm'
import type { ContentBlock } from '@janhq/jan-llm'
import type { SessionId } from '@janhq/jan-session'
import type { SubagentResult } from './types.ts'

/** Durable attribution for one model-authored message between Agents. */
export interface AgentMessageSource {
  readonly kind: 'agent-message'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the Agent whose tool call produced the message. */
  readonly senderSessionId: SessionId
}

/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link AgentMessageSource}: an Agent message is content the sender chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
export interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Exact execution stop reason; absent on historical notices. Writers always include it. */
  readonly stopReason?: SubagentResult['stopReason']
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}

declare module '@janhq/jan-llm' {
  interface MessageSourceMap {
    'agent-message': AgentMessageSource
    'subagent-settled': SubagentSettledMessageSource
  }
}

/** Build durable attribution for one Agent message. */
function agentMessageSource(sender: Agent): AgentMessageSource {
  return {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId: sender.id,
  }
}

/**
 * Build the model-visible and durable representation of one Agent message.
 * @param sender - exact live Agent that authored the message.
 * @param senderName - the sender's model-facing name in its subagent tree.
 * @param content - model-visible message blocks supplied by the sender.
 * @returns the durable user-message representation delivered to the recipient.
 */
export function createAgentMessage(
  sender: Agent,
  senderName: string,
  content: ContentBlock[],
): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [
      { type: 'text' as const, text: `Agent ${senderName} sent a message: ` },
      ...content,
    ],
    source: agentMessageSource(sender),
  })
}

/**
 * Append automatic result-delivery guidance to a parent-delivered child's initial task.
 * @param prompt - initial model-visible task blocks.
 * @returns task blocks followed by the result-delivery guidance.
 */
export function withResultDeliveryGuidance(
  prompt: ContentBlock[],
): ContentBlock[] {
  return [
    ...prompt,
    {
      type: 'text',
      text: 'Your final answer is delivered automatically if your parent is still online. '
        + 'Follow the requested format. Otherwise use Summary:, Evidence:, Blockers:, and Changed files: in your final answer. '
        + 'Report only checks you ran and files you changed; omit unknown details. Your parent does not receive your transcript. '
        + 'Use messages for interim updates, '
        + 'not as a substitute for your final answer.',
    },
  ]
}

/**
 * One line telling a parent that a background child is finished and why, in
 * the parent's own task vocabulary.
 * @param childName - the model-facing name the parent knows the child by.
 * @param stopReason - how the child's last ordinary turn ended.
 * @param continuable - whether the child accepts a later message.
 * @returns the model-facing opening line of the settlement notice.
 */
function settlementSummary(childName: string, stopReason: SubagentResult['stopReason'], continuable: boolean): string {
  const subject = `Background subagent ${childName}`
  switch (stopReason) {
    case 'completed':
      return continuable
        ? `${subject} finished and will do no further work unless you send it more.`
        : `${subject} finished. It cannot receive follow-up messages.`
    case 'aborted':
      return `${subject} was stopped before it finished.`
    case 'max-tokens':
      return `${subject} ran out of room before it finished.`
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // the child had claimed, so the parent must not treat the task as done.
    case 'refusal':
      return `${subject} declined the task.`
    case 'error':
      return `${subject} failed before it finished.`
    /* v8 ignore next 4 -- `SubagentResult['stopReason']` is merge-extensible, so this arm
     * needs a backend that adds a variant; an unnameable ending is reported as unfinished
     * rather than silently as success. */
    default:
      return `${subject} ended abnormally (${String(stopReason)}) before it finished.`
  }
}

function reportField(structured: unknown, key: string): string | undefined {
  if (typeof structured !== 'object' || structured === null || !Object.hasOwn(structured, key)) return undefined
  const value = (structured as Record<string, unknown>)[key]
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const entries = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return entries.length === 0 ? undefined : entries.join('; ')
}

/** Extract optional child-reported fields without interpreting arbitrary prose or discarding it. */
function reportedFields(text: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>()
  const parts = [...text.matchAll(/^[\t ]*(?:\*\*)?(Summary|Evidence|Blockers|Changed files):(?:\*\*)?[\t ]*/gimu)]
  const first = parts.findIndex(part => part[1]?.toLowerCase() === 'summary')
  if (first < 0) return fields
  for (let index = first; index < parts.length; index++) {
    const part = parts[index]
    const key = part?.[1]?.toLowerCase()
    if (part === undefined || key === undefined) continue
    const value = text.slice(part.index + part[0].length, parts[index + 1]?.index).trim()
    if (value !== '') fields.set(key, value)
  }
  return fields
}

/**
 * Build the runtime-owned settlement notice from the child's nonempty closing text.
 * @param childId - durable child session id recorded as the sender.
 * @param childName - model-facing child name used in the notice text.
 * @param terminal - recorded terminal state for the settled Activation.
 * @param continuable - whether the child can accept another task.
 * @returns the durable user-message representation delivered to the parent.
 */
export function createSettlementMessage(
  childId: SessionId,
  childName: string,
  terminal: SubagentResult,
  continuable = true,
): ReturnType<typeof createUserMessage> {
  const summary = settlementSummary(childName, terminal.stopReason, continuable)
  // Parent providers receive this notice as a user message and may reject
  // nontext assistant blocks. Keep this conversion local so SDK/UI consumers
  // retain the complete child output.
  const closingText = terminal.output.flatMap(block =>
    block.type === 'text' && block.text.length > 0 ? [block] : [],
  )
  const fields = reportedFields(closingText.map(block => block.text).join('\n'))
  const status = terminal.stopReason === 'completed' ? 'completed' : terminal.stopReason === 'aborted' ? 'interrupted' : 'failed'
  const evidence = reportField(terminal.structured, 'evidence') ?? fields.get('evidence') ?? 'Not reported.'
  const blockers = [terminal.diagnostic, reportField(terminal.structured, 'blockers') ?? fields.get('blockers')].filter(Boolean)
  const changed = reportField(terminal.structured, 'changedFiles') ?? fields.get('changed files') ?? 'Not reported.'
  const outcome = reportField(terminal.structured, 'summary') ?? fields.get('summary')
    ?? (closingText.length === 0 ? 'No closing message.' : 'See closing message below.')
  return createUserMessage({
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: `Status: ${status}\nSummary: ${outcome}\nEvidence: ${evidence}\n`
        + `Blockers: ${blockers.length === 0 ? 'Not reported.' : blockers.join('\n')}\nChanged files: ${changed}` },
      ...closingText.length === 0
        ? [{ type: 'text' as const, text: 'It left no closing message.' }]
        : [{ type: 'text' as const, text: 'Its closing message:' }, ...closingText],
      ...terminal.structured !== undefined
        ? [{ type: 'text' as const, text: `Structured result: ${JSON.stringify(terminal.structured)}` }] : [],
    ],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: boundContextSummary(summary),
      stopReason: terminal.stopReason,
      senderSessionId: childId,
    },
  })
}
