import { useEffect, useState, type ReactNode } from 'react'
import type { PluginI18nJob } from '@janhq/jan-api-remotes/client'
import type { LocaleSnapshot } from '@janhq/jan-client-locale/client'
import { Button, Switch, Tag } from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { PluginI18nState } from './service.ts'
import css from './PluginTranslationsTab.module.css'

/** One installed plugin as the tab lists it. */
export interface TranslationPackage {
  /** npm package name. */
  readonly name: string
  /** Display title in the active locale. */
  readonly title: string
}

/** Registration-side face used by the tab. */
export interface PluginTranslationsTabInjected {
  hooks: {
    /** Stored text, consent, and jobs. */
    translations: HostObservable<PluginI18nState>
    /** The active locale, whose stored text the rows describe. */
    locale: HostObservable<LocaleSnapshot>
  }
  /** Read the installed plugins. */
  listPackages: () => Promise<readonly TranslationPackage[]>
  /** Translate a package into the active locale and wait for the job to end. */
  translate: (pkg: string, rerun: boolean) => Promise<PluginI18nJob>
  /** Delete a package's generated text and consent. */
  clear: (pkg: string) => Promise<void>
  /** Switch the global tool-title consent. */
  setGlobal: (allowed: boolean) => Promise<void>
  /** Name a locale in itself. */
  languageName: (locale: string) => string
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginTranslationsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginI18n'>
  & InjectFace<PluginTranslationsTabInjected>

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly packages: readonly TranslationPackage[] }

/**
 * Render the translation controls of the installed plugins: the global title switch and one row each with
 * Translate, Run again, and Clear.
 * @param props - Settings slot props with the translation face.
 * @returns the tab content.
 */
export function PluginTranslationsTab({
  t, useTranslations, useLocale, listPackages, translate, clear, setGlobal, languageName,
}: PluginTranslationsTabProps): ReactNode {
  const state = useTranslations(snapshot => snapshot)
  const locale = useLocale(snapshot => snapshot.active)
  const language = languageName(locale)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({})
  useEffect(() => {
    let current = true
    setList({ status: 'loading' })
    listPackages().then(
      (packages) => { if (current) setList({ status: 'ready', packages }) },
      () => { if (current) setList({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listPackages, attempt, locale])

  const model = state.route === null ? t('modelDefault') : `${state.route.provider}/${state.route.model}`
  const run = (key: string, work: () => Promise<unknown>): void => {
    setBusy(previous => new Set(previous).add(key))
    setFailures(previous => ({ ...previous, [key]: '' }))
    work().then(
      () => {},
      (error: unknown) => { setFailures(previous => ({ ...previous, [key]: error instanceof Error ? error.message : String(error) })) },
    ).finally(() => {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(key)
        return next
      })
    })
  }

  return (
    <section className={css.section}>
      <p className={css.intro}>{t('intro', { language })}</p>
      <div className={css.global}>
        <div className={css.globalText}>
          <strong>{t('globalLabel')}</strong>
          <span className={css.hint}>{t('globalHint', { model })}</span>
        </div>
        <Switch
          checked={state.consent.global}
          disabled={busy.has('')}
          label={t('globalLabel')}
          onChange={(next) => { run('', () => setGlobal(next)) }}
        />
      </div>
      {failures[''] ? <p className={css.failure} role="alert">{t('failed', { reason: failures[''] })}</p> : null}
      {list.status === 'loading' ? <p className={css.status} role="status">{t('loading')}</p> : null}
      {list.status === 'error'
        ? (
          <p className={css.failure} role="alert">
            <span>{t('error')}</span>
            <Button variant="outline" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
          </p>
        )
        : null}
      {list.status === 'ready' && list.packages.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {list.status === 'ready'
        ? (
          <ul className={css.rows}>
            {list.packages.map((pkg) => {
              const status = state.statuses[pkg.name]
              const stored = status?.locales.find(item => item.locale === locale)
              const job = status?.job?.locale === locale ? status.job : null
              const running = job?.state === 'running'
              const failure = failures[pkg.name] || (job?.state === 'failed' ? job.message : undefined)
              const line = running
                ? t('running', { done: job.done, total: job.total })
                : stored === undefined
                  ? t('notTranslated', { language })
                  : t(stored.kept > 0 ? 'translatedKept' : 'translated', { language, model: stored.model, count: stored.entries, kept: stored.kept })
              return (
                <li key={pkg.name} className={css.row} data-plugin-package={pkg.name}>
                  <div className={css.rowMain}>
                    <strong className={css.rowTitle}>{pkg.title}</strong>
                    <code className={css.rowName}>{pkg.name}</code>
                    {stored === undefined ? null : <Tag tone="neutral">{t('machineTag')}</Tag>}
                  </div>
                  <p className={css.status} role="status">{line}</p>
                  {failure ? <p className={css.failure} role="alert">{t('failed', { reason: failure })}</p> : null}
                  <div className={css.actions}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy.has(pkg.name) || running}
                      onClick={() => { run(pkg.name, () => translate(pkg.name, stored !== undefined)) }}
                    >
                      {t(stored === undefined ? 'actionTranslate' : 'actionRerun')}
                    </Button>
                    {status === undefined || (status.locales.length === 0 && !status.consented)
                      ? null
                      : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy.has(pkg.name)}
                          onClick={() => { run(pkg.name, () => clear(pkg.name)) }}
                        >
                          {t('actionClear')}
                        </Button>
                      )}
                  </div>
                </li>
              )
            })}
          </ul>
        )
        : null}
    </section>
  )
}
