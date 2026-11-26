/**
 * One ranking for every model list the user reads: the composer picker, its
 * search, and the `/model` argument suggestions. Starred models come first,
 * then the models this person used most recently, then each provider's
 * remaining models. Without a query a provider lists its families in name
 * order with the newest version first; while searching, the newest version
 * leads across families, so `opus` finds `claude-opus-5-5` above
 * `claude-opus-4-6`.
 */
import type { ModelCatalogModel } from '@janhq/jan-api-session-controller/types'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { compareModelNames, compareNewest } from './model-order.ts'

/**
 * `provider/model` identity shared by favorites and recents.
 * @param provider - provider id.
 * @param model - model id within the provider.
 * @returns the joined key.
 */
export const modelKey = (provider: string, model: string): string => `${provider}/${model}`

/**
 * Starred models, as `provider/model` keys in the order they were starred. Shared
 * by every seat and kept across restarts; a starred model that leaves the
 * catalog stays starred and returns to Favorites when it comes back.
 */
export const favoriteStore = createSnapshotStore<readonly string[]>([], { persist: { name: 'jan.models.favorites' } })

/**
 * Star or unstar one model.
 * @param key - `provider/model` key.
 */
export function toggleFavorite(key: string): void {
  const keys = favoriteStore.getSnapshot()
  favoriteStore.set(keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key])
}

/** How many models the recents store remembers. */
const RECENT_KEEP = 8

/** Recently selected models, most recent first; shared by every seat and kept across restarts. */
export const recentStore = createSnapshotStore<readonly string[]>([], { persist: { name: 'jan.models.recent' } })

/** Recently used models listed above the providers while the search is empty. */
export const RECENT_ROWS = 3

/**
 * Move one model to the front of the recents.
 * @param key - `provider/model` key.
 */
export function recordRecent(key: string): void {
  const keys = recentStore.getSnapshot()
  if (keys[0] === key) return
  recentStore.set([key, ...keys.filter(item => item !== key)].slice(0, RECENT_KEEP))
}

/**
 * Display names for one provider's models: a router name such as
 * `anthropic/claude-opus-5-5` drops its vendor prefix unless that would make
 * two rows read the same.
 * @param models - one provider's models.
 * @returns display name by model id.
 */
export function displayNames(models: readonly ModelCatalogModel[]): Map<string, string> {
  const short = (name: string): string => name.slice(name.lastIndexOf('/') + 1) || name
  const counts = new Map<string, number>()
  for (const model of models) counts.set(short(model.name), (counts.get(short(model.name)) ?? 0) + 1)
  return new Map(models.map(model => [model.id, counts.get(short(model.name)) === 1 ? short(model.name) : model.name]))
}

/**
 * Lowercase, with `-`, `_`, `.`, `/` and whitespace runs folded to one space.
 * @param text - raw text.
 * @returns the normalized text.
 */
export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/[\s\-_./]+/g, ' ').trim()
}

/**
 * Split a query into normalized words.
 * @param query - raw query.
 * @returns the normalized words; none for a blank query.
 */
export function searchWords(query: string): string[] {
  const normalized = normalizeSearch(query)
  return normalized === '' ? [] : normalized.split(' ')
}

/** A provider's models with their display label. */
export interface RankedGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
  label(model: ModelCatalogModel): string
}

/** One listed model. */
export interface RankedRow<G extends RankedGroup> {
  readonly group: G
  readonly model: ModelCatalogModel
}

/** One heading of the ranked list; Favorites and Recent carry no provider name. */
export interface RankedSection<G extends RankedGroup> {
  readonly key: string
  readonly kind: 'favorites' | 'recent' | 'provider'
  /** Provider name for a provider section; empty for Favorites and Recent. */
  readonly name: string
  readonly rows: readonly RankedRow<G>[]
}

/** What the ranking reads besides the catalog. */
export interface RankOptions {
  /** Starred keys in starring order. */
  readonly favorites: readonly string[]
  /** Recently used keys, most recent first. */
  readonly recents: readonly string[]
  /** Typed text; a model matches when its name contains every word as one run. */
  readonly query: string
  /** Recent rows shown without a query; a search shows every recent match. */
  readonly recentLimit: number
}

/**
 * Rank a catalog for display.
 * @param groups - providers in catalog order.
 * @param options - favorites, recents, the query and the recent cap.
 * @returns the non-empty sections; each model appears once.
 */
export function rankModels<G extends RankedGroup>(groups: readonly G[], options: RankOptions): RankedSection<G>[] {
  const words = searchWords(options.query)
  const matches = (group: G, model: ModelCatalogModel): boolean => {
    if (words.length === 0) return true
    const haystack = `${normalizeSearch(model.name)} ${normalizeSearch(group.label(model))}`
    return words.every(word => haystack.includes(word))
  }
  const byKey = new Map<string, RankedRow<G>>()
  for (const group of groups) {
    for (const model of group.models) {
      const key = modelKey(group.id, model.id)
      if (!byKey.has(key)) byKey.set(key, { group, model })
    }
  }
  const listed = new Set<string>()
  const pick = (keys: readonly string[], limit: number): RankedRow<G>[] => {
    const rows: RankedRow<G>[] = []
    for (const key of keys) {
      if (rows.length >= limit) break
      const row = byKey.get(key)
      if (row === undefined || listed.has(key) || !matches(row.group, row.model)) continue
      listed.add(key)
      rows.push(row)
    }
    return rows
  }
  const favorites = pick(options.favorites, Infinity)
  const recent = pick(options.recents, words.length === 0 ? options.recentLimit : Infinity)
  const compare = words.length === 0 ? compareModelNames : compareNewest
  const sections: RankedSection<G>[] = [
    { key: '\u0000favorites', kind: 'favorites', name: '', rows: favorites },
    { key: '\u0000recent', kind: 'recent', name: '', rows: recent },
    ...groups.map(group => ({
      key: group.id,
      kind: 'provider' as const,
      name: group.name,
      rows: group.models
        .filter(model => !listed.has(modelKey(group.id, model.id)) && matches(group, model))
        .sort((a, b) => compare(group.label(a), group.label(b)))
        .map(model => ({ group, model })),
    })),
  ]
  return sections.filter(section => section.rows.length > 0)
}
