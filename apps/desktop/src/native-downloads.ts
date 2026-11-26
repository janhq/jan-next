/** Electron-owned native download reporting and private action routing. */
import { randomUUID } from 'node:crypto'
import type { Branded, BrandedNumber } from '@janhq/jan-brand'
import type { DownloadAction, DownloadActions, DownloadFinishState, DownloadHandle, DownloadStart, DownloadUpdate } from '@janhq/jan-downloads/types'

type NativeDownloadId = Branded<'NativeDownloadId'>
type NativeDownloadAttemptId = Branded<'NativeDownloadAttemptId'>
type NativeDownloadRequestId = BrandedNumber<'NativeDownloadRequestId'>

/** Private identity of one Host download subscription. */
export type NativeDownloadSubscription = Branded<'NativeDownloadSubscription'>

const NATIVE_ACTIONS = ['cancel', 'retry', 'open', 'reveal'] as const satisfies readonly DownloadAction[]
type NativeAction = typeof NATIVE_ACTIONS[number]
type Start = Omit<DownloadStart, 'id' | 'kind' | 'actions'> & {
  readonly id: string
  readonly kind: 'file' | 'update'
  readonly actions?: DownloadActions
}
type Progress = Pick<DownloadUpdate, 'receivedBytes' | 'totalBytes'> & Required<Pick<DownloadUpdate, 'state'>>
type Event = { readonly type: 'native-download'; readonly id: NativeDownloadId; readonly attempt: NativeDownloadAttemptId } & (
  | { readonly phase: 'start'; readonly kind: Start['kind']; readonly name: string; readonly totalBytes?: number; readonly actions: readonly NativeAction[] }
  | ({ readonly phase: 'update' } & Progress)
  | { readonly phase: 'finish'; readonly state: DownloadFinishState; readonly error?: string; readonly actions: readonly NativeAction[] }
)
/** Receives lifecycle reports for the currently attached Host. */
export type NativeDownloadPublisher = (event: Event) => void

/** Reports cumulative native progress and one terminal outcome. */
export interface NativeDownloadHandle extends Pick<DownloadHandle, 'finish'> {
  /** @param progress - Current native state and byte counters. */
  update(progress: Progress): void
}
interface ActionRequest {
  readonly id: NativeDownloadId
  readonly attempt: NativeDownloadAttemptId
  readonly requestId: NativeDownloadRequestId
  readonly subscription: NativeDownloadSubscription
  readonly action: NativeAction
}
interface Entry {
  initial: Extract<Event, { phase: 'start' }>
  progress?: Extract<Event, { phase: 'update' }>
  terminal?: Extract<Event, { phase: 'finish' }>
  actions: DownloadActions
}

/**
 * Parse a Host action request without accepting a local path or native command.
 * @param message - Untrusted child-process message.
 * @returns Routed identity and requested action, if valid.
 */
export function parseNativeDownloadAction(message: object): ActionRequest | undefined {
  if (!('id' in message) || typeof message.id !== 'string' || message.id.length === 0 || message.id.length > 512
    || !('attempt' in message) || typeof message.attempt !== 'string' || message.attempt.length !== 36
    || !('requestId' in message) || typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId) || message.requestId < 1
    || !('subscription' in message) || typeof message.subscription !== 'string' || message.subscription.length !== 36
    || !('action' in message)) return undefined
  const action = NATIVE_ACTIONS.find(action => action === message.action)
  if (action === undefined) return undefined
  return { id: message.id as NativeDownloadId, attempt: message.attempt as NativeDownloadAttemptId,
    requestId: message.requestId as NativeDownloadRequestId, subscription: message.subscription as NativeDownloadSubscription, action }
}

/**
 * Normalize native counters; Chromium and updater report zero for an unknown total.
 * @param receivedBytes - Cumulative transferred bytes from the native source.
 * @param totalBytes - Expected size from the native source, when known.
 * @returns Valid counters for the Host progress report.
 */
export function nativeDownloadBytes(receivedBytes: number, totalBytes: number): Pick<Progress, 'receivedBytes' | 'totalBytes'> {
  return {
    ...(Number.isSafeInteger(receivedBytes) && receivedBytes >= 0 ? { receivedBytes } : {}),
    ...(Number.isSafeInteger(totalBytes) && totalBytes > 0 ? { totalBytes } : {}),
  }
}

/** Retains the latest native reports for Host attachment, without owning inbox or badge state. */
export class DesktopDownloads {
  private readonly entries = new Map<NativeDownloadId, Entry>()
  private publish: NativeDownloadPublisher | undefined

  /**
   * Replay native reports to a newly attached Host store in attempt order.
   * @param publish - Sink for this specific child-process subscription.
   */
  connect(publish: NativeDownloadPublisher): void {
    if (publish === this.publish) return
    this.publish = publish
    for (const { initial, progress, terminal } of this.entries.values()) {
      publish(initial)
      if (progress !== undefined) publish(progress)
      if (terminal !== undefined) publish(terminal)
    }
  }

  /** @param publish - Detach this child and discard terminal rows already delivered to its Host store. */
  disconnect(publish: NativeDownloadPublisher): void {
    if (this.publish !== publish) return
    this.publish = undefined
    for (const [id, entry] of this.entries) if (entry.terminal !== undefined) this.entries.delete(id)
  }

  /**
   * Start one real Electron transfer, replacing any previous attempt with the same id.
   * @param initial - Safe display metadata and private native callbacks.
   * @returns Reporting handle that ignores superseded or settled attempts.
   */
  start({ id, kind, name, totalBytes, actions = {} }: Start): NativeDownloadHandle {
    const identity = { type: 'native-download', id: id as NativeDownloadId, attempt: randomUUID() as NativeDownloadAttemptId } as const
    const initial = { ...identity, phase: 'start', kind, name, ...(totalBytes === undefined ? {} : { totalBytes }),
      actions: NATIVE_ACTIONS.filter(action => actions[action] !== undefined) } as const
    const entry: Entry = { initial, actions }
    this.entries.delete(initial.id)
    this.entries.set(initial.id, entry)
    this.publish?.(initial)
    return {
      update: ({ state, receivedBytes, totalBytes }) => {
        if (this.entries.get(initial.id) !== entry || entry.terminal !== undefined) return
        const update = { ...identity, phase: 'update', state,
          ...(receivedBytes === undefined ? {} : { receivedBytes }), ...(totalBytes === undefined ? {} : { totalBytes }) } as const
        entry.progress = update
        this.publish?.(update)
      },
      finish: (state, error, actions = {}) => {
        if (this.entries.get(initial.id) !== entry || entry.terminal !== undefined) return
        entry.actions = actions
        entry.terminal = { ...identity, phase: 'finish', state, ...(error === undefined ? {} : { error }),
          actions: NATIVE_ACTIONS.filter(action => actions[action] !== undefined) }
        this.publish?.(entry.terminal)
      },
    }
  }

  /**
   * Dispatch an action only for the attached child and latest native attempt.
   * @param publish - Child subscription invoking the action.
   * @param request - Validated action naming an attempt, not an operation target.
   * @returns Completion of the native callback; rejects if the action was withdrawn or failed.
   */
  async act(publish: NativeDownloadPublisher, request: ActionRequest): Promise<void> {
    const entry = this.entries.get(request.id)
    const invoke = entry?.actions[request.action]
    if (this.publish !== publish || entry?.initial.attempt !== request.attempt || invoke === undefined) {
      throw new Error('Desktop download action is no longer available')
    }
    await invoke()
  }
}
