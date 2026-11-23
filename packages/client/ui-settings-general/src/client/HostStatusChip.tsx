/** Sidebar chip naming the computer a remote window works on and whether the link to it is up. */
import { StateDot, Tooltip, type StateDotState } from '@janhq/jan-client-ui-primitives'
import type { ConnectionState } from '@janhq/jan-client-connection/client'
import type { RemoteHostFacts } from '@janhq/jan-api-remotes/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import css from './HostStatusChip.module.css'

/** Registrant share: the reconnect command and the two Host observables the chip reads. */
export type HostStatusChipInjected = {
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  hooks: {
    /** Fixed Host facts; the chip renders only for a Host started over SSH. */
    hostInfo: HostObservable<RemoteHostFacts>
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
  }
}

/** Chip props read from the toggle-action owner share, the injected face and the settings locale seat. */
export type HostStatusChipProps =
  Pick<PropsRuntime<'sidebar.toggle.actions'>, 'tooltipSide' | 'portal'>
  & InjectFace<HostStatusChipInjected> & PropsLocale<'settings'>

const DOT: Readonly<Record<ConnectionState, StateDotState>> = {
  connected: 'done',
  connecting: 'warning',
  disconnected: 'error',
}

/**
 * Render the remote-computer chip: the Host's name and a dot for the link state.
 * A local window renders nothing, so the chip appears only where it tells the
 * person something. While the link is down the chip is a button that reconnects.
 * @param props - toggle-action owner share, Host observables and locale seat.
 * @returns the chip, or null for a local Host or before the first ready frame.
 */
export function HostStatusChip({ reconnect, useHostInfo, useConnectionState, tooltipSide, portal, t }: HostStatusChipProps) {
  const host = useHostInfo(info => info)
  const state = useConnectionState(value => value) ?? 'connecting'
  if (!host.remote || host.name === undefined) return null
  const name = host.name
  const status = t(`host.status.${state}`, { name })
  const down = state !== 'connected'
  const content = (
    <>
      <StateDot state={DOT[state]} />
      <span className={css.name}>{name}</span>
    </>
  )
  return (
    <Tooltip label={down ? t('host.status.reconnect', { name }) : status} side={tooltipSide} portal={portal} delayMs={300}>
      {down
        ? (
          <button type="button" className={css.chip} data-state={state} aria-label={t('host.status.reconnect', { name })} onClick={reconnect}>
            {content}
          </button>
        )
        : <span className={css.chip} data-state={state} role="status" aria-label={status}>{content}</span>}
    </Tooltip>
  )
}
