import { describe, expect, it } from 'vitest'
import { createUserMessage, ToolCallId, type ContentBlock } from '@janhq/jan-llm'
import { SessionId } from '@janhq/jan-session'
import { createSettlementMessage } from '../src/continuation-messages.ts'

const childId = SessionId('settled-child')
const childName = 'reviewer/checker'
const summary = { type: 'text', text: `Background subagent ${childName} finished and will do no further work unless you send it more.` }
const reasoning: ContentBlock = { type: 'reasoning', text: 'private child reasoning' }
const toolCall: ContentBlock = { type: 'tool-call', id: ToolCallId('child-call'), name: 'read', arguments: '{}' }
const envelope = (status: string, outcome = 'See closing message below.', blockers = 'Not reported.') => ({
  type: 'text', text: `Status: ${status}\nSummary: ${outcome}\nEvidence: Not reported.\nBlockers: ${blockers}\nChanged files: Not reported.`,
})

describe('settlement attribution', () => {
  it.each(['completed', 'aborted', 'max-tokens', 'refusal', 'error'] as const)(
    'records the exact %s stop reason without changing model content', (stopReason) => {
      const terminal = { stopReason, output: [{ type: 'text' as const, text: '  answer\n' }] }
      const message = createSettlementMessage(childId, childName, terminal)
      expect(message.source).toMatchObject({
        kind: 'subagent-settled', form: 'notice',
        senderSessionId: childId, stopReason,
      })
      expect(message.content.slice(2)).toEqual([
        { type: 'text', text: 'Its closing message:' },
        ...terminal.output,
      ])
    },
  )

  it('preserves historical notices without inferring missing attribution from English', () => {
    const source = { kind: 'subagent-settled' as const, form: 'notice' as const,
      summary: 'Historical runtime summary', senderSessionId: childId }
    const content = [{ type: 'text' as const, text: 'Background subagent settled-child finished.' }]
    const message = createUserMessage({ source, content })
    expect(message.source).toEqual(source)
    expect(message.source).not.toHaveProperty('stopReason')
    expect(message.content).toEqual(content)
  })
})

describe('continuable settlement content', () => {
  it.each([
    ['reasoning before the answer', [reasoning, { type: 'text', text: 'answer' }]],
    ['a tool call after the answer', [{ type: 'text', text: 'answer' }, toolCall]],
  ] satisfies [string, ContentBlock[]][])('reports only the closing text with %s', (_label, output) => {
    const original = structuredClone(output)
    const message = createSettlementMessage(childId, childName, { stopReason: 'completed', output })

    expect(message.role).toBe('user')
    expect(message.content).toEqual([
      summary,
      envelope('completed'),
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'answer' },
    ])
    expect(output).toEqual(original)
  })

  it.each([
    ['empty output', []],
    ['reasoning-only output', [reasoning]],
    ['empty text', [{ type: 'text', text: '' }]],
  ] satisfies [string, ContentBlock[]][])('reports no closing message for %s', (_label, output) => {
    const message = createSettlementMessage(childId, childName, { stopReason: 'completed', output })

    expect(message.content).toEqual([
      summary,
      envelope('completed', 'No closing message.'),
      { type: 'text', text: 'It left no closing message.' },
    ])
  })

  it('preserves text block order and bytes around omitted reasoning and tool calls', () => {
    const first: ContentBlock = { type: 'text', text: '  first\n' }
    const second: ContentBlock = { type: 'text', text: '\n第二段  ' }
    const message = createSettlementMessage(childId, childName, {
      stopReason: 'completed',
      output: [reasoning, first, toolCall, second],
    })

    expect(message.content).toEqual([
      summary,
      envelope('completed'),
      { type: 'text', text: 'Its closing message:' },
      first,
      second,
    ])
  })
})

it('includes closing text alongside structured results and diagnostics', () => {
  expect(createSettlementMessage(childId, childName, {
    stopReason: 'completed', output: [{ type: 'text', text: 'final answer' }],
    structured: { answer: 42 }, diagnostic: 'safe diagnostic',
  }).content).toEqual([
    summary,
    envelope('completed', 'See closing message below.', 'safe diagnostic'),
    { type: 'text', text: 'Its closing message:' },
    { type: 'text', text: 'final answer' },
    { type: 'text', text: 'Structured result: {"answer":42}' },
  ])
})

it.each([
  ['completed', 'completed'], ['aborted', 'interrupted'], ['max-tokens', 'failed'],
  ['refusal', 'failed'], ['error', 'failed'],
] as const)('renders a consistent envelope for %s', (stopReason, status) => {
  const message = createSettlementMessage(childId, childName, {
    stopReason,
    output: [{ type: 'text', text: 'Actual result' }],
    ...(stopReason === 'error' ? { diagnostic: 'Backend unavailable' } : {}),
    structured: { evidence: ['src/main.ts:2'], blockers: ['No fixture'], changedFiles: ['src/index.ts'] },
  }, false)
  const report = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  expect(report).toContain(`Status: ${status}`)
  expect(report).toContain('Summary:')
  expect(report).toContain('Actual result')
  expect(report).toContain('Evidence: src/main.ts:2')
  expect(report).toContain('Changed files: src/index.ts')
  expect(report).toContain(stopReason === 'error' ? 'Blockers: Backend unavailable' : 'Blockers: No fixture')
})

it('uses explicitly reported facts and preserves free-form closing output', () => {
  const text = 'Summary: Fixed the timeout.\nEvidence: timeout.spec.ts passed.\nBlockers: None.\nChanged files: timeout.ts'
  const result = createSettlementMessage(childId, childName, { stopReason: 'completed', output: [{ type: 'text', text }] })
  expect(result.content[1]).toEqual({ type: 'text', text: `Status: completed\n${text}` })
  expect(result.content.at(-1)).toEqual({ type: 'text', text })
})

it('reads bold report labels without changing the original reply', () => {
  const text = '**Summary:** Found the port.\n\n**Evidence:** routes.ts:2\n**Blockers:** None.\n**Changed files:** None.'
  const result = createSettlementMessage(childId, childName, { stopReason: 'completed', output: [{ type: 'text', text }] })
  expect(result.content[1]).toEqual({ type: 'text', text: 'Status: completed\nSummary: Found the port.\n'
    + 'Evidence: routes.ts:2\nBlockers: None.\nChanged files: None.' })
  expect(result.content.at(-1)).toEqual({ type: 'text', text })
})

it('reads a labeled footer after requested findings', () => {
  const text = 'Finding 1: Incorrect multiplier.\n\nSummary: Reviewed the fee.\nEvidence: fees.ts:9\nChanged files: None.'
  const result = createSettlementMessage(childId, childName, { stopReason: 'completed', output: [{ type: 'text', text }] })
  expect(result.content[1]).toEqual({ type: 'text', text: 'Status: completed\nSummary: Reviewed the fee.\n'
    + 'Evidence: fees.ts:9\nBlockers: Not reported.\nChanged files: None.' })
  expect(result.content.at(-1)).toEqual({ type: 'text', text })
})
