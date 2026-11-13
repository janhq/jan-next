import { APIs } from '@/lib/service'
/**
 * Typed access to the Rust settings store (`core::app::settings_store`), which
 * persists to `<jan_data>/settings.json`.
 *
 * Named `appSettings` rather than `settings` to keep it distinct from the
 * per-extension settings store on the extension host, which is unrelated.
 */

/**
 * Reads a persisted setting.
 * @returns the stored string, or null when the key is unset.
 */
const get: (key: string) => Promise<string | null> = async (key) =>
  (await APIs.settingsGet({ key })) ?? null

/**
 * Persists a setting. Values are stored as strings; callers serialize.
 */
const set: (key: string, value: string) => Promise<void> = (key, value) =>
  APIs.settingsSet({ key, value })

/**
 * Removes a setting. Removing an absent key is not an error.
 */
const remove: (key: string) => Promise<void> = (key) =>
  APIs.settingsRemove({ key })

export const appSettings = { get, set, remove }
