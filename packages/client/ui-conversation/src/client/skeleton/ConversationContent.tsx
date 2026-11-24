import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@janhq/jan-workspace/types'
import { workspaceDisplayTitle } from '@janhq/jan-api-workspace-controller/default-workspace'
import type { ConversationContentProps, ConversationViewsProps, InputZone } from '../contract/slots.ts'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

function ConversationSessionView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', {})
}

function NoConversationWidthControls() {
  return null
}

/**
 * Render the shared Conversation body and its occurrence-selected local Components.
 * @param props - Factory input, standard Session sources, and Conversation seats.
 * @returns the Conversation view, Composer, and optional width controls.
 */
export function ConversationContent(props: ConversationContentProps) {
  const {
    sessionId, phase, hero, useSession, useSessions, useSessionStatus,
    useWorkspaces, useInput, useAccess, useComposerBlock, renderSlot, renderSlotChain,
    selectWorkspace, openDefaultDraft, pickSuggestion, t, useFactorySlot, useHeroPlaceholder,
  } = props
  const session = useSession(snapshot => snapshot)
  const Views = useFactorySlot('views', ConversationSessionView)
  const WidthControls = useFactorySlot('widthControls', NoConversationWidthControls)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const pendingInteraction = useSessionStatus(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId)?.pendingInteraction)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)
  const heroPlaceholder = useHeroPlaceholder(text => text)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const [pendingAgent, setPendingAgent] = useState<{ id: string | null; workspaceId?: WorkspaceId }>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  const composerStack = useRef<HTMLDivElement>(null)

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --jan-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --jan-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--jan-composer-height', `${seat.offsetHeight}px`)
      scroller.style.setProperty(
        '--jan-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      )
    })
    seatObserver.current.observe(seat)
    seatObserver.current.observe(scroller)
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  useEffect(() => {
    if (sessionId !== undefined) setPendingAgent(undefined)
  }, [sessionId])

  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  // A title still automatic reads in the reader's language, matching the
  // sidebar row the same Workspace has there.
  const chipWorkspace = pendingWorkspace ?? (sessionId === undefined ? undefined : sessionWorkspace)
  const defaultWorkspaceId = sessionId === undefined ? workspaces.items.find(workspace => workspace.isDefault)?.workspaceId : undefined
  const agentWorkspaceId = chipWorkspace?.workspaceId ?? defaultWorkspaceId
  const pendingMatches = pendingAgent?.workspaceId === undefined || pendingAgent.workspaceId === agentWorkspaceId
  const chipTitle = chipWorkspace === undefined
    ? sessionId === undefined || workspaces.phase === 'ready' || cwd === undefined || cwd === '' ? undefined : workspaceLabel(cwd)
    : workspaceDisplayTitle(chipWorkspace, t('workspace.defaultName'))

  // A started chat keeps its project label fixed, while its mode and agent can change between turns.
  const workspaceLocked = phase === 'active'
  const workspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen && !workspaceLocked}
        locked={workspaceLocked}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen && !workspaceLocked,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          const readText = sessionId === undefined ? () => {
            const input = composerStack.current?.querySelector<HTMLDivElement>('[data-composer-input]')
            return input?.innerText ?? input?.textContent ?? ''
          } : undefined
          const profile = sessionId === undefined && (pendingAgent?.workspaceId === undefined || pendingAgent.workspaceId === workspaceId)
            ? pendingAgent?.id : undefined
          void (profile !== undefined ? selectWorkspace(workspaceId, readText, profile)
            : readText === undefined ? selectWorkspace(workspaceId) : selectWorkspace(workspaceId, readText)).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {hero
        ? renderSlot('conversation.hero.agentPreset', {})
        : sessionId === undefined ? null : renderSlot('conversation.composer.agentPreset', {})}
      {chipWorkspace?.hostId === undefined && (hero
        ? renderSlot('conversation.hero.agentProfile', {
          workspaceId: agentWorkspaceId,
          pending: sessionId === undefined && pendingMatches ? pendingAgent?.id : undefined,
          onPick: (id, scope) => {
            setPendingAgent({ id, ...scope === 'project' && agentWorkspaceId !== undefined ? { workspaceId: agentWorkspaceId } : {} })
          },
        })
        : sessionId === undefined ? null : renderSlot('conversation.composer.agentProfile', { workspaceId: agentWorkspaceId }))}
      {hero && sessionId !== undefined ? <div className={css.heroOptions}>{renderSlot('conversation.hero.options', {})}</div> : null}
    </div>
  )

  // A sessionless home opens the default draft on interaction, never on render.
  const pendingDefaultAgent = pendingAgent?.workspaceId === undefined || pendingAgent.workspaceId === defaultWorkspaceId
    ? pendingAgent?.id : undefined
  const activateDraft = sessionId === undefined && hero && props.variant !== 'embedded' && openDefaultDraft !== undefined
    ? pendingDefaultAgent === undefined ? openDefaultDraft : (readText: () => string) => openDefaultDraft(readText, pendingDefaultAgent)
    : undefined
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const promptDenied = useAccess('session/prompt') === false
  const suggestionsDisabled = inert || blocked || promptDenied || session === undefined || session.removed
    || session.subagent !== null || inputState === undefined
    || (inputState.phase !== 'plain' && inputState.phase !== 'claimed')
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    // Embedded active panes and subagent transcripts do not own the project row.
    ...(hero || (sessionId !== undefined && props.variant !== 'embedded' && (session === undefined || session.subagent === null))
      ? { dockStart: workspaceRow }
      : {}),
    ...(activateDraft !== undefined
      ? { onActivateDraft: activateDraft, placeholder: heroPlaceholder ?? t('placeholder.hero') }
      : inert
        ? {
          disabled: true,
          placeholder: t('placeholder.workspace'),
          workspacePickerOpen: pickerOpen,
          onRequestWorkspace: () => { setPickerOpen(true) },
        }
        : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
          ? { blocked: composerBlock, placeholder: composerBlock.reason }
          : hero ? { placeholder: heroPlaceholder ?? t('placeholder.hero') } : {}),
  })

  const composerBar = (
    <div ref={composerStack} className={clsx(css.composerStack, hero && css.composerHero)}>
      {/* An embedded home sits under its host's own heading, so it skips the greeting. */}
      {hero && props.variant !== 'embedded' && <HeroShell t={t} renderSlot={renderSlot} />}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
      {hero && renderSlot('conversation.hero.suggestions', {
        disabled: suggestionsDisabled,
        onPick: (text) => { if (!suggestionsDisabled) pickSuggestion(text) },
      })}
    </div>
  )

  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave a business-owned takeover at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="" data-conversation-region="composer">
      {composer}
    </div>
  )

  return (
    <div
      ref={setBody}
      className={clsx(css.body, props.variant === 'embedded' && css.embeddedBody)}
      data-conversation-content=""
      data-conversation-session={sessionId}
      data-conversation-region="chat"
      data-content-phase={phase}
    >
      {/* The frame wraps the scroll body in every phase, so leaving the home keeps the composer mounted. */}
      {renderSlot('conversation.hero.frame', { hero: hero && props.variant !== 'embedded' }, {
        children: (
          <div className={css.scrollBody} data-conversation-scroll="">
            {sessionId === undefined ? null : <Views />}
            {composerSeat}
          </div>
        ),
      })}
      <WidthControls container={body} phase={phase} />
    </div>
  )
}
