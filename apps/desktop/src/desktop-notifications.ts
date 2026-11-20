/** Native notifications requested by the product document; a click restores the window and names the notification. */

import { Notification, type BrowserWindow } from 'electron'

/** One notification the product document asks the shell to show. */
export interface DesktopNotificationRequest {
  /** Opaque document-owned id echoed back on click; at most {@link MAX_ID_LENGTH} characters. */
  readonly id: string
  readonly title: string
  readonly body: string
}

/** Shell actions a notification click performs. */
export interface DesktopNotificationsOptions {
  /** Show and focus the primary window. */
  readonly focus: () => void
  /** Deliver the clicked notification's id to the product document. */
  readonly clicked: (id: string) => void
}

const MAX_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 256
const MAX_BODY_LENGTH = 1024
/** Shown notifications stay referenced until clicked, closed, or failed, so the click listener survives garbage collection. */
const MAX_RETAINED = 32

/**
 * Validate an IPC payload from the product document.
 * @param request - untrusted renderer value.
 * @returns the validated request.
 * @throws {TypeError} when a field is missing, not a string, empty, or over its length limit.
 */
export function parseDesktopNotificationRequest(request: unknown): DesktopNotificationRequest {
  if (request === null || typeof request !== 'object') throw new TypeError('jan desktop: notification request must be an object')
  const { id, title, body } = request as Record<string, unknown>
  const text = (value: unknown, name: string, limit: number): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
      throw new TypeError(`jan desktop: notification ${name} must be a non-empty string of at most ${limit} characters`)
    }
    return value
  }
  return { id: text(id, 'id', MAX_ID_LENGTH), title: text(title, 'title', MAX_TITLE_LENGTH), body: text(body, 'body', MAX_BODY_LENGTH) }
}

/**
 * Whether the user is looking at the window. Electron's renderer keeps `document.visibilityState` visible and
 * `document.hasFocus()` true for a minimized Linux window, so only the native state answers this.
 * @param window - the main window.
 * @returns whether it is shown, not minimized, and focused.
 */
export function isWindowActive(window: Pick<BrowserWindow, 'isVisible' | 'isMinimized' | 'isFocused'>): boolean {
  return window.isVisible() && !window.isMinimized() && window.isFocused()
}

/** Owns the shown notifications; a notification with an id already shown replaces the earlier one. */
export class DesktopNotifications {
  private readonly shown = new Map<string, Notification>()

  /** @param options - window focus and click delivery actions. */
  constructor(private readonly options: DesktopNotificationsOptions) {}

  /**
   * Show one notification when the platform supports it.
   * @param request - validated request.
   * @returns whether the notification was handed to the platform.
   */
  show(request: DesktopNotificationRequest): boolean {
    if (!Notification.isSupported()) return false
    this.release(request.id)
    const notification = new Notification({ title: request.title, body: request.body })
    this.shown.set(request.id, notification)
    const forget = (): void => { if (this.shown.get(request.id) === notification) this.forget(request.id) }
    notification.once('click', () => {
      forget()
      this.options.focus()
      this.options.clicked(request.id)
    })
    notification.once('close', forget)
    notification.once('failed', forget)
    while (this.shown.size > MAX_RETAINED) this.forget(this.shown.keys().next().value as string)
    notification.show()
    return true
  }

  /** Close every shown notification; called once at shutdown. */
  dispose(): void {
    for (const id of [...this.shown.keys()]) this.release(id)
  }

  private release(id: string): void {
    const notification = this.shown.get(id)
    if (notification === undefined) return
    this.forget(id)
    try { notification.close() }
    catch (error) { console.warn('desktop notifications: could not close notification', error) }
  }

  private forget(id: string): void {
    this.shown.get(id)?.removeAllListeners()
    this.shown.delete(id)
  }
}
