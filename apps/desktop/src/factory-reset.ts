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
}

/**
 * Paths one category removes. Absent paths are fine; a removed profile file is recreated at the next launch.
 * @param category - chosen category.
 * @param roots - data roots of this installation.
 * @returns absolute paths to remove.
 */
export function factoryResetTargets(category: FactoryResetCategory, roots: FactoryResetRoots): readonly string[] {
  const { janHome, profile, userData } = roots
  switch (category) {
    case 'chats': return [join(janHome, 'sessions'), join(janHome, 'attachments'), join(janHome, 'storages', 'session_projcache')]
    case 'settings': return [
      join(profile, 'cordis.patch.yml'), join(janHome, 'storages', 'workspace.json'),
      join(janHome, 'storages', 'llm_pi_ai_model_listings.json'),
      join(userData, 'desktop'), join(userData, 'keybindings.json'),
    ]
    // The profile manifest is rewritten with only the shipped bundles at the next launch.
    case 'plugins': return [join(profile, 'package.json'), join(profile, 'node_modules'), join(profile, 'pnpm-lock.yaml')]
    case 'credentials': return [join(janHome, '.credentials.yaml')]
    case 'skills': return [join(janHome, 'skills')]
    case 'logs': return [join(janHome, 'logs')]
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

/**
 * Remove every chosen category's data. The caller has stopped the Host, so no file is in use.
 * All targets are attempted; the first failure is rethrown after the rest are tried.
 * @param categories - validated selection.
 * @param roots - data roots of this installation.
 */
export async function performFactoryReset(categories: readonly FactoryResetCategory[], roots: FactoryResetRoots): Promise<void> {
  const results = await Promise.allSettled(categories.flatMap(category => factoryResetTargets(category, roots))
    .map(path => rm(path, { recursive: true, force: true, maxRetries: 3 })))
  const failure = results.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
}
