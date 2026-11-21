/** First-use setup stages the recognizer before persisting activation or language. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelection } from '@janhq/jan-experimental-speech-to-text/types'
import { canRecord, type SpeechReadiness } from './readiness.ts'
import { languageName, PreparationCard } from './PreparationCard.tsx'
import type { VoiceBundleState } from './voice-bundle.ts'
import type { VoiceInputActions } from './VoiceInput.tsx'
import type { NS } from './locales.ts'
import css from './VoiceInput.module.css'

type Props = PropsLocale<typeof NS> & Pick<VoiceInputActions, 'prepare' | 'cancelPreparation' | 'configure' | 'enableVoice' | 'refreshVoiceBundle'> & {
  readiness: SpeechReadiness
  bundle: VoiceBundleState
  onDismiss: () => void
  onStart: (selection: SpeechSelection) => void
}

/**
 * Present language, download progress and confirmation without changing the draft.
 * @param props - Current speech state, persisted settings operations and completion callbacks.
 * @returns The modal for preparing and starting dictation.
 */
export function ComposerVoiceSetup({
  readiness, bundle, prepare, cancelPreparation, configure, enableVoice, refreshVoiceBundle, onDismiss, onStart, t,
}: Props) {
  const selected = readiness.catalog?.selection
  const providers = readiness.catalog?.providers
  const provider = bundle === 'disabled' ? providers?.find(item => item.location === 'host-local')
    : providers?.find(item => item.id === selected?.providerId)
  const [language, setLanguage] = useState<string>()
  const speechLanguage = language !== undefined && provider?.languages.includes(language) ? language
    : selected && provider?.languages.includes(selected.language) ? selected.language : provider?.languages[0]
  const [busy, setBusy] = useState<'saving' | 'cancelling'>()
  const [error, setError] = useState<string>()
  const working = useRef<typeof busy>()
  const mounted = useRef(false)
  const owned = useRef<{ id: SpeechProviderId; start: Promise<void> }>()
  const cancelOwned = async (): Promise<void> => {
    const task = owned.current
    if (!task) return
    try { await task.start } catch {
      // A lost response does not prove the host skipped preparation. Ask it to cancel either way.
    }
    await cancelPreparation(task.id)
    owned.current = undefined
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (working.current !== 'cancelling') void cancelOwned().catch(() => {
        // On unmount the provider still owns preparation; its status remains visible in settings.
      })
    }
  }, [cancelPreparation])

  const stage = async (id: SpeechProviderId, options?: SpeechPreparationOptions): Promise<void> => {
    if (working.current) return
    const start = prepare(id, options)
    owned.current = { id, start }
    await start
  }
  const dismiss = async (): Promise<void> => {
    if (working.current) return
    if (!owned.current) { onDismiss(); return }
    working.current = 'cancelling'; setBusy('cancelling'); setError(undefined)
    try { await cancelOwned(); if (mounted.current) onDismiss() }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { working.current = undefined; if (mounted.current) setBusy(undefined) }
  }
  const confirm = async (): Promise<void> => {
    if (working.current || !readiness.connected || !provider || !speechLanguage || !canRecord(provider.preparation.phase)) return
    working.current = 'saving'; setBusy('saving'); setError(undefined)
    const selection = { providerId: provider.id, language: speechLanguage }
    try {
      if (bundle === 'disabled') await enableVoice()
      if (selection.providerId !== selected?.providerId || selection.language !== selected.language) await configure(selection)
      owned.current = undefined
      if (mounted.current) onStart(selection)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { working.current = undefined; if (mounted.current) setBusy(undefined) }
  }

  const blocked = bundle === 'checking' || bundle === 'error' || bundle === 'restart'
  const ready = readiness.connected && canRecord(provider?.preparation.phase)
  return <Modal open title={t('setupPrompt.title')} closeLabel={t('cancel')} className={css.setupDialog ?? ''}
    onClose={() => { void dismiss() }} footer={<>
      <Button variant="ghost" disabled={busy !== undefined} onClick={() => { void dismiss() }}>{t('cancel')}</Button>
      {bundle === 'error' && <Button variant="outline" onClick={() => { void refreshVoiceBundle() }}>{t('setup.retry')}</Button>}
      {ready && !blocked && <Button variant="primary" disabled={busy !== undefined} onClick={() => { void confirm() }}>
        {t(bundle === 'disabled' ? 'setup.enableRecord' : 'start')}
      </Button>}
    </>}>
    {bundle === 'restart' ? <p role="alert">{t('setup.restart')}</p>
      : bundle === 'error' || (!readiness.connected && readiness.error) ? <p role="alert">{t('setup.offline')}</p>
        : !readiness.connected || bundle === 'checking' ? <p role="status">{t('loading')}</p>
          : !provider ? <p role="alert">{t('setup.noProvider')}</p> : null}
    {!blocked && provider && <>
      <div className={css.preferences}>
        <label>{t('language')}<select data-modal-autofocus value={speechLanguage} disabled={!readiness.connected || busy !== undefined}
          onChange={(event) => { setLanguage(event.target.value) }}>
          {provider.languages.map(item => <option key={item} value={item}>{languageName(item, t)}</option>)}
        </select></label>
        <p>{t(provider.location === 'cloud' ? 'cloud' : 'setup.local')}</p>
      </div>
      <PreparationCard provider={provider} connected={readiness.connected && busy === undefined}
        prepare={stage} cancelPreparation={cancelPreparation} t={t} />
    </>}
    {busy && <p className={css.setupStatus} role="status">{t(busy === 'saving' ? 'setup.saving' : 'preparation.cancelling')}</p>}
    {error && bundle !== 'restart' && <p className={css.preparationError} role="alert">{t('setup.actionFailed', { message: error })}</p>}
  </Modal>
}
