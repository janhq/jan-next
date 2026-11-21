/**
 * The started session's agent-preset chip, under its composer.
 *
 * A started session keeps every message it already has; what a switch changes
 * is the composition its NEXT turn runs under. The Host accepts the selection
 * only at a turn boundary (no open turn), appends it to the durable log, and
 * refuses while a reply is still running — which is why the control disables
 * itself for that window instead of promising a swap it cannot make.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@janhq/jan-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, IconWarningOutlineRegular, Menu, Toast,
} from '@janhq/jan-client-ui-primitives'
import type { SessionId } from '@janhq/jan-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the composer preset seat).
import type { } from '@janhq/jan-client-ui-conversation/client'
import type { } from '@janhq/jan-agent-preset-registry/types'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import { requiresCodingTools } from './settings-store.ts'
import css from './AgentPresetSeat.module.css'

/** Registration-side business face for the composer chip. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
    /** Shared Developer tools preference; off hides the PTC and Minimal choices. */
    developerTools: ObservableSnapshot<boolean>
  }
  /** Read the roster, so the control can show a name rather than an id. */
  load: () => Promise<void>
  /**
   * Commit one preset for this Session at its next turn boundary.
   * @param sessionId - the Session whose later turns change.
   * @param id - the preset to run.
   * @returns the Host refusal text, or undefined once the selection is logged.
   */
  select: (sessionId: SessionId, id: string) => Promise<string | undefined>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.composer.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/** Duration of a switch-refusal banner. */
const REFUSAL_HOLD_MS = 8000

/**
 * Render this session's agent preset with its switch menu.
 * @param props - composed slot props.
 * @returns the control, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, useDeveloperTools, load, select, t,
}: AgentPresetLabelProps) {
  const preset = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  })
  const running = useSessions(state => state.byId[sessionId]?.running === true)
  const options = useAgentPresets(state => state.options)
  const developerTools = useDeveloperTools(value => value)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ seq: number; id: string; reason: string } | null>(null)
  const refusalSeq = useRef(0)
  const control = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  const choices = useMemo(
    () => options.filter(option => developerTools || !requiresCodingTools(option)),
    [options, developerTools],
  )

  // A state change that can move the roster under an open menu closes it: a
  // hidden default or a session that starts running leaves nothing to pick.
  useEffect(() => {
    setOpen(false)
  }, [developerTools, choices.length, running])

  if (preset === undefined) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  const name = text?.name ?? preset
  const hint = running ? t('switchBusy') : t('headerHint')

  return (
    <>
      <Menu
        open={open && !running}
        onClose={() => { setOpen(false) }}
        items={choices.map((entry) => {
          const display = presetDisplayText(entry, t)
          return {
            id: entry.id,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{display.name}</span>
                <span className={css.itemDesc}>{display.description ?? t('noDescription')}</span>
              </span>
            ),
          }
        })}
        selectedId={preset}
        onSelect={(id) => {
          setOpen(false)
          if (id === preset) return
          setBusy(true)
          void select(sessionId, id).then((reason) => {
            if (reason === undefined) return
            refusalSeq.current += 1
            setRefusal({ seq: refusalSeq.current, id, reason })
          }).catch((error: unknown) => {
            refusalSeq.current += 1
            setRefusal({ seq: refusalSeq.current, id, reason: error instanceof Error ? error.message : String(error) })
          }).finally(() => { setBusy(false) })
        }}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            ref={control}
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open && !running}
            aria-label={`${hint}: ${name}`}
            title={hint}
            disabled={busy || running || choices.length === 0}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconAgentPresetOutlineRegular className={css.seatIcon} />
            <span className={css.seatLabel}>{name}</span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
      {refusal === null ? null : (
        <Toast
          key={refusal.seq}
          text={t('switchRefused', {
            name: presetDisplayText(choices.find(entry => entry.id === refusal.id) ?? { id: refusal.id }, t).name,
            reason: refusal.reason,
          })}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          anchor={control.current}
          onDone={() => { setRefusal(null) }}
        />
      )}
    </>
  )
}
