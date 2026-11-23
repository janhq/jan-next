/** Factory reset: which Jan data each choice removes, and the removal itself. Workspace folders are never touched. */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

/** What the user may reset, in Settings order. */
export const FACTORY_RESET_CATEGORIES = ['chats', 'settings', 'plugins', 'credentials', 'skills', 'logs'] as const
export type FactoryResetCategory = typeof FACTORY_RESET_CATEGORIES[number]

/** Data roots a reset may remove from; every target lies under one of them. */
export interface FactoryResetRoots {
  /** The Jan home (`$JAN_HOME` or `~/.config/jan-alpha`). */
  readonly janHome: string
  /** The desktop profile directory under the Jan home. */
  readonly profile: string
  /** Electron userData. */
  readonly userData: string
  /** Electron's resolved application logs directory, which can be outside userData. */
  readonly desktopLogs: string
}

/**
 * Paths one category removes. Absent paths are fine; a removed profile file is recreated at the next launch.
 * @param category - chosen category.
 * @param roots - data roots of this installation.
 * @returns absolute paths to remove.
 */
export function factoryResetTargets(category: FactoryResetCategory, roots: FactoryResetRoots): readonly string[] {
  const { janHome, profile, userData, desktopLogs } = roots
  switch (category) {
    case 'chats': return [
      join(janHome, 'sessions'), join(janHome, 'attachments'), join(janHome, 'storages', 'session_projcache'),
      // The local worker persists per-conversation state here, separate from the model weights.
      join(janHome, 'llama-cpp', 'slots'),
    ]
    case 'settings': return [
      join(profile, 'cordis.patch.yml'), join(janHome, 'storages', 'workspace.json'),
      join(janHome, 'storages', 'llm_pi_ai_model_listings.json'),
      join(userData, 'desktop'), join(userData, 'keybindings.json'),
    ]
    // The profile manifest is rewritten with only the shipped bundles at the next launch.
    case 'plugins': return [join(profile, 'package.json'), join(profile, 'node_modules'), join(profile, 'pnpm-lock.yaml')]
    case 'credentials': return [join(janHome, '.credentials.yaml'), join(janHome, 'hosts', 'devices.json')]
    case 'skills': return [join(janHome, 'skills')]
    case 'logs': return [...new Set([join(janHome, 'logs'), desktopLogs])]
  }
}

/**
 * Validate a Renderer-supplied selection.
 * @param value - IPC argument.
 * @returns the distinct chosen categories in Settings order.
 * @throws when the value is not a nonempty list of known categories.
 */
export function parseFactoryResetRequest(value: unknown): readonly FactoryResetCategory[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('factory reset: choose at least one category')
  for (const item of value) {
    if (!FACTORY_RESET_CATEGORIES.includes(item as FactoryResetCategory)) throw new Error(`factory reset: unknown category ${String(item)}`)
  }
  return FACTORY_RESET_CATEGORIES.filter(category => value.includes(category))
}

/** Selected categories fully cleared, and removal failures grouped by the data they affect. */
export interface FactoryResetResult {
  readonly completed: readonly FactoryResetCategory[]
  readonly incomplete: ReadonlyMap<FactoryResetCategory, readonly unknown[]>
}

/**
 * Attempt all selected removals after the Host has stopped, even if one removal fails.
 * @param categories - validated selection.
 * @param roots - data roots of this installation.
 * @param clearBrowserStorage - clear Electron's persisted browser settings for the Settings category.
 * @returns categories that finished and categories where selected data may remain.
 */
export async function performFactoryReset(categories: readonly FactoryResetCategory[], roots: FactoryResetRoots,
  clearBrowserStorage: () => Promise<void>): Promise<FactoryResetResult> {
  const outcomes = await Promise.all(categories.map(async (category) => {
    const removals = factoryResetTargets(category, roots).map(path => rm(path, { recursive: true, force: true, maxRetries: 3 }))
    if (category === 'settings') removals.push(Promise.resolve().then(clearBrowserStorage))
    const results = await Promise.allSettled(removals)
    return { category, failures: results.flatMap(result => result.status === 'rejected' ? [result.reason] : []) }
  }))
  const completed: FactoryResetCategory[] = []
  const incomplete = new Map<FactoryResetCategory, readonly unknown[]>()
  for (const { category, failures } of outcomes) {
    if (failures.length === 0) completed.push(category)
    else incomplete.set(category, failures)
  }
  return { completed, incomplete }
}
