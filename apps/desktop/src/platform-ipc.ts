/** Shared names for the desktop Platform bridge. */
/** Private desktop channels; the Platform renderer receives bootstrap and locale updates. */
export const PLATFORM_IPC = {
  bootstrap: 'jan-platform:bootstrap',
  localeChanged: 'jan-platform:locale-changed',
  open: 'jan-platform:open',
  bounds: 'jan-platform:bounds',
  close: 'jan-platform:close',
} as const

/** Resolved Platform language; Desktop resolves the system preference before sending it. */
export type PlatformLocale = 'en_US' | 'zh_CN'
