import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PluginI18nService, PluginI18nState, PluginTranslationSuggestion } from '@janhq/jan-client-ui-plugin-i18n/client'
import { Button, IconGlobeOutlineRegular, StateDot, Tag } from '@janhq/jan-client-ui-primitives'
import type { HostObservable } from '@janhq/jan-client-ui-slots'
import type { PackageView } from './manager-store.ts'
import type { Translate } from './presentation.ts'
import css from './PluginManagerPage.module.css'

type PackageTranslationService = Pick<PluginI18nService, 'getSnapshot' | 'subscribe' | 'suggestions' | 'assess' | 'translate' | 'clear'>

/** Page-only, so the installation controller does not depend on Settings navigation. */
export interface PluginTranslationFace {
  hooks: {
    packageTranslation: HostObservable<PackageTranslationService | undefined>
    translationSettings: HostObservable<boolean>
  }
  openTranslationSettings: () => void
}

const NO_SUGGESTIONS: readonly PluginTranslationSuggestion[] = []
const subscribeNever = (): (() => void) => () => {}
const EMPTY_STATE: HostObservable<undefined> = { getSnapshot: () => undefined, subscribe: subscribeNever }
const EMPTY_SUGGESTIONS: HostObservable<readonly PluginTranslationSuggestion[]> = {
  getSnapshot: () => NO_SUGGESTIONS,
  subscribe: subscribeNever,
}

function useSnapshot<T>(source: HostObservable<T>): T {
  return useSyncExternalStore(
    useCallback(listener => source.subscribe(listener), [source]),
    useCallback(() => source.getSnapshot(), [source]),
  )
}

type Operation = 'translate' | 'clear'
interface Attempt {
  readonly service: PackageTranslationService
  readonly locale: string
  readonly operation: Operation
  /** Undefined means the operation is in flight. */
  readonly error?: string
}

export interface TranslationControl {
  readonly action: ReactNode
  readonly error: ReactNode
}

/** Keep actions started on a card visible after navigating to its detail page, and vice versa. */
export function usePackageTranslations(service: PackageTranslationService | undefined, locale: string, t: Translate) {
  const state = useSnapshot<PluginI18nState | undefined>(service ?? EMPTY_STATE)
  const suggestions = useSnapshot(service?.suggestions ?? EMPTY_SUGGESTIONS)
  const [attempts, setAttempts] = useState<ReadonlyMap<string, Attempt>>(() => new Map())
  const targetLanguage = useMemo(() => service === undefined ? locale : displayLanguage(locale), [locale, service])

  return (pkg: PackageView): TranslationControl | undefined => {
    if (service === undefined || state?.ready !== true || pkg.official || !pkg.installed || pkg.availability === 'missing') return
    const name = pkg.name
    const status = state.statuses[name]
    const translated = state.consent.packages.includes(name) || status?.consented === true
      || status?.locales.some(item => item.locale === locale) === true
    const job = status?.job?.locale === locale ? status.job : undefined
    const pending = attempts.get(name)
    const attempt = pending?.service === service && pending.locale === locale ? pending : undefined
    const working = attempt !== undefined && attempt.error === undefined
    const clearing = working && attempt.operation === 'clear'
    const running = working || (job?.state === 'running' && attempt?.error === undefined)
    const translateError = attempt?.operation === 'translate' ? attempt.error : undefined
    const failed = translateError !== undefined || job?.state === 'failed'
    const jobError = translateError ?? job?.message
    const suggestion = translated || running ? undefined : suggestions.find(item => item.pkg === name && item.target === locale)
    const offer = translated || running || suggestion !== undefined ? null : service.assess({
      pkg: name,
      meta: [pkg.meta?.title, pkg.meta?.description ?? pkg.description].filter(text => text !== undefined),
    }, { manual: true })
    const screenError = state.failures[name]
    if (!translated && !running && !failed && suggestion === undefined && offer === null) return

    const run = async (operation: Operation): Promise<void> => {
      const active = { service, locale, operation }
      setAttempts(previous => new Map(previous).set(name, active))
      let error: string | undefined
      try {
        if (operation === 'clear') await service.clear(name)
        else {
          const result = await service.translate(name)
          if (result.state === 'failed') error = result.message ?? ''
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
      setAttempts((previous) => {
        if (previous.get(name) !== active) return previous
        const next = new Map(previous)
        if (error === undefined) next.delete(name)
        else next.set(name, { service, locale, operation, error })
        return next
      })
    }

    let action: ReactNode
    if (running) {
      const text = clearing ? t('pluginShowingOriginal')
        : job?.state === 'running' && job.total > 0 ? t('pluginTranslationProgress', { done: job.done, total: job.total })
          : t('installTranslateRunning', { language: targetLanguage })
      action = <span role="status" className={css.translationStatus}><StateDot state="ongoing" size={12} /><span>{text}</span></span>
    } else {
      const language = offer?.language ?? targetLanguage
      const params = { source: suggestion?.languageName ?? '', language }
      const accept = suggestion !== undefined || offer !== null || failed
      action = (
        <>
          {translated && !failed ? <Tag>{t('pluginTranslated')}</Tag> : null}
          {accept ? (
            <Button variant="outline" size="sm" className={css.translationButton} icon={<IconGlobeOutlineRegular size={13} />}
              aria-label={suggestion === undefined ? t(failed ? 'retry' : 'installTranslateAction', params) : t('pluginTranslateFrom', params)}
              onClick={() => { void run('translate') }}>
              <span className={css.translationLabel}>{suggestion === undefined
                ? t(failed ? 'retry' : 'installTranslateAction', params) : t('pluginTranslationPair', params)}</span>
            </Button>
          ) : null}
          {translated ? (
            <Button variant="ghost" size="sm" className={css.translationButton} aria-label={t('pluginShowOriginal')}
              onClick={() => { void run('clear') }}>
              <span className={css.translationLabel}>{t('pluginShowOriginal')}</span>
            </Button>
          ) : null}
        </>
      )
    }

    const error = running ? undefined : attempt?.operation === 'clear' && attempt.error !== undefined
      ? t('pluginShowOriginalFailed', { reason: attempt.error })
      : failed ? jobError ? t('installTranslateFailed', { reason: jobError }) : t('pluginTranslationFailed')
        : screenError ? t('installTranslateFailed', { reason: screenError }) : undefined
    return {
      action: <div className={css.translationActions} translate="no">{action}</div>,
      error: error === undefined ? null : <p className={css.reason} role="alert" translate="no">{error}</p>,
    }
  }
}

function displayLanguage(locale: string): string {
  try { return new Intl.DisplayNames(locale, { type: 'language' }).of(locale) ?? locale } catch { return locale }
}
