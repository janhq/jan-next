/** Live titles and destinations shared by Settings and the command palette. */
import type { Context } from '@janhq/cordis'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import { resolveSlotLabel } from '@janhq/jan-client-ui-slots'
import { rankByName } from '@janhq/jan-client-ui-primitives'
import { CurrentVersionRow } from './CurrentVersionRow.tsx'
import { DesktopChannelRow } from './DesktopChannelRow.tsx'
import { DeveloperToolsRow } from './DeveloperToolsRow.tsx'
import { FactoryResetRow } from './FactoryResetRow.tsx'
import { GeneralSection } from './GeneralSection.tsx'

/** A current Settings page or one row owned by this package. */
export interface SettingsSearchTarget {
  readonly sectionId: string
  readonly sectionTitle: string
  readonly title: string
  readonly keywords: readonly string[]
  readonly destination: { readonly kind: 'page' } | { readonly kind: 'row'; readonly id: string }
}

const SECTIONS = 'settings.section'
const GENERAL_ROWS = 'settings.general.item'

function humanize(id: string): string {
  return id.replace(/[-_.]/g, ' ').replace(/^./, char => char.toUpperCase())
}

/**
 * Project effective slot winners on demand and keep the snapshot stable between changes.
 * @param slots - live section and General row registrations.
 * @param locale - revision and localized labels for the rows owned here.
 * @returns the shared, read-only search catalog.
 */
export function createSettingsSearchSource(
  slots: Context['slots'], locale: Context['locale'],
): ObservableSnapshot<readonly SettingsSearchTarget[]> {
  const t = locale.bind('settings')
  const titles = new Map<unknown, () => string>([
    [DeveloperToolsRow, () => t('developerTools.title')],
    [DesktopChannelRow, () => t('desktop.channel.title')],
    [FactoryResetRow, () => t('factoryReset.title')],
  ])
  if (process.env.JAN_CLIENT_VERSION !== undefined) titles.set(CurrentVersionRow, () => t('search.currentVersion'))

  let sectionVersion = -1
  let generalVersion = -1
  let localeRevision = -1
  let snapshot: readonly SettingsSearchTarget[] = []
  return {
    getSnapshot: () => {
      const sections = slots.getVersion(SECTIONS)
      const general = slots.getVersion(GENERAL_ROWS)
      const revision = locale.getSnapshot().revision
      if (sections === sectionVersion && general === generalVersion && revision === localeRevision) return snapshot

      const entries = [...slots.entriesOfSlot(SECTIONS)].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
      const targets: SettingsSearchTarget[] = []
      const rows: SettingsSearchTarget[] = []
      for (const entry of entries) {
        const sectionId = entry.options.id
        if (sectionId === undefined) continue
        const sectionTitle = resolveSlotLabel(entry.options.label) || humanize(sectionId)
        targets.push({ sectionId, sectionTitle, title: sectionTitle, keywords: [sectionId, humanize(sectionId)], destination: { kind: 'page' } })
        if (sectionId !== 'general' || entry.component !== GeneralSection) continue
        for (const row of [...slots.entriesOfSlot(GENERAL_ROWS)].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))) {
          const id = row.options.id
          const title = titles.get(row.component)
          if (id === undefined || title === undefined) continue
          rows.push({ sectionId, sectionTitle, title: title(), keywords: [sectionTitle, id, humanize(id)], destination: { kind: 'row', id } })
        }
      }
      sectionVersion = sections
      generalVersion = general
      localeRevision = revision
      snapshot = targets.concat(rows)
      return snapshot
    },
    subscribe: (listener) => {
      const offSections = slots.subscribe(SECTIONS, listener)
      const offGeneral = slots.subscribe(GENERAL_ROWS, listener)
      const offLocale = locale.subscribe(listener)
      return () => { offSections(); offGeneral(); offLocale() }
    },
  }
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Rank title matches first; keywords use substring matching only.
 * @param targets - search catalog in source order.
 * @param query - user input, ignoring case, accents and outer whitespace.
 * @returns matching targets with stable source order on ties.
 */
export function filterSettings(targets: readonly SettingsSearchTarget[], query: string): readonly SettingsSearchTarget[] {
  const needle = normalize(query.trim())
  if (needle === '') return targets
  const titled = rankByName(targets.map(target => ({ name: normalize(target.title), target })), needle)
    .map(match => match.target)
  const seen = new Set(titled)
  for (const target of targets) {
    if (!seen.has(target) && target.keywords.some(keyword => normalize(keyword).includes(needle))) titled.push(target)
  }
  return titled
}
