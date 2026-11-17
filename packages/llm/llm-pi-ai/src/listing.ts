/**
 * Runtime model listings for routes whose endpoint, not configuration, decides
 * which models they serve (`modelListing` on a provider profile).
 *
 * One {@link RouteModelListings} instance belongs to one plugin instance. It
 * keeps the latest successful listing per route together with a fingerprint of
 * the endpoint and credential that produced it, so a changed key or endpoint
 * (sign-in, sign-out, a new deployment) is never answered from another
 * account's listing. Only a listing whose models changed is published, and
 * only after it is stored.
 *
 * @module jan-llm-pi-ai/listing
 */

import { createHash } from 'node:crypto'

import { LlmError } from '@janhq/jan-llm'
import type { LlmDiscoveredModel } from '@janhq/jan-llm'
import { deepEqualJson } from '@janhq/jan-util-values'
import type { ResolvedPiAiModelListing, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'

/** A listing route's profile: one that carries resolved listing settings. */
export type ListingProfile = ResolvedPiAiProviderProfile & { modelListing: ResolvedPiAiModelListing }

/** Where and as whom one route's listing is requested. */
export interface ListingTarget {
  /** The route's endpoint. */
  baseURL: string
  /** The route's credential, or undefined when it names none. */
  apiKey: string | undefined
}

/** Host-owned inputs of {@link RouteModelListings}. */
export interface RouteModelListingsOptions {
  /**
   * Resolve one route's endpoint and credential. Rejects with `LlmError`
   * `MISSING_CREDENTIAL` while the route's credential or endpoint is unset.
   */
  target: (provider: string, profile: ListingProfile) => Promise<ListingTarget>
  /** Observe a held listing whose models differ from the one it replaced, fetched, stored, or dropped. */
  onChange: (provider: string) => void
  /** Observe every successful fetch, changed or not, after it is held. */
  onFetched: (provider: string, models: readonly LlmDiscoveredModel[]) => void
  /** Observe a failed refresh that kept the previous listing. */
  onStale: (provider: string, error: unknown) => void
  /** Observe a failed write to the attached {@link ListingStore}. */
  onPersistFailure: (provider: string, error: unknown) => void
  /** Aborts every in-flight request when the owning plugin unloads. */
  signal: AbortSignal
  /** Current time in milliseconds. */
  now?: () => number
}

/** One route's listing as a {@link ListingStore} keeps it across restarts. */
export interface PersistedListing {
  /** SHA-256 of the endpoint and credential the listing was fetched with. */
  fingerprint: string
  /** The listed models. */
  models: readonly LlmDiscoveredModel[]
  /** When the listing was fetched, in milliseconds since the epoch. */
  fetchedAt: number
}

/** Durable listing copies keyed by route; writes resolve once durable. */
export interface ListingStore {
  /** @returns every persisted listing with its route. */
  entries: () => Iterable<[string, PersistedListing]>
  /** Persist one route's listing, replacing any earlier one. */
  save: (provider: string, listing: PersistedListing) => Promise<void>
  /** Forget one route's listing. */
  remove: (provider: string) => Promise<void>
}

/** One route's stored listing. */
interface StoredListing extends PersistedListing {
  /** When the listing was last fetched or last failed to refresh. */
  checkedAt: number
}

/**
 * Whether a profile takes its models from a runtime listing.
 * @param profile - a resolved provider profile.
 * @returns true when the profile sets `modelListing`.
 */
export function isListingProfile(profile: ResolvedPiAiProviderProfile): profile is ListingProfile {
  return profile.modelListing !== undefined
}

/** Fingerprint of one endpoint and credential; the credential itself is not retained. */
function fingerprintOf(target: ListingTarget): string {
  return createHash('sha256').update(`${target.baseURL}\0${target.apiKey ?? ''}`).digest('hex')
}

/** Stored model listings for every listing route of one plugin instance. */
export class RouteModelListings {
  private readonly stored = new Map<string, StoredListing>()
  /** One running request per route; `done` resolves false when a later state superseded it. */
  private readonly inflight = new Map<string, { fingerprint: string; done: Promise<boolean> }>()
  /** The last failed request per route without a listing for its endpoint and credential. */
  private readonly failed = new Map<string, { fingerprint: string; at: number }>()
  private readonly now: () => number
  private version = 0
  private store: ListingStore | undefined

  constructor(private readonly options: RouteModelListingsOptions) {
    this.now = options.now ?? Date.now
  }

  /**
   * Keep listings in `store` from now on. A persisted listing is adopted for
   * a route that holds none yet, with its fetch time, so it is served until
   * a request replaces it; listings already held are written to the store.
   * @param store - the durable store to read and write.
   */
  attach(store: ListingStore): void {
    const persisted = new Map(store.entries())
    this.store = store
    for (const [provider, listing] of persisted) {
      if (this.stored.has(provider)) continue
      this.stored.set(provider, { ...listing, checkedAt: listing.fetchedAt })
      this.version += 1
      this.options.onChange(provider)
    }
    for (const [provider, { fingerprint, models, fetchedAt }] of this.stored) {
      if (persisted.get(provider)?.fetchedAt !== fetchedAt) this.persist(provider, { fingerprint, models, fetchedAt })
    }
  }

  /** Stop writing to the attached store; listings already held stay. */
  detach(): void {
    this.store = undefined
  }

  /** Incremented whenever {@link snapshot} changes; used to memoize resolved profiles. */
  get generation(): number {
    return this.version
  }

  /**
   * The latest listing per route.
   * @returns a detached map of route to listed models.
   */
  snapshot(): ReadonlyMap<string, readonly LlmDiscoveredModel[]> {
    return new Map([...this.stored].map(([provider, listing]) => [provider, listing.models]))
  }

  /**
   * Make sure one route's listing is current. A listing fetched with the same
   * endpoint and credential within `refreshIntervalMs` is kept without a
   * request unless `force` is set, and so is an older one while a request for
   * the same endpoint and credential is already running; concurrent callers
   * share one request. A caller whose request is superseded by a sign-out or
   * another credential settles against that newer state.
   * @param provider - the listing route.
   * @param profile - the route's resolved profile.
   * @param force - fetch even when the stored listing is fresh.
   * @throws LlmError `MISSING_CREDENTIAL` while the route cannot authenticate,
   *   which also drops its stored listing; `DISCOVERY_FAILED` when the request
   *   fails and no listing for the same endpoint and credential is stored.
   */
  async ensure(provider: string, profile: ListingProfile, force = false): Promise<void> {
    let target: ListingTarget
    try {
      target = await this.options.target(provider, profile)
    } catch (error) {
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') this.drop(provider)
      throw error
    }
    const fingerprint = fingerprintOf(target)
    const current = this.stored.get(provider)
    const pending = this.inflight.get(provider)
    if (!force && current?.fingerprint === fingerprint && (
      this.now() - current.checkedAt < profile.modelListing.refreshIntervalMs
      // A refresh for this account is running: serve its last listing meanwhile.
      || pending?.fingerprint === fingerprint
    )) return
    let request = pending
    if (request?.fingerprint !== fingerprint) {
      const started = { fingerprint, done: Promise.resolve(false) }
      started.done = this.fetch(provider, profile, target, () => this.inflight.get(provider) !== started)
        .finally(() => { if (this.inflight.get(provider) === started) this.inflight.delete(provider) })
      this.inflight.set(provider, started)
      request = started
    }
    if (await request.done) return
    await this.ensure(provider, profile, force)
  }

  /**
   * Whether a listing fetched with the route's current endpoint and
   * credential is held, without waiting for the network. When that listing is
   * missing or stale, a refresh starts in the background, unless a request
   * for the same endpoint and credential failed within `refreshIntervalMs`
   * and no listing is held.
   * @param provider - the listing route.
   * @param profile - the route's resolved profile.
   * @returns true when the held listing belongs to the current endpoint and credential.
   */
  async holds(provider: string, profile: ListingProfile): Promise<boolean> {
    let target: ListingTarget
    try {
      target = await this.options.target(provider, profile)
    } catch (error) {
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') this.drop(provider)
      return false
    }
    const fingerprint = fingerprintOf(target)
    const current = this.stored.get(provider)
    const interval = profile.modelListing.refreshIntervalMs
    const failed = this.failed.get(provider)
    const backingOff = current?.fingerprint !== fingerprint
      && failed?.fingerprint === fingerprint && this.now() - failed.at < interval
    if (!backingOff && (current?.fingerprint !== fingerprint || this.now() - current.checkedAt >= interval)) {
      this.ensure(provider, profile).catch((_reportedByListModels: unknown) => {
        // A model listing read reports this failure; this caller never waits for it.
      })
    }
    return current?.fingerprint === fingerprint
  }

  /**
   * Forget one route's listing and settle its running request, publishing the
   * change and deleting the persisted copy when a listing was held.
   * @param provider - the listing route.
   */
  drop(provider: string): void {
    this.inflight.delete(provider)
    if (!this.stored.delete(provider)) return
    this.persist(provider, undefined)
    this.version += 1
    this.options.onChange(provider)
  }

  /** Write or remove one route's persisted listing; a failure is reported, never thrown. */
  private persist(provider: string, listing: PersistedListing | undefined): void {
    const store = this.store
    if (store === undefined) return
    const write = listing === undefined ? store.remove(provider) : store.save(provider, listing)
    write.catch((error: unknown) => { this.options.onPersistFailure(provider, error) })
  }

  /**
   * Run one listing request and store its result.
   * @param superseded - whether the route was dropped or another request
   *   started since this one, which then stores nothing.
   * @returns false when superseded, true once this request settled the route.
   */
  private async fetch(
    provider: string,
    profile: ListingProfile,
    target: ListingTarget,
    superseded: () => boolean,
  ): Promise<boolean> {
    const fingerprint = fingerprintOf(target)
    const timeout = AbortSignal.timeout(profile.modelListing.timeoutMs)
    let models: readonly LlmDiscoveredModel[]
    try {
      models = await discoverModels(
        {
          baseURL: target.baseURL,
          api: profile.modelListing.api,
          signal: AbortSignal.any([timeout, this.options.signal]),
        },
        () => ({ headers: profile.headers, resolveApiKey: () => Promise.resolve(target.apiKey) }),
      )
    } catch (error) {
      if (superseded()) return false
      const failure = timeout.aborted && !this.options.signal.aborted
        ? new LlmError(
          `${target.baseURL} did not list its models within ${String(profile.modelListing.timeoutMs)} ms`,
          'DISCOVERY_FAILED', { cause: error },
        )
        : error
      const current = this.stored.get(provider)
      if (current?.fingerprint !== fingerprint || this.options.signal.aborted) {
        this.failed.set(provider, { fingerprint, at: this.now() })
        throw failure
      }
      // A transient failure keeps serving the listing this account last
      // fetched; the next attempt waits for the refresh interval.
      current.checkedAt = this.now()
      this.options.onStale(provider, failure)
      return true
    }
    if (superseded()) return false
    const previous = this.stored.get(provider)
    const fetchedAt = this.now()
    this.failed.delete(provider)
    this.stored.set(provider, { fingerprint, models, fetchedAt, checkedAt: fetchedAt })
    this.persist(provider, { fingerprint, models, fetchedAt })
    this.options.onFetched(provider, models)
    if (previous !== undefined && deepEqualJson(previous.models, models)) return true
    this.version += 1
    this.options.onChange(provider)
    return true
  }
}
