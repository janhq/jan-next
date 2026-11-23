/** Owner-only browser rendezvous; store submitted bytes before the tool settles. */
import { addAbortListener } from 'node:events'
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-attachment'
import type {} from '@janhq/jan-client-connection'
import type {} from '@janhq/jan-fs'
import type { CaptureRequest, CaptureRequester, CaptureResult } from './types.ts'

/** Services used by the Host storage and owner-only application route. */
export const inject = ['attachments', 'connection', 'fs']

interface Pending {
  readonly request: CaptureRequest
  readonly signal: AbortSignal
  readonly finish: (result: CaptureResult) => void
  sending: boolean
}

const NOTE_LIMIT = 1000
const RECORDING_LIMIT = 100 * 1024 * 1024
const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'audio/ogg': 'ogg',
}

class InvalidCapture extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function response(status: number, message?: string): Response {
  return new Response(message ?? null, { status, headers: { 'cache-control': 'no-store' } })
}

async function* boundedBody(body: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  let bytes = 0
  let ended = false
  using _cancellation = addAbortListener(signal, () => { void reader.cancel(signal.reason).catch(() => undefined) })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) {
        ended = true
        if (bytes === 0) throw new InvalidCapture(400, 'Empty media capture.')
        return
      }
      bytes += chunk.value.byteLength
      if (bytes > limit) throw new InvalidCapture(413, 'Media capture exceeded the upload limit.')
      yield chunk.value
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function saveMedia(ctx: Context, pending: Pending, input: Request): Promise<CaptureResult> {
  const { request } = pending
  const body = input.body
  if (body === null) throw new InvalidCapture(400, 'Missing media capture.')
  const signal = AbortSignal.any([input.signal, pending.signal])
  const mediaType = input.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()

  if (request.mode === 'photo') {
    if (mediaType !== 'image/jpeg') throw new InvalidCapture(415, 'The photo must be a JPEG.')
    const { maxImageBytes, maxMessageImageBytes } = ctx.attachments.imageLimits
    const bytes: Uint8Array[] = []
    for await (const chunk of boundedBody(body, Math.min(maxImageBytes, maxMessageImageBytes), signal)) bytes.push(chunk)
    signal.throwIfAborted()
    const image = await ctx.attachments.saveImage({ data: Buffer.concat(bytes), mediaType, name: 'camera.jpg' })
    signal.throwIfAborted()
    return { status: 'captured', mode: 'photo', image }
  }

  const extension = mediaType === undefined || !mediaType.startsWith(request.mode + '/') ? undefined : EXTENSIONS[mediaType]
  if (extension === undefined) throw new InvalidCapture(415, 'Unsupported recording format.')
  let note: string
  try {
    note = decodeURIComponent(input.headers.get('x-jan-capture-note') ?? '')
  } catch (error) {
    if (!(error instanceof URIError)) throw error
    throw new InvalidCapture(400, 'Invalid capture note.')
  }
  if (note.length > NOTE_LIMIT) throw new InvalidCapture(400, 'Capture note is too long.')
  const file = await ctx.attachments.saveFileStream({
    data: boundedBody(body, RECORDING_LIMIT, signal), signal, name: `${request.mode}.${extension}`,
  })
  signal.throwIfAborted()
  const hostPath = ctx.attachments.fileHostPath(file)
  const path = hostPath === undefined ? undefined : request.agent.ctx.fs.processPathFromHostPath(hostPath)
  if (path === undefined) throw new InvalidCapture(422, 'The current session filesystem cannot read the stored recording.')
  return { status: 'captured', mode: request.mode, file, path, note }
}

/** Mount the process-local rendezvous and its exact Fetch route. @param ctx - Web Host context. */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  const requests = new Map<string, Map<string, Pending>>()
  ctx.effect(() => () => { lifetime.abort() }, 'media-capture: lifetime')
  const provider: CaptureRequester = {
    async request(request, toolSignal) {
      const signal = AbortSignal.any([toolSignal, lifetime.signal])
      signal.throwIfAborted()
      const id = request.agent.id
      let calls = requests.get(id)
      if (calls === undefined) requests.set(id, calls = new Map<string, Pending>())
      if (calls.has(request.callId)) throw new Error('A capture already owns this tool call.')
      const result = Promise.withResolvers<CaptureResult>()
      const pending: Pending = { request, signal, sending: false, finish: result.resolve }
      calls.set(request.callId, pending)
      using _cancellation = addAbortListener(signal, () => { result.reject(signal.reason) })
      try {
        return await result.promise
      } finally {
        calls.delete(request.callId)
        if (calls.size === 0) requests.delete(id)
      }
    },
  }
  function pendingFor(input: Request): Pending | undefined {
    const query = new URL(input.url).searchParams
    const sessionId = query.get('sessionId')
    const callId = query.get('callId')
    const pending = sessionId !== null && callId !== null ? requests.get(sessionId)?.get(callId) : undefined
    return pending?.signal.aborted === false ? pending : undefined
  }
  // GET reports whether the card's request is still open; POST declines it.
  function answerConsent(input: Request): Response {
    const pending = pendingFor(input)
    if (pending === undefined) return response(404, 'Capture request is no longer active.')
    if (pending.sending) return response(409, 'A capture submission is already in progress.')
    if (input.method === 'POST') {
      pending.sending = true
      pending.finish({ status: 'declined' })
    }
    return response(204)
  }
  ctx.provide('mediaCapture', provider)
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/session/mediaCapture', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: input => Promise.resolve(answerConsent(input)),
  }), 'media-capture: consent route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/session/mediaCapture/upload', methods: ['POST'], requestBody: 'streaming',
    async fetch(input) {
      const pending = pendingFor(input)
      if (pending === undefined) return response(404, 'Capture request is no longer active.')
      if (pending.sending) return response(409, 'A capture submission is already in progress.')
      pending.sending = true
      try {
        const result = await saveMedia(ctx, pending, input)
        pending.signal.throwIfAborted()
        input.signal.throwIfAborted()
        pending.finish(result)
        return response(204)
      } catch (error) {
        pending.sending = false
        if (error instanceof InvalidCapture) return response(error.status, error.message)
        if (pending.signal.aborted || input.signal.aborted) return response(409, 'Capture upload was cancelled.')
        if (ctx.attachments.isAttachmentError(error)) return response(422, 'Could not store the submitted media.')
        throw error
      }
    },
  }), 'media-capture: upload route')
}
