/** The changed-files card, shown only while the Host serves the turn's summary, and explicitly declared files for a closing turn. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TurnTailOwnerProps } from '@janhq/jan-client-ui-chat/client'
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, SessionStandardProps } from '@janhq/jan-client-ui-slots'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { PresentedOpenController } from './present-open.ts'
import type { ChangesDiffStore } from './changes-diff.ts'
import type { ChangesSummaryStore } from './changes-summary.ts'
import { ChangedFiles } from './ChangedFiles.tsx'
import {
  changesForClosing, presentedForClosing, selectProducedFiles, type ChangesTurnData, type PresentedPath,
} from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import { changesSummaryUrl, type ChangesReviewCoordinates } from '../changes.ts'
import { presentedFileUrl } from '../presented.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import { inlinePreviewType, PresentedInlinePreview, type ReadPresented } from './PresentedInlinePreview.tsx'
import { fileAddressFor } from '@janhq/jan-util-workspace-path'
import type { InlineViewer } from '@janhq/jan-client-ui-sidebar-right/client'
import type { SessionId } from '@janhq/jan-session/types'
import css from './Deliverables.module.css'

/** `alone` is the turn's one file: its lone delivery, else its lone produced file, else the one local file its reply links. */
interface DeliverablesMatch {
  changes: ChangesTurnData | null
  presented: readonly PresentedPath[]
  alone?: { readonly path: string; readonly presented: boolean; readonly turn: number } | undefined
}

const COLLAPSED_PRESENTED_COUNT = 4

