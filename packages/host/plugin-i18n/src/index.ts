/**
 * Host service that translates plugin UI text with the user's chosen or default model, keeps the results in a file
 * cache, and serves them to clients over the `pluginI18n` Remote.
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { MAX_TIMER_DELAY_MS } from '@janhq/jan-timeout'
import { Remote, RemoteError, TypertRemoteService } from '@janhq/jan-typert-protocol'
// Type-only: the root `janHomePath` resolver merge.
import type {} from '@janhq/jan-app-boot'
import { modelCall } from './model.ts'
import { chooseRoute, routeChoices } from './route.ts'
import { hashSources, I18nStore, pairEntries } from './store.ts'
import { splitEntries, translateEntries, type ModelCall } from './translate.ts'
import type {
  PluginI18nChange, PluginI18nConsent, PluginI18nConsentChange, PluginI18nEntries, PluginI18nJob, PluginI18nPackageTables,
  PluginI18nRoute, PluginI18nRouteChoices, PluginI18nRouteRef, PluginI18nRuntimeStatus, PluginI18nStatus, PluginI18nTables,
  PluginI18nTranslateRequest,
} from './types.ts'

export type * from './types.ts'
export { checkTranslation, placeholdersOf, type TranslationProblem } from './check.ts'
export { parseReply, splitEntries, translateEntries, type BatchResult, type ModelCall } from './translate.ts'
export { hashSources, I18nStore } from './store.ts'

declare module '@janhq/cordis' {
  interface Context {
    /** Plugin text translation service: generated tables, runtime strings, and consent. */
    pluginI18n: PluginI18n
  }
}

/** Limits and location of the translation service. */
export interface Config {
  /** Cache directory; absent means `plugin-i18n` under the Jan home. */
  dir?: string
  /** Most entries one translate request may carry. */
  maxEntries: number
  /** Most UTF-8 bytes of source text one translate request may carry. */
  maxSourceBytes: number
  /** Most entries in one model call. */
  batchEntries: number
  /** Most source bytes in one model call. */
  batchBytes: number
  /** Output-token cap of one model call. */
  maxOutputTokens: number
  /** Deadline of one model call in milliseconds. */
  timeoutMs: number
  /** Runtime strings kept per locale; the oldest are dropped beyond it. */
  maxStrings: number
  /** Longest runtime string sent to the model, in characters; longer strings stay as written. */
  maxStringLength: number
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const LOCALE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
const MAX_PACKAGE_NAME = 214

/** The job a package and locale share. */
const jobKey = (pkg: string, locale: string): string => `${pkg}\n${locale}`

/** Cancellation reason of a job superseded by `clear`. */
const CLEARED = new Error('Translation cleared')

interface RunningJob {
  job: PluginI18nJob
  readonly abort: AbortController
}

/** Translates plugin text and serves the cached results. */
export default class PluginI18n extends TypertRemoteService {
  static inject = ['llm', 'agentDefaultModel']

  static Config = z.object({
    dir: z.string(),
    maxEntries: z.natural().min(1).default(2000),
    maxSourceBytes: z.natural().min(1).default(256 * 1024),
    batchEntries: z.natural().min(1).default(40),
    batchBytes: z.natural().min(1).default(8 * 1024),
    maxOutputTokens: z.natural().min(1).default(8192),
    timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
    maxStrings: z.natural().min(1).default(5000),
    maxStringLength: z.natural().min(1).default(400),
  })

