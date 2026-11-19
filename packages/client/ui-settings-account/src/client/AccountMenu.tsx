/** Sidebar account launcher and locally authoritative sign-out action. */
import { useEffect, useRef, useState } from 'react'
import {
  Toast, Menu, IconSettingsOutlineMedium, IconUserOutlineMedium, IconGlobeOutlineMedium,
  IconSlidersTwoOutlineMedium, IconDeliverDocMedium, IconInfoOutlineMedium,
} from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountAvatar } from './AccountAvatar.tsx'
import { AccountNoticeStack } from './AccountNotice.tsx'
import css from './AccountMenu.module.css'

// Jan's public release notes and docs, the same pages the original app links.
const JAN_CHANGELOG_URL = 'https://jan.ai/changelog'
const JAN_DOCS_URL = 'https://jan.ai/docs'

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings,
  openOnboarding: _openOnboarding, settingsOpen,
  useAccount, useTheme, signOut, hasRunningAccountTasks, refreshAccount, bonusNoticeShown, bonusNoticeDismissed,
  contactUs, showLogin, start, cancel, avatarFailed, openSettingsSection, openLink, t,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const profile = account.details?.profile
  const label = profile === undefined ? null : profile.status === 'ready'
    ? profile.value.name ?? profile.value.contact ?? t('signedIn') : t('signedIn')
  // The menu header names who is signed in: the name, then the email (or the
  // service when no email is shown), like the account chip in other apps.
  const contact = profile?.status === 'ready' && profile.value.contact !== label ? profile.value.contact : null
  // Signed out, the wide footer leads with the action people need: Log in.
  // The gear beside it keeps Settings, Language and the links one click away.
  const loginRow = !signedIn && wide
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [signOutImpact, setSignOutImpact] = useState<boolean | 'unknown'>()
  const requestSignOut = async () => {
    setBusy(true)
    try { setSignOutImpact(await hasRunningAccountTasks()); setOpen(false) }
    catch (_error) { setSignOutImpact('unknown'); setOpen(false) }
    finally { setBusy(false) }
  }
  // The plugin's start publishes `loginFailed` before it rejects, so the dialog owns the report.
  const beginSignIn = (): void => { setOpen(false); void start().catch(() => undefined) }
  return <div ref={anchor} className={css.root} data-inset={signedIn && wide} data-login-row={loginRow}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {signedIn && !account.desktopOnboardingVisible && !account.onboarding && account.notices && <AccountNoticeStack
      notices={account.notices}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    {loginRow && <button type="button" className={css.login} onClick={beginSignIn}>
      <IconUserOutlineMedium size={16} />
      <span className={css.label}>{t('logIn')}</span>
    </button>}
    <Menu open={open} side="top" portal autoFocus className={loginRow ? css.gearAnchor : css.anchor} listClassName={signedIn ? undefined : css.signedOutMenu}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide || loginRow} data-signed-out={!signedIn} aria-label={t('menu')}
        title={loginRow ? t('settings') : undefined}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {signedIn
          ? <span className={css.avatar} data-avatar-status={account.avatar?.status}>
            <AccountAvatar avatar={account.avatar} avatarFailed={avatarFailed} />
          </span>
          : <IconSettingsOutlineMedium size={16} />}
        {wide && signedIn && <span className={css.label}>{label}</span>}
        {wide && signedIn && <span className={css.provider}>{t('tokamak')}</span>}
      </button>}
      items={[
        ...(signedIn && label !== null ? [
          { type: 'label' as const, id: 'account-name', text: label },
          { type: 'label' as const, id: 'account-contact', text: contact ?? t('tokamak') },
          { type: 'separator' as const, id: 'account-header-separator' },
        ] : []),
        {
          id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }),
        },
        ...(openSettingsSection === undefined ? [] : [
          { id: 'language', label: t('language'), icon: <IconGlobeOutlineMedium size={16} /> },
          { id: 'inference', label: t('inference'), icon: <IconSlidersTwoOutlineMedium size={16} /> },
        ]),
        ...(openLink === undefined ? [] : [
          { type: 'separator' as const, id: 'links-separator' },
          { id: 'changelog', label: t('changelog'), icon: <IconDeliverDocMedium size={16} /> },
          { id: 'learn', label: t('learnMore'), icon: <IconInfoOutlineMedium size={16} /> },
        ]),
        { type: 'separator' as const, id: 'account-separator' },
        ...(signedIn ? [{ id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy }]
          : [{ id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} /> }]),
        ...(process.env.JAN_CLIENT_VERSION ? [
          { type: 'separator' as const, id: 'version-separator' },
          { type: 'label' as const, id: 'version', text: `${t('version')} ${process.env.JAN_CLIENT_VERSION}` },
        ] : []),
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
        else if (id === 'language' || id === 'inference') {
          setOpen(false)
          openSettingsSection?.(id === 'language' ? 'general' : 'models')
        } else if (id === 'changelog' || id === 'learn') {
          setOpen(false)
          openLink?.(id === 'changelog' ? JAN_CHANGELOG_URL : JAN_DOCS_URL)
        } else if (id === 'contact') { setOpen(false); contactUs() }
        else if (id === 'signin') beginSignIn()
        else void requestSignOut()
      }} />
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t}
      close={() => { showLogin(false) }} useApiKey={() => { showLogin(false); openSettings() }} />}
    {signedIn && signOutImpact !== undefined && <SignOutDialog running={signOutImpact} signOut={signOut}
      close={() => { setSignOutImpact(undefined) }} t={t} />}
  </div>
}
