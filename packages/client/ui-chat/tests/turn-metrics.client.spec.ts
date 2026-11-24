// Assistant timing readings and statistics formatting.

import { describe, expect, it } from 'vitest'
import type {
  AssistantMessageNode,
} from '@janhq/jan-client-ui-chat/client'
import { assistantStepReading } from '../src/client/contract/turn-metrics.ts'
import { formatTokensPerSecond } from '../src/client/chat/message-chrome.ts'
import { formatCacheHitPercent } from '../src/client/chat/token-format.ts'

interface StepSpec {
  seq: number
  turn: number
  step: number
  timing?: AssistantMessageNode['timing']
  usage?: unknown
  /** The message text; defaults to as many characters as a streamed 1,000-token answer carries. */
  text?: string
}

const assistant = ({ seq, turn, step, timing, usage, text = 'x'.repeat(4_000) }: StepSpec): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step, blocks: [{ kind: 'text', text }],
  ...(timing === undefined ? {} : { timing }),
  ...(usage === undefined ? {} : { usage }),
})

describe('assistantStepReading', () => {
  it('derives ttft, decode time, and output tokens from a fully recorded step', () => {
    const reading = assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 6_800 },
      usage: { outputTokens: 200 },
    }))
    expect(reading).toEqual({ ttftMs: 800, decodeMs: 5_000, outputTokens: 200 })
  })

  it('returns nulls when timing is absent', () => {
    const reading = assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, usage: { outputTokens: 5 } }))
    expect(reading).toEqual({ ttftMs: null, decodeMs: null, outputTokens: 5 })
  })

  it('needs both boundaries for ttft, output tokens for a decode span, and clamps negative spans to zero', () => {
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: null, firstTokenTime: 1_800, completedTime: 6_800 },
    }))).toEqual({ ttftMs: null, decodeMs: null, outputTokens: null })
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 1_000, firstTokenTime: null, completedTime: 6_800 },
    }))).toEqual({ ttftMs: null, decodeMs: null, outputTokens: null })
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1,
      timing: { stepStartTime: 2_000, firstTokenTime: 1_500, completedTime: 1_200 },
    }))).toEqual({ ttftMs: 0, decodeMs: null, outputTokens: null })
  })

  it('reports no decode span for a step whose tokens arrived in one burst', () => {
    // A buffered Tool call: 7,000 tokens of arguments land 27 ms after the first one.
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1, text: 'x'.repeat(28_000),
      timing: { stepStartTime: 1_000, firstTokenTime: 38_800, completedTime: 38_827 },
      usage: { outputTokens: 7_000 },
    }))).toEqual({ ttftMs: 37_800, decodeMs: null, outputTokens: 7_000 })
  })

  it('measures from the step start when the output count outgrows what the stream carried', () => {
    // Hidden reasoning: 1,802 output tokens, but the stream carried a 1,095-character answer over its
    // last 1.6 s. Dividing by that span alone read 1,146 tok/s.
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1, text: 'x'.repeat(1_095),
      timing: { stepStartTime: 1_000, firstTokenTime: 10_820, completedTime: 12_393 },
      usage: { outputTokens: 1_802 },
    }))).toEqual({ ttftMs: 9_820, decodeMs: 11_393, outputTokens: 1_802 })
  })

  it('cannot measure hidden-reasoning output whose step start is outside the window', () => {
    expect(assistantStepReading(assistant({
      seq: 2, turn: 1, step: 1, text: 'short',
      timing: { stepStartTime: null, firstTokenTime: 10_820, completedTime: 12_393 },
      usage: { outputTokens: 1_802 },
    })).decodeMs).toBeNull()
  })

  it('rejects non-object, missing, and non-finite usage token counts', () => {
    const timing = { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 }
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: 'weird' })).outputTokens).toBeNull()
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: {} })).outputTokens).toBeNull()
    const nan = assistant({ seq: 2, turn: 1, step: 1, timing, usage: { outputTokens: Number.NaN } })
    expect(assistantStepReading(nan).outputTokens).toBeNull()
    expect(assistantStepReading(assistant({ seq: 2, turn: 1, step: 1, timing, usage: { outputTokens: -3 } })).outputTokens).toBeNull()
  })
})

describe('footer figure formatters', () => {
  it('omits a redundant decimal zero in cache-hit percentages', () => {
    expect(formatCacheHitPercent(1, 2, 1)).toBe('50')
  })

  it('formats throughput with whole tokens from ten up and one decimal below', () => {
    expect(formatTokensPerSecond(34.4)).toBe('34')
    expect(formatTokensPerSecond(9.96)).toBe('10')
    expect(formatTokensPerSecond(3.14)).toBe('3.1')
    expect(formatTokensPerSecond(-1)).toBe('0')
  })
})
