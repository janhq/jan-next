import { Context } from '@janhq/cordis'
import { createInboxStub, unsupportedModel } from '@janhq/jan-agent-loop-testkit'
import type { Agent } from '@janhq/jan-agent'
import { ToolCallId } from '@janhq/jan-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@janhq/jan-session'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime from '@janhq/jan-tools'
import { executeToolFixture } from '@janhq/jan-tool-testkit'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { CaptureRequester } from '../src/types.ts'

async function fixture(name: 'capture_camera' | 'capture_audio', args: object) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const request = vi.fn<CaptureRequester['request']>()
  ctx.provide('mediaCapture', { request })
  apply(ctx)
  const id = SessionId('first')
  const agent: Agent = {
    id, ctx, options: {}, model: unsupportedModel(), inbox: createInboxStub(), status: 'idle',
    session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, delegationDepth: 0 }),
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const signal = new AbortController().signal
  const toolSet = await ctx.tools.resolve({ agent, signal, modelSelection: { provider: 'test', model: 'test' } })
  const run = () => executeToolFixture(ctx, {
    callId: ToolCallId('capture-1'), name, arguments: args, signal, agent, toolSet,
  })
  return { run, request }
}

it('returns an explicit refusal without an attachment when the user declines', async () => {
  const f = await fixture('capture_audio', { reason: 'Identify this sound.' })
  f.request.mockResolvedValue({ status: 'declined' })
  expect(await f.run()).toMatchObject({
    isError: false, value: { status: 'declined' },
    content: [{ type: 'text', text: 'The user declined the capture request. No media was shared.' }],
  })
  expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ mode: 'audio', reason: 'Identify this sound.' }), expect.anything())
})

it('returns the shared photo as native image content', async () => {
  const f = await fixture('capture_camera', { reason: 'Identify this part.', mode: 'photo' })
  const image = { attachmentId: 'photo-1', mediaType: 'image/jpeg', name: 'camera.jpg', bytes: 32, width: 4, height: 2 } as const
  f.request.mockResolvedValue({ status: 'captured', mode: 'photo', image })
  expect(await f.run()).toMatchObject({ isError: false, content: [expect.anything(), { type: 'image', attachment: image }] })
})

it.each(['video', 'audio'] as const)('returns a stored %s with its read path and user note', async (mode) => {
  const f = await (mode === 'video'
    ? fixture('capture_camera', { reason: 'Identify this movement.', mode })
    : fixture('capture_audio', { reason: 'Identify this sound.' }))
  const path = `/session/${SessionId('first')}/${mode}.webm`
  const file = { attachmentId: 'file-1', name: `${mode}.webm`, bytes: 42 }
  f.request.mockResolvedValue({ status: 'captured', mode, file, path, note: 'Listen at the end.' })
  const result = await f.run()
  const pathText: unknown = expect.stringContaining(path)
  expect(result).toMatchObject({ isError: false, value: { path, note: 'Listen at the end.' }, content: [
    { type: 'text', text: pathText },
    { type: 'file', attachment: file },
  ] })
  const noteText: unknown = expect.stringContaining('Listen at the end.')
  const anyBlock: unknown = expect.anything()
  expect(result).toMatchObject({ content: [{ text: noteText }, anyBlock] })
})
