/** Jan brand copy. */
import type {} from '@janhq/jan-client-ui-slots'

/** Locale namespace. */
export const NS = 'ui-brand-official' as const

/** English dictionary. */
export const en = {
  /** Release stage shown beside the product name. */
  stage: 'Next',
} as const

/** Dictionary keys. */
export type BrandKey = keyof typeof en

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Jan brand name and release stage. */
    'ui-brand-official': BrandKey
  }
}

type Dictionary = Record<BrandKey, string>

// The UI is English-only; the other languages show the English stage name.
/** Chinese dictionary. */
export const zh: Dictionary = { stage: 'Next' }
/** Japanese dictionary. */
export const ja: Dictionary = { stage: 'Next' }
/** Spanish dictionary. */
export const es: Dictionary = { stage: 'Next' }
/** French dictionary. */
export const fr: Dictionary = { stage: 'Next' }
/** German dictionary. */
export const de: Dictionary = { stage: 'Next' }
/** Russian dictionary. */
export const ru: Dictionary = { stage: 'Next' }
/** Portuguese dictionary. */
export const pt: Dictionary = { stage: 'Next' }
