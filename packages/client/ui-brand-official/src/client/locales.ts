/** Jan brand copy. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace. */
export const NS = 'ui-brand-official' as const

/** English dictionary. */
export const en = {
  /** Release stage shown beside the product name. */
  stage: 'Beta',
} as const

/** Dictionary keys. */
export type BrandKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Jan brand name and release stage. */
    'ui-brand-official': BrandKey
  }
}

type Dictionary = Record<BrandKey, string>

// The tokamak-harness UI is English-only; the other languages show the English stage name.
export const zh: Dictionary = { stage: 'Beta' }
export const ja: Dictionary = { stage: 'Beta' }
export const es: Dictionary = { stage: 'Beta' }
export const fr: Dictionary = { stage: 'Beta' }
export const de: Dictionary = { stage: 'Beta' }
export const ru: Dictionary = { stage: 'Beta' }
export const pt: Dictionary = { stage: 'Beta' }
