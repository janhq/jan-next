/**
 * Local model manager inside the Models card: installed models (fit, vision, context, residency;
 * load, unload, make default, delete), downloads in progress, curated models with a search box that
 * also looks up Hugging Face repositories, and import of a GGUF file, with an optional vision
 * projector file, from disk.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Tag } from '@janhq/jan-client-ui-primitives'
import type {
  HuggingFaceRepoInfo, LlamaCppHostPlatform, LlamaCppState, LocalModelEntry, LocalModelStatus,
} from '@janhq/jan-api-llama-cpp-controller'
import type { LocalModelActions, Outcome } from './actions.ts'
import { formatBytes } from './state.ts'
import { DownloadProgress, FitTag, VisionTag, type T } from './parts.tsx'
import css from './LocalModel.module.css'

const SOURCE_KEY = { catalog: 'sourceCatalog', huggingface: 'sourceHuggingFace', import: 'sourceImport' } as const
const STATUS_KEY = { loaded: 'statusLoaded', loading: 'statusLoading', unloaded: 'statusUnloaded' } as const satisfies Record<LocalModelStatus, string>
/** The Host resolves the imported path, so the example follows its platform, not the browser's. */
const IMPORT_PLACEHOLDER_KEY = {
  linux: 'importPlaceholderLinux', macos: 'importPlaceholderMacos', windows: 'importPlaceholderWindows',
} as const satisfies Record<LlamaCppHostPlatform, string>
const IMPORT_PROJECTOR_PLACEHOLDER_KEY = {
  linux: 'importProjectorPlaceholderLinux', macos: 'importProjectorPlaceholderMacos', windows: 'importProjectorPlaceholderWindows',
} as const satisfies Record<LlamaCppHostPlatform, string>

/** Text that names a Hugging Face repository rather than a catalog search. */
const REPO_INPUT = /^(?:https?:\/\/\S+|[\w.-]+\/[\w.-]+)$/

/** Props shared by every manager section. */
interface SectionProps {
  state: LlamaCppState
  actions: LocalModelActions
  t: T
}

/** @returns the whole manager. */
export function ModelManager(props: SectionProps): ReactNode {
  return <>
    <InstalledModels {...props} />
    <Downloads {...props} />
    <AddModel {...props} />
    <ImportModel {...props} />
  </>
}

function InstalledModels({ state, actions, t }: SectionProps): ReactNode {
  const [confirming, setConfirming] = useState<string | undefined>()
  // One model operation at a time per row; its failure stays on the row until the next attempt.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  if (state.models.length === 0) return null
  const busy = state.phase === 'starting' || state.phase === 'checking'
  const running = state.phase === 'running'
  const perform = (id: string, call: (id: string) => Promise<Outcome<void>>): void => {
    setPending(current => new Set(current).add(id))
    setErrors((current) => { const next = new Map(current); next.delete(id); return next })
    void call(id).then((outcome) => {
      setPending((current) => { const next = new Set(current); next.delete(id); return next })
      if (!outcome.ok) setErrors(current => new Map(current).set(id, outcome.error))
    })
  }
  return <section className={css.section} aria-label={t('installedTitle')}>
    <h4 className={css.sectionTitle}>{t('installedTitle')}</h4>
    <ul className={css.list} data-testid="local-model-installed">
      {state.models.map((model: LocalModelEntry) => {
        const disabled = busy || pending.has(model.id)
        const error = errors.get(model.id)
        const context = model.contextSize ?? model.contextLength
        const detail = [
          formatBytes(model.bytes), model.architecture,
          ...context === undefined ? [] : [t(model.contextSize === undefined ? 'trainedContext' : 'modelContext', { tokens: context.toLocaleString() })],
          t(SOURCE_KEY[model.source]),
        ].join(' · ')
        return <li key={model.id} className={css.row} data-model-id={model.id} data-status={model.status}>
          <span className={css.rowMain}>
            <span className={css.offerHead}>
              <span className={css.rowName} title={model.name}>{model.name}</span>
              {model.active && <span title={t('defaultHint')}><Tag tone="info">{t('defaultTag')}</Tag></span>}
              {model.vision && <VisionTag t={t} />}
              <FitTag fit={model.fit} t={t} />
            </span>
            <span className={css.muted}>{detail}</span>
          </span>
          {confirming === model.id ? <span className={css.actions}>
            <span className={css.muted}>
              {t(model.source === 'import' ? 'forgetConfirm' : 'deleteConfirm', { name: model.name, size: formatBytes(model.bytes) })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setConfirming(undefined) }}>{t('keep')}</Button>
            <Button variant="outline" size="sm" data-testid="local-model-confirm-delete" onClick={() => {
              setConfirming(undefined)
              perform(model.id, actions.deleteModel)
            }}>{t(model.source === 'import' ? 'confirmForget' : 'confirmDelete')}</Button>
          </span> : <span className={css.actions}>
            {running && <span className={css.status} data-testid="local-model-residency">{t(STATUS_KEY[model.status])}</span>}
            {running && model.status === 'unloaded' && <Button variant="outline" size="sm" data-testid="local-model-load" disabled={disabled}
              onClick={() => { perform(model.id, actions.loadModel) }}>{t('load')}</Button>}
            {running && model.status === 'loaded' && <Button variant="outline" size="sm" data-testid="local-model-unload" disabled={disabled}
              onClick={() => { perform(model.id, actions.unloadModel) }}>{t('unload')}</Button>}
            {!model.active && <Button variant="outline" size="sm" data-testid="local-model-make-default" disabled={disabled}
              onClick={() => { perform(model.id, actions.setDefaultModel) }}>{t('makeDefault')}</Button>}
            <Button variant="ghost" size="sm" data-testid="local-model-delete" disabled={disabled} onClick={() => { setConfirming(model.id) }}>
              {t('deleteModel')}
            </Button>
          </span>}
          {error !== undefined && <span className={`${css.rowWide} ${css.error}`} role="alert">{error}</span>}
        </li>
      })}
    </ul>
  </section>
}

