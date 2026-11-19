import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconGlobeOutlineRegular, IconLoadingOutlineRegular, IconWarningOutlineRegular, modalSelector, Toast } from '@janhq/jan-client-ui-primitives'
import type { LocaleSnapshot } from '@janhq/jan-client-locale/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-layout/client'
import { languageName, type PluginI18nService, type PluginTranslationSuggestion } from './service.ts'
import css from './PluginTranslationPrompt.module.css'

export interface PluginTranslationPromptInjected extends Pick<PluginI18nService, 'translate' | 'clear' | 'dismiss'> {
  readonly hooks: {
    readonly suggestions: PluginI18nService['suggestions']
    readonly locale: HostObservable<LocaleSnapshot>
  }
}

export type PluginTranslationPromptProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.pluginI18n'> & InjectFace<PluginTranslationPromptInjected>

type Operation = { suggestion: PluginTranslationSuggestion } & (
  | { phase: 'working' | 'success' | 'restoring' }
  | { phase: 'failed' | 'restore-failed'; reason: string }
)

/** One non-modal offer and its feedback, regardless of how many plugins were detected. */
export function PluginTranslationPrompt({
  useLocale, useSuggestions, translate, clear, dismiss, t,
}: PluginTranslationPromptProps): ReactNode {
  const active = useLocale(state => state.active)
  const candidate = useSuggestions(items => items[0])
  const [operation, setOperation] = useState<Operation | undefined>()
  const busy = useRef(false)
  const current = operation?.suggestion.target === active ? operation : undefined
  const suggestion = current?.suggestion ?? candidate
  const pending = current?.phase === 'working' || current?.phase === 'restoring'

  useEffect(() => {
    if (operation !== undefined && operation.suggestion.target !== active) setOperation(undefined)
  }, [operation, active])
  useEffect(() => {
    if (suggestion === undefined || pending || current?.phase === 'success') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || document.querySelector(modalSelector) !== null) return
      dismiss(suggestion.pkg, 'later')
      setOperation(undefined)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [current, dismiss, pending, suggestion])

  if (suggestion === undefined || suggestion.target !== active) return null
  const copy = { plugin: suggestion.title, source: suggestion.languageName, target: languageName(suggestion.target) }
  const close = (mode: 'later' | 'never'): void => {
    dismiss(suggestion.pkg, mode)
    setOperation(undefined)
  }
  const run = async (restore: boolean, retry: boolean): Promise<void> => {
    if (busy.current) return
    busy.current = true
    const working: Operation = { phase: restore ? 'restoring' : 'working', suggestion }
    setOperation(working)
    try {
      if (restore) await clear(suggestion.pkg)
      else {
        const job = await translate(suggestion.pkg, retry)
        if (job.state === 'failed') throw new Error(job.message || t('offerUnknownError'))
      }
      setOperation(previous => previous === working ? restore ? undefined : { phase: 'success', suggestion } : previous)
    } catch (error) {
      const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : t('offerUnknownError')
      setOperation(previous => previous === working ? { phase: restore ? 'restore-failed' : 'failed', reason, suggestion } : previous)
    } finally {
      busy.current = false
    }
  }

  if (current?.phase === 'success') return <Toast
    text={t('offerSuccess', copy)} tone="success" holdMs={10000}
    actions={[{ label: t('offerOriginal'), prefix: ' ', onClick: () => { void run(true, false) } }]}
    onDone={() => { setOperation(previous => previous === current ? undefined : previous) }}
  />

  const failed = current?.phase === 'failed' || current?.phase === 'restore-failed'
  const Icon = pending ? IconLoadingOutlineRegular : failed ? IconWarningOutlineRegular : IconGlobeOutlineRegular
  const message = current?.phase === 'working' ? t('offerWorking', copy)
    : current?.phase === 'restoring' ? t('offerRestoring', copy)
      : current?.phase === 'failed' ? t('failed', { reason: current.reason })
        : current?.phase === 'restore-failed' ? t('offerRestoreFailed', { reason: current.reason }) : t('offerQuestion', copy)

  return <aside className={css.prompt} aria-label={t('tab')} translate="no">
    <div className={css.header}>
      <span aria-hidden="true" className={pending ? css.spinner : css.icon}><Icon size={18} /></span>
      <p role={failed ? 'alert' : 'status'} className={css.message}>{message}</p>
    </div>
    {!pending && <div className={css.actions}>
      {!failed && <Button size="sm" className={css.never} onClick={() => { close('never') }}>{t('offerNever')}</Button>}
      <Button size="sm" onClick={() => { close('later') }}>{t('offerLater')}</Button>
      <Button variant="primary" size="sm" onClick={() => { void run(current?.phase === 'restore-failed', failed) }}>
        {t(failed ? 'retry' : 'actionTranslate')}
      </Button>
    </div>}
  </aside>
}
