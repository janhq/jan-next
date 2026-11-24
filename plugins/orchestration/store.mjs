/** Durable orchestration state and message retention for one Jan Host. */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, rename } from 'node:fs/promises'
import { writeFileAtomic } from '@janhq/jan-atomic-write'

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
const MAX_MESSAGES = 2000

/** Mint an opaque orchestration id.
 * @param {'task'|'dsp'|'msg'|'q'} prefix - record kind.
 * @returns {string} the prefixed id.
 */
export function newId(prefix) {
  let id = `${prefix}_`
  for (const byte of randomBytes(10)) id += BASE32[byte & 31]
  return id
}

// Retention first drops the oldest delivered messages, then the oldest held
// ones (reports for an archived coordinator), and never other pending ones.
function trim(messages) {
  let excess = messages.length - MAX_MESSAGES
  for (const drop of [message => message.delivered, message => message.held]) {
    if (excess <= 0) return
    let kept = 0
    for (const message of messages) {
      if (excess > 0 && drop(message)) excess--
      else messages[kept++] = message
    }
    messages.length = kept
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A mutation applied in memory whose save failed; a later write saves it. */
export class StateWriteError extends Error {
  constructor(cause) {
    super(`Could not save orchestration state: ${cause.message}`, { cause })
    this.name = 'StateWriteError'
  }
}

/** Open one state file, quarantining an unreadable state format before resetting it.
 * @param {string} path - state.json filename.
 * @param {{warn(message: string): void}} logger - receives the quarantine and failed-write diagnostics.
 * @param {{onRecover?: () => void, retryMs?: number}} [options] - `onRecover` runs after the
 *   first successful write that follows a failed one; `retryMs` paces write retries.
 * @returns {Promise<object>} live read view, serialized synchronous mutation API, write barrier and close.
 */
export async function openStore(path, logger, { onRecover = () => {}, retryMs = 5000 } = {}) {
  let state
  let contents
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (contents !== undefined) {
    try {
      state = JSON.parse(contents)
      if (state?.version !== 1 || typeof state.hostId !== 'string'
        || ![state.tasks, state.dispatches, state.workers, state.peerCursors].every(record)
        || (state.peerAcks !== undefined && !record(state.peerAcks))
        || !Array.isArray(state.messages) || !Array.isArray(state.outbox)
        || !Number.isSafeInteger(state.nextSeq) || state.nextSeq < 1) {
        throw new Error('Invalid orchestration state or unsupported version.')
      }
    } catch (error) {
      const broken = `${path}.broken-${Date.now()}`
      await rename(path, broken)
      logger.warn(`Moved unreadable orchestration state to ${broken}: ${error.message}`)
      state = undefined
    }
  }
  const write = () => writeFileAtomic(path, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
  if (state === undefined) {
    state = { version: 1, hostId: randomUUID(), tasks: {}, dispatches: {}, workers: {}, messages: [], outbox: [], peerCursors: {}, nextSeq: 1 }
    await write()
  }
  state.peerAcks ??= {}
  let tail = Promise.resolve()
  // A failed write rejects its mutation and keeps the change in memory, so a
  // caller never acknowledges unsaved state. Every write saves the whole state:
  // a timer retries until one succeeds, and onRecover lets the owner redo the
  // follow-up work (deliveries, dispatches) that the rejected callers skipped.
  let writeError, retry, closed = false
  function mutate(fn) {
    const result = tail.then(async () => {
      const value = fn(state)
      trim(state.messages)
      try {
        await write()
      } catch (cause) {
        if (!writeError) logger.warn(`Could not save orchestration state; retrying: ${cause.message}`)
        writeError = new StateWriteError(cause)
        if (!closed) retry ??= setTimeout(() => { retry = undefined; mutate(() => {}).catch(() => {}) }, retryMs).unref()
        throw writeError
      }
      if (writeError) {
        writeError = undefined
        queueMicrotask(onRecover)
      }
      return value
    })
    // The caller owns callback failures; flush reports only a failed write.
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  return {
    read: () => state,
    mutate,
    /** Wait for queued writes; after a failed write, try once more and throw if it fails again. */
    async flush() {
      await tail
      if (writeError) await mutate(() => {})
    },
    close() {
      closed = true
      clearTimeout(retry)
    },
  }
}