/** Percent of a paused download's bytes already on disk. */
function pausedPercent(item: LlamaCppState['downloads'][number]): string {
  const progress = item.progress
  if (progress === undefined || progress.totalBytes <= 0) return '0'
  return String(Math.min(100, Math.floor((progress.receivedBytes / progress.totalBytes) * 100)))
}

function Downloads({ state, actions, t }: SectionProps): ReactNode {
  // While nothing is installed the card's own progress line shows the running first download.
  const items = state.models.length === 0
    ? state.downloads.filter(item => item.error !== undefined || item.paused !== undefined)
    : state.downloads
  if (items.length === 0) return null
  return <section className={css.section} aria-label={t('downloadsTitle')}>
    <h4 className={css.sectionTitle}>{t('downloadsTitle')}</h4>
    <ul className={css.list} data-testid="local-model-downloads">
      {items.map(item => {
        const running = item.error === undefined && item.paused === undefined
        return <li key={item.id} className={css.row} data-model-id={item.id}>
          <span className={css.rowMain}>
            <span className={css.rowName} title={item.name}>{item.name}</span>
            {item.error !== undefined && <span className={css.error} role="alert">{item.error}</span>}
            {item.paused !== undefined && <span className={css.muted}>{t('pausedAt', { percent: pausedPercent(item) })}</span>}
            {running && item.progress === undefined && <span className={css.muted}>{t('queued')}</span>}
          </span>
          <span className={css.actions}>
            {item.error !== undefined && <Button variant="outline" size="sm" data-testid="local-model-retry-download"
              onClick={() => { actions.retryDownload(item.id) }}>{t('retryDownload')}</Button>}
            {item.paused !== undefined && <Button variant="outline" size="sm" data-testid="local-model-resume-download"
              onClick={() => { actions.retryDownload(item.id) }}>{t('resumeDownload')}</Button>}
            {running && <Button variant="outline" size="sm" data-testid="local-model-pause-download"
              onClick={() => { actions.pauseDownload(item.id) }}>{t('pauseDownload')}</Button>}
            <Button variant="ghost" size="sm" onClick={() => { actions.cancelDownload(item.id) }}>
              {t(item.error === undefined ? 'cancel' : 'dismiss')}
            </Button>
          </span>
          {running && item.progress !== undefined
            && <span className={css.rowWide}><DownloadProgress progress={item.progress} name={item.name} t={t} /></span>}
        </li>
      })}
    </ul>
  </section>
}

type Lookup =
  | { status: 'idle' }
  | { status: 'loading'; repo: string }
  | { status: 'done'; result: HuggingFaceRepoInfo }
  | { status: 'failed'; error: string }

