/** Mount active capture outside disclosure groups so consent never sits inside an inert peek. */
import type { ChatNode } from '@janhq/jan-client-ui-chat/client'
import type { ConversationNodeDefinitionInput } from '@janhq/jan-client-ui-conversation/client'
import type {} from '@janhq/jan-tool-executor-ptc/types'
import { isAppendSurfaceEvent } from '@janhq/jan-session/surface'
import type { CaptureMode } from './contract.ts'

interface CaptureNodeData {
  readonly mode: CaptureMode
  readonly reason: string
}

declare module '@janhq/jan-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** An interactive camera or microphone capture awaiting the user's input. */
    'media-capture': CaptureNodeData
  }
}

function captureMode(name: string, value: unknown): CaptureMode | undefined {
  if (name === 'capture_audio') return 'audio'
  if (name === 'capture_camera' && (value === 'photo' || value === 'video')) return value
  return undefined
}

function readRequest(name: string, args: unknown): CaptureNodeData | null {
  if (typeof args !== 'object' || args === null || !('reason' in args) || typeof args.reason !== 'string') return null
  const mode = captureMode(name, 'mode' in args ? args.mode : undefined)
  const reason = args.reason.trim()
  return mode !== undefined && reason.length > 0 && reason.length <= 300 ? { mode, reason } : null
}

function isCaptureTool(name: string): boolean {
  return name === 'capture_camera' || name === 'capture_audio'
}

/** Pair native calls and PTC subcalls with their own settling events. */
export const captureNodeDefinition: ConversationNodeDefinitionInput<CaptureNodeData | null> = {
  kind: 'media-capture', target: 'chat',
  match: {
    'tool/call': event => event.type === 'tool/call' && isCaptureTool(event.data.name)
      ? { id: event.data.callId, role: 'start' } : null,
    'tool/ptc-dispatch-start': event => event.type === 'tool/ptc-dispatch-start' && isCaptureTool(event.data.name)
      ? { id: event.data.subCallId, role: 'start' } : null,
    'tool/result': event => event.type === 'tool/result' && isAppendSurfaceEvent(event)
      ? { id: event.data.message.source.callId, role: 'update' } : null,
    'tool/ptc-dispatch': event => event.type === 'tool/ptc-dispatch' && isCaptureTool(event.data.name)
      ? { id: event.data.subCallId, role: 'update' } : null,
  },
  start(_context, { event }) {
    if (event.type === 'tool/ptc-dispatch-start') return readRequest(event.data.name, event.data.arguments)
    if (event.type !== 'tool/call') return null
    try {
      const args: unknown = JSON.parse(event.data.arguments)
      return readRequest(event.data.name, args)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return null
    }
  },
  update: () => null,
  buildViewNode(context) {
    const data = context.state
    const start = context.start
    const location = start?.location
    if (data == null || start === undefined || location === undefined
      || ((location.kind === 'turn' || location.kind === 'step') && location.turn.status === 'closed')
      || (location.kind === 'step' && location.step.status === 'closed')) {
      const previous = context.current.get('chat') as ChatNode<'media-capture'> | null | undefined
      return previous == null || previous.visibility === 'hidden' ? previous ?? null : { ...previous, visibility: 'hidden' }
    }
    return {
      key: context.key, id: context.id, kind: 'media-capture', target: 'chat',
      data, location, anchorSeq: start.event.seq, groupTree: 'turn', visibility: 'visible',
    } satisfies ChatNode<'media-capture'>
  },
}
