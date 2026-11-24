import { useEffect, useState, type ReactNode } from 'react'
import type { PluginI18nJob } from '@janhq/jan-api-remotes/client'
import type { PluginI18nRouteChoices, PluginI18nRouteRef } from '@janhq/jan-host-plugin-i18n/types'
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
  /** Read the model in use, the saved pick, the default model, and the models to pick from. */
  routes: () => Promise<PluginI18nRouteChoices>
  /** Save the model translations run on, or follow the default model again with null. */
  setRoute: (route: PluginI18nRouteRef | null) => Promise<PluginI18nRouteChoices>
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
  t, useTranslations, useLocale, listPackages, translate, clear, setGlobal, routes, setRoute, languageName,
}: PluginTranslationsTabProps): ReactNode {
  const state = useTranslations(snapshot => snapshot)
  const locale = useLocale(snapshot => snapshot.active)
  const language = languageName(locale)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [choices, setChoices] = useState<PluginI18nRouteChoices | 'error' | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({})
  const routeKey = state.route === null ? '' : `${state.route.provider}/${state.route.model}/${state.route.source}`
  useEffect(() => {
    let current = true
    setList({ status: 'loading' })
    listPackages().then(
      (packages) => { if (current) setList({ status: 'ready', packages }) },
      () => { if (current) setList({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listPackages, attempt, locale])
  useEffect(() => {
    let current = true
    routes().then(
      (loaded) => { if (current) setChoices(loaded) },
      () => { if (current) setChoices('error') },
    )
    return () => { current = false }
  }, [routes, attempt, routeKey])

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
      <ModelPicker
        t={t}
        choices={choices}
        busy={busy.has('model')}
        onPick={(next) => { run('model', async () => { setChoices(await setRoute(next)) }) }}
      />
      {failures.model ? <p className={css.failure} role="alert">{t('failed', { reason: failures.model })}</p> : null}
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
              const screenCount = status?.runtime.find(item => item.locale === locale)?.strings ?? 0
              const screenRows = state.screen[pkg.name] ?? []
              const screenFailure = state.failures[pkg.name]
              const consented = state.consent.packages.includes(pkg.name)
              const textual = stored !== undefined && stored.entries + stored.kept > 0
              const line = running
                ? t('running', { done: job.done, total: job.total })
                : stored === undefined
                  ? t('notTranslated', { language })
                  : textual
                    ? t(stored.kept > 0 ? 'translatedKept' : 'translated', { language, model: stored.model, count: stored.entries, kept: stored.kept })
                    : screenCount > 0
                      ? t('translatedScreen', { language, model: stored.model, count: screenCount })
                      : t('translatedScreenWaiting', { language, model: stored.model })
              return (
                <li key={pkg.name} className={css.row} data-translation-package={pkg.name}>
                  <div className={css.rowMain}>
                    <strong className={css.rowTitle}>{pkg.title}</strong>
                    <code className={css.rowName}>{pkg.name}</code>
                    {stored === undefined ? null : <Tag tone="neutral">{t('machineTag')}</Tag>}
                  </div>
                  <p className={css.status} role="status">{line}</p>
                  {textual && consented && screenCount > 0 ? <p className={css.status}>{t('screenLine', { count: screenCount })}</p> : null}
                  {screenFailure ? <p className={css.failure} role="alert">{t('screenFailed', { reason: screenFailure })}</p> : null}
                  {failure ? <p className={css.failure} role="alert">{t('failed', { reason: failure })}</p> : null}
                  {screenRows.length === 0
                    ? null
                    : (
                      <details className={css.screenList}>
                        <summary>{t('screenShow', { count: screenRows.length })}</summary>
                        <ul className={css.screenRows}>
                          {screenRows.map(row => (
                            <li key={row.source} className={css.screenRow}>
                              <span lang="und">{row.source}</span>
                              <span aria-hidden="true">{'->'}</span>
                              <span>{row.text}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
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

/** Props of the model picker. */
interface ModelPickerProps {
  t: PluginTranslationsTabProps['t']
  /** The Host's answer, 'error' when it could not be read, null while loading. */
  choices: PluginI18nRouteChoices | 'error' | null
  busy: boolean
  /** The person picked a model, or null to follow the default model. */
  onPick: (route: PluginI18nRouteRef | null) => void
}

/**
 * Render the translation model picker: the default model, preselected, then every model the person may choose, and
 * a note when the model in use is not the one the choice names.
 * @param props - the Host's choices and the pick callback.
 * @returns the picker.
 */
function ModelPicker({ t, choices, busy, onPick }: ModelPickerProps): ReactNode {
  if (choices === 'error') return <p className={css.failure} role="alert">{t('modelError')}</p>
  if (choices === null) return <p className={css.status} role="status">{t('modelLoading')}</p>
  const { saved, route, models } = choices
  const listed = saved !== null && models.some(model => model.provider === saved.provider && model.model === saved.model)
  const current = saved === null ? 'default' : listed ? String(models.findIndex(model => model.provider === saved.provider && model.model === saved.model)) : 'saved'
  const using = `${route.provider}/${route.model}`
  const notice = saved === null
    ? route.source === 'default' ? null : t('modelFallback', { model: using })
    : route.source === 'saved' ? null : t('modelSavedGone', { model: using })
  return (
    <div className={css.model}>
      <label className={css.modelField}>
        <span className={css.modelLabel}>{t('modelLabel')}</span>
        <select
          className={css.select}
          aria-label={t('modelLabel')}
          value={current}
          disabled={busy}
          onChange={(event) => {
            const picked = models[Number(event.target.value)]
            if (event.target.value === 'default') onPick(null)
            else if (picked !== undefined) onPick({ provider: picked.provider, model: picked.model })
          }}
        >
          <option value="default">{t('modelOptionDefault', { model: `${choices.default.provider}/${choices.default.model}` })}</option>
          {saved !== null && !listed ? <option value="saved">{`${saved.provider}/${saved.model}`}</option> : null}
          {models.map((model, index) => (
            <option key={`${model.provider}\n${model.model}`} value={String(index)}>
              {t(model.loaded ? 'modelOptionLoaded' : 'modelOption', { name: model.name, provider: model.provider })}
            </option>
          ))}
        </select>
      </label>
      {notice === null ? null : <p className={css.status} role="status">{notice}</p>}
    </div>
  )
}