function AddModel({ state, actions, t }: SectionProps): ReactNode {
  const [query, setQuery] = useState('')
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' })
  // Kept here, not in the file list, so a re-run lookup does not offer a started download again:
  // `repo/file` → the model id it installs as, or undefined while the request is pending.
  const [started, setStarted] = useState<ReadonlyMap<string, string | undefined>>(new Map())
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const text = query.trim()
  const looksLikeRepo = REPO_INPUT.test(text)
  const needle = text.toLowerCase()
  const matches = looksLikeRepo ? [] : state.catalog.filter(entry =>
    needle === '' || entry.name.toLowerCase().includes(needle) || entry.repo.toLowerCase().includes(needle))
  // A paused download offers Download again, which resumes it from its partial file.
  const downloading = new Set(state.downloads.filter(item => item.error === undefined && item.paused === undefined).map(item => item.id))

  const runLookup = (): void => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLookup({ status: 'loading', repo: text })
    void actions.lookupRepo(text, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return
      setLookup(outcome.ok ? { status: 'done', result: outcome.value } : { status: 'failed', error: outcome.error })
    })
  }

  return <section className={css.section} aria-label={t('addTitle')}>
    <h4 className={css.sectionTitle}>{t('addTitle')}</h4>
    <form className={css.field} onSubmit={(event) => {
      event.preventDefault()
      if (looksLikeRepo) runLookup()
    }}>
      <Input className={css.input ?? ''} aria-label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={query}
        data-testid="local-model-search" spellCheck={false} autoCapitalize="off"
        onChange={(event) => {
          // A lookup still in flight answers for the old text; drop it.
          pending.current?.abort()
          setQuery(event.target.value)
          setLookup({ status: 'idle' })
        }} />
      {looksLikeRepo && <Button variant="outline" size="sm" type="submit" data-testid="local-model-lookup" disabled={lookup.status === 'loading'}>
        {t(lookup.status === 'loading' ? 'lookingUp' : 'lookUp')}
      </Button>}
    </form>
    {!looksLikeRepo && (matches.length === 0
      ? <p className={css.muted}>{t('noMatches')}</p>
      : <ul className={css.list} data-testid="local-model-catalog">
        {matches.map(entry => <li key={entry.id} className={css.row} data-model-id={entry.id}>
          <span className={css.rowMain}>
            <span className={css.offerHead}>
              <span className={css.rowName}>{entry.name}</span>
              {entry.recommended && <Tag tone="info">{t('recommended')}</Tag>}
              {entry.vision && <VisionTag t={t} />}
              <FitTag fit={entry.fit} t={t} />
            </span>
            <span className={css.muted}>{formatBytes(entry.bytes)} · {entry.repo}</span>
          </span>
          {entry.installed
            ? <Tag tone="neutral">{t('installed')}</Tag>
            : <Button variant="outline" size="sm" data-testid="local-model-catalog-download" disabled={downloading.has(entry.id)}
              onClick={() => { actions.downloadModel(entry.id) }}>{t(downloading.has(entry.id) ? 'queued' : 'downloadShort')}</Button>}
        </li>)}
      </ul>)}
    {looksLikeRepo && lookup.status === 'failed' && <p className={css.error} role="alert">{lookup.error}</p>}
    {looksLikeRepo && lookup.status === 'done' && <RepoFiles result={lookup.result} state={state} actions={actions} t={t}
      started={started} onStarted={(key, id) => {
        setStarted((current) => {
          const next = new Map(current)
          if (id === null) next.delete(key)
          else next.set(key, id)
          return next
        })
      }} />}
  </section>
}

/** Props of the looked-up file list; `started` maps `repo/file` keys of requested downloads to their model ids. */
interface RepoFilesProps {
  result: HuggingFaceRepoInfo
  state: LlamaCppState
  actions: LocalModelActions
  t: T
  started: ReadonlyMap<string, string | undefined>
  /** Record a requested download: its id once known, undefined while pending, null to forget it. */
  onStarted: (key: string, id: string | undefined | null) => void
}

type FileStatus = 'installed' | 'downloading' | 'queued' | 'available'

