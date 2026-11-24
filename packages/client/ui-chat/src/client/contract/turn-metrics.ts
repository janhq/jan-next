// Assistant timing readings used by session statistics.

import type { AssistantMessageNode } from '@janhq/jan-client-ui-conversation/client'
import { measuredDecodeMs, streamedBlockChars } from '@janhq/jan-llm/assistant-stream'

/** One assistant step's derivable latency facts; null marks an unrecorded part. */
export interface StepReading {
  /** step/start → first token delta, in ms. */
  ttftMs: number | null
  /**
   * First token delta (or step/start, when unstreamed reasoning preceded the stream) → final
   * message, in ms; null when too short to measure speed from.
   */
  decodeMs: number | null
  /** Provider-reported completion tokens. */
  outputTokens: number | null
}

interface UsageLike {
  outputTokens?: number
}

type AssistantNode = AssistantMessageNode

function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as UsageLike).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Read one assistant node's TTFT, decode wall time, and output tokens.
 * @param node - A settled assistant node.
 * @returns Per-part readings with `null` for unrecorded values.
 */
export function assistantStepReading(node: AssistantNode): StepReading {
  const timing = node.timing
  const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
    ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    : null
  const outputTokens = usageOutputTokens(node.usage)
  const decodeMs = timing !== undefined && timing.firstTokenTime !== null && outputTokens !== null
    ? measuredDecodeMs({
      stepStartTime: timing.stepStartTime, firstTokenTime: timing.firstTokenTime, completedTime: timing.completedTime,
      outputTokens, streamedChars: streamedBlockChars(node.blocks),
    }) ?? null
    : null
  return { ttftMs, decodeMs, outputTokens }
}
