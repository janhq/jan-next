/** Camera and microphone tools that wait for explicit user permission and sharing. */
import type { Context } from '@janhq/cordis'
import { AttachmentId } from '@janhq/jan-attachment'
import { defineTool, type ToolRunContext } from '@janhq/jan-tools'
import type { CaptureMode, CaptureResult } from './types.ts'

/** Cordis plugin name. */
export const name = 'tool-capture-media'
/** The tool registry and interactive Host capture provider. */
export const inject = ['tools', 'mediaCapture']

const reason = { type: 'string', required: true, description: 'A short explanation for the user of why you need this capture.' } as const
const ref = {
  attachmentId: { type: 'string', required: true },
  name: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
} as const
const captured = { type: 'string', enum: ['captured'], required: true } as const
const output = {
  schema: {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['declined'], required: true } } },
      { type: 'object', additionalProperties: false, properties: {
        status: captured,
        mode: { type: 'string', enum: ['photo'], required: true },
        image: { type: 'object', required: true, additionalProperties: false, properties: {
          ...ref,
          name: { type: 'string' },
          mediaType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], required: true },
          width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
          originalDimensions: { type: 'object', additionalProperties: false, properties: {
            width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
          } },
        } },
      } },
      { type: 'object', additionalProperties: false, properties: {
        status: captured,
        mode: { type: 'string', enum: ['video', 'audio'], required: true },
        file: { type: 'object', additionalProperties: false, required: true, properties: ref },
        path: { type: 'string', required: true },
        note: { type: 'string', required: true },
      } },
    ],
  },
  render(_args: object, value: CaptureResult) {
    if (value.status === 'declined') {
      return [{ type: 'text' as const, text: 'The user declined the capture request. No media was shared.' }]
    }
    if (value.mode === 'photo') {
      return [
        { type: 'text' as const, text: 'The user shared this camera photo.' },
        { type: 'image' as const, attachment: { ...value.image, attachmentId: AttachmentId(value.image.attachmentId) } },
      ]
    }
    return [
      { type: 'text' as const, text: JSON.stringify({ path: value.path, note: value.note }) },
      { type: 'file' as const, attachment: { ...value.file, attachmentId: AttachmentId(value.file.attachmentId) } },
    ]
  },
  presentationMeta(_args: object, value: CaptureResult) {
    return value.status === 'declined' || value.mode === 'photo'
      ? { mediaCapture: value.status }
      : { mediaCapture: value.status, path: value.path, note: value.note }
  },
} as const

/** Register both media tools in the calling preset's tool scope. @param ctx - preset context. */
export function apply(ctx: Context): void {
  function request(mode: CaptureMode, input: string, exec: ToolRunContext): Promise<CaptureResult> {
    const agent = exec.agent
    if (agent === undefined || agent.session.header.origin === 'subagent') {
      throw new Error('Media capture requires a foreground chat Session.')
    }
    const explanation = input.trim()
    if (explanation.length === 0 || explanation.length > 300) throw new Error('reason must have 1 to 300 characters')
    return ctx.mediaCapture.request({ agent, callId: exec.callId, mode, reason: explanation }, exec.signal)
  }

  const options = { when: ({ agent }: { agent: NonNullable<ToolRunContext['agent']> }) => agent.session.header.origin !== 'subagent' }
  ctx.tools.register(defineTool({
    name: 'capture_camera',
    description: 'Ask the user to share a camera photo or a silent video. The user can preview, capture, annotate, and decline before sharing. A photo returns image content; a video returns a readable session file and any user note. Use capture_audio for microphone sound.',
    parameters: {
      reason,
      mode: { type: 'string', enum: ['photo', 'video'], required: true, description: 'Capture a still photo or a silent video.' },
    },
    output,
    execute: (args, exec) => request(args.mode, args.reason, exec),
  }), options)
  ctx.tools.register(defineTool({
    name: 'capture_audio',
    description: 'Ask the user to record and share a microphone clip. The user can preview input levels, record, add a note, and decline before sharing. Returns a readable session file and any user note.',
    parameters: { reason },
    output,
    execute: (args, exec) => request('audio', args.reason, exec),
  }), options)
}