/** Summary reads, native-open callbacks, and shared gesture status supplied by the plugin. */
export interface DeliverablesInjected {
  hooks: {
    changesDiff: ObservableSnapshot<ReturnType<ChangesDiffStore['state']['getSnapshot']>>
    showCodeDiff: ObservableSnapshot<boolean>
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
    changesSummary: ObservableSnapshot<ReturnType<ChangesSummaryStore['state']['getSnapshot']>>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  loadChangesDiff: ChangesDiffStore['load']
  loadChangesSummary: ChangesSummaryStore['load']
  openPresented: PresentedOpenController['open']
  openChanged: PresentedOpenController['openChanged']
  /** Open one turn's review in the right Sidebar on the file at an index. */
  openChangesReview: (coordinates: ChangesReviewCoordinates, index: number) => void
  /** Read a lone delivery's bytes for its inline preview. */
  readPresented: ReadPresented
  /** Which right-Sidebar viewer would draw a resource in place. */
  inlineViewer: (address: string) => InlineViewer
  /** Draw a resource's right-Sidebar viewer into a chat container; returns the withdrawal. */
  embed: (sessionId: SessionId, address: string, container: HTMLElement, rank: number) => () => void
}

/**
 * Claim turns with a change announcement, declared files, or exactly one produced file.
 * @param owner - closing turn.
 * @returns matched announcement and deliveries, or null for a turn with none.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const changes = changesForClosing(owner)
  const presented = presentedForClosing(owner)
  const produced = presented.length === 0 ? selectProducedFiles(owner) : null
  const linked = presented.length === 0 && produced === null ? owner.turn.data.get('deliverables')?.linked : undefined
  const [only] = presented.length === 1 ? presented.map(file => file.path)
    : produced?.length === 1 ? produced
      : linked?.length === 1 ? linked : []
  const lone = only === undefined ? undefined : { path: only, presented: presented.length === 1 }
  const alone = lone === undefined ? undefined : { ...lone, turn: owner.turn.turn }
  return changes === null && presented.length === 0 && alone === undefined ? null : { changes, presented, alone }
}

/**
 * Contribute file deliveries alongside other completed-Turn artifacts.
 * @param props - closing Turn, file actions, and localized copy.
 * @returns file rows, or null when the Turn declares none.
 */
export function DeliverablesTail(props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS> & InjectFace<DeliverablesInjected> & PropsRenderSlots<'deliverables.file.actions' | 'deliverables.preview.actions'>) {
  const matched = selectDeliverables(props)
  return matched === null ? null : <Deliverables {...props} matched={matched} />
}

/**
 * Render the changed-files card, once the Host has served the announced
 * summary and it lists a file, and shared native opening controls for declared
 * files. A summary the Host no longer serves leaves no card.
 * @param props - matched announcement and files, workspace opener, and localized copy.
 * @returns the closing turn's file rows.
 */
export function Deliverables({
  matched, openFile, useContextMenu, t, sessionId, useSessions, openPresented, openChangesReview, usePresentedOpen, usePresentedHost,
  useChangesDiff, loadChangesDiff, useChangesSummary, reloadPresentedHost, loadChangesSummary, useShowCodeDiff, readPresented, renderSlot,
  inlineViewer, embed,
}: Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: DeliverablesMatch
} & PropsLocale<typeof NS> & Pick<SessionStandardProps, 'sessionId'> & Pick<GlobalStandardProps, 'useSessions' | 'useContextMenu'> & InjectFace<DeliverablesInjected> & PropsRenderSlots<'deliverables.file.actions' | 'deliverables.preview.actions'>) {
  const { getTriggerProps } = useContextMenu()
  const [expanded, setExpanded] = useState(false)
  const showCodeDiff = useShowCodeDiff(value => value)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const states = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const announced = showCodeDiff ? matched.changes : null
  const summary = useChangesSummary(value => announced === null ? undefined : value[changesSummaryUrl(sessionId, announced.seq)])
  useEffect(() => {
    if (announced !== null && summary === undefined) void loadChangesSummary(sessionId, announced.seq)
  }, [announced, summary, sessionId, loadChangesSummary])
  const changes = announced !== null && typeof summary === 'object' && summary.files.length > 0
    ? { seq: announced.seq, ...summary }
    : null
  const collapsible = matched.presented.length > COLLAPSED_PRESENTED_COUNT
  const presented = collapsible && !expanded
    ? matched.presented.slice(0, COLLAPSED_PRESENTED_COUNT)
    : matched.presented
  useEffect(() => {
    if (host === null) void reloadPresentedHost()
  }, [host, reloadPresentedHost])
  // Images and pages delivered alone already show in place; any other lone file shows the viewer the Sidebar would open.
  const alone = matched.alone !== undefined && !(matched.alone.presented && inlinePreviewType(matched.alone.path) !== undefined)
    ? matched.alone : undefined
  const viewer = alone === undefined ? null : <InlineViewerHost key={alone.path} sessionId={sessionId} cwd={cwd} file={alone}
    inlineViewer={inlineViewer} embed={embed} renderSlot={renderSlot} />
  return <>
    {changes !== null && <ChangedFiles changes={changes} cwd={cwd} t={t}
      sessionId={sessionId} useChangesDiff={useChangesDiff} loadChangesDiff={loadChangesDiff}
      openReview={(index) => { openChangesReview({ sessionId, seq: changes.seq, turn: changes.turn }, index) }} />}
    {matched.presented.length === 0 && viewer}
    {matched.presented.length > 0 && <div
      className={css.root}
      data-after-changes={changes !== null || undefined}
    >
      {host === 'error' && <div className={css.hostStatus}>
        <span>{t('presented.hostError')}</span>
        <Button size="sm" onClick={() => { void reloadPresentedHost() }}>{t('presented.retry')}</Button>
      </div>}
      {host !== null && host !== 'error' && !host.available && <span className={css.hostStatus}>{t('presented.unavailable')}</span>}
      {viewer}
      {matched.presented.length === 1 && matched.presented.map(file => <PresentedInlinePreview key={`${file.seq}:${file.index}`}
        file={file} sessionId={sessionId} readPresented={readPresented} onPreview={() => { openFile(file.path) }}
        renderSlot={renderSlot} t={t} />)}
      <div className={css.presented} data-presented-files-row data-single={matched.presented.length === 1 ? true : undefined}>
        {presented.map(file => <PresentedFileCard key={`${file.seq}:${file.index}`} file={file} cwd={cwd}
          phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
          host={host === 'error' ? null : host} t={t}
          onPreview={() => { openFile(file.path) }}
          contextMenuProps={getTriggerProps({ kind: 'file', value: { sessionId, path: file.path } })}
          actions={renderSlot('deliverables.file.actions', {
            actionUrl: presentedFileUrl(sessionId, file.seq, file.index),
            available: host !== null && host !== 'error' && host.available,
            pending: states[presentedFileUrl(sessionId, file.seq, file.index)] === 'opening'
              || states[presentedFileUrl(sessionId, file.seq, file.index)] === 'revealing',
            onAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application),
          })} />)}
      </div>
      {collapsible && <button type="button" className={css.toggle}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'presented.collapseAria' : 'presented.expandAria', { count: matched.presented.length })}
        onClick={() => { setExpanded(value => !value) }}>
        <span>{t(expanded ? 'presented.collapse' : 'presented.all', { count: matched.presented.length })}</span>
        {expanded ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
      </button>}
    </div>}
  </>
}

/**
 * Lend a container to the right Sidebar so the viewer it would open draws the
 * turn's lone file in the chat. A produced file shows only with a viewer made
 * for its content; a delivered one also with the generic file preview. The
 * Sidebar draws one such viewer per Session, the latest turn's, so an earlier
 * turn's container stays empty and collapses with its annotate actions.
 */
function InlineViewerHost({ sessionId, cwd, file, inlineViewer, embed, renderSlot }: {
  readonly sessionId: SessionId
  readonly cwd: string | undefined
  readonly file: { readonly path: string; readonly presented: boolean; readonly turn: number }
} & Pick<DeliverablesInjected, 'inlineViewer' | 'embed'> & Pick<PropsRenderSlots<'deliverables.preview.actions'>, 'renderSlot'>) {
  const container = useRef<HTMLDivElement>(null)
  const getSurface = useCallback(() => container.current, [])
  const address = fileAddressFor(sessionId, cwd, file.path)
  const kind = inlineViewer(address)
  const shown = kind === 'dedicated' || (kind === 'fallback' && file.presented)
  useLayoutEffect(() => shown ? embed(sessionId, address, container.current as HTMLDivElement, file.turn) : undefined,
    [shown, embed, sessionId, address, file.turn])
  return shown
    ? <div className={css.inlineViewerBlock}>
      <div ref={container} className={css.inlineViewer} data-presented-inline="viewer" />
      {renderSlot('deliverables.preview.actions', { getSurface })}
    </div>
    : null
}
