/** Maps private Electron lifecycle reports into the Host-owned download inbox. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@janhq/cordis'
import type { Branded, BrandedNumber } from '@janhq/jan-brand'
import type { DownloadAction, DownloadActions, DownloadHandle } from '@janhq/jan-downloads/types'

type NativeDownloadId = Branded<'NativeDownloadId'>
type NativeDownloadAttemptId = Branded<'NativeDownloadAttemptId'>
type NativeDownloadSubscription = Branded<'NativeDownloadSubscription'>
type NativeDownloadRequestId = BrandedNumber<'NativeDownloadRequestId'>

type Send = (message: object) => Promise<void>
const ACTION_DEADLINE_MS = 10_000

function byteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseActions(value: unknown): readonly DownloadAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const actions: DownloadAction[] = []
  for (const entry of value) {
    if (entry !== 'cancel' && entry !== 'retry' && entry !== 'open' && entry !== 'reveal') return undefined
    actions.push(entry)
  }
  return actions
}

/**
 * Connect the optional inbox provider to the Electron parent for each provider lifetime.
 * @param ctx - Running Desktop profile context owning the subscription.
 * @param send - Private parent-process writer; failures are independent of native transfers.
 */
export function installNativeDownloads(ctx: Context, send: Send): void {
  if (!process.connected) return
  ctx.inject(['downloads'], (inboxCtx) => {
    inboxCtx.effect(() => {
      const downloads = inboxCtx.downloads
      const subscription = randomUUID() as NativeDownloadSubscription
      const active = new Map<NativeDownloadId, { attempt: NativeDownloadAttemptId; handle: DownloadHandle }>()
      const pending = new Map<NativeDownloadRequestId, (ok: boolean) => void>()
      let nextRequestId = 0
      let disposed = false
      const notify = (message: object): void => {
        void send(message).catch((error: unknown) => { console.error('desktop Host: native download subscription failed', error) })
      }
      const actionsFor = (id: NativeDownloadId, attempt: NativeDownloadAttemptId, actions: readonly DownloadAction[]): DownloadActions => {
        const result: DownloadActions = {}
        for (const action of actions) {
          result[action] = async () => {
            if (disposed || !process.connected) throw new Error('Desktop download action is unavailable')
            const requestId = ++nextRequestId as NativeDownloadRequestId
            const response = Promise.withResolvers<boolean>()
            pending.set(requestId, response.resolve)
            const timer = setTimeout(() => { response.resolve(false) }, ACTION_DEADLINE_MS)
            timer.unref()
            try {
              void send({ type: 'native-download-action', subscription, requestId, id, attempt, action })
                .catch(() => { response.resolve(false) })
              if (!await response.promise) throw new Error('Desktop download action could not be completed')
            } finally {
              clearTimeout(timer)
              pending.delete(requestId)
            }
          }
        }
        return result
      }
      const receive = (message: unknown): void => {
        if (typeof message !== 'object' || message === null || !('type' in message)
          || !('subscription' in message) || message.subscription !== subscription) return
        if (message.type === 'native-download-action-result') {
          if ('requestId' in message && byteCount(message.requestId) && 'ok' in message && typeof message.ok === 'boolean') {
            pending.get(message.requestId as NativeDownloadRequestId)?.(message.ok)
          }
          return
        }
        if (message.type !== 'native-download' || !('phase' in message)
          || !('id' in message) || typeof message.id !== 'string' || message.id.length === 0 || message.id.length > 512
          || !('attempt' in message) || typeof message.attempt !== 'string' || message.attempt.length !== 36) return
        const id = message.id as NativeDownloadId
        const attempt = message.attempt as NativeDownloadAttemptId
        switch (message.phase) {
          case 'start': {
            if (!('name' in message) || typeof message.name !== 'string' || message.name.length === 0
              || !('kind' in message) || (message.kind !== 'file' && message.kind !== 'update')
              || !('actions' in message)) return
            const totalBytes = 'totalBytes' in message ? message.totalBytes : undefined
            if (totalBytes !== undefined && !byteCount(totalBytes)) return
            const actions = parseActions(message.actions)
            if (actions === undefined) return
            const handle = downloads.start({ id, kind: message.kind, name: message.name,
              ...(totalBytes === undefined ? {} : { totalBytes }), actions: actionsFor(id, attempt, actions) })
            active.set(id, { attempt, handle })
            return
          }
          case 'update': {
            const entry = active.get(id)
            if (entry?.attempt !== attempt || !('state' in message)
              || (message.state !== 'queued' && message.state !== 'downloading' && message.state !== 'paused')) return
            const receivedBytes = 'receivedBytes' in message ? message.receivedBytes : undefined
            const totalBytes = 'totalBytes' in message ? message.totalBytes : undefined
            if ((receivedBytes !== undefined && !byteCount(receivedBytes)) || (totalBytes !== undefined && !byteCount(totalBytes))) return
            entry.handle.update({ state: message.state,
              ...(receivedBytes === undefined ? {} : { receivedBytes }),
              ...(totalBytes === undefined ? {} : { totalBytes }) })
            return
          }
          case 'finish': {
            const entry = active.get(id)
            if (entry?.attempt !== attempt || !('state' in message)
              || (message.state !== 'done' && message.state !== 'failed' && message.state !== 'cancelled') || !('actions' in message)) return
            const error = 'error' in message ? message.error : undefined
            if (error !== undefined && typeof error !== 'string') return
            const actions = parseActions(message.actions)
            if (actions === undefined) return
            active.delete(id)
            entry.handle.finish(message.state, error, actionsFor(id, attempt, actions))
            return
          }
          default:
            return
        }
      }
      const rejectPending = (): void => {
        for (const resolve of pending.values()) resolve(false)
        pending.clear()
      }
      process.on('message', receive)
      process.once('disconnect', rejectPending)
      notify({ type: 'native-download-subscribe', subscription })
      return () => {
        disposed = true
        process.off('message', receive)
        process.off('disconnect', rejectPending)
        rejectPending()
        active.clear()
        notify({ type: 'native-download-unsubscribe', subscription })
      }
    })
  })
}
