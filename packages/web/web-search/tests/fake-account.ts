/** In-memory `tokamakAccount` service whose sign-in state tests set directly. */

import { TokamakAccount } from '@janhq/jan-tokamak-account'
import type { AccountView, TokamakPlatformSession } from '@janhq/jan-tokamak-account'

const LINKS = { usageUrl: 'https://tokamak.invalid', topUpUrl: 'https://tokamak.invalid/keys' }

/** Releases its key only for URLs on `issuer`, like the real account; `failState` makes state reads throw. */
export class FakeTokamakAccount extends TokamakAccount {
  readonly modelProvider = 'tokamak'
  issuer = 'http://127.0.0.1'
  failState = false
  readonly rejected: string[] = []
  private token: string | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * Store or remove the key and notify watchers.
   * @param token - the key, or undefined to sign out.
   */
  setToken(token: string | undefined): void {
    this.token = token
    for (const listener of this.listeners) listener()
  }

  override getState(): Promise<AccountView> {
    if (this.failState) return Promise.reject(new Error('credential store unreadable'))
    return Promise.resolve({ status: this.token === undefined ? 'signed-out' : 'credential-stored', links: LINKS, attempt: null })
  }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const wakeUp = (): void => { dirty = true; wake?.() }
    this.listeners.add(wakeUp)
    signal.addEventListener('abort', wakeUp, { once: true })
    try {
      while (!signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(wakeUp)
      signal.removeEventListener('abort', wakeUp)
    }
  }

  override resolveToken(url: string): Promise<string | undefined> {
    return Promise.resolve(new URL(url).origin === this.issuer ? this.token : undefined)
  }

  override rejectToken(token: string): Promise<void> {
    this.rejected.push(token)
    if (token === this.token) this.setToken(undefined)
    return Promise.resolve()
  }

  override getProfile(): Promise<null> { return Promise.resolve(null) }
  override getBalance(): Promise<null> { return Promise.resolve(null) }
  override getUnnotifiedBonuses(): Promise<null> { return Promise.resolve(null) }
  override ackBonusNotified(): Promise<boolean> { return Promise.resolve(false) }
  override startSignIn(): Promise<AccountView> { return this.getState() }
  override cancelSignIn(): Promise<AccountView> { return this.getState() }
  override signOut(): Promise<AccountView> { this.setToken(undefined); return this.getState() }
  override getPlatformSession(): Promise<TokamakPlatformSession | null> { return Promise.resolve(null) }
  override getDeviceIdentity(): Promise<{ osVersion: string }> { return Promise.resolve({ osVersion: 'test' }) }
}
