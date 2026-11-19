/**
 * Pre-send context-window check: warn before a plain message that cannot fit
 * the selected model, so a too-large paste never lands in history where every
 * later request would overflow too. A second send of the same draft goes
 * through, because the estimate is approximate.
 */
import type { ContextPressureProjection } from '@janhq/jan-token-meter/client'
import type { ModelDirectoryState } from './directory.ts'

/**
 * Characters per token: the token meter's fixed density estimate. Restated
 * here because client bundles may not value-import another plugin's module.
 */
const CHARS_PER_TOKEN = 4

/** What the check needs to know about the session at send time. */
export interface SendFit {
  /** The session's model directory snapshot (catalog groups plus the current selection). */
  directory: ModelDirectoryState
  /** The session's latest context-pressure projection, when it has one. */
  pressure: ContextPressureProjection | undefined
}

/** A message the selected model cannot hold. */
export interface Overflow {
  /** Estimated prompt tokens after adding the message. */
  tokens: number
  /** The selected route's context window. */
  contextWindow: number
  /** Display name of the selected model. */
  model: string
}

/**
 * Estimate whether sending `text` overflows the selected model's context window.
 * @param text - the plain message about to be sent.
 * @param fit - the session's directory and pressure snapshots.
 * @returns the overflow, or undefined when it fits or the window is unknown.
 */
export function overflowOf(text: string, fit: SendFit): Overflow | undefined {
  const current = fit.directory.current
  if (current === null) return undefined
  const model = fit.directory.groups.find(group => group.id === current.provider)
    ?.models.find(entry => entry.id === current.model)
  // The catalog follows the selection; the pressure window is the last request's route.
  const contextWindow = model?.contextWindow ?? fit.pressure?.contextWindow
  if (contextWindow === undefined) return undefined
  const used = fit.pressure?.projectedTokens ?? fit.pressure?.pressureTokens ?? 0
  const tokens = used + Math.ceil(text.length / CHARS_PER_TOKEN)
  if (tokens <= contextWindow) return undefined
  return { tokens, contextWindow, model: model?.name ?? current.model }
}
