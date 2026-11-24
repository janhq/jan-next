/** Pure view inputs for the desktop onboarding flow. */
import type { TrackProductEvent } from '@janhq/jan-client-product-analytics/client'
import type { OnboardingProcess, OnboardingProgress } from '../onboarding-settings.ts'
import type { AccountSnapshot } from './AccountSection.tsx'
import type { PlatformPages } from './platform-pages.ts'
import type { AccountKey } from './locales.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface SlotMap {
    /** Replaces the stock desktop introduction and uses the same completion marker. */
    'settings.onboarding.flow': { kind: 'single'; scope: 'root'; owner: OnboardingFlowOwner }
  }
  interface SlotFactoryMap {
    /** The stock transcript detail selector rendered in a caller-owned flow. */
    'settings.onboarding.detail': { scope: 'root'; props: OnboardingDetailProps; locale: 'settings.account' }
  }
}

/** Inputs for reusing the stock detail selector. */
export interface OnboardingDetailProps {
  busy: boolean
  process: OnboardingProcess | null
  continueLabel: string
  onSelect: (value: OnboardingProcess) => void
  onContinue: () => void
}

/** Operations and write state for a replacement desktop introduction. */
export interface OnboardingFlowOwner {
  /** True while settings are being written or the overlay is exiting. */
  busy: boolean
  /** The account-owned settings read or write failed. */
  settingsError: boolean
  /** @param detail - selected transcript detail, or null to skip. @returns whether completion was saved. */
  finish(this: void, detail: OnboardingProcess | null): Promise<boolean>
  /** @returns whether the settings read or write succeeded on retry. */
  retry(this: void): Promise<boolean>
}

/** Render state with pending choices previewed over durable Host progress. */
export interface DesktopOnboardingState {
  status: 'loading' | 'ready' | 'saving' | 'error'
  visible: boolean
  progress: OnboardingProgress
  /** Whether positive balance was already available at first credit-page entry; pending uses ordinary actions, never persisted. */
  creditFunded: boolean
  error: 'settings' | null
}

/** User-selected fields accepted before final preference application. */
export type OnboardingChange = Partial<Pick<OnboardingProgress, 'step' | 'purpose' | 'process'>>

/** Data and callbacks consumed by the presentational desktop flow. */
export interface DesktopOnboardingProps {
  /** Keep the saved final step visible while revealing the workspace. */
  exiting?: boolean
  /** Desktop collection callback; absent when analytics is disabled. */
  track?: TrackProductEvent
  state: DesktopOnboardingState
  account: AccountSnapshot
  /** Desktop-only: show the shared native recharge page; absent in ordinary browsers. */
  openPlatformPage?: PlatformPages['open']
  update(this: void, change: OnboardingChange): Promise<boolean>
  complete(this: void, reason: 'completed' | 'skipped'): Promise<boolean>
  retry(this: void): Promise<boolean>
  /** Active interface language selects the matching illustration artwork. */
  locale: string
  t: (key: AccountKey) => string
}