  private readonly store: I18nStore
  private readonly lifetime = new AbortController()
  private readonly running = new Map<string, RunningJob>()
  private readonly latest = new Map<string, PluginI18nJob>()
  private readonly pending = new Set<Promise<void>>()
  private readonly strings = new Map<string, Record<string, string>>()
  /** Strings the model could not translate acceptably; they are not sent again until the Host restarts. */
  private readonly refused = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pluginI18n')
    const dir = config.dir ?? ctx.janHomePath?.('plugin-i18n')
    if (dir === undefined || !isAbsolute(dir)) throw new Error('plugin-i18n: dir must be an absolute path when the Jan home is unavailable')
    this.store = new I18nStore(dir)
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Plugin i18n disposed'))
      await Promise.allSettled([...this.pending, this.queue])
    })
  }

  /**
   * Read the model translations run on: the person's saved pick, else the default model, else a loaded local model,
   * else any configured model, whichever resolves first.
   * @returns the provider, model, and why it was chosen.
   */
  @Remote
  async route(): Promise<PluginI18nRoute> {
    return chooseRoute(this.ctx, await this.store.readRoute())
  }

  /**
   * Read what the model picker shows: the route in use, the saved pick, the default model, and the models to pick.
   * @returns the route choices.
   */
  @Remote
  async routes(): Promise<PluginI18nRouteChoices> {
    return routeChoices(this.ctx, await this.store.readRoute())
  }

  /**
   * Save the model translations run on until changed again, or follow the default model again.
   * @param route - the provider and model to use, or null to follow the default model.
   * @returns the route choices after the change.
   * @throws {RemoteError} `plugin-i18n/invalid-route` when no adapter serves the provider or the model is empty.
   */
  @Remote
  async setRoute(route: PluginI18nRouteRef | null): Promise<PluginI18nRouteChoices> {
    if (route !== null && (route.model === '' || !this.ctx.llm.listProviders().some(provider => provider.id === route.provider))) {
      throw new RemoteError('plugin-i18n/invalid-route', `"${route.provider}/${route.model}" is not a model of a registered provider`, {
        provider: route.provider, model: route.model,
      })
    }
    await this.serial(() => this.store.writeRoute(route))
    this.changed({})
    return this.routes()
  }

  /**
   * Read what is stored and running for one package.
   * @param pkg - npm package name.
   * @returns stored locales, the latest job, and whether the person consented to this package.
   * @throws {RemoteError} `plugin-i18n/invalid-package`.
   */
  @Remote
  async status(pkg: string): Promise<PluginI18nStatus> {
    assertPackage(pkg)
    return this.statusOf(pkg, await this.store.readConsent())
  }

  /**
   * Read the status of every package that has stored text, a job, or consent.
   * @returns one status per package, sorted by name.
   */
  @Remote
  async statuses(): Promise<PluginI18nStatus[]> {
    const consent = await this.store.readConsent()
    const names = new Set([
      ...await this.store.listPackages(), ...await this.store.listRuntimePackages(),
      ...[...this.latest.values()].map(job => job.pkg), ...consent.packages,
    ])
    return Promise.all([...names].toSorted().map(pkg => this.statusOf(pkg, consent)))
  }

  /**
   * Start translating one package's text into one locale in the Host, so closing the page does not cancel it. Asking
   * is the person's consent for the package. Entries unchanged since the last run are reused. A job already running
   * for the package and locale is returned instead of starting another.
   * @param request - package, locales, and the text to translate.
   * @returns the running job; `plugin-i18n/changed` announces progress and completion.
   * @throws {RemoteError} `plugin-i18n/invalid-package`, `plugin-i18n/invalid-locale`, or `plugin-i18n/too-large`.
   */
  @Remote
  async translate(request: PluginI18nTranslateRequest): Promise<PluginI18nJob> {
    assertPackage(request.pkg)
    assertLocale(request.locale)
    assertLocale(request.sourceLocale)
    const entries = Object.values(request.sources).flatMap(keys => Object.values(keys))
    const bytes = entries.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0)
    if (entries.length > this.config.maxEntries || bytes > this.config.maxSourceBytes) {
      throw new RemoteError('plugin-i18n/too-large', `Plugin text has ${String(entries.length)} entries and ${String(bytes)} bytes; the limits are ${String(this.config.maxEntries)} and ${String(this.config.maxSourceBytes)}`, {
        entries: entries.length, bytes, maxEntries: this.config.maxEntries, maxBytes: this.config.maxSourceBytes,
      })
    }
    const key = jobKey(request.pkg, request.locale)
    const existing = this.running.get(key)
    if (existing !== undefined) return existing.job
    await this.setPackageConsent(request.pkg, true)
    const running: RunningJob = {
      job: { pkg: request.pkg, locale: request.locale, state: 'running', done: 0, total: entries.length },
      abort: new AbortController(),
    }
    this.running.set(key, running)
    this.latest.set(key, running.job)
    const work = this.run(request, running).finally(() => {
      this.pending.delete(work)
      if (this.running.get(key) === running) this.running.delete(key)
    })
    this.pending.add(work)
    this.changed({ pkg: request.pkg, locale: request.locale })
    return running.job
  }

  /**
   * Delete a package's generated text and consent and stop its running jobs.
   * @param pkg - npm package name.
   * @throws {RemoteError} `plugin-i18n/invalid-package`.
   */
  @Remote
  async clear(pkg: string): Promise<void> {
    assertPackage(pkg)
    for (const [key, running] of this.running) {
      if (running.job.pkg !== pkg) continue
      running.abort.abort(CLEARED)
      this.running.delete(key)
    }
    for (const [key, job] of this.latest) if (job.pkg === pkg) this.latest.delete(key)
    await this.store.clearPackage(pkg)
    await this.serial(() => this.dropRuntime(pkg))
    await this.setPackageConsent(pkg, false)
    this.changed({ pkg })
  }

  /**
   * Translate runtime strings such as tool titles or text a plugin renders itself, caching each result by its exact
   * source text. Strings leave the Host only when the person consented to a package or globally; strings attributed
   * to a package need that package's own consent, which the global switch does not give. A string the model could
   * not translate acceptably is absent from the result.
   * @param strings - exact source texts.
   * @param locale - target locale.
   * @param pkg - the package whose screen text this is; its translated strings are listed under it.
   * @param rerun - translate the strings again even when the cache has them; a string the model fails keeps its old translation.
   * @returns translations by exact source text.
   * @throws {RemoteError} `plugin-i18n/invalid-locale`, `plugin-i18n/invalid-package`, `plugin-i18n/not-consented`, or
   * `plugin-i18n/model-failed`.
   */
  @Remote
  async translateStrings(strings: string[], locale: string, pkg?: string, rerun?: boolean): Promise<Record<string, string>> {
    assertLocale(locale)
    if (pkg !== undefined) assertPackage(pkg)
    const consent = await this.store.readConsent()
    const allowed = pkg === undefined ? titlesAllowed(consent) : consent.packages.includes(pkg)
    if (!allowed) throw new RemoteError('plugin-i18n/not-consented', 'Translating plugin text needs consent', {})
    const wanted = [...new Set(strings.filter(text => text.trim() !== '' && text.length <= this.config.maxStringLength))]
      .slice(0, this.config.maxEntries)
    await this.serial(async () => {
      await this.translateMissing(wanted, locale, rerun === true)
      if (pkg !== undefined) await this.listRuntime(pkg, locale, wanted)
    })
    const cache = await this.stringsOf(locale)
    return Object.fromEntries(wanted.flatMap(text => cache[text] === undefined ? [] : [[text, cache[text]]]))
  }

  /**
   * Read everything a client registers at start-up for one locale.
   * @param locale - target locale.
   * @returns each package's generated text and, when titles may be translated, the runtime strings.
   * @throws {RemoteError} `plugin-i18n/invalid-locale`.
   */
  @Remote
  async tables(locale: string): Promise<PluginI18nTables> {
    assertLocale(locale)
    const packages: Record<string, PluginI18nPackageTables> = {}
    for (const pkg of await this.store.listPackages()) {
      const file = await this.store.readLocale(pkg, locale)
      if (file !== undefined) packages[pkg] = { sourceLocale: file.sourceLocale, entries: file.entries }
    }
    const allowed = titlesAllowed(await this.store.readConsent())
    const strings = allowed ? await this.stringsOf(locale) : {}
    const runtime: Record<string, string[]> = {}
    if (allowed) {
      for (const pkg of await this.store.listRuntimePackages()) {
        const listed = await this.store.readRuntime(pkg, locale)
        if (listed.length > 0) runtime[pkg] = listed
      }
    }
    return { locale, packages, strings, runtime }
  }

  /**
   * Read the consent record.
   * @returns the global switch and the consenting packages.
   */
  @Remote
  async consent(): Promise<PluginI18nConsent> {
    return this.store.readConsent()
  }

  /**
   * Change the consent record.
   * @param change - one package, or the global switch when `pkg` is absent.
   * @returns the record after the change.
   * @throws {RemoteError} `plugin-i18n/invalid-package`.
   */
  @Remote
  async setConsent(change: PluginI18nConsentChange): Promise<PluginI18nConsent> {
    if (change.pkg === undefined) {
      const next = await this.serial(async () => {
        const current = await this.store.readConsent()
        const record = { ...current, global: change.allowed }
        await this.store.writeConsent(record)
        return record
      })
      this.changed({})
      return next
    }
    assertPackage(change.pkg)
    const next = await this.setPackageConsent(change.pkg, change.allowed)
    this.changed({ pkg: change.pkg })
    return next
  }

  /** Run `work` after every earlier serialized task, whether or not they failed. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => {})
    return result
  }

  private setPackageConsent(pkg: string, allowed: boolean): Promise<PluginI18nConsent> {
    return this.serial(async () => {
      const current = await this.store.readConsent()
      const packages = allowed ? [...new Set([...current.packages, pkg])] : current.packages.filter(name => name !== pkg)
      const record = { ...current, packages: packages.toSorted() }
      await this.store.writeConsent(record)
      return record
    })
  }

  private changed(change: PluginI18nChange): void {
    this.ctx.emit('plugin-i18n/changed', change)
  }

  private async statusOf(pkg: string, consent: PluginI18nConsent): Promise<PluginI18nStatus> {
    const files = await this.store.listLocales(pkg)
    const jobs = [...this.latest.values()].filter(job => job.pkg === pkg)
    const runtime: PluginI18nRuntimeStatus[] = []
    for (const locale of await this.store.listRuntimeLocales(pkg)) {
      const cache = await this.stringsOf(locale)
      const strings = (await this.store.readRuntime(pkg, locale)).filter(text => cache[text] !== undefined).length
      if (strings > 0) runtime.push({ locale, strings })
    }
    return {
      pkg,
      locales: files.map(file => ({
        locale: file.locale,
        sourceLocale: file.sourceLocale,
        model: file.model,
        generatedAt: file.generatedAt,
        namespaces: Object.keys(file.entries).toSorted(),
        entries: Object.values(file.entries).reduce((sum, keys) => sum + Object.keys(keys).length, 0),
        kept: file.kept,
      })),
      runtime,
      job: jobs.at(-1) ?? null,
      consented: consent.packages.includes(pkg),
    }
  }

  /** Run one job to its end, recording the outcome on the job. */
  private async run(request: PluginI18nTranslateRequest, running: RunningJob): Promise<void> {
    const { pkg, locale } = request
    const signal = AbortSignal.any([this.lifetime.signal, running.abort.signal])
    const key = jobKey(pkg, locale)
    const settle = (patch: Partial<PluginI18nJob>): void => {
      if (running.abort.signal.aborted) return
      running.job = { ...running.job, ...patch }
      this.latest.set(key, running.job)
      this.changed({ pkg, locale })
    }
    try {
      const previous = request.rerun === true ? undefined : await this.store.readLocale(pkg, locale)
      const reused: PluginI18nEntries = {}
      const todo: { ns: string; key: string; text: string }[] = []
      for (const [ns, keys] of Object.entries(request.sources)) {
        for (const [name, text] of Object.entries(keys)) {
          const cached = previous?.entries[ns]?.[name]
          if (cached !== undefined && cached.src === text) (reused[ns] ??= {})[name] = cached
          else todo.push({ ns, key: name, text })
        }
      }
      let done = running.job.total - todo.length
      settle({ done })
      const route = await chooseRoute(this.ctx, await this.store.readRoute())
      signal.throwIfAborted()
      const model = modelCall(this.ctx, this.config, signal, route)
      const fresh: Record<string, Record<string, string>> = {}
      const items = new Map<string, { ns: string; key: string }>()
      const texts: Record<string, string> = {}
      for (const [index, item] of todo.entries()) {
        const id = `${String(index)}:${item.ns}.${item.key}`
        items.set(id, item)
        texts[id] = item.text
      }
      for (const batch of splitEntries(texts, this.config.batchEntries, this.config.batchBytes)) {
        const result = await translateEntries(model, { sourceLocale: request.sourceLocale, locale, entries: batch })
        for (const [id, text] of Object.entries(result.translated)) {
          const item = items.get(id)
          if (item !== undefined) (fresh[item.ns] ??= {})[item.key] = text
        }
        done += Object.keys(batch).length
        settle({ done })
      }
      signal.throwIfAborted()
      const entries = mergeEntries(reused, pairEntries(request.sources, fresh))
      const total = Object.values(request.sources).reduce((sum, keys) => sum + Object.keys(keys).length, 0)
      const translated = Object.values(entries).reduce((sum, keys) => sum + Object.keys(keys).length, 0)
      await this.store.writeLocale({
        format: 1, pkg, locale, sourceLocale: request.sourceLocale, sourceHash: hashSources(request.sources),
        model: `${route.provider}/${route.model}`, generatedAt: Date.now(), kept: total - translated, entries,
      })
      settle({ state: 'done', done: running.job.total })
    } catch (error) {
      if (running.abort.signal.aborted) return
      settle({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  private async stringsOf(locale: string): Promise<Record<string, string>> {
    let cache = this.strings.get(locale)
    if (cache === undefined) {
      cache = await this.store.readStrings(locale)
      this.strings.set(locale, cache)
    }
    return cache
  }

  /**
   * Translate the strings the cache lacks, or all of them when forced, in model-sized batches and persist the cache.
   * Serialized by the caller.
   */
  private async translateMissing(wanted: readonly string[], locale: string, force = false): Promise<void> {
    const cache = await this.stringsOf(locale)
    const missing = wanted.filter(text => force || (cache[text] === undefined && !this.refused.has(`${locale}\n${text}`)))
    if (missing.length === 0) return
    const route = await chooseRoute(this.ctx, await this.store.readRoute())
    const model: ModelCall = modelCall(this.ctx, this.config, this.lifetime.signal, route)
    const identified = Object.fromEntries(missing.map((text, index) => [`s${String(index)}`, text]))
    try {
      for (const batch of splitEntries(identified, this.config.batchEntries, this.config.batchBytes)) {
        const result = await translateEntries(model, { locale, entries: batch })
        for (const [id, text] of Object.entries(result.translated)) cache[batch[id] as string] = text
        for (const id of result.kept) this.refused.add(`${locale}\n${batch[id] as string}`)
      }
    } catch (error) {
      throw modelFailed(error)
    }
    const overflow = Object.keys(cache).length - this.config.maxStrings
    if (overflow > 0) {
      const kept = Object.fromEntries(Object.entries(cache).slice(overflow))
      this.strings.set(locale, kept)
      await this.store.writeStrings(locale, kept)
      return
    }
    await this.store.writeStrings(locale, cache)
  }

  /** Record the translated strings among `wanted` as text `pkg` displayed. Serialized by the caller. */
  private async listRuntime(pkg: string, locale: string, wanted: readonly string[]): Promise<void> {
    const cache = await this.stringsOf(locale)
    const listed = await this.store.readRuntime(pkg, locale)
    const known = new Set(listed)
    const added = wanted.filter(text => cache[text] !== undefined && !known.has(text))
    if (added.length === 0) return
    await this.store.writeRuntime(pkg, locale, [...listed, ...added])
    this.changed({ pkg, locale })
  }

  /** Forget what `pkg` displayed, and drop the translations no other package displayed. Serialized by the caller. */
  private async dropRuntime(pkg: string): Promise<void> {
    const others = (await this.store.listRuntimePackages()).filter(name => name !== pkg)
    for (const locale of await this.store.listRuntimeLocales(pkg)) {
      const keep = new Set<string>()
      for (const other of others) for (const text of await this.store.readRuntime(other, locale)) keep.add(text)
      const cache = await this.stringsOf(locale)
      const mine = new Set((await this.store.readRuntime(pkg, locale)).filter(text => !keep.has(text) && cache[text] !== undefined))
      if (mine.size === 0) continue
      const kept = Object.fromEntries(Object.entries(cache).filter(([text]) => !mine.has(text)))
      this.strings.set(locale, kept)
      await this.store.writeStrings(locale, kept)
    }
    await this.store.clearRuntime(pkg)
  }
}

/** Wrap a model failure for the wire. */
function modelFailed(error: unknown): RemoteError<'plugin-i18n/model-failed'> {
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError('plugin-i18n/model-failed', `Translation failed: ${reason}`, { reason })
}

/** Whether tool titles and other runtime strings may be sent to the model. */
function titlesAllowed(consent: PluginI18nConsent): boolean {
  return consent.global || consent.packages.length > 0
}

/** Merge two entry sets, the second overriding the first. */
function mergeEntries(base: PluginI18nEntries, over: PluginI18nEntries): PluginI18nEntries {
  const merged: PluginI18nEntries = {}
  for (const source of [base, over]) {
    for (const [ns, keys] of Object.entries(source)) merged[ns] = { ...merged[ns], ...keys }
  }
  return merged
}

function assertPackage(pkg: string): void {
  if (pkg.length > MAX_PACKAGE_NAME || !PACKAGE_NAME.test(pkg)) {
    throw new RemoteError('plugin-i18n/invalid-package', `"${pkg}" is not a valid npm package name`, { pkg })
  }
}

function assertLocale(locale: string): void {
  if (!LOCALE_TAG.test(locale)) throw new RemoteError('plugin-i18n/invalid-locale', `"${locale}" is not a locale tag`, { locale })
}
