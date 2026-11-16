/** Operations available to the isolated native welcome renderer. */

import type { AccountView, SignInAttemptId } from '@janhq/jan-tokamak-account/types'
import type { ProductEventMap } from '@janhq/jan-client-product-analytics/types'
import type { DesktopLocale } from './locale.ts'

/** Private native welcome channels, installed only while its window exists. */
export const WELCOME_IPC = {
  saveApiKey: 'jan-welcome:save-api-key',
  analytics: 'jan-welcome:analytics',
  analyticsEnabled: 'jan-welcome:analytics-enabled',
  skip: 'jan-welcome:skip',
  start: 'jan-welcome:start',
  cancel: 'jan-welcome:cancel',
  copyLink: 'jan-welcome:copy-link',
  state: 'jan-welcome:state',
  takeNotice: 'jan-welcome:take-notice',
  localStart: 'jan-welcome:local-start',
  localState: 'jan-welcome:local-state',
} as const

/**
 * tokamak-harness: what the welcome window shows of the local model setup. A path-free subset of
 * the Host's llama.cpp state.
 */
export interface WelcomeLocalModel {
  /** Host lifecycle phase (`missing`, `downloading`, `starting`, `running`, `failed`, …). */
  readonly phase: string
  /** Model being installed or run. */
  readonly name: string
  /** Bytes of the first-run model download. */
  readonly totalBytes: number
  /** Present while downloading. */
  readonly progress?: {
    readonly receivedBytes: number
    readonly totalBytes: number
    readonly bytesPerSecond: number
  }
  /** Present in `failed`. */
  readonly error?: string
}

/** Credential writes return a safe outcome without exposing Host diagnostics. */
export type WelcomeSaveResult = { readonly ok: true } | { readonly ok: false }

/** One-time notification retained by the main process until Welcome receives it. */
export type WelcomeNotice = 'session-expired'

type WelcomeEventName = 'auth_page_view' | 'auth_page_click' | 'api_key_save_click'

/** Host-owned operations used by the welcome window. */
export interface WelcomeOperations {
  /** @param eventName - allowed welcome event. @param attributes - approved fields without credentials. */
  analytics?<K extends WelcomeEventName>(eventName: K, attributes: ProductEventMap[K]): Promise<void>
  /** @returns the Host's current effective collection policy. */
  analyticsEnabled(): Promise<boolean>
  /** @returns the pending notification, clearing it before another renderer can receive it. */
  takeNotice(): Promise<WelcomeNotice | undefined>
  /** @returns account state after starting a login attempt. */
  startSignIn(): Promise<AccountView>
  /** @param id - attempt to cancel. @returns the settled state. */
  cancelSignIn(id: SignInAttemptId): Promise<AccountView>
  /** @param id - current waiting attempt whose authorization URL is copied to the system clipboard. */
  copySignInLink(id: SignInAttemptId): Promise<void>

  /**
   * Store the official provider's key before entering the workspace.
   * @param value - validated, trimmed API key.
   * @returns whether the write completed, without private error details.
   */
  saveApiKey(value: string): Promise<WelcomeSaveResult>
  /** @returns the local model state after asking the Host to download and start the first-run model. */
  startLocalModel(): Promise<WelcomeLocalModel>
  /** @returns the local model state, or undefined when this build has no local model. */
  readLocalModel(): Promise<WelcomeLocalModel | undefined>
  /**
   * Enter the workspace without writing an onboarding-completion setting.
   * @returns completion after the workspace opens.
   */
  skip(): Promise<void>
}

/** The renderer receives localized copy, login operations, and safe account snapshots. */
export type WelcomeApi = DesktopLocale & WelcomeOperations & {
  /** @param listener - safe account snapshot recipient. @returns subscription disposer. */
  onAccountState(listener: (state: AccountView) => void): () => void
}

/** Authentication facts supplied at cold start or after a completed sign-out. */
export interface WelcomeAuthentication {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
  /** tokamak-harness: a local model is installed, so the workspace can serve without an account. */
  readonly hasLocalModel?: boolean
}

/**
 * Decide whether a startup or sign-out requires the welcome entry.
 * @param authentication - current account and independently stored API-key facts.
 * @returns true only when no authentication route is configured and no local model is installed.
 */
export function needsWelcome(authentication: WelcomeAuthentication): boolean {
  return !authentication.loggedIn && !authentication.hasApiKey && authentication.hasLocalModel !== true
}
