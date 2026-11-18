/** JSON-safe records, errors, and events of the `pluginI18n` Remote namespace. */
import type {} from '@janhq/jan-typert-protocol'

declare module '@janhq/jan-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A package name is not a valid npm package name. */
    'plugin-i18n/invalid-package': { readonly pkg: string }
    /** A locale is not a BCP 47-style tag. */
    'plugin-i18n/invalid-locale': { readonly locale: string }
    /** A request exceeds `maxEntries` or `maxSourceBytes`; the limits are in the details. */
    'plugin-i18n/too-large': { readonly entries: number; readonly bytes: number; readonly maxEntries: number; readonly maxBytes: number }
    /** Strings leave the Host only after the person consented to translating plugin text. */
    'plugin-i18n/not-consented': Record<string, never>
    /** The default model route could not complete the request. */
    'plugin-i18n/model-failed': { readonly reason: string }
  }
}

/** Plugin source text: namespace, then key, then the text the plugin itself supplied. */
export type PluginI18nSources = Record<string, Record<string, string>>

/** One generated translation with the exact source text it translated. */
export interface PluginI18nEntry {
  /** The plugin's own text at generation time; a client uses a translation only while the plugin still supplies this text. */
  readonly src: string
  /** The translation. */
  readonly text: string
}

/** Generated entries: namespace, then key. */
export type PluginI18nEntries = Record<string, Record<string, PluginI18nEntry>>

/** A request to translate one package's UI text into one locale. */
export interface PluginI18nTranslateRequest {
  /** npm package name. */
  readonly pkg: string
  /** Target locale tag. */
  readonly locale: string
  /** Locale tag of the source text, named to the model. */
  readonly sourceLocale: string
  /** Text to translate; the Host translates only entries that are new or changed since the last run unless `rerun` is set. */
  readonly sources: PluginI18nSources
  /** Translate every entry again instead of reusing the cached ones. */
  readonly rerun?: boolean
}

/** Progress of one translation job. */
export type PluginI18nJobState = 'running' | 'done' | 'failed'

/** The latest translation job of one package and locale. */
export interface PluginI18nJob {
  readonly pkg: string
  readonly locale: string
  readonly state: PluginI18nJobState
  /** Entries translated or reused so far. */
  readonly done: number
  /** Entries the job covers. */
  readonly total: number
  /** The failure diagnostic when `state` is `failed`. */
  readonly message?: string
}

/** One locale of generated text stored for a package. */
export interface PluginI18nLocaleStatus {
  readonly locale: string
  readonly sourceLocale: string
  /** `provider/model` that produced the text. */
  readonly model: string
  /** Unix milliseconds. */
  readonly generatedAt: number
  /** Namespaces with generated text. */
  readonly namespaces: string[]
  /** Entries translated. */
  readonly entries: number
  /** Entries kept in the source language after a rejected translation. */
  readonly kept: number
}

/** What the Host stores and runs for one package. */
export interface PluginI18nStatus {
  readonly pkg: string
  readonly locales: PluginI18nLocaleStatus[]
  /** The latest job, absent when none ran since the Host started. */
  readonly job: PluginI18nJob | null
  /** Whether the person consented to translating this package's text. */
  readonly consented: boolean
}

/** Consent to send plugin text to the default model. */
export interface PluginI18nConsent {
  /** Translate tool titles of every plugin. */
  readonly global: boolean
  /** Packages whose text the person agreed to translate. */
  readonly packages: string[]
}

/** A change to the consent record: one package, or the global switch when `pkg` is absent. */
export interface PluginI18nConsentChange {
  readonly pkg?: string
  readonly allowed: boolean
}

/** The default model route that translations run on. */
export interface PluginI18nRoute {
  readonly provider: string
  readonly model: string
}

/** Generated text of one package for one locale, as a client registers it. */
export interface PluginI18nPackageTables {
  readonly sourceLocale: string
  readonly entries: PluginI18nEntries
}

/** Everything a client loads at start-up for one locale. */
export interface PluginI18nTables {
  readonly locale: string
  readonly packages: Record<string, PluginI18nPackageTables>
  /** Runtime strings translated so far, keyed by exact source text; empty unless titles may be translated. */
  readonly strings: Record<string, string>
}

/** What changed; absent fields mean everything of that kind. */
export interface PluginI18nChange {
  readonly pkg?: string
  readonly locale?: string
}

declare module '@janhq/cordis' {
  interface Events {
    /**
     * Generated text, a job, or the consent record changed.
     * @mode emit
     * @param change - the package and locale that changed, when one did.
     */
    'plugin-i18n/changed'(change: PluginI18nChange): void
  }
}
