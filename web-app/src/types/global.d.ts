export {}

type AppCore = {
  api: APIs
}

declare global {
  declare const IS_TAURI: boolean
  declare const IS_WEB_APP: boolean
  declare const IS_MACOS: boolean
  declare const IS_WINDOWS: boolean
  declare const PLATFORM: string
  declare const VERSION: string
  declare const MODEL_CATALOG_URL: string
  declare const LATEST_JAN_MODEL_URL: string
  declare const IS_DEV: boolean
  interface Window {
    core: AppCore | undefined
  }
}
