/** Desktop channel selection; persistence and updater transitions remain in Electron. */
import { SelectMenu, Toast, IconWarningOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { DesktopChannelSource } from './desktop-channel-source.ts'
import type { DesktopUpdateChannel } from '../types.ts'
import css from './DesktopChannelRow.module.css'

/** Framework-bound shell state and explicit selection action. */
export interface DesktopChannelRowInjected {
  hooks: { channel: DesktopChannelSource['store'] }
  select(channel: DesktopUpdateChannel): Promise<void>
}

/**
 * Render the Desktop-only channel control without depending on a Host settings service.
 * @param props - Shell observation, selection action and localized copy.
 * @returns The General settings row.
 */
export function DesktopChannelRow({ useChannel, select, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DesktopChannelRowInjected>) {
  const { state, failed, pending } = useChannel(value => value)
  const busy = pending !== undefined || state?.changing === true
  const channel = pending ?? state?.channel
  return <div className={css.row} role="group" aria-label={t('desktop.channel.title')}
    data-settings-search-row="desktop-update-channel" tabIndex={-1}>
    <div className={css.rowText}>
      <div className={css.title}>{t('desktop.channel.title')}</div>
      <div className={css.description}>{t('desktop.channel.description')}</div>
      {(failed || state?.error !== undefined) && <div role="alert">{t(failed ? 'desktop.channel.readError' : 'desktop.channel.error')}</div>}
    </div>
    <SelectMenu value={channel ?? undefined} label={t('desktop.channel.title')} placeholder={t('desktop.channel.unavailable')}
      busy={busy} disabled={state === undefined}
      options={[{ id: 'stable', label: t('desktop.channel.stable') }, { id: 'nightly', label: t('desktop.channel.nightly') }]}
      onChange={(id: DesktopUpdateChannel) => { void select(id) }} />
  </div>
}

/** Shell-owned operation feedback that survives closing Settings. */
export interface DesktopChannelToastInjected {
  hooks: { channel: DesktopChannelSource['store'] }
  dismiss(sequence: number): void
  openConfiguration(): void
}

/**
 * Render the latest channel save result outside Settings.
 * @param props - Shared operation state, dismissal and localized copy.
 * @returns A transient toast, or nothing.
 */
export function DesktopChannelToast({ useChannel, dismiss, openConfiguration, t }:
  PropsRuntime<'shell.overlay'> & PropsLocale<'settings'> & InjectFace<DesktopChannelToastInjected>) {
  const notice = useChannel(value => value.notice)
  if (notice === undefined) return null
  return <Toast key={notice.sequence} text={t(`desktop.channel.result.${notice.outcome}`)} failure={notice.failure}
    {...notice.outcome === 'configuration' ? { holdMs: 10_000,
      actions: [{ label: t('desktop.channel.details'), onClick: openConfiguration }] } : {}}
    onDone={() => { dismiss(notice.sequence) }} {...notice.outcome === 'applied' ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular /> }} />
}
