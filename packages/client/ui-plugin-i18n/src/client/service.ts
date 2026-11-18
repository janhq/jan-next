/**
 * Client half of plugin translation: loads generated tables into the locale runtime, offers and runs translation
 * of a package, and serves cached translations of runtime strings such as tool titles.
 */
import type { Context as ClientContext } from '@janhq/cordis'
import type { LocalizedText } from '@janhq/jan-package-manifest'
import type {
  PluginI18nConsent, PluginI18nJob, PluginI18nRoute, PluginI18nStatus,
} from '@janhq/jan-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@janhq/jan-client-store'
import type { HostObservable } from '@janhq/jan-client-ui-slots'
import { NamespaceOwnership } from './ownership.ts'
import { mismatchesLocale } from './script.ts'
import { collectSources, lacksDictionary, metaLacksLocale } from './sources.ts'

/** Delay that gathers the titles of one render pass into one request. */
const TITLE_DEBOUNCE_MS = 120

/** Most strings in one `translateStrings` request. */
const TITLE_BATCH = 40

/** What the Settings surface and the install dialog read. */
export interface PluginI18nState {
  /** Whether the Host answered the first read. */
  readonly ready: boolean
  readonly consent: PluginI18nConsent
  /** The model translations run on; null until read. */
  readonly route: PluginI18nRoute | null
  /** Stored text and the latest job by package. */
  readonly statuses: Readonly<Record<string, PluginI18nStatus>>
}

/** Display of runtime strings; replaced on every change so consumers re-render. */
export interface TitleView {
  /** The cached translation of a string, or the string itself when none applies or none has arrived. */
  display(text: string): string
  /** Ask for the translation of a string the person is looking at; a no-op unless one applies. */
  request(text: string): void
}

/** An offer to translate one package into the active locale. */
export interface TranslationOffer {
  readonly pkg: string
  readonly locale: string
  /** The locale's own name for itself, such as `日本語`. */
  readonly language: string
  /** The model the text would be sent to; null until the Host answered. */
  readonly route: PluginI18nRoute | null
}

/** What a package shows the person that could lack the locale. */
export interface TranslationSubject {
  readonly pkg: string
  /** The package's display title and description. */
  readonly meta: readonly LocalizedText[]
}

/** The `ctx.pluginI18n` service. */
export interface PluginI18nService extends HostObservable<PluginI18nState> {
  /** Runtime string display for tool titles. */
  readonly titles: HostObservable<TitleView>
  /**
   * Decide whether to offer translating a package into the active locale. Nothing is offered when a translation of
   * the locale is stored, or when the package ships the locale: its registered dictionaries have it and its display
   * text names it or is already written for the locale.
   * @param subject - package name and display text.
   * @returns the offer, or null when the package needs none.
   */
  assess(subject: TranslationSubject): TranslationOffer | null
  /**
   * Translate a package into the active locale in the Host and wait for the job to end. Asking records consent for
   * the package. Entries unchanged since the last run are reused.
   * @param pkg - npm package name.
   * @param rerun - translate every entry again.
   * @returns the settled job.
   */
  translate(pkg: string, rerun?: boolean): Promise<PluginI18nJob>
  /**
   * Delete a package's generated text and consent.
   * @param pkg - npm package name.
   */
  clear(pkg: string): Promise<void>
  /**
   * Switch the global consent to translate tool titles of every plugin.
   * @param allowed - whether titles of every plugin may be translated.
   */
  setGlobal(allowed: boolean): Promise<void>
  /** Read the Host again and load the active locale's tables. */
  refresh(): Promise<void>
}

const EMPTY_STATE: PluginI18nState = {
  ready: false, consent: { global: false, packages: [] }, route: null, statuses: {},
}

/**
 * Name a locale in itself.
 * @param locale - locale tag.
 * @returns the language's own name, or the tag when the runtime does not know it.
 */
export function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

/** Whether runtime strings may be sent for translation. */
function titlesAllowed(consent: PluginI18nConsent): boolean {
  return consent.global || consent.packages.length > 0
}

