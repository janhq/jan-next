import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Button, MarkdownText, useClipboardCopy } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { SideAnswerState } from './state.ts'
import css from './SideAnswerPanel.module.css'

export interface SideAnswerInjected { readonly state: SideAnswerState }

/** Displays only the current Session scope's ephemeral answer. */
export function SideAnswerPanel({ state, t }: SideAnswerInjected & PropsLocale<'btw'>) {
  const root = useRef<HTMLElement>(null)
  const answer = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const active = answer !== null
  const copy = t('copy')
  const copied = t('copied')
  const footnotes = t('footnotes')
  const labels = useMemo(() => ({ code: { copyLabel: copy, copiedLabel: copied }, footnotes }), [copy, copied, footnotes])
  const clipboard = useClipboardCopy(answer?.text ?? '')
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof Element)) return
      const owner = root.current?.closest('[data-conversation-session]')
      if (owner == null || owner !== event.target.closest('[data-conversation-session]')) return
      if (event.target.closest('[role="dialog"], [role="menu"], [data-approval-key], .xterm, [inert]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      state.dismiss()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [active, state])
  if (answer === null) return null
  return (
    <section ref={root} className={css.panel} aria-label={t('title')}>
      <header className={css.header}>
        <div className={css.heading}>
          <strong>{t('title')}</strong>
          <div className={css.question} title={answer.question}>{answer.question}</div>
        </div>
        {answer.text.trim() !== '' && (
          <Button size="sm" onClick={clipboard.onCopy}>{clipboard.copied ? copied : copy}</Button>
        )}
        <Button size="sm" onClick={state.dismiss}>{t('dismiss')}</Button>
      </header>
      {answer.text.trim() === '' ? (
        answer.error === undefined && <p role="status" className={css.status}>{t(answer.status === 'streaming' ? 'waiting' : 'empty')}</p>
      ) : (
        <div className={css.answer} aria-busy={answer.status === 'streaming'}>
          <MarkdownText text={answer.text} streaming={answer.status === 'streaming'} labels={labels} />
        </div>
      )}
      {answer.error !== undefined && <p role="alert" className={css.status}>{t(answer.error)}</p>}
    </section>
  )
}
