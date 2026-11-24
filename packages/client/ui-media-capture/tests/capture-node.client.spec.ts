import { Context } from '@janhq/cordis'
import { SessionSeq, type SessionEvent } from '@janhq/jan-session'
import { expect, it } from 'vitest'
import type { ConversationViewNode } from '@janhq/jan-client-ui-conversation/client'
import { ConversationNodeAssembler } from '../../ui-conversation/src/client/conversation/assembler.ts'
import { ConversationEventRegistry } from '../../ui-conversation/src/client/conversation/event-registry.ts'
import { captureNodeDefinition } from '../src/client/capture-node.ts'

function timeline() {
  const nodes = new Map<string, ConversationViewNode>()
  const events = new ConversationEventRegistry(new Context())
  events.register(captureNodeDefinition)
  const assembler = new ConversationNodeAssembler(
    events,
    { entries: () => [{ target: 'chat', create: () => ({
      empty: [],
      replace({ nodes: replacement }) {
        nodes.clear()
        for (const node of replacement) nodes.set(node.key, node)
        return [...nodes.values()]
      },
      apply({ upserts }) {
        for (const node of upserts) nodes.set(node.key, node)
        return [...nodes.values()]
      },
    }) }] },
  )
  assembler.activateTarget('chat')
  return { assembler, nodes }
}

const event = (seq: number, type: string, data: object, append = false) => ({
  type: 'event' as const,
  event: { type, seq: SessionSeq(seq), time: seq, data, ...(append ? { surfaceOp: 'append' } : {}) } as SessionEvent,
})

it('projects a pending call outside its tool disclosure and retires the same row when the call settles', () => {
  const { assembler, nodes } = timeline()
  const location = { turn: 1, step: 1 }
  const opened = [event(1, 'turn/start', { turn: 1 }), event(2, 'step/start', location), event(3, 'tool/call', {
    ...location, callId: 'camera-1', name: 'capture_camera', arguments: '{"mode":"photo","reason":"Identify this part."}',
  })]
  const closed = event(4, 'tool/result', {
    ...location, message: { id: 'result', role: 'tool', source: { kind: 'tool', callId: 'camera-1' }, isError: false, content: [] },
  }, true)
  assembler.replaceWindow(opened, false)
  assembler.flush()
  expect([...nodes.values()]).toMatchObject([{
    id: 'camera-1', groupTree: 'turn', visibility: 'visible', data: { mode: 'photo', reason: 'Identify this part.' },
  }])
  const [key] = nodes.keys()

  assembler.append(closed)
  assembler.flush()
  expect([...nodes.values()]).toMatchObject([{ key, visibility: 'hidden' }])

  const replay = timeline()
  replay.assembler.replaceWindow([...opened, closed], false)
  replay.assembler.flush()
  expect(replay.nodes.size).toBe(0)
})
