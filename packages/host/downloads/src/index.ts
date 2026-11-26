import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-client-connection'
import { createDownloadStore } from './store.ts'
import type { DownloadAction, DownloadStore } from './types.ts'

/** The Downloads Host and corresponding Client contribution. */
export const name = 'jan-downloads'
/** The owner-only Fetch registry supplies the transport for Web and Desktop. */
export const inject = ['connection']
const ACTIONS: Readonly<Record<DownloadAction, true>> = { cancel: true, pause: true, resume: true, retry: true, open: true, reveal: true }
const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Install the process-local store and expose its snapshots and user actions to the signed-in owner.
 * @param ctx - Host scope with an authenticated connection registry.
 */
export function apply(ctx: Context): void {
  const store = createDownloadStore()
  const streams = new Set<() => void>()
  ctx.effect(() => {
    const withdraw = ctx.provide('downloads', store)
    return () => {
      for (const close of streams) close()
      store.dispose()
      withdraw()
    }
  }, 'downloads: store')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/downloads.inbox', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') return follow(store, request.signal, streams)
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
        return Response.json(null, { status: 415, headers: NO_STORE })
      }
      let body: unknown
      try { body = await request.json() }
      catch { return Response.json(null, { status: 400, headers: NO_STORE }) }
      if (typeof body !== 'object' || body === null || !('method' in body)) {
        return Response.json(null, { status: 400, headers: NO_STORE })
      }
      if (body.method === 'clearFinished') store.clearFinished()
      else if (body.method === 'markSeen' && 'sequence' in body && typeof body.sequence === 'number' && Number.isSafeInteger(body.sequence)) {
        store.markSeen(body.sequence)
      } else if (body.method === 'act' && 'id' in body && typeof body.id === 'string'
        && 'action' in body && typeof body.action === 'string' && Object.hasOwn(ACTIONS, body.action)) {
        try { await store.act(body.id, body.action as DownloadAction) }
        catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409, headers: NO_STORE })
        }
      } else return Response.json(null, { status: 400, headers: NO_STORE })
      return new Response(null, { status: 204, headers: NO_STORE })
    },
  }), 'downloads: inbox API')
}

function follow(store: DownloadStore, signal: AbortSignal, streams: Set<() => void>): Response {
  const encoder = new TextEncoder()
  let close: () => void
  let cleanup: () => void
  let wake: (() => void) | undefined
  let dirty = true
  let closed = false
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = store.subscribe(() => { dirty = true; wake?.() })
      cleanup = () => {
        closed = true
        unsubscribe()
        signal.removeEventListener('abort', close)
        streams.delete(close)
        wake?.()
      }
      close = () => { controller.close(); cleanup() }
      if (signal.aborted) close()
      else {
        streams.add(close)
        signal.addEventListener('abort', close, { once: true })
      }
    },
    async pull(controller) {
      if (!dirty) {
        const { promise, resolve } = Promise.withResolvers<void>()
        wake = resolve
        await promise
      }
      wake = undefined
      if (closed) return
      dirty = false
      controller.enqueue(encoder.encode(`${JSON.stringify(store.snapshot())}\n`))
    },
    cancel() { cleanup() },
  }), { headers: { ...NO_STORE, 'content-type': 'application/x-ndjson' } })
}
