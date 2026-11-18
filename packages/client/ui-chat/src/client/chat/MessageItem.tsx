import { memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PendingSubmission } from '@janhq/jan-api-session-controller/client'
import type { InjectFace, PropsRenderFactories, PropsRenderSlots } from '@janhq/jan-client-ui-slots'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { UserTextFacts } from '@janhq/jan-client-ui-conversation/client'
import { JsonBlock, StateDot, TextShimmer } from '@janhq/jan-client-ui-primitives'
import type {
  ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, UserContentAttachment, UserContentData, UserContentInput,
} from '../contract/slots.ts'
import type { ModelSwitchChatData } from '../contract/chat-nodes.ts'
import type { ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

const EMPTY_TEXT_FACTS: Readonly<Partial<UserTextFacts>> = {}

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>
function contentParts(content: readonly unknown[]): {
  text: string
  attachments: UserContentAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: UserContentAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

/** Recovery from a context-window failure: local growth, and compaction on every route. */
export interface ContextRecovery {
  /** Local llama.cpp model of the failed request; undefined on cloud routes, whose window cannot grow. */
  modelFor: () => string | undefined
  contextFor: (id: string) => Promise<{ current: number; maximum?: number } | undefined>
  increase: (id: string) => Promise<{ ok: true; value: number | null } | { ok: false; error: string }>
  /** Summarize older history in this chat; `empty` means nothing was old enough to summarize. */
  compact: () => Promise<{ ok: true } | { ok: false; reason: 'empty' } | { ok: false; reason: 'failed'; error: string }>
  retry: (failureSeq: number) => void
}

interface TurnErrorInjected {
  hooks: {
    settingsAvailability: ObservableSnapshot<boolean>
    /** Seq of the failed turn/end a retry would answer, or null; a banner offers recovery only while it is that one. */
    continuation: ObservableSnapshot<number | null>
  }
  openModelsSettings: () => void
  recovery?: ContextRecovery
}

function failureMessage(
  message: string,
  code: unknown,
  t: ChatViewSlotProps['t'],
): string {
  if (code === 'ACCOUNT_SIGNED_OUT') return t('message.failure.accountSignedOut')
  if (code === 'INTERRUPTED') return t('message.failure.interrupted')
  if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return t('message.failure.accountSignInRequired')
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return t('message.failure.quota')
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return t('message.failure.contextWindow')
  if (code === 'MISSING_CREDENTIAL') return t('message.failure.missingCredential')
  if (code === 'MODEL_SWITCH_COMPACTION_FAILED') return t('message.failure.switchCompaction')
  return code === 'AUTH' ? t('message.failure.auth') : message
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          <TextShimmer active={active}>
            {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
          </TextShimmer>
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** A visible record that another model took over after the model in use failed. */
function ModelSwitchItem({ node, t }: {
  node: ModelSwitchChatData
  t: ChatViewSlotProps['t']
}) {
  return (
    <details className={css.retryRow}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {node.from === undefined
            ? t('message.modelSwitch.statusUnknown', { to: node.to })
            : t('message.modelSwitch.status', { from: node.from, to: node.to })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t, canOpenModelsSettings, openModelsSettings, recovery, current }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
  canOpenModelsSettings: boolean
  openModelsSettings: () => void
  recovery: ContextRecovery | undefined
  /** True while a retry would answer this very failure. */
  current: boolean
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [context, setContext] = useState<{ current: number; maximum?: number }>()
  const [exhausted, setExhausted] = useState(false)
  const recoverable = node.code === 'CONTEXT_WINDOW_EXCEEDED' && current && recovery !== undefined
  const modelId = recoverable ? recovery.modelFor() : undefined
  useEffect(() => {
    if (modelId === undefined) return
    let live = true
    void recovery?.contextFor(modelId).then((value) => { if (live) setContext(value) }, () => {})
    return () => { live = false }
  }, [modelId, recovery])
  const atMaximum = exhausted || (context?.maximum !== undefined && context.current >= context.maximum)
  // A local window grows first; compaction is the way out once it cannot, and the only one on cloud routes.
  const growable = modelId !== undefined && !atMaximum
  const attempt = async (act: (target: ContextRecovery) => Promise<void>): Promise<void> => {
    if (recovery === undefined || working) return
    setWorking(true)
    setError(undefined)
    setNotice(undefined)
    try { await act(recovery) } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setWorking(false) }
  }
  const grow = (): Promise<void> => attempt(async (target) => {
    if (modelId === undefined) return
    const result = await target.increase(modelId)
    if (!result.ok) setError(result.error)
    else if (result.value === null) setExhausted(true)
    else {
      setNotice(t('message.failure.contextIncreased', { tokens: result.value.toLocaleString() }))
      target.retry(node.seq)
    }
  })
  const compact = (): Promise<void> => attempt(async (target) => {
    const result = await target.compact()
    if (result.ok) {
      setNotice(t('message.failure.compacted'))
      target.retry(node.seq)
    } else setError(result.reason === 'empty' ? t('message.failure.nothingToCompact') : result.error)
  })
  const message = !recoverable ? failureMessage(node.message, node.code, t)
    : modelId === undefined ? t('message.failure.cloudContextWindow')
      : t(atMaximum ? 'message.failure.contextMaximum' : 'message.failure.localContextWindow')
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{node.code === 'ACCOUNT_SIGNED_OUT' || node.code === 'INTERRUPTED' ? t('message.taskStopped') : t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{message}</span>
        {node.code === 'MISSING_CREDENTIAL' && canOpenModelsSettings && <button type="button" className={css.turnErrorAction}
          onClick={openModelsSettings}>{t('message.failure.openModels')}</button>}
        {recoverable && (growable
          ? <button type="button" className={css.turnErrorAction} disabled={working} onClick={() => { void grow() }}>
            {t(working ? 'message.failure.increasingContext' : 'message.failure.increaseContext')}
          </button>
          : <button type="button" className={css.turnErrorAction} disabled={working} onClick={() => { void compact() }}>
            {t(working ? 'message.failure.compacting' : 'message.failure.compactRetry')}
          </button>)}
        {notice !== undefined && <span className={css.turnErrorMessage}>{notice}</span>}
        {error !== undefined && <span className={css.turnErrorMessage} role="alert">{error}</span>}
      </div>
      {node.code !== undefined && node.code !== 'INTERRUPTED' && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * A row the message-source seat decorates. A durable Chat node satisfies it;
 * pending and local-echo rows pass a source-less stand-in.
 */
interface DecoratedRow {
  readonly kind: 'user' | 'steering'
  readonly data: { readonly source: unknown }
}

/** Pending and local-echo rows carry no durable source for the seat to elect. */
const UNDECORATED_ROW: DecoratedRow = { kind: 'user', data: { source: null } }

/** Occupant used by rows that do not own the message-source seat. */
const NO_MESSAGE_SOURCE: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain'] = () => null

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  node, renderSlotChain, content, loadImage, renderFactorySlot, actions,
  pending = false, echo = false, batchStart = false,
  referenceLabels, skillNames, previewAttachments, facts: inputFacts = EMPTY_TEXT_FACTS, interactive = false,
}: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Row whose durable source the message-source seat elects above this bubble. */
  node: DecoratedRow
  /** Seat renderer; rows that do not own the seat pass {@link NO_MESSAGE_SOURCE}. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Whether this admitted steering row starts its claim's batch and keeps the Turn tail slot above it. */
  batchStart?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly UserContentAttachment[]
  /** Inputs used by text transforms, separate from row and rendering props. */
  facts?: Readonly<Partial<UserTextFacts>>
} & Pick<ChatNodeOwnerProps, 'loadImage'> & Pick<UserContentInput, 'interactive'>): ReactNode {
  const parts = useMemo(() => contentParts(content), [content])
  const prepared = useMemo<UserContentData>(() => ({
    text: parts.text,
    attachments: previewAttachments ?? parts.attachments,
    extraBlocks: parts.rest,
    ...(referenceLabels === undefined ? {} : { referenceLabels }),
  }), [parts, previewAttachments, referenceLabels])
  const facts = useMemo<Readonly<Partial<UserTextFacts>>>(() => ({
    ...inputFacts,
    ...(referenceLabels === undefined ? {} : { sessionLabels: referenceLabels }),
    ...(skillNames === undefined ? {} : { skillNames }),
  }), [inputFacts, referenceLabels, skillNames])
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
      data-chat-steering-batch={batchStart ? 'start' : undefined}
    >
      {renderSlotChain('conversation.chat.user.before', { source: node.data.source, kind: node.kind }, { fallback: null })}
      {renderFactorySlot('conversation.chat.user.content', {
        content: prepared,
        loadImage,
        facts,
        interactive,
      })}
      {actions?.(prepared.text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - pending content, authorized image loader, and Factory/locale seats.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, loadImage, renderFactorySlot, t }: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the pending submission, authorized image loader, and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, loadImage, renderFactorySlot, t }: {
  submission: PendingSubmission
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly UserContentAttachment[]>(
    () => submission.attachments.map(attachment => attachment.type === 'image'
      ? {
        type: 'image',
        image: {
          preview: {
            url: attachment.value.previewUrl,
            ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
            ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
            ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
          },
        },
      }
      : { type: 'file', file: attachment.value }),
    [submission.attachments],
  )
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      previewAttachments={previewAttachments}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending={submission.placement === 'steering'}
      echo
      actions={text => (
        <MessageIconActions
          text={text}
          time={submission.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Official user and admitted-steering keyed Chat renderer.
 *
 * Renders the durable-message chain seat directly above the bubble. The seat is
 * declared by the `user` registration alone, so a steering row renders the same
 * bubble without asking for it.
 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderFactorySlot, loadImage, renderSlotChain, t,
}: ChatNodeViewProps<'user' | 'steering'> & {
  /** Bound by the `user` keyed registration, the only entry that declares the seat. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
}) {
  const data = node.data
  return (
    <UserStyleBubble
      node={node}
      renderSlotChain={renderSlotChain}
      content={data.content}
      interactive
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      batchStart={node.kind === 'steering' && node.data.batchStart === true}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      producer={data.producer}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Mid-Turn model-switch keyed Chat renderer. */
export const ModelSwitchNodeView = memo(function ModelSwitchNodeView({ node, t }: ChatNodeViewProps<'model-switch'>) {
  return <ModelSwitchItem node={node.data} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({
  node, t, useSettingsAvailability, useContinuation, openModelsSettings, recovery,
}: ChatNodeViewProps<'turn-error'> & InjectFace<TurnErrorInjected>) {
  const canOpenModelsSettings = useSettingsAvailability(available => available)
  const current = useContinuation(ending => ending === node.data.seq)
  return <TurnErrorItem node={node.data} t={t} canOpenModelsSettings={canOpenModelsSettings}
    openModelsSettings={openModelsSettings} recovery={recovery} current={current} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
