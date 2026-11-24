import { Fragment, memo, useMemo, useState } from 'react'
import { fileMediaUrl } from '@janhq/jan-util-workspace-path'
import type { PropsRenderSlots } from '@janhq/jan-client-ui-slots'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText, createStreamReveal } from '@janhq/jan-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownPathImages } from '@janhq/jan-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps, UseDisclosure, UsePresentation, UseGroupAction } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { useSmoothText } from './smooth-stream.ts'
import css from './AssistantMarkdown.module.css'

/**
 * Standalone fallback for image destinations (query/fragment suffixes are ignored).
 * Chat fileImages resolves decoded file references against cwd; pathImages also
 * serves this component outside that provider and accepts legacy image URL suffixes.
 * Resolve an authored absolute image path against the document's file API.
 * @param base - canonical `document.baseURI` at render time.
 * @param value - authored Markdown destination; URL escapes are decoded once.
 * @returns an absolute Web or Desktop file-API URL, or undefined for unsupported
 * protocols and non-local paths.
 */
export function localPathMediaUrl(base: string, value: string): string | undefined {
  let path: string
  try { path = decodeURIComponent(value.split(/[?#]/u)[0] ?? '') }
  catch { return undefined } // Malformed URL escapes cannot identify a file.
  return fileMediaUrl(base, path)
}

export interface AssistantMarkdownProps extends
  Pick<PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>, 'renderSlot'>,
  Pick<ChatNodeOwnerProps, 'loadImage'> {
  /** Render only the requested business portion, preserving original block indexes. */
  groupPart?: string | undefined
  /** Stable Hook forwarded to each independently expandable reasoning block. */
  useDisclosure: UseDisclosure
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Session and Assistant step identity shared by live and settled views. */
  replyIdentity?: string
  /** Only finalized durable Assistant messages supply selection sources. */
  textInteractionSource?: boolean
  /** Frozen partial of a cut reply: `stopped` by Stop, or `steered` when the user's steer cut it and the turn went on. */
  interrupted?: 'stopped' | 'steered' | undefined
  /** Hide reasoning that belongs to the Turn-level process disclosure. */
  reasoningHidden?: boolean | undefined
  /** Process hiding bound by the node slot to its current viewport. */
  useGroupAction: UseGroupAction
  /** Live display policy for reasoning summaries. */
  usePresentation: UsePresentation
  /** Reveal the disclosure that hides this reasoning. */
  revealProcess?: (() => void) | undefined
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Renders non-blank reasoning blocks as independent disclosures alongside the response. */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, replyIdentity, textInteractionSource = false, interrupted, loadImage, groupPart, useDisclosure,
  reasoningHidden = false, usePresentation, revealProcess, mentions, renderSlot, useGroupAction, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  // MarkdownText memoizes its vocabulary; keep its identity stable across renders.
  const pathImages = useMemo<MarkdownPathImages>(() => {
    return { resolve: value => localPathMediaUrl(document.baseURI, value) }
  }, [])
  const last = blocks.length - 1
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted !== undefined
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    if (groupPart === 'reasoning' && block.kind !== 'reasoning') continue
    if (groupPart === 'response' && block.kind === 'reasoning') continue
    switch (block.kind) {
      case 'text': {
        const identity = replyIdentity === undefined ? undefined : `${replyIdentity}:${i}`
        rendered.push(
          <PacedMarkdown
            key={identity ?? i}
            identity={identity}
            text={block.text}
            streaming={streaming}
            labels={labels}
            fileMentions={mentions}
            pathImages={pathImages}
            textInteractionSource={textInteractionSource}
          />,
        )
        break
      }
      case 'reasoning':
        if (block.text.trim() === '') break
        rendered.push(
          <ProcessReasoning
            key={i}
            hidden={reasoningHidden}
            reveal={revealProcess}
            useGroupAction={useGroupAction}
          >
            <ReasoningRow text={block.text} running={streaming && i === last} usePresentation={usePresentation}
              useDisclosure={useDisclosure} renderSlot={renderSlot} textInteractionSource={textInteractionSource} t={t} />
          </ProcessReasoning>,
        )
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderSlot('conversation.chat.message.images', {
              images: group.map(({ attachment }) => ({ attachment })), loadImage, align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {interrupted !== undefined && (groupPart === undefined || groupPart === 'response'
          || !blocks.some(block => block.kind !== 'reasoning' && block.kind !== 'tool-call'))
          && <span className={css.stopped}>{t(interrupted === 'steered' ? 'message.interrupted' : 'message.stopped')}</span>}
      </div>
    </div>
  )
})

/**
 * Streamed prose released at a steady pace with each new word fading in from a
 * slight blur; the settled render takes over once the paced text has caught up with a finished stream.
 */
function PacedMarkdown({ text, streaming, identity, ...markdown }: Omit<Parameters<typeof MarkdownText>[0], 'variant' | 'omitHtml' | 'reveal'> & {
  streaming: boolean
  identity: string | undefined
}) {
  const paced = useSmoothText(text, streaming, identity)
  // One reveal per reply, so words that remount as their block freezes resume their fade.
  const [reveal] = useState(createStreamReveal)
  return <MarkdownText {...markdown} text={paced.text} streaming={!paced.settled} reveal={reveal} />
}

function ProcessReasoning({ hidden, reveal, useGroupAction, children }: {
  hidden: boolean
  reveal?: (() => void) | undefined
  useGroupAction: UseGroupAction
  children: ReactNode
}) {
  const ref = useGroupAction(hidden, reveal ?? NOOP)
  return <div ref={ref} data-turn-process-inline={hidden || undefined}>{children}</div>
}

const NOOP = (): void => {}
