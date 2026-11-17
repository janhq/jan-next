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
  /** Observe a stored listing whose models differ from the one it replaced. */
  onChange: (provider: string, models: readonly LlmDiscoveredModel[]) => void
  /** Observe a failed refresh that kept the previous listing. */
  onStale: (provider: string, error: unknown) => void
  /** Aborts every in-flight request when the owning plugin unloads. */
  signal: AbortSignal
  /** Current time in milliseconds. */
  now?: () => number
}

/** One route's stored listing. */
interface StoredListing {
  /** Hash of the endpoint and credential the listing was fetched with. */
  fingerprint: string
  models: readonly LlmDiscoveredModel[]
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
  private readonly inflight = new Map<string, { fingerprint: string; done: Promise<void> }>()
  private readonly now: () => number
  private version = 0

  constructor(private readonly options: RouteModelListingsOptions) {
    this.now = options.now ?? Date.now
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
   * request unless `force` is set; concurrent callers share one request.
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
    if (!force && current?.fingerprint === fingerprint
      && this.now() - current.checkedAt < profile.modelListing.refreshIntervalMs) return
    const pending = this.inflight.get(provider)
    if (pending?.fingerprint === fingerprint) return pending.done
    const done = this.fetch(provider, profile, target, fingerprint)
      .finally(() => { if (this.inflight.get(provider)?.done === done) this.inflight.delete(provider) })
    this.inflight.set(provider, { fingerprint, done })
    return done
  }

  /** Forget one route's listing, publishing the change when one was stored. */
  drop(provider: string): void {
    this.inflight.delete(provider)
    if (!this.stored.delete(provider)) return
    this.version += 1
    this.options.onChange(provider, [])
  }

  /**
   * Whether a request for `fingerprint` no longer owns the route's result:
   * the route was dropped, or a request for another endpoint or credential
   * started since.
   */
  private superseded(provider: string, fingerprint: string): boolean {
    return this.inflight.get(provider)?.fingerprint !== fingerprint
  }

  private async fetch(provider: string, profile: ListingProfile, target: ListingTarget, fingerprint: string): Promise<void> {
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
      if (this.superseded(provider, fingerprint)) return
      const failure = timeout.aborted && !this.options.signal.aborted
        ? new LlmError(
          `${target.baseURL} did not list its models within ${String(profile.modelListing.timeoutMs)} ms`,
          'DISCOVERY_FAILED', { cause: error },
        )
        : error
      const current = this.stored.get(provider)
      if (current?.fingerprint !== fingerprint || this.options.signal.aborted) throw failure
      // A transient failure keeps serving the listing this account last
      // fetched; the next attempt waits for the refresh interval.
      current.checkedAt = this.now()
      this.options.onStale(provider, failure)
      return
    }
    if (this.superseded(provider, fingerprint)) return
    const previous = this.stored.get(provider)
    this.stored.set(provider, { fingerprint, models, checkedAt: this.now() })
    if (previous !== undefined && deepEqualJson(previous.models, models)) return
    this.version += 1
    this.options.onChange(provider, models)
  }
}
