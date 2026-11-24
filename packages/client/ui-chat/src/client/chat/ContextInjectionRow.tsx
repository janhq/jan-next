import { useMemo, useState } from 'react'
import { estimateContent } from '@janhq/jan-token-meter/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import {
  DisclosureRow, IconBrowseOutlineRegular, IconChevronRightOutlineRegular, IconContextInjectionOutlineRegular, ReferenceIconRegular,
} from '@janhq/jan-client-ui-primitives'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import { contextBody } from './ContextBody.tsx'
import { formatExactTokens, formatTokens } from './token-format.ts'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  producer: ContextMessageNode['producer']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body. Injected context also shows its estimated
 * token cost at the row's end, priced like the context meter prices it.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, producer, form, t }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false)
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t })
  const tokens = useMemo(() => estimateContent(content), [content])

  const toolBlocks = content.length > 0
    && content.every(block => block.type === 'tool-addition' || block.type === 'tool-removal')
    ? content : undefined
  const added = toolBlocks?.flatMap(block => block.type === 'tool-addition' ? [block.toolName] : []) ?? []
  const removed = toolBlocks?.flatMap(block => block.type === 'tool-removal' ? [block.toolName] : []) ?? []
  const single = toolBlocks?.length === 1 ? toolBlocks[0] : undefined
  const toolSummary = toolBlocks === undefined || single !== undefined ? null
    : added.length > 0 && removed.length > 0
      ? t('message.toolsChanged', { added: added.length, removed: removed.length })
      : added.length > 0
        ? t('message.toolsAddedCount', { count: added.length })
        : t('message.toolsRemovedCount', { count: removed.length })

  // A trailing chevron marks every expandable row and turns down while it is open.
  const chevron = single === undefined && (
    <span className={css.trailingChevron} aria-hidden data-open={open || undefined}>
      <IconChevronRightOutlineRegular size={14} />
    </span>
  )
  return (
    <DisclosureRow
      className={css.root}
      icon={toolBlocks !== undefined ? <IconBrowseOutlineRegular size={14} /> : producer.role === 'recall'
        ? <span data-context-recall-icon><ReferenceIconRegular kind="session" /></span>
        : <IconContextInjectionOutlineRegular size={14} />}
      chevronClassName={css.chevron}
      title={single !== undefined ? t(single.type === 'tool-addition' ? 'message.toolAdded' : 'message.toolRemoved', { name: single.toolName })
        : t(toolBlocks !== undefined ? 'message.toolsUpdated' : producer.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
      collapsedContent={toolSummary !== null ? (
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.summary}>{toolSummary}</span>
          {chevron}
        </>
      ) : toolBlocks !== undefined || producer.label === null ? chevron || undefined : (
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the readable parts. */
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.source} data-context-source>{producer.label}</span>
          {summary !== null && (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.summary} data-context-summary>{summary}</span>
            </>
          )}
          {/* Supplementary and approximate: kept out of the row's accessible name,
              which stays the role and producer like every disclosure row. */}
          <span
            className={css.tokens}
            aria-hidden
            data-context-tokens
            title={t('message.contextTokensTitle', { count: formatExactTokens(tokens, t) })}
          >
            {t('message.contextTokens', { count: formatTokens(tokens, t) })}
          </span>
          {chevron}
        </>
      )}
      previewChevron={false}
      keepContentWhenOpen
      open={open && single === undefined}
      expandable={single === undefined}
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
        {toolBlocks === undefined ? body : (
          <div className={css.toolChanges}>
            {added.length > 0 && <div>{t('message.toolsAdded', { names: added.join(', ') })}</div>}
            {removed.length > 0 && <div>{t('message.toolsRemoved', { names: removed.join(', ') })}</div>}
          </div>
        )}
      </div>
    </DisclosureRow>
  )
}