function RepoFiles({ result, state, actions, t, started, onStarted }: RepoFilesProps): ReactNode {
  const [error, setError] = useState<string | undefined>()
  // A requested file follows the live state, so a finished, failed or deleted download is shown as such.
  const status = (file: HuggingFaceRepoInfo['files'][number]): FileStatus => {
    const key = `${result.repo}/${file.file}`
    if (!started.has(key)) return file.installed ? 'installed' : 'available'
    const id = started.get(key)
    if (id === undefined) return 'queued'
    if (state.models.some(model => model.id === id)) return 'installed'
    const download = state.downloads.find(item => item.id === id && item.error === undefined && item.paused === undefined)
    if (download === undefined) return 'available'
    return download.progress === undefined ? 'queued' : 'downloading'
  }
  if (result.files.length === 0) return <p className={css.muted}>{t('repoEmpty', { repo: result.repo })}</p>
  return <>
    <p className={css.muted}>{t('repoFiles', { repo: result.repo })}</p>
    {result.projector !== undefined && <p className={`${css.muted} ${css.offerHead}`} data-testid="local-model-repo-projector">
      <VisionTag t={t} />
      <span>{t('repoProjector', { file: result.projector.file, size: formatBytes(result.projector.bytes) })}</span>
    </p>}
    <ul className={css.list} data-testid="local-model-repo-files">
      {result.files.map((file) => { const fileStatus = status(file); return <li key={file.file} className={css.row}>
        <span className={css.rowMain}>
          <span className={css.offerHead}>
            <span className={css.rowName} title={file.file}>{file.file}</span>
            {file.recommended && <Tag tone="info">{t('recommended')}</Tag>}
            <FitTag fit={file.fit} t={t} />
          </span>
          <span className={css.muted}>{formatBytes(file.bytes)}{file.quant === undefined ? '' : ` · ${file.quant}`}</span>
        </span>
        {fileStatus !== 'available'
          ? <Tag tone="neutral">{t(fileStatus)}</Tag>
          : <Button variant="outline" size="sm" data-testid="local-model-repo-download" onClick={() => {
            const key = `${result.repo}/${file.file}`
            onStarted(key, undefined)
            void actions.downloadRepoFile(result.repo, file.file).then((outcome) => {
              if (outcome.ok) { onStarted(key, outcome.value); return }
              setError(outcome.error)
              onStarted(key, null)
            })
          }}>{t('downloadShort')}</Button>}
      </li> })}
    </ul>
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </>
}

function ImportModel({ state, actions, t }: SectionProps): ReactNode {
  const [path, setPath] = useState('')
  const [projector, setProjector] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; name: string } | { kind: 'failed'; error: string }>({ kind: 'idle' })
  return <section className={css.section} aria-label={t('importTitle')}>
    <h4 className={css.sectionTitle}>{t('importTitle')}</h4>
    <form className={css.field} onSubmit={(event) => {
      event.preventDefault()
      const file = path.trim()
      if (file === '') return
      const projectorFile = projector.trim()
      setStatus({ kind: 'busy' })
      void actions.importModel(file, projectorFile === '' ? undefined : projectorFile).then((outcome) => {
        if (!outcome.ok) { setStatus({ kind: 'failed', error: outcome.error }); return }
        setPath('')
        setProjector('')
        setStatus({ kind: 'done', name: file.split(/[\\/]/).at(-1) ?? file })
      })
    }}>
      <Input className={css.input ?? ''} aria-label={t('importLabel')} placeholder={t(IMPORT_PLACEHOLDER_KEY[state.hostPlatform])} value={path}
        data-testid="local-model-import-path" spellCheck={false} autoCapitalize="off"
        onChange={(event) => { setPath(event.target.value); setStatus({ kind: 'idle' }) }} />
      <Input className={css.input ?? ''} aria-label={t('importProjectorLabel')} placeholder={t(IMPORT_PROJECTOR_PLACEHOLDER_KEY[state.hostPlatform])}
        value={projector} data-testid="local-model-import-projector" spellCheck={false} autoCapitalize="off"
        onChange={(event) => { setProjector(event.target.value); setStatus({ kind: 'idle' }) }} />
      <Button variant="outline" size="sm" type="submit" data-testid="local-model-import" disabled={status.kind === 'busy' || path.trim() === ''}>
        {t(status.kind === 'busy' ? 'importing' : 'importAction')}
      </Button>
    </form>
    {status.kind === 'failed' && <p className={css.error} role="alert">{status.error}</p>}
    {status.kind === 'done' && <p className={css.muted}>{t('imported', { name: status.name })}</p>}
  </section>
}
