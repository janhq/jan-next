/** Jan brand copy. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace. */
export const NS = 'ui-brand-official' as const

/** English dictionary. */
export const en = {
  /** Release stage shown beside the product name. */
  stage: 'Alpha',
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
export const zh: Dictionary = { stage: 'Alpha' }
export const ja: Dictionary = { stage: 'Alpha' }
export const es: Dictionary = { stage: 'Alpha' }
export const fr: Dictionary = { stage: 'Alpha' }
export const de: Dictionary = { stage: 'Alpha' }
export const ru: Dictionary = { stage: 'Alpha' }
export const pt: Dictionary = { stage: 'Alpha' }