/** Client state and behavior behind `ctx.pluginI18n`. */
export class PluginI18nClient implements PluginI18nService {
  private readonly store: SnapshotStore<PluginI18nState> = createSnapshotStore(EMPTY_STATE)
  private readonly titleListeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private readonly cache = new Map<string, string>()
  private readonly requested = new Set<string>()
  private readonly waiting = new Set<string>()
  private readonly settledJobs = new Map<string, ((job: PluginI18nJob) => void)[]>()
  private queue = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshing: Promise<void> | undefined
  private again = false
  private disposed = false
  private view: TitleView

  readonly titles: HostObservable<TitleView> = {
    getSnapshot: () => this.view,
    subscribe: (listener) => {
      this.titleListeners.add(listener)
      return () => { this.titleListeners.delete(listener) }
    },
  }

  /**
   * @param ctx - the plugin context with `remote.pluginI18n` and the locale service.
   * @param ownership - attribution of namespaces to packages.
   */
  constructor(private readonly ctx: ClientContext, private readonly ownership: NamespaceOwnership) {
    this.view = this.makeView()
  }

  getSnapshot(): PluginI18nState {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /** Stop timers and drop generated tables. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.dropTables()
  }

  /**
   * React to a language switch: stored text of the new locale replaces the old.
   * Called by the plugin on `locale/change`.
   */
  localeChanged(): void {
    this.cache.clear()
    this.requested.clear()
    this.queue.clear()
    this.publishTitles()
    void this.refresh().catch((error: unknown) => { this.ctx.logger.warn(error) })
  }

  /**
   * React to a package becoming active: when it consented and its fresh dictionaries lack the locale or its text
   * changed, translate it again in the background.
   * @param pkg - the package whose client fiber became active.
   */
  activated(pkg: string): void {
    const state = this.getSnapshot()
    if (!state.consent.packages.includes(pkg) || this.waiting.has(pkg)) return
    const locale = this.locale()
    const owned = this.ownership.ownedBy(pkg)
    if (!lacksDictionary(this.ctx.locale, owned, locale)) return
    const { sources } = collectSources(this.ctx.locale, owned, locale)
    const total = Object.values(sources).reduce((sum, keys) => sum + Object.keys(keys).length, 0)
    const stored = state.statuses[pkg]?.locales.find(item => item.locale === locale)
    if (stored !== undefined && stored.entries + stored.kept === total) return
    void this.translate(pkg).catch((error: unknown) => { this.ctx.logger.warn(error) })
  }

  /** A Host change event arrived: read again, coalescing a burst into one trailing read. */
  hostChanged(): void {
    void this.refresh().catch((error: unknown) => { this.ctx.logger.warn(error) })
  }

  async refresh(): Promise<void> {
    if (this.refreshing !== undefined) {
      this.again = true
      return this.refreshing
    }
    this.refreshing = (async () => {
      try {
        await this.read()
        while (this.consumeAgain() && !this.disposed) await this.read()
      } finally {
        this.refreshing = undefined
      }
    })()
    return this.refreshing
  }

  /** Take the request that arrived during a read: one trailing read covers any burst. */
  private consumeAgain(): boolean {
    const again = this.again
    this.again = false
    return again
  }

  assess(subject: TranslationSubject): TranslationOffer | null {
    const state = this.getSnapshot()
    const locale = this.locale()
    if (state.statuses[subject.pkg]?.locales.some(item => item.locale === locale) === true) return null
    const lacks = lacksDictionary(this.ctx.locale, this.ownership.ownedBy(subject.pkg), locale)
      || subject.meta.some(text => metaLacksLocale(text, locale))
    return lacks ? { pkg: subject.pkg, locale, language: languageName(locale), route: state.route } : null
  }

  async translate(pkg: string, rerun = false): Promise<PluginI18nJob> {
    const locale = this.locale()
    const { sourceLocale, sources } = collectSources(this.ctx.locale, this.ownership.ownedBy(pkg), locale)
    this.waiting.add(pkg)
    try {
      const started = await this.ctx.remote.pluginI18n.translate({
        pkg, locale, sourceLocale, sources, ...rerun ? { rerun } : {},
      })
      if (!started.ok) throw started.error
      const settled = started.value.state === 'running' ? this.settled(pkg, locale) : Promise.resolve(started.value)
      void this.refresh().catch((error: unknown) => { this.ctx.logger.warn(error) })
      return await settled
    } finally {
      this.waiting.delete(pkg)
    }
  }

  async clear(pkg: string): Promise<void> {
    const result = await this.ctx.remote.pluginI18n.clear(pkg)
    if (!result.ok) throw result.error
    await this.refresh()
  }

  async setGlobal(allowed: boolean): Promise<void> {
    const result = await this.ctx.remote.pluginI18n.setConsent({ allowed })
    if (!result.ok) throw result.error
    await this.refresh()
  }

  private locale(): string {
    return this.ctx.locale.getLocale().active
  }

  /** Resolve when the Host reports the job of a package and locale as done or failed. */
  private settled(pkg: string, locale: string): Promise<PluginI18nJob> {
    const key = `${pkg}\n${locale}`
    const { promise, resolve } = Promise.withResolvers<PluginI18nJob>()
    this.settledJobs.set(key, [...this.settledJobs.get(key) ?? [], resolve])
    return promise
  }

  /** Read statuses, consent, route, and tables from the Host and publish them. */
  private async read(): Promise<void> {
    const remote = this.ctx.remote.pluginI18n
    const [statuses, consent, route] = await Promise.all([remote.statuses(), remote.consent(), remote.route()])
    if (this.disposed) return
    if (!statuses.ok) throw statuses.error
    if (!consent.ok) throw consent.error
    this.store.set({
      ready: true,
      consent: consent.value,
      route: route.ok ? route.value : null,
      statuses: Object.fromEntries(statuses.value.map(status => [status.pkg, status])),
    })
    await this.loadTables()
    this.releaseSettled(statuses.value)
    this.publishTitles()
  }

  /** Register the stored text of the active locale; replaces what an earlier read registered. */
  private async loadTables(): Promise<void> {
    const locale = this.locale()
    const result = await this.ctx.remote.pluginI18n.tables(locale)
    if (!result.ok || this.disposed || locale !== this.locale()) return
    this.dropTables()
    for (const pkg of Object.values(result.value.packages)) {
      for (const [ns, entries] of Object.entries(pkg.entries)) {
        this.disposers.push(this.ctx.locale.registerGenerated(ns, locale, { from: pkg.sourceLocale, entries }))
      }
    }
    for (const [text, translation] of Object.entries(result.value.strings)) this.cache.set(text, translation)
  }

  private dropTables(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  private releaseSettled(statuses: readonly PluginI18nStatus[]): void {
    for (const status of statuses) {
      const job = status.job
      if (job === null || job.state === 'running') continue
      const key = `${job.pkg}\n${job.locale}`
      for (const resolve of this.settledJobs.get(key) ?? []) resolve(job)
      this.settledJobs.delete(key)
    }
  }

  private makeView(): TitleView {
    return {
      display: (text) => {
        const translation = this.cache.get(text)
        return translation !== undefined && titlesAllowed(this.getSnapshot().consent) ? translation : text
      },
      request: (text) => { this.requestTitle(text) },
    }
  }

  private publishTitles(): void {
    this.view = this.makeView()
    for (const listener of [...this.titleListeners]) listener()
  }

  /** Queue a foreign-script string for translation, once per string and locale. */
  private requestTitle(text: string): void {
    if (this.disposed || this.cache.has(text) || this.requested.has(text)) return
    if (!titlesAllowed(this.getSnapshot().consent) || !mismatchesLocale(text, this.locale())) return
    this.requested.add(text)
    this.queue.add(text)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flushTitles() }, TITLE_DEBOUNCE_MS)
  }

  /** Send queued strings in batches; strings without a translation are not asked for again. */
  private async flushTitles(): Promise<void> {
    const locale = this.locale()
    const batch = [...this.queue].slice(0, TITLE_BATCH)
    for (const text of batch) this.queue.delete(text)
    if (this.queue.size > 0) this.timer = setTimeout(() => { void this.flushTitles() }, TITLE_DEBOUNCE_MS)
    if (batch.length === 0) return
    const result = await this.ctx.remote.pluginI18n.translateStrings(batch, locale)
    if (this.disposed || locale !== this.locale()) return
    if (!result.ok) {
      this.ctx.logger.warn(result.error)
      return
    }
    for (const [text, translation] of Object.entries(result.value)) this.cache.set(text, translation)
    this.publishTitles()
  }
}
