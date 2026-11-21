/**
 * Web question plugin, node half.
 *
 * Mounting `ask_user_question` in the tools registry's global layer expands
 * every agent's tool list regardless of its preset. Rendering a question is
 * a host UI capability; the model-facing tool belongs to the presets that
 * include it and to the TUI composition, which has no presets.
 */
import type { Context, Volatile } from '@janhq/cordis'
import type {} from '@janhq/jan-settings'
import type { UserQuestionSettings } from '@janhq/jan-user-questions/types'
import z from '@janhq/schemastery'
import { AUTO_ANSWER_SECONDS, DEFAULT_AUTO_ANSWER_SECONDS, type AutoAnswerSeconds } from './question-settings.ts'

/** Runtime configuration kept live by the Host settings service. */
export interface Config {
  /** Seconds before an unanswered question batch is automatically submitted. */
  autoAnswerSeconds: Volatile<AutoAnswerSeconds>
}

/** Live Host preference exposed through the Settings form. */
export const Config = z.object({
  autoAnswerSeconds: z.union([...AUTO_ANSWER_SECONDS]).default(DEFAULT_AUTO_ANSWER_SECONDS).volatile(),
})

/** Expose the countdown preference without registering a model-facing tool.
 * @param ctx Host context.
 * @param config Profile-owned question preferences.
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  ctx.provide('userQuestionSettings', { autoAnswerSeconds: () => config.autoAnswerSeconds.get() } satisfies UserQuestionSettings)
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
