/** The right Sidebar's viewer drawn in the chat: under a finished turn, and live under a running one. */
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { InlineViewer } from '@janhq/jan-client-ui-sidebar-right/client'
import type { SessionId } from '@janhq/jan-session/types'
import { fileAddressFor } from '@janhq/jan-util-workspace-path'
import css from './Deliverables.module.css'

/** What the inline viewer needs from the right Sidebar. */
export interface InlineViewerInjected {
  /** Which right-Sidebar viewer would draw a resource in place. */
  inlineViewer: (address: string) => InlineViewer
  /** The page a turn's tool calls are changing, as an address `embed` draws. */
  inlinePageForTools: (tools: readonly string[]) => string | undefined
  /** Draw a resource's right-Sidebar viewer into a chat container; returns the withdrawal. */
  embed: (sessionId: SessionId, address: string, container: HTMLElement, rank: number) => () => void
}

/**
 * Lend a container to the right Sidebar so the viewer for an address draws in
 * the chat. The Sidebar draws one viewer per Session, the highest-ranked
 * (latest turn's), so an earlier turn's container stays empty and collapses
 * with its actions.
 */
export function InlineViewerHost({ sessionId, address, rank, embed, renderActions }: {
  readonly sessionId: SessionId
  readonly address: string
  readonly rank: number
  readonly embed: InlineViewerInjected['embed']
  readonly renderActions: (getSurface: () => HTMLElement | null) => ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const getSurface = useCallback(() => container.current, [])
  useLayoutEffect(() => embed(sessionId, address, container.current as HTMLDivElement, rank), [embed, sessionId, address, rank])
  return <div className={css.inlineViewerBlock}>
    <div ref={container} className={css.inlineViewer} data-presented-inline="viewer" />
    {renderActions(getSurface)}
  </div>
}

/**
 * The viewer a turn shows in place: a file with a viewer made for it, else
 * the page its tool calls change.
 * @param files - candidate files, latest last; each with whether it was delivered.
 * @returns the address to draw, or undefined.
 */
export function inlineTarget(
  sessionId: SessionId, cwd: string | undefined, files: readonly { readonly path: string; readonly presented: boolean }[],
  tools: readonly string[], { inlineViewer, inlinePageForTools }: Pick<InlineViewerInjected, 'inlineViewer' | 'inlinePageForTools'>,
): string | undefined {
  for (let index = files.length - 1; index >= 0; index--) {
    const file = files[index]
    if (file === undefined) continue
    const address = fileAddressFor(sessionId, cwd, file.path)
    const kind = inlineViewer(address)
    if (kind === 'dedicated' || (kind === 'fallback' && file.presented)) return address
  }
  return inlinePageForTools(tools)
}

/**
 * Show what a running turn is building as it builds it: the latest file it
 * wrote, delivered, or linked that has a viewer made for it, else the page its
 * tool calls change (CAD while `cad_` tools run). Ranked by the turn, it takes
 * the Session's one viewer from earlier turns; the turn's tail takes it over
 * once the turn ends.
 */
export function DeliverablesLive({ turn, sessionId, useSessions, renderSlot, inlineViewer, inlinePageForTools, embed }:
PropsRuntime<'conversation.chat.running-tail'> & InjectFace<InlineViewerInjected> & PropsRenderSlots<'deliverables.live.actions'>) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const data = turn.data.get('deliverables')
  const files = [
    ...(data?.produced ?? []).map(file => ({ path: file.path, presented: false })),
    ...(data?.linked ?? []).map(path => ({ path, presented: false })),
    ...(data?.presented ?? []).map(file => ({ path: file.path, presented: true })),
  ]
  const address = inlineTarget(sessionId, cwd, files, data?.tools ?? [], { inlineViewer, inlinePageForTools })
  return address === undefined ? null : <InlineViewerHost key={address} sessionId={sessionId} address={address} rank={turn.turn}
    embed={embed} renderActions={getSurface => renderSlot('deliverables.live.actions', { getSurface })} />
}
