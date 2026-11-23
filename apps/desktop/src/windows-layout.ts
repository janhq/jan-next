/** Shared geometry for the Windows main-window caption. */

/** Windows application titlebar height in CSS pixels at actual size. */
export const WINDOWS_TITLEBAR_HEIGHT = 32

/** Smallest overlay height Windows honours; at or below about 23 DIP the caption buttons fall back to their default size. */
const WINDOWS_CAPTION_MIN_HEIGHT = 24

/**
 * Native caption button height that matches the page's title row at a zoom.
 * The page row is {@link WINDOWS_TITLEBAR_HEIGHT} CSS px, so it grows with zoom while the overlay stays in DIP.
 * @param zoomFactor - the window's webContents zoom factor.
 * @returns overlay height in device-independent pixels.
 */
export function windowsCaptionHeight(zoomFactor: number): number {
  return Math.max(WINDOWS_CAPTION_MIN_HEIGHT, Math.round(WINDOWS_TITLEBAR_HEIGHT * zoomFactor))
}
