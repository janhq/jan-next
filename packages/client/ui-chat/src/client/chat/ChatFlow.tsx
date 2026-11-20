/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
import { memo, type ReactElement } from 'react'
import type { PendingSubmission } from '@janhq/jan-api-session-controller/client'
import { assertNever } from '@janhq/jan-util-values'
import type { ChatFlowSlotProps, RunningDetailOwnerProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'
import { RunningStatus } from './RunningStatus.tsx'

const RUNNING_DETAIL_OWNER: RunningDetailOwnerProps = {}
const TOOL_LABEL_PREFIX_LENGTH = 160

function latestTurn({ timeline }: ChatSnapshot) {
  const turn = timeline.turnOrder.at(-1)
  return turn === undefined ? undefined : timeline.turns.get(turn)
}

function runningPhaseLabel(snapshot: ChatSnapshot, t: ChatFlowSlotProps['t'], detail: boolean): string {
  const turn = latestTurn(snapshot)
  const step = turn?.steps.at(-1)
  if (turn === undefined || turn.status === 'closed' || step === undefined || step.status === 'closed') {
    return t('chat.running.working')
  }

  // A step's calls run in order, so the earliest unfinished one is the one executing; later ones are queued.
  const tool = snapshot.legacy.runningCalls.find(call => call.turn === turn.turn && call.step === step.step)
  if (tool !== undefined) {
    if (!detail) return t('chat.running.tool', { tool: tool.name })
    const title = tool.args.textPrefix('title', TOOL_LABEL_PREFIX_LENGTH)?.trim()
    const description = title ? undefined : tool.args.textPrefix('description', TOOL_LABEL_PREFIX_LENGTH)?.trim()
    return t('chat.running.tool', { tool: title || description || tool.name })
  }

  const assistant = step.data.get('assistant-step')
  if (assistant?.status === 'running' && assistant.streamingPhase !== undefined) {
    return t(`chat.running.${assistant.streamingPhase}`)
  }
  return step.status === 'open' && (assistant === undefined || assistant.status === 'running')
    ? t('chat.running.waiting')
    : t('chat.running.working')
}

/** A local submission echo, or a Host-pending steering item without a local submission. */
type PendingInput = ChatFlowSlotProps['pendingInputs'][number]

/** Whether the echo is a local submission rather than a Host-pending steering item. */
function isLocalSubmission(item: PendingInput): item is PendingSubmission {
  return 'requestId' in item
}

/** Whether the echo is a local submission that opens a new Turn. */
function isTranscriptEcho(item: PendingInput): boolean {
  return isLocalSubmission(item) && item.placement === 'transcript'
}

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, pendingInputs, lastInputTurn, deferCollapse,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation, useConnectionState,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, loadImage,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const running = useSession(snapshot => snapshot.running)
  const disconnected = useConnectionState(state => state === 'disconnected' || state === 'connecting')
  const turn = useChat(latestTurn)
  const runningStartTime = turn?.status === 'open' ? turn.start?.time : undefined
  const latestTurnOpen = turn?.status === 'open'
  const phaseLabel = useChat(snapshot => running ? runningPhaseLabel(snapshot, t, true) : t('chat.running.working'))
  const announcement = useChat(snapshot => running ? runningPhaseLabel(snapshot, t, false) : t('chat.running.working'))
  const holding = !running && latestTurnOpen
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, inspectCall, forkAt, loadImage,
  }
  const rows = entries.map((entry) => {
    switch (entry.kind) {
      case 'node':
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} paused={disconnected} />
      default:
        return assertNever(entry)
    }
  })
  // Transcript echoes open the running Turn and precede the status; steering
  // and Inbox echoes follow it, so the status stays on the running Turn's tail.
  // The first transcript echo opens the next Turn, whose first claim takes the
  // steering already pending ahead of it before that prompt; those echoes lead
  // the same Turn in claim order.
  const firstTranscript = pendingInputs.findIndex(isTranscriptEcho)
  const leadingRows: ReactElement[] = []
  const openingRows: ReactElement[] = []
  const pendingRows: ReactElement[] = []
  for (const [index, item] of pendingInputs.entries()) {
    const row = isLocalSubmission(item)
      ? <PendingSubmissionBubble key={item.requestId} submission={item}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
      : <PendingSteeringBubble key={item.id} content={item.content}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
    if (index <= firstTranscript) leadingRows.push(row)
    else if (isTranscriptEcho(item)) openingRows.push(row)
    else pendingRows.push(row)
  }
  const tail = entries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows the echoes that lead its Turn.
  // All rows share this keyed list so inserting the control keeps the echoes mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    rows.splice(rows.length - 1, 0, ...leadingRows.splice(0))
  }
  // Rows enter before the keyed status and echoes after it, so React never moves its DOM node. The
  // running bit and the Turn's end arrive separately: after the bit clears, an open latest Turn keeps
  // the status slot (hidden) until its actions row takes the slot in the same commit.
  return [
    ...rows, ...leadingRows, ...openingRows,
    ...running || holding ? [<RunningStatus key="running" phaseLabel={phaseLabel} startTime={runningStartTime}
      announcement={announcement}
      paused={disconnected} holding={holding} t={t}
      detail={holding ? null : renderSlot('conversation.chat.running-detail', RUNNING_DETAIL_OWNER)} />] : [],
    ...pendingRows,
  ]
})
