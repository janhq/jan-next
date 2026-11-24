/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@janhq/schemastery'

/** Onboarding options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /** The provider row the first-run step offers when nothing can serve yet. */
  onboardingRoute: OnboardingRoute
}

/** Directory identity of the onboarding provider row. */
export interface OnboardingRoute {
  /** Provider route id. */
  provider: string
  /** Owning settings namespace (the adapter plugin entry id). */
  settingsNs: string
  /** Path of the route inside that namespace; empty for a whole-namespace provider. */
  settingsPath: string[]
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  credentialOnboarding: z.boolean().default(true),
  onboardingRoute: z.object({
    provider: z.string().min(1).default('tokamak'),
    settingsNs: z.string().min(1).default('llm-pi-ai'),
    settingsPath: z.array(z.string()).default(['providers', 'tokamak']),
  }).default({ provider: 'tokamak', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'tokamak'] }),
})

/** Page-global key carrying only the public onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__JAN_MODELS_ONBOARDING__'
