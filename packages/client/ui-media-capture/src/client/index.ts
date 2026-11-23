/** Browser plugin registering pending media capture in the ordinary chat stream. */
import { createElement, useMemo } from 'react'
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { CaptureCard } from './CaptureCard.tsx'
import { captureNodeDefinition } from './capture-node.ts'
import { dictionaries } from './locales.ts'
import { bindCapture } from './pending.ts'

export type { CaptureCardProps, CaptureMode, CapturePending } from './contract.ts'

/** Services registering capture copy and the chat node. */
export const inject = ['locale', 'slots', 'uiConversation']

function CaptureView({ node, sessionId, t }: PropsRuntime<'conversation.chat.node', 'media-capture'> & PropsLocale<'mediaCapture'>) {
  const pending = useMemo(() => bindCapture(sessionId, node.id, node.data), [sessionId, node.id, node.data])
  return createElement(CaptureCard, { key: node.id, ...pending, t })
}

/** Register the live capture projection and renderer. @param ctx - Client plugin context. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('mediaCapture', dictionaries), 'ui-media-capture: dictionaries')
  ctx.uiConversation.events.register(captureNodeDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'media-capture', locale: 'mediaCapture',
  }, CaptureView))
}
