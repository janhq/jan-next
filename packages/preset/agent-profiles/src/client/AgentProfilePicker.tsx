/** Agent choice for a sessionless hero or a chat with a durable selection. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import {
  IconChevronDownOutlineRegular, IconUserOutlineRegular, IconWarningOutlineRegular,
  Menu, Tag, Toast, Tooltip, captureFailure, type FailureDetails, type MenuEntry,
} from '@janhq/jan-client-ui-primitives'
import type {} from '@janhq/jan-client-ui-conversation/client'
import type { AgentProfileList, AgentProfileListRequest, AgentProfileSelectRequest, AgentProfileSummary } from '../types.ts'
import css from './AgentProfiles.module.css'

/** Menu and `/agent` value for plain Jan; profile ids cannot contain a colon, so no profile collides. */
export const JAN = 'jan:no-profile'
const MANAGE = 'jan:manage-profiles'
const CREATE = 'jan:new-profile'

type Locale = PropsLocale<'agentProfiles'>

/** Data and actions contributed by the Agent Profiles Client. */
export interface AgentProfilePickerInjected {
  /** Follow catalog changes; the picker watches only while its menu is open. */
  readonly watchChanges: (onChange: () => void) => () => void
  readonly list: (request: AgentProfileListRequest) => Promise<AgentProfileList>
  readonly select: (request: AgentProfileSelectRequest) => Promise<'locked' | undefined>
  /** Open Settings > Agents; `create` also opens the new-agent editor there. */
  readonly manage: (intent?: 'create') => void
}

type Hero = PropsRuntime<'conversation.hero.agentProfile'>

/** Shared picker props; only the hero supports staging before a chat exists. */
export type AgentProfilePickerProps = Pick<Hero, 'sessionId' | 'workspaceId' | 'useSessions' | 'useProjection'>
  & Partial<Pick<Hero, 'pending' | 'onPick'>> & InjectFace<AgentProfilePickerInjected> & Locale

/**
 * Show the source badge and any unmapped values for a profile.
 * @param props - profile metadata and feature translations.
 * @returns the source and warnings that are present.
 */
export function ProfileBadges({ profile, t }: Locale & { profile: AgentProfileSummary }) {
  const warnings = profile.warnings.join('\n')
  return <>
    {profile.source !== 'jan' && <Tag>{t(`source.${profile.source}`)}</Tag>}
    {warnings !== '' && <Tooltip label={warnings} portal>
      <span className={css.warning} aria-label={t('warnings', { warnings })}>
        <IconWarningOutlineRegular size={14} aria-hidden="true" />
      </span>
    </Tooltip>}
  </>
}

/**
 * Show the selected agent, and fetch usable choices and follow their changes only while the menu is open.
 * @param props - chat identity, optional hero stage, and injected operations.
 * @returns the chip, its selection menu, and the most recent refused operation.
 */
export function AgentProfilePicker({ sessionId, workspaceId, pending, onPick, useSessions, useProjection, watchChanges,
  list, select, manage, t }: AgentProfilePickerProps) {
  const recorded = useProjection('agentProfile')
  const running = useSessions(state => sessionId !== undefined && state.byId[sessionId]?.running === true)
  const selected = sessionId === undefined ? pending : recorded
  const name = selected ?? t('jan')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ workspaceId: typeof workspaceId; profiles: readonly AgentProfileSummary[] | null }>()
  // A lock is the chat's state, not a failure, so only real failures carry details.
  const [refusal, setRefusal] = useState<{ key: number; reason: 'locked' | 'selectError' | 'manageError'; failure?: FailureDetails }>()
  const attempt = useRef(0)
  const visible = open && !running
  const [revision, setRevision] = useState(0)
  useEffect(() => visible ? watchChanges(() => { setRevision(value => value + 1) }) : undefined, [visible, watchChanges])
  useEffect(() => {
    if (running) setOpen(false)
  }, [running])
  useEffect(() => {
    if (!visible) return
    let current = true
    const loadForProject = async () => {
      try {
        const { profiles } = await list(workspaceId === undefined ? {} : { workspaceId })
        if (current) setLoad({ workspaceId, profiles: profiles.filter(profile => profile.use !== 'subagent' && profile.shadowedBy === undefined) })
      } catch {
        // Keep the chip and management action available when the catalog read fails.
        if (current) setLoad({ workspaceId, profiles: null })
      }
    }
    void loadForProject()
    return () => { current = false }
  }, [list, revision, visible, workspaceId])

  const profiles = load?.workspaceId === workspaceId ? load?.profiles : undefined
  const items: MenuEntry[] = [{ id: JAN, label: t('noAgent') }]
  if (visible && profiles) for (const scope of ['project', 'global'] as const) {
    const group = profiles.filter(profile => profile.scope === scope)
    if (group.length === 0) continue
    items.push({ type: 'label', id: `heading:${scope}`, text: t(`group.${scope}`) })
    for (const profile of group) items.push({ id: profile.id, label: <span className={css.menuProfile}>
      <span className={css.menuHeading}><span className={css.ellipsis}>{profile.id}</span><ProfileBadges profile={profile} t={t} /></span>
      {profile.description !== '' && <span className={css.menuDescription}>{profile.description}</span>}
    </span> })
  }
  const choose = async (key: string) => {
    setOpen(false)
    const notice = ++attempt.current
    if (key === MANAGE || key === CREATE) {
      try { manage(key === CREATE ? 'create' : undefined) } catch (error) { setRefusal({ key: notice, reason: 'manageError', failure: captureFailure('agentProfiles.manage', error) }) }
      return
    }
    const id = key === JAN ? null : key
    if (sessionId === undefined) {
      onPick?.(id, profiles?.find(profile => profile.id === id)?.scope)
      return
    }
    setBusy(true)
    try {
      const reason = await select({ sessionId, id })
      if (reason !== undefined) setRefusal({ key: notice, reason })
    } catch (error) {
      setRefusal({ key: notice, reason: 'selectError', failure: captureFailure('agentProfiles.select', error) })
    } finally {
      setBusy(false)
    }
  }
  return <>
    <Menu portal side="top" open={visible} onClose={() => { setOpen(false) }} items={items}
      className={css.chipAnchor} listClassName={css.menu} selectedId={selected ?? JAN}
      footer={[{ id: CREATE, label: t('new') }, { id: MANAGE, label: t('manage') }]}
      header={visible && (profiles === undefined || profiles === null) ? <div className={css.menuStatus}
        role={profiles === null ? 'alert' : 'status'}>{t(profiles === null ? 'listError' : 'loading')}</div> : undefined}
      onSelect={(id) => { void choose(id) }}
      anchor={<button type="button" className={css.chip} aria-haspopup="menu" aria-expanded={visible}
        aria-label={t('choose', { name })} title={running ? t('locked') : t('choose', { name })}
        disabled={running || busy} onClick={() => {
          if (!open) setLoad(undefined)
          setOpen(!open)
        }}>
        <IconUserOutlineRegular size={16} aria-hidden="true" />
        <span className={css.ellipsis}>{name}</span>
        <IconChevronDownOutlineRegular size={14} aria-hidden="true" />
      </button>} />
    {refusal !== undefined && <Toast key={refusal.key} text={t(refusal.reason)} failure={refusal.failure}
      icon={<IconWarningOutlineRegular />} holdMs={8000} onDone={() => { setRefusal(undefined) }} />}
  </>
}
