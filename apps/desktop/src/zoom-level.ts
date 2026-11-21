/** Window zoom chosen from the View menu, kept for the next launch. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Chromium zoom levels the View menu offers: 50% (-3) through about 250% (5), in half steps. */
export const MIN_ZOOM_LEVEL = -3
export const MAX_ZOOM_LEVEL = 5

/**
 * Bound a requested level to the menu's range and half steps.
 * @param level - requested Chromium zoom level.
 * @returns the nearest accepted level.
 */
export function clampZoomLevel(level: number): number {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Math.round(level * 2) / 2))
}

/**
 * Read the last zoom level.
 * @param userData - Electron userData directory.
 * @returns the saved level, or 0 (actual size) when missing, invalid or unreadable.
 */
export function readDesktopZoomLevel(userData: string): number {
  try {
    const value = Number(readFileSync(join(userData, 'desktop', 'zoom-level'), 'utf8').trim())
    if (Number.isFinite(value) && clampZoomLevel(value) === value) return value
    throw new Error('expected a zoom level from -3 to 5 in half steps')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('desktop zoom: opening at actual size because the saved level could not be read', error)
    }
    return 0
  }
}

/**
 * Remember a zoom level; a write failure leaves the current window zoom unchanged.
 * @param userData - Electron userData directory.
 * @param level - level just applied.
 */
export function writeDesktopZoomLevel(userData: string, level: number): void {
  try {
    const directory = join(userData, 'desktop')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(directory, 'zoom-level'), `${level}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn('desktop zoom: level could not be saved for the next launch', error)
  }
}
