/** Capture only content inside the requesting application window. */
import type { BrowserWindow, Rectangle } from 'electron'

/**
 * Convert untrusted window coordinates into an integral, visible content rectangle.
 * @param input - requested position and size in window device-independent pixels.
 * @param content - window content size in device-independent pixels.
 * @returns the clipped rectangle, or null for invalid or invisible regions.
 */
export function windowCaptureRect(input: unknown, content: Pick<Rectangle, 'width' | 'height'>): Rectangle | null {
  if (typeof input !== 'object' || input === null || !('x' in input) || !('y' in input)
    || !('width' in input) || !('height' in input)) return null
  const { x, y, width, height } = input
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return null
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(content.width, Math.ceil(x + width))
  const bottom = Math.min(content.height, Math.ceil(y + height))
  return right <= left || bottom <= top ? null : { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Capture the already-authorized window's requested content, not the desktop or another app.
 * @param window - main application window that sent the request.
 * @param request - untrusted CSS pixel bounds from its renderer.
 * @returns PNG bytes; rejects if the window has no capturable content at the bounds.
 */
export async function captureWindowRegion(window: BrowserWindow, request: unknown): Promise<Uint8Array> {
  const zoom = window.webContents.getZoomFactor()
  const { width, height } = window.getContentBounds()
  const css = windowCaptureRect(request, { width: width / zoom, height: height / zoom })
  const rect = css === null ? null : windowCaptureRect({
    x: css.x * zoom, y: css.y * zoom, width: css.width * zoom, height: css.height * zoom,
  }, { width, height })
  if (rect === null || !window.isVisible() || window.isMinimized()) throw new Error('Window capture area is not visible')
  const image = await window.webContents.capturePage(rect)
  if (image.isEmpty()) throw new Error('Window capture returned no image')
  return image.toPNG()
}
