/** Main-desk controls carried through the existing Conversation slot tree. */
import { createContext, useContext, useState } from 'react'
import { Button, IconCloseOutlineRegular, Menu, Tooltip } from '@janhq/jan-client-ui-primitives'
import type { SessionId } from '@janhq/jan-session/types'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import css from './ConversationDesk.module.css'

/** Picker rows refer to the existing Session catalog, not new chat instances. */
export interface DeskChoice {
  readonly id: SessionId
  readonly label: string
}

/** Controls scoped to the pane whose Conversation header is rendering. */
export interface ConversationDeskSeat {
  readonly leading: boolean
  readonly primary: boolean
  readonly status?: 'running' | 'done' | undefined
  readonly close?: (() => void) | undefined
  readonly toolbar?: ConversationDeskToolbarProps | undefined
}

/** The root desk supplies controls only to main Conversation occurrences. */
export const ConversationDeskContext = createContext<ConversationDeskSeat | undefined>(undefined)

/** Layout actions and picker rows for the first visible header. */
export interface ConversationDeskToolbarProps {
  readonly active: boolean
  readonly runningCount: number
  readonly limitReached: boolean
  readonly choices: readonly DeskChoice[]
  readonly overflow: readonly DeskChoice[]
  readonly toggleActive: () => void
  readonly openBeside: (id: SessionId) => void
  readonly focusActive: (id: SessionId) => void
}

/** Accessible menu of Sessions, shared by split and overflow. */
function DeskPicker({ label, choices, select, compact }: {
  readonly label: string
  readonly choices: readonly DeskChoice[]
  readonly select: (id: SessionId) => void
  readonly compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu open={open} onClose={() => { setOpen(false) }} portal autoFocus align="end"
      items={choices} onSelect={(id) => {
        setOpen(false)
        select(id as SessionId)
      }}
      anchor={(
        <Button size="sm" className={css.action} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          {!compact && <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
            <path d="M8 3v10" />
          </svg>}
          {label}
        </Button>
      )}
    />
  )
}

/** In-header desk controls; omitted outside the main multi-Session layout. */
export function ConversationDeskActions({ t }: { readonly t: TranslateNS<'conversation'> }) {
  const seat = useContext(ConversationDeskContext)
  if (seat === undefined) return null
  const { toolbar, close, status } = seat
  if (toolbar === undefined && close === undefined && status === undefined) return null
  const activeLabel = toolbar?.active === true ? t('desk.restore') : t('desk.active', { n: toolbar?.runningCount ?? 0 })
  const statusLabel = status === undefined ? undefined : t(status === 'running' ? 'desk.running' : 'desk.done')
  return (
    <div className={css.actions}>
      {statusLabel !== undefined && <span className={css.status} data-desk-status={status}>{statusLabel}</span>}
      {toolbar !== undefined && (
        <>
          {toolbar.active
            ? toolbar.overflow.length > 0 && (
              <DeskPicker key="overflow" compact label={t('desk.overflow', { n: toolbar.overflow.length })}
                choices={toolbar.overflow} select={toolbar.focusActive} />
            )
            : toolbar.choices.length > 0 && (
              <DeskPicker key="split" label={t('desk.split')} choices={toolbar.choices} select={toolbar.openBeside} />
            )}
          {!toolbar.active && toolbar.limitReached && (
            <Tooltip label={t('desk.limit')} portal>
              <span className={css.limit} tabIndex={0} aria-label={t('desk.limit')}>{t('desk.split')}</span>
            </Tooltip>
          )}
          <Tooltip label={t(toolbar.active ? 'desk.restore' : 'desk.activeHint')} portal>
            <Button size="sm" className={css.action} aria-pressed={toolbar.active} onClick={toolbar.toggleActive}>
              {activeLabel}
            </Button>
          </Tooltip>
        </>
      )}
      {close !== undefined && (
        <Tooltip label={t('desk.close')} portal>
          <Button size="sm" className={css.close} aria-label={t('desk.close')} onClick={close}>
            <IconCloseOutlineRegular size={14} />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
