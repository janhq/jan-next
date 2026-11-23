/** Model menu row that starts Tokamak sign-in while signed out. */
import { IconUserOutlineMedium, MenuItemButton } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-model-selection/client'
import type { AccountSectionInjected } from './AccountSection.tsx'

/** Full props of the model menu sign-in row. */
export type ModelMenuSignInProps = PropsRuntime<'conversation.input.model.options'>
  & PropsLocale<'settings.account'> & InjectFace<Pick<AccountSectionInjected, 'hooks' | 'start'>>

/**
 * Offer sign-in once the account stream says no credential is stored; hidden while it loads.
 * @param props - menu owner, account stream and the sign-in starter.
 * @returns the row, or null when signed in or still loading.
 */
export function ModelMenuSignIn({ useAccount, start, dismiss, t }: ModelMenuSignInProps) {
  const status = useAccount(state => state.view?.status)
  if (status === undefined || status === 'credential-stored') return null
  return <MenuItemButton icon={<IconUserOutlineMedium size={16} />} onSelect={() => {
    dismiss()
    // The plugin's start publishes `loginFailed` before it rejects; the sign-in dialog reports it.
    void start().catch(() => undefined)
  }}>{t('freeUsage')}</MenuItemButton>
}
