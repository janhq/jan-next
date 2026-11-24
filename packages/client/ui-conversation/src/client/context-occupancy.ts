import type { ContextPressureProjection } from '@janhq/jan-token-meter/client'

/** Context usage rendered by conversation and Chat status surfaces. */
export interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Resolve bounded display occupancy from independently updated pressure fields.
 * @param pressure - latest token-meter projection.
 * @param selectedWindow - the selected model's window, used until a request reports the route's own.
 * @param unsentTokens - what the first request would inject, counted until a request reports usage.
 * @returns occupancy, or null until a capacity is known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
  selectedWindow?: number,
  unsentTokens = 0,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens !== undefined && pressure?.contextWindow !== undefined) {
    return {
      percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
      usedTokens,
      contextWindow: pressure.contextWindow,
    }
  }
  if (selectedWindow === undefined || selectedWindow <= 0) return null
  const used = usedTokens ?? unsentTokens
  return { percent: Math.min(100, Math.round(used / selectedWindow * 100)), usedTokens: used, contextWindow: selectedWindow }
}
