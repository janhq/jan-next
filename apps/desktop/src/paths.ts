/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveJanHome } from '@janhq/jan-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param janHome - Harness home shared with npm-installed jan.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(janHome: string = resolveJanHome()): DesktopPaths {
  return {
    profile: join(janHome, 'profiles', 'desktop'),
    lock: join(janHome, 'profiles', 'desktop', 'lock'),
  }
}
