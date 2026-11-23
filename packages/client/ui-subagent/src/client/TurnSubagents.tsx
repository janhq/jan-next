/** A closed Turn's subagents, on its duration header line: a count that opens their rows below the line. */
import { useId, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-chat/client'
import { catalogProgress, useCatalogs } from './catalog-state.ts'
import type { SubagentCatalogInjected } from './SubagentHeaderLineage.tsx'
import { SubagentRowList } from './SubagentRoster.tsx'
import type { NS } from './locales.ts'
import css from './SubagentRoster.module.css'

/** Full props of the turn header's subagent entry. */
export type TurnSubagentsProps = PropsRuntime<'conversation.chat.turn-process.trailing'>
  & InjectFace<SubagentCatalogInjected> & PropsLocale<typeof NS>

/**
 * List the subagents a closed Turn spawned, matched by creation time within the Turn's bounds.
 * @param props - the Turn, Session catalog sources, navigation actions and translator.
 * @returns The count and progress with a disclosure, or null when the Turn spawned none.
 */
export function TurnSubagents({
  sessionId, turn, useSessions, useSessionStatus, openChild, openChildAside, refreshProjection, t,
}: TurnSubagentsProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const { catalogs, summaries } = useCatalogs({ useSessions, useSessionStatus })
  const start = turn.start?.time
  const end = turn.end?.time
  if (turn.status !== 'closed' || start === undefined || end === undefined) return null
  const entries = (catalogs[sessionId]?.entries ?? []).filter(entry => entry.createdAt >= start && entry.createdAt <= end)
  if (entries.length === 0) return null
  const progress = catalogProgress(entries, summaries, t)
  return (
    <>
      <button type="button" className={`${css.header} ${css.turnHeader}`} aria-expanded={open} aria-controls={panelId}
        data-turn-subagents={entries.length} onClick={() => { setOpen(!open) }}>
        <span>{t(entries.length === 1 ? 'count.total.one' : 'count.total.other', { count: entries.length })}</span>
        {progress !== '' && <span className={css.progress}>{progress}</span>}
        <IconChevronDownOutlineRegular size={12} className={css.chevron} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className={`${css.panel} ${css.turnPanel}`} data-subagent-panel>
          <SubagentRowList parentSessionId={sessionId} entries={entries} catalogs={catalogs} summaries={summaries}
            openChild={openChild} openChildAside={openChildAside} refreshProjection={refreshProjection} t={t} />
        </div>
      )}
    </>
  )
}
