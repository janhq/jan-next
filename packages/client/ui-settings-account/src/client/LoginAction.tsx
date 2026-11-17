/** Sidebar footer Login row: shown only while signed out, it starts the Tokamak sign-in. */
import { IconUserOutlineMedium } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-sidebar/client'
import type { AccountSectionInjected, AccountSnapshot } from './AccountSection.tsx'
import css from './AccountMenu.module.css'

/** What the Login row needs from the account plugin. */
export interface LoginActionInjected {
  hooks: { account: HostObservable<AccountSnapshot> }
  start: AccountSectionInjected['start']
}

/** Login row props composed by the sidebar footer-action slot. */
export type LoginActionProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'settings.account'>
  & InjectFace<LoginActionInjected>

/**
 * @param props - sidebar width, account hook and sign-in start.
 * @returns the Login row, or nothing once an account is signed in.
 */
export function LoginAction({ wide, useAccount, start, t }: LoginActionProps) {
  const signedIn = useAccount(state => state.view?.status === 'credential-stored')
  if (signedIn) return null
  // The plugin's start publishes `loginFailed` before it rejects; the sign-in dialog owns the report.
  return <button type="button" className={css.trigger} data-account-row data-collapsed={!wide} data-signed-out
    aria-label={t('login')} title={wide ? undefined : t('login')}
    onClick={() => { void start().catch(() => undefined) }}>
    <IconUserOutlineMedium size={16} />
    {wide && <span className={css.label}>{t('login')}</span>}
  </button>
}
