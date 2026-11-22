/** Bind one displayed request to its authenticated Host intake. */
import type { CapturePending } from './contract.ts'
import type { SessionId } from '@janhq/jan-session/types'

/**
 * Create interaction callbacks without requesting devices or contacting the Host on render.
 * @param sessionId - The Session that owns this call.
 * @param callId - The specific pending tool call.
 * @param data - The model's requested mode and reason.
 * @returns The card's immutable pending request and settlement actions.
 */
export function bindCapture(sessionId: SessionId, callId: string, data: Pick<CapturePending, 'mode' | 'reason'>): CapturePending {
  const query = new URLSearchParams({ sessionId, callId })
  const control = `api/session/mediaCapture?${query}`
  const upload = `api/session/mediaCapture/upload?${query}`
  return {
    ...data,
    async confirmActive(signal) {
      const response = await fetch(control, { signal: signal ?? null, cache: 'no-store' })
      if (response.status === 404 || response.status === 409) return false
      if (!response.ok) throw new Error(`Could not verify capture request: ${response.status}`)
      return true
    },
    async decline(signal) {
      const response = await fetch(control, { method: 'POST', signal: signal ?? null })
      if (!response.ok) throw new Error(`Could not decline capture: ${response.status}`)
    },
    async send(blob, note, signal) {
      const headers = new Headers({ 'content-type': blob.type })
      if (note !== undefined && note !== '') headers.set('x-jan-capture-note', encodeURIComponent(note))
      const response = await fetch(upload, { method: 'POST', body: blob, headers, signal: signal ?? null })
      if (!response.ok) throw new Error(`Could not send capture: ${response.status}`)
    },
  }
}
