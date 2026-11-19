/** Desktop welcome presentation; account and credential operations stay in the preload. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Toast } from '@janhq/jan-client-ui-primitives/src/Toast.tsx'
import { StateDot } from '@janhq/jan-client-ui-primitives/src/StateDot.tsx'
import type { AccountView } from '@janhq/jan-tokamak-account/types'
import type { WelcomeApi, WelcomeLocalModel } from '../welcome-api.ts'

type Page = 'entry' | 'key' | 'account' | 'local'

/** How often the local model page re-reads the Host state. */
const LOCAL_POLL_MS = 500

/**
 * Fill `{name}` placeholders.
 * @param text - localized template.
 * @param params - values by placeholder name.
 * @returns the text.
 */
function fill(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/**
 * Describe the time a download still needs.
 * @param bytes - bytes still to arrive.
 * @param bytesPerSecond - recent rate, above 0.
 * @param m - localized copy.
 * @returns e.g. "about 3 min left".
 */
function remaining(bytes: number, bytesPerSecond: number, m: WelcomeApi['messages']): string {
  const seconds = Math.max(0, bytes) / bytesPerSecond
  return seconds < 60 ? m.welcomeLocalEtaSoon : fill(m.welcomeLocalEtaMinutes, { minutes: String(Math.ceil(seconds / 60)) })
}

/**
 * Format a byte count for people.
 * @param bytes - size in bytes.
 * @returns e.g. "2.7 GB" or "23 MB".
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`
}

/**
 * Render the standalone welcome flow using shell-owned operations and localized copy.
 * Clearing the account attempt returns the sign-in status page to the initial choices.
 * @param props.api - isolated preload API; no account credentials reach the renderer.
 * @returns welcome pages with fixed bottom actions.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [expiryNotice, setExpiryNotice] = useState(false)
  const [page, setPage] = useState<Page>('entry')
  const pageRef = useRef<Page>('entry')
  const visiblePage = useRef<Page>('entry')
  const [attempt, setAttempt] = useState<AccountView['attempt']>(null)
  const attemptRef = useRef<AccountView['attempt']>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'idle' | 'busy' | 'copied' | 'failed' }>({ status: 'idle' })
  const copyState = copyFeedback.status
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)
  const focusEntry = useRef(false)
  const [local, setLocal] = useState<WelcomeLocalModel | undefined>()
  const [localFailed, setLocalFailed] = useState(false)
  const [offer, setOffer] = useState<WelcomeLocalModel | undefined>()
  const [cancellingLocal, setCancellingLocal] = useState(false)

  function navigate(next: Page) {
    pageRef.current = next
    setPage(next)
  }
  function showAccount(state: AccountView) {
    if (pageRef.current === 'key' || (state.attempt === null && pageRef.current === 'entry')) return
    attemptRef.current = state.attempt
    setAttempt(state.attempt)
    setStarting(false)
    setCopyFeedback({ status: 'idle' })
    navigate(state.attempt === null || state.attempt.phase === 'cancelled' ? 'entry' : 'account')
  }

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    const takeNotice = (): void => {
      void api.takeNotice().then((notice) => {
        if (mounted.current && notice === 'session-expired') setExpiryNotice(true)
      }).catch((_closedChannel: unknown) => {
        // A closed Welcome IPC channel must not interrupt the sign-in page.
      })
    }
    takeNotice()
    const stop = api.onAccountState((state) => {
      revision.current++
      takeNotice()
      showAccount(state)
    })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  useEffect(() => {
    if (page === 'entry' && visiblePage.current !== 'entry') void api.analytics?.('auth_page_view', {})
    visiblePage.current = page
    if (page === 'key') input.current?.focus()
    else if (page === 'entry' && focusEntry.current) {
      focusEntry.current = false
      keyButton.current?.focus()
    }
  }, [page, api])

  useEffect(() => {
    if (page !== 'local') return
    let stopped = false
    const poll = (): void => {
      void api.readLocalModel().then((state) => {
        if (!stopped && mounted.current) setLocal(state)
      }).catch((_closedChannel: unknown) => {
        // The next poll retries; a closed channel means the window is closing.
      })
    }
    const timer = setInterval(poll, LOCAL_POLL_MS)
    poll()
    return () => { stopped = true; clearInterval(timer) }
  }, [page, api])

  // The entry names the first-run model and its size before the download is committed.
  useEffect(() => {
    void api.readLocalModel().then((state) => {
      if (mounted.current) setOffer(state)
    }).catch((_closedChannel: unknown) => {
      // Without the size the entry still offers the download.
    })
  }, [api])

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return
    const timer = setTimeout(() => { setCopyFeedback({ status: 'idle' }) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copyFeedback])

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    void api.analytics?.('api_key_save_click', {})
    const value = draft.trim()
    if (!/^[\x21-\x7e]+$/.test(value) || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
      || ((value.startsWith('"') || value.startsWith("'") || value.charCodeAt(0) === 96) && value.at(-1) === value[0])) {
      setError(value === '' ? m.welcomeKeyBlank : m.welcomeKeyInvalid)
      input.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.saveApiKey(value)
      if (!mounted.current) return
      if (result.ok) setDraft('')
      else setError(m.welcomeKeyFailed)
    } catch {
      if (mounted.current) setError(m.welcomeKeyFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function skip() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await api.skip()
      if (mounted.current) setDraft('')
    } catch {
      if (mounted.current) setError(m.welcomeContinueFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function startLocal() {
    navigate('local')
    setLocalFailed(false)
    try {
      const state = await api.startLocalModel()
      if (mounted.current) setLocal(state)
    } catch {
      if (mounted.current) setLocalFailed(true)
    }
  }
  async function cancelLocal() {
    setCancellingLocal(true)
    try {
      const state = await api.cancelLocalModel()
      if (!mounted.current) return
      setOffer(previous => state ?? previous)
      setLocal(undefined)
      focusEntry.current = true
      navigate('entry')
    } catch {
      // The download keeps running and its progress stays on screen, so cancelling can be retried.
    } finally {
      if (mounted.current) setCancellingLocal(false)
    }
  }
  async function start() {
    navigate('account')
    setStarting(true)
    setAttempt(null)
    attemptRef.current = null
    const current = ++revision.current
    try {
      const state = await api.startSignIn()
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      if (mounted.current && revision.current === current) setStarting(false)
    }
  }
  async function cancel() {
    if (cancelling || attemptRef.current === null) return
    setCancelling(true)
    const current = ++revision.current
    try {
      const state = await api.cancelSignIn(attemptRef.current.id)
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      // The current attempt remains visible so cancellation can be retried.
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }
  async function copyLink() {
    const current = attemptRef.current
    if (current?.phase !== 'waiting-browser' || (copyState === 'busy' || copyState === 'copied')) return
    setCopyFeedback({ status: 'busy' })
    try {
      await api.copySignInLink(current.id)
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'copied' })
    } catch {
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'failed' })
    }
  }

  const phase = starting ? 'initializing' : attempt?.phase ?? 'failed'
  const waiting = phase === 'waiting-browser'
  const failed = phase === 'expired' || phase === 'failed'
  const title = phase === 'initializing' ? m.welcomeAuthStarting
    : waiting ? m.welcomeAuthWaiting : phase === 'expired' ? m.welcomeAuthExpired
      : phase === 'failed' ? m.welcomeAuthFailed : m.welcomeAuthExchanging
  const heading = page === 'entry' ? 'welcome-heading' : page === 'key' ? 'key-title' : page === 'local' ? 'local-title' : 'auth-status'
  const localPhase = localFailed ? 'failed' : local?.phase ?? 'checking'
  const localName = local?.name ?? ''
  const localBusy = localPhase === 'downloading' || localPhase === 'starting' || localPhase === 'installed' || localPhase === 'checking'
  const localProgress = localPhase === 'downloading' ? local?.progress : undefined
  const localStatus = localPhase === 'running' ? fill(m.welcomeLocalReady, { name: localName })
    : localPhase === 'failed' ? m.welcomeLocalFailed
      : localPhase === 'starting' || localPhase === 'installed' ? fill(m.welcomeLocalStarting, { name: localName })
        : fill(m.welcomeLocalDownloading, { name: localName })
  const localDetail = localProgress === undefined ? '' : [
    fill(m.welcomeLocalProgress, {
      percent: String(Math.min(100, Math.floor((localProgress.receivedBytes / Math.max(localProgress.totalBytes, 1)) * 100))),
      received: formatBytes(localProgress.receivedBytes), total: formatBytes(localProgress.totalBytes),
    }),
    ...localProgress.bytesPerSecond > 0 ? [fill(m.welcomeLocalSpeed, { speed: formatBytes(localProgress.bytesPerSecond) })] : [],
    ...localProgress.bytesPerSecond > 0
      ? [remaining(localProgress.totalBytes - localProgress.receivedBytes, localProgress.bytesPerSecond, m)]
      : [],
  ].join(' · ')

  return <>
    {expiryNotice && <Toast text={m.welcomeSessionExpired} onDone={() => { setExpiryNotice(false) }} />}
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby={heading}>
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline" hidden={page !== 'entry'}>
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
      </div>
      <form id="key-form" className="key-form" hidden={page !== 'key'} noValidate onSubmit={(event) => { void saveKey(event) }} aria-busy={busy}>
        <header className="key-heading"><h1 id="key-title">{m.welcomeKeyTitle}</h1><p id="key-description">{m.welcomeKeyDescription}</p></header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="key-input">{m.welcomeKeyPlaceholder}</label>
          <input ref={input} id="key-input" type="password" autoComplete="new-password" autoCapitalize="off" spellCheck={false} required
            aria-describedby="key-description key-error" aria-invalid={error !== ''} placeholder={m.welcomeKeyPlaceholder}
            value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setError('') }} />
          <p id="key-error" className="key-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <section id="auth-page" className={`key-heading ${waiting ? 'auth-waiting' : phase === 'expired' ? 'auth-expired' : ''}`}
        hidden={page !== 'account'} aria-live="polite">
        <h1 id="auth-status">{title}</h1>
        <p id="auth-description" hidden={!waiting && phase !== 'expired'}>{waiting ? m.welcomeAuthWaitingDescription : m.welcomeAuthExpiredDescription}</p>
        <button id="auth-copy" className="copy-link" type="button" hidden={!waiting} disabled={!waiting || (copyState === 'busy' || copyState === 'copied')} onClick={() => { void copyLink() }}>
          {copyState === 'copied' ? m.welcomeAuthCopied : copyState === 'failed' ? m.welcomeAuthCopyFailed : m.welcomeAuthCopyLink}
        </button>
      </section>
      <section id="local-page" className="key-heading" hidden={page !== 'local'} aria-live="polite">
        <h1 id="local-title">{fill(m.welcomeLocalTitle, { name: localName })}</h1>
        <p id="local-status">{localStatus}</p>
        {localProgress !== undefined && <>
          <progress id="local-progress" value={localProgress.receivedBytes} max={Math.max(localProgress.totalBytes, 1)} aria-label={localStatus} />
          <p id="local-detail">{localDetail}</p>
        </>}
        {localPhase === 'failed' && local?.error !== undefined && <p id="local-error" className="key-error" role="alert">{local.error}</p>}
        {localPhase !== 'failed' && <p id="local-description">{m.welcomeLocalDescription}</p>}
      </section>
      <div id="local-actions" className="actions" hidden={page !== 'local'}>
        {localPhase === 'running' && <button id="local-start" className="primary" type="button" onClick={() => { void skip() }}>{m.welcomeLocalStart}</button>}
        {localPhase === 'failed' && <button id="local-retry" className="primary" type="button" onClick={() => { void startLocal() }}>{m.welcomeLocalRetry}</button>}
        {localBusy && <button id="local-background" className="secondary" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeLocalBackground}</button>}
        {localPhase === 'downloading' && <button id="local-cancel" className="back" type="button" disabled={busy || cancellingLocal} onClick={() => { void cancelLocal() }}>{m.welcomeLocalCancel}</button>}
        {!localBusy && localPhase !== 'running' && <button id="local-back" className="back" type="button" onClick={() => { navigate('entry') }}>{m.welcomeLocalBack}</button>}
      </div>
      <div id="auth-actions" className="actions" hidden={page !== 'account'}>
        <button id="auth-loading" className="primary" type="button" hidden={failed} disabled aria-label={m.welcomeAuthExchanging}>
          <StateDot state="ongoing" size={16} className="welcome-loading" />
        </button>
        <button id="auth-retry" className="primary" type="button" hidden={!failed} onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'sign_in' }); void start() }}>{m.welcomeAuthRetry}</button>
        <button id="auth-api-key" className="secondary" type="button" hidden={!failed} onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'api-key' }); navigate('key') }}>{m.welcomeApiKey}</button>
        <button id="auth-cancel" className="secondary" type="button" hidden={failed}
          disabled={cancelling || phase === 'committing' || phase === 'succeeded' || (phase === 'initializing' && !attempt?.id)}
          onClick={() => { void cancel() }}>{m.welcomeAuthCancel}</button>
      </div>
      <div id="entry-actions" className="actions" hidden={page !== 'entry'}>
        <button id="local-model" className="primary" type="button" title={m.welcomeLocalHint}
          aria-describedby={offer === undefined ? undefined : 'local-size'} onClick={() => { void startLocal() }}>{m.welcomeLocalModel}</button>
        {offer !== undefined && <p id="local-size" className="hint">{fill(m.welcomeLocalSize, { name: offer.name, size: formatBytes(offer.totalBytes) })}</p>}
        <button id="sign-in" className="secondary" type="button" onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'sign_in' }); void start() }}>{m.welcomeSignIn}</button>
        <div className="links">
          <button ref={keyButton} id="api-key" className="back" type="button" onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'api-key' }); setError(''); navigate('key') }}>{m.welcomeApiKey}</button>
          <span className="links-separator" aria-hidden="true">·</span>
          <button id="skip-entry" className="back" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeKeyLater}</button>
        </div>
        <p id="entry-error" className="hint" role="alert" hidden={error === ''}>{error}</p>
      </div>
      <div id="key-actions" className="actions" hidden={page !== 'key'}>
        <button id="save-key" className="primary" type="submit" form="key-form" disabled={busy || draft.trim() === ''}>{m.welcomeKeySave}</button>
        <button id="skip-key" className="secondary" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeKeyLater}</button>
        <button id="back-to-login" className="back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setDraft(''); setError(''); focusEntry.current = true; navigate('entry')
        }}>{m.welcomeKeyBack}</button>
      </div>
    </main>
  </>
}
