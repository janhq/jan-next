/**
 * Durable copies of runtime model listings, kept through the optional
 * `storageDomain` service so a listing route serves its last listing from the
 * first read after a restart, including while its endpoint is unreachable.
 *
 * Each record holds the route's listed models, when they were fetched, and the
 * SHA-256 fingerprint of the endpoint and credential that fetched them; the
 * credential itself is never stored. `@janhq/jan-storage-domain` is loaded
 * only once the service is mounted, so compositions without storage need not
 * install it.
 *
 * @module jan-llm-pi-ai/listing-store
 */

import { z } from 'zod'
import type { DomainFacility } from '@janhq/jan-storage-domain'
import type { ListingStore, PersistedListing } from './listing.ts'

/** Domain name; one plugin instance per process opens it. */
const DOMAIN_NAME = 'llm_pi_ai_model_listings'

const persistedListingSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  fetchedAt: z.number().int().nonnegative(),
  models: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    inputModalities: z.array(z.enum(['text', 'image'])).optional(),
  })),
}).transform((record): PersistedListing => ({
  fingerprint: record.fingerprint,
  fetchedAt: record.fetchedAt,
  // Absent optional fields stay absent rather than becoming `undefined`.
  models: record.models.map(model => ({
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { inputModalities: model.inputModalities },
  })),
}))

/** An open listing store and the release of its domain handle. */
export interface OpenedListingStore {
  /** The store backed by the open domain. */
  store: ListingStore
  /** Release the domain handle. */
  close: () => Promise<void>
}

/**
 * Open the listing domain.
 * @param facility - the mounted `storageDomain` service.
 * @returns the store and its release.
 * @throws DomainError when the domain is already open or a stored record is invalid.
 */
export async function openListingStore(facility: DomainFacility): Promise<OpenedListingStore> {
  const { defineDomain, domainTable } = await import('@janhq/jan-storage-domain')
  const spec = defineDomain({
    name: DOMAIN_NAME,
    version: 1,
    tables: { listings: domainTable<string, PersistedListing>(persistedListingSchema) },
  })
  const domain = await facility.open(spec)
  const table = domain.table('listings')
  return {
    store: {
      entries: () => table.entries(),
      save: (provider, listing) => table.put(provider, listing),
      remove: async (provider) => { await table.delete(provider) },
    },
    close: () => domain.close(),
  }
}
