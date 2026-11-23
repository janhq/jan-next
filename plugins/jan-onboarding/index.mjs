/** Device-local onboarding answers stored in the desktop Host settings document. */
import z from '@janhq/schemastery'

/** Device-local preferences, not account or Session data. */
export const Config = z.object({
  name: z.string().default('').volatile(),
  roles: z.array(z.string()).default([]).volatile(),
  goals: z.array(z.string()).default([]).volatile(),
  /** The answer to "How do you want to use Jan?"; absent when onboarding was skipped. */
  mode: z.union([z.const('assistant'), z.const('workspace')]).volatile(),
})

/** Keep onboarding answers out of the generated settings editor. @param {import('@janhq/cordis').Context} ctx - Host Context. */
export function apply(ctx) {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
}
