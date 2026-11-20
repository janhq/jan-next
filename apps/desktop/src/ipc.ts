import type { DesktopFileActions } from '@janhq/jan-client-ui-file-actions/types'
/** Typed preload operations exposed only by the Electron shell. */

export type { DesktopChannelState, DesktopChannelChangeResult } from '@janhq/jan-client-ui-settings-general/types'
import type { DesktopChannelBridge, DesktopChannelState } from '@janhq/jan-client-ui-settings-general/types'
import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@janhq/jan-client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@janhq/jan-client-ui-sidebar-browser/types'
import type { DesktopFileDrag } from '@janhq/jan-util-file-drag'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  fileSave: 'jan-desktop:file-save',
  clipboardImageRead: 'jan-desktop:clipboard-image-read',
  captureRegion: 'jan-desktop:capture-region',
  shortcutsInput: 'jan-desktop:shortcuts-input',
  shortcutsCloseWindow: 'jan-desktop:shortcuts-close-window',
  shortcutsGet: 'jan-desktop:shortcuts-get',
  shortcutsEdit: 'jan-desktop:shortcuts-edit',
  shortcutsChanged: 'jan-desktop:shortcuts-changed',
  shortcutsRecording: 'jan-desktop:shortcuts-recording',
  boot: 'jan-desktop:boot',
  enterWorkspace: 'jan-desktop:enter-workspace',
  onboardingActive: 'jan-desktop:onboarding-active',
  onboardingApiKey: 'jan-desktop:onboarding-api-key',
  bootFailed: 'jan-desktop:boot-failed',
  browserAcquire: 'jan-desktop:browser-acquire',
  browserRelease: 'jan-desktop:browser-release',
  browserOpenRequested: 'jan-desktop:browser-open-requested',
  directoryPick: 'jan-desktop:directory-pick',
  fileDragPrepare: 'jan-desktop:file-drag-prepare',
  fileDragCancel: 'jan-desktop:file-drag-cancel',
  fileDragStart: 'jan-desktop:file-drag-start',
  fileDragRelease: 'jan-desktop:file-drag-release',
  deviceInfo: 'jan-desktop:device-info',
  localeBootstrap: 'jan-desktop:locale-bootstrap',
  localeChanged: 'jan-desktop:locale-changed',
  updatesChannelGet: 'jan-desktop:updates-channel-get',
  updatesChannelSet: 'jan-desktop:updates-channel-set',
  updatesChannelChanged: 'jan-desktop:updates-channel-changed',
  updatesStatus: 'jan-desktop:updates-status',
  updatesOpen: 'jan-desktop:updates-open',
  updatesPresentation: 'jan-desktop:updates-presentation',
  nativeThemeSet: 'jan-desktop:native-theme-set',
  windowFullscreen: 'jan-desktop:window-fullscreen',
  windowsAppearance: 'jan-desktop:windows-appearance',
  windowsMenu: 'jan-desktop:windows-menu',
  notificationShow: 'jan-desktop:notification-show',
  notificationClicked: 'jan-desktop:notification-clicked',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable' | 'fullscreen-timeout'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install' | 'configuration'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
  /** Current filesystem failure, independent of previous cache cleanup attempts. */
  readonly downloadFailure?: 'space' | 'permission' | 'busy'
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'configuration'
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'download-space'
  | 'download-permission'
  | 'download-busy'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'
  | 'fullscreen-timeout'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
  readonly configurationError?: DesktopChannelState['error']
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface JanDesktopProductApi {
  readonly fileActions: DesktopFileActions
  /** @param bounds - rectangle in main-renderer CSS pixels. @returns a PNG of visible application content. */
  captureRegion(bounds: { x: number; y: number; width: number; height: number }): Promise<Uint8Array>
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly fileDrag: DesktopFileDrag
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
  /**
   * Local machine description for the feedback questionnaire.
   * @returns `name=value` fields separated by `; `, with no hostname, user name, or serial number.
   */
  deviceInfo(): Promise<string>
  readonly notifications: {
    /**
     * @param request - `id` is echoed to click listeners; `title` and `body` are display text.
     * @returns whether the platform accepted the notification.
     */
    show(request: { id: string; title: string; body: string }): Promise<boolean>
    /** @param listener - receives the id of a clicked notification after the window is focused. @returns the unsubscribe function. */
    subscribe(listener: (id: string) => void): () => void
  }
  readonly updates: {
    readonly channels: DesktopChannelBridge
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'jan-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('jan desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('jan desktop: rejected IPC from an unowned renderer')
  }
}
