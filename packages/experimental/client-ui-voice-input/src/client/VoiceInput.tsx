/** Click-to-record toolbar activity; transcripts remain in the original Session draft. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { TokenSpan } from '@janhq/jan-client-ui-conversation/client'
import type { TranscriptionRequest } from '@janhq/jan-experimental-api-speech-to-text/types'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelection, SpeechSelectionPatch, Transcript } from '@janhq/jan-experimental-speech-to-text/types'
import type { RemoteResult } from '@janhq/jan-typert-protocol'
import { audioBase64, type Recording } from './audio.ts'
import { failureText } from './failure-text.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import { canRecord, type SpeechReadiness } from './readiness.ts'
import { Waveform } from './Waveform.tsx'
import { ComposerVoiceSetup } from './ComposerVoiceSetup.tsx'
import type { VoiceBundleState } from './voice-bundle.ts'
import { NS } from './locales.ts'
import { Button, IconCloseOutlineRegular, IconStopFillRegular, IconMicrophoneOutlineRegular, StateDot, Tooltip } from '@janhq/jan-client-ui-primitives'
import css from './VoiceInput.module.css'

/** Host calls injected without exposing a Cordis Context to React. */
export interface VoiceInputActions {
  /** Open the voice bundle details without starting preparation. */
  openSettings: () => void
  /** Enable the voice bundle through Plugin Manager. */
  enableVoice: () => Promise<void>
  /** Re-read the bundle selection after a connection error. */
  refreshVoiceBundle: () => Promise<void>
  /** Connect to speech readiness when setup opens or dictation is enabled. */
  connectReadiness: () => void
  /** @returns one microphone operation owned by the plugin lifecycle. */
  createRecording: () => Recording
  /** Remember the browser microphone used by previews and subsequent recordings. */
  selectMicrophone: (device: MicrophoneDevice) => void
  transcribe: (request: TranscriptionRequest, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
  prepare: (providerId: SpeechProviderId, options?: SpeechPreparationOptions) => Promise<void>
  cancelPreparation: (providerId: SpeechProviderId) => Promise<void>
  configure: (patch: SpeechSelectionPatch) => Promise<void>
}

/** Entry-injected Host readiness and microphone operations. */
export interface VoiceInputInjected extends VoiceInputActions {
  hooks: {
    speechReadiness: HostObservable<SpeechReadiness>
    microphoneDevice: HostObservable<MicrophoneDevice>
    /** Whether the Plugins page navigation service is present; the setup dialog offers the details only while it is. */
    pluginNavigation: HostObservable<boolean>
    voiceBundle: HostObservable<VoiceBundleState>
  }
}

/** Alternate voice controls share the composer's microphone activity. */
export interface VoiceOptionsOwnerProps {
  /** Prevent starting a second capture while the composer is locked. */
  locked: boolean
  /** Disable primary dictation while the alternate voice session owns the microphone. */
  onActiveChange: (active: boolean) => void
}

/** Composer-owned expansion and draft actions; preferences stay in plugin settings. */
export type VoiceInputProps = Pick<PropsRuntime<'conversation.input.draftActivity'>, 'sessionId' | 'inputActions' | 'locked' | 'onActiveChange' | 'openDraft'>
  & PropsLocale<typeof NS> & InjectFace<VoiceInputInjected> & Pick<PropsRenderSlots<'voice-input.options'>, 'renderSlot'>

declare module '@janhq/jan-client-ui-slots' {
  interface SlotMap {
    /** Optional alternate voice actions on the composer's microphone control. */
    'voice-input.options': { kind: 'single'; scope: 'session'; owner: VoiceOptionsOwnerProps }
  }
}

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'feedback'
interface ActiveRecording {
  readonly capture: Recording
  readonly abort: AbortController
  readonly span: TokenSpan
  readonly selection: SpeechSelection
  readonly input: NonNullable<VoiceInputProps['inputActions']>
  readonly maxDurationSeconds: number
  readonly maxAudioBytes: number
  phase: 'requesting' | 'recording' | 'transcribing'
  timer?: ReturnType<typeof setTimeout> | undefined
}

async function disposeRecording(capture: Recording): Promise<void> {
  try { await capture.dispose() } catch (_error) {
    // Tracks stop before AudioContext.close(); a close failure must not hide the recording result.
  }
}

/** Render a compact microphone or an expanded capture, transcription, or retry row. */
export function VoiceInput(props: VoiceInputProps) {
  const { sessionId, inputActions, openDraft, locked, onActiveChange, createRecording, transcribe,
    useSpeechReadiness, useVoiceBundle, renderSlot, t } = props
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const bundle = useVoiceBundle(value => value)
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const speechReady = readiness.connected && canRecord(provider?.preparation.phase)
  const usable = speechReady && (bundle === 'enabled' || bundle === 'unmanaged')
  const [phase, setPhase] = useState<Phase>('idle'), [message, setMessage] = useState(''), [pending, setPending] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  useEffect(() => { if (setupOpen || bundle === 'enabled') props.connectReadiness() },
    [setupOpen, bundle, props.connectReadiness])
  const [alternateActive, setAlternateActive] = useState(false)
  const current = useRef<ActiveRecording>(), generation = useRef(0)
  const bootstrap = useRef<SpeechSelection>()
  const [openingDraft, setOpeningDraft] = useState(false)
  const previousSession = useRef(sessionId)
  const expanded = phase !== 'idle'
  useLayoutEffect(() => { onActiveChange(expanded); return () => { onActiveChange(false) } }, [expanded, onActiveChange])

  const cancel = (): void => {
    bootstrap.current = undefined
    setOpeningDraft(false)
    generation.current++
    const active = current.current
    current.current = undefined
    if (active) { clearTimeout(active.timer); active.abort.abort(); void disposeRecording(active.capture) }
    setPending(''); setMessage(''); setPhase('idle'); setSetupOpen(false)
  }
  useEffect(() => {
    if (previousSession.current !== undefined && previousSession.current !== sessionId) {
      cancel()
      setAlternateActive(false)
    }
    previousSession.current = sessionId
  }, [sessionId])
  useEffect(() => {
    const blur = (): void => { if (current.current?.phase === 'recording') cancel() }
    const visibility = (): void => {
      if (document.hidden && current.current && current.current.phase !== 'transcribing') cancel()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && current.current) { event.preventDefault(); cancel() }
    }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('keydown', escape)
      bootstrap.current = undefined
      generation.current++
      const active = current.current
      current.current = undefined
      if (active) { clearTimeout(active.timer); active.abort.abort(); void disposeRecording(active.capture) }
    }
  }, [])

  const feedback = (text: string): void => { setMessage(text); setPhase('feedback') }
  const finish = async (): Promise<void> => {
    const active = current.current
    if (!active || active.phase !== 'recording') return
    active.phase = 'transcribing'
    const run = generation.current
    clearTimeout(active.timer); setPhase('transcribing')
    try {
      const audio = await active.capture.stop(active.maxDurationSeconds)
      if (run !== generation.current) return
      if (audio.byteLength > active.maxAudioBytes) { feedback(t('tooLarge')); return }
      const result = await transcribe({ audioBase64: audioBase64(audio), ...active.selection }, active.abort.signal)
      if (run !== generation.current) return
      if (!result.ok) { feedback(t('failed', { message: result.error.message })); return }
      if (result.value.text === '') { feedback(t('empty')); return }
      if (!active.input.insertText(result.value.text, active.span)) { setPending(result.value.text); feedback(t('conflict')); return }
      setPhase('idle')
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) feedback(failureText(failure, t))
    } finally { if (run === generation.current) current.current = undefined }
  }
  const start = async (selection: SpeechSelection | undefined): Promise<void> => {
    if (!catalog || !selection || locked || alternateActive || current.current) return
    if (!inputActions) {
      if (!openDraft || bootstrap.current) return
      bootstrap.current = selection
      setOpeningDraft(true)
      try { await openDraft() } catch {
        if (bootstrap.current === selection) {
          bootstrap.current = undefined
          setOpeningDraft(false)
          feedback(t('draftUnavailable'))
        }
      }
      return
    }
    const run = ++generation.current
    const active: ActiveRecording = { capture: createRecording(), abort: new AbortController(),
      span: inputActions.captureInsertion(), selection, input: inputActions,
      maxDurationSeconds: catalog.maxDurationSeconds, maxAudioBytes: catalog.maxAudioBytes, phase: 'requesting' }
    current.current = active
    setMessage(''); setPending(''); setPhase('requesting')
    try {
      await active.capture.start((failure) => {
        if (run !== generation.current || current.current !== active || active.phase === 'transcribing') return
        current.current = undefined
        clearTimeout(active.timer); active.abort.abort()
        feedback(failureText(failure, t))
      })
      if (run !== generation.current || current.current !== active) return
      active.phase = 'recording'
      setPhase('recording')
      active.timer = setTimeout(() => { void finish() }, active.maxDurationSeconds * 1000)
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) { current.current = undefined; feedback(failureText(failure, t)) }
    }
  }
  useEffect(() => {
    if (!inputActions || !bootstrap.current) return
    const selection = bootstrap.current
    bootstrap.current = undefined
    setOpeningDraft(false)
    if (locked) feedback(t('draftUnavailable')); else void start(selection)
  })
  if (!expanded) return <>
    <div className={css.voiceControl}>
      <Tooltip label={t(usable ? 'dictate' : 'setupPrompt.trigger')} disabled={!usable} side="top" portal>
        <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" disabled={locked || alternateActive || openingDraft}
          aria-label={t(usable ? 'start' : 'setupPrompt.trigger')} aria-haspopup={usable ? undefined : 'dialog'}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={() => { if (usable) void start(catalog?.selection); else setSetupOpen(true) }}>
          <IconMicrophoneOutlineRegular size={18} />
        </Button></span>
      </Tooltip>
      {sessionId !== undefined && renderSlot('voice-input.options', { locked, onActiveChange: setAlternateActive })}
    </div>
    {setupOpen && <ComposerVoiceSetup {...props} readiness={readiness} bundle={bundle}
      onDismiss={() => { setSetupOpen(false) }} onStart={(selection) => { setSetupOpen(false); void start(selection) }} />}
  </>
  return <div className={css.captureRow} data-voice-activity={phase}>
    <Button type="button" className={css.roundButton} size="sm" aria-label={t(pending ? 'discard' : 'cancel')}
      onClick={cancel}><IconCloseOutlineRegular size={14} /></Button>
    {phase === 'recording' ? <Waveform recording={current.current?.capture} label={t('recording')} />
      : <span className={css.activityMessage} role="status" title={pending || message}>
        {(phase === 'requesting' || phase === 'transcribing') && <StateDot state="ongoing" />}
        {phase === 'feedback' ? message : t(phase === 'requesting' ? 'requesting'
          : provider?.preparation.phase === 'waking' ? 'wakingShort' : 'transcribingShort')}</span>}
    {phase === 'recording' && <Button type="button" className={css.roundButton} size="sm" aria-label={t('stop')}
      onClick={() => { void finish() }}><IconStopFillRegular size={14} /></Button>}
    {phase === 'feedback' && (pending
      ? <Button className={css.inlineAction} size="sm" type="button" onClick={() => {
        if (inputActions?.insertText(pending, inputActions.captureInsertion())) { setPending(''); setPhase('idle') }
      }}>{t('insert')}</Button>
      : <Button className={css.roundButton} size="sm" type="button" aria-label={t('retryRecording')} disabled={!usable || locked}
        onClick={() => { void start(catalog?.selection) }}><IconMicrophoneOutlineRegular size={18} /></Button>)}
  </div>
}
