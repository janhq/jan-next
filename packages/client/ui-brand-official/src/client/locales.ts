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
export const zh: Dictionary = { ...en }
export const ja: Dictionary = { ...en }
export const es: Dictionary = { ...en }
export const fr: Dictionary = { ...en }
export const de: Dictionary = { ...en }
export const ru: Dictionary = { ...en }
export const pt: Dictionary = { ...en }
