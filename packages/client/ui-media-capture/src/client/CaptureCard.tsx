/** Owns the local consent, device session, and reviewed draft for one chat request. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@janhq/jan-client-ui-primitives'
import type { CaptureCardProps, CaptureMode } from './contract.ts'
import type { CaptureKey } from './locales.ts'
import { PhotoAnnotation, type PhotoExport } from './PhotoAnnotation.tsx'
import styles from './capture.module.css'

type Stage = 'permission' | 'opening' | 'preview' | 'recording' | 'review' | 'sending' | 'declining' | 'declined' | 'sent' | 'closed'
const RECORDING_LIMIT = 100 * 1024 * 1024
const PHOTO_SIDE_LIMIT = 2048
const FORMATS = {
  video: ['video/webm', 'video/mp4'],
  audio: ['audio/webm', 'audio/mp4', 'audio/ogg'],
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function LiveCamera({ stream, label, video, onReady }: {
  stream: MediaStream
  label: string
  video: React.RefObject<HTMLVideoElement>
  onReady: () => void
}) {
  useEffect(() => {
    const element = video.current
    if (element === null) return
    element.srcObject = stream
    return () => { element.srcObject = null }
  }, [stream, video])
  return <video className={styles.media} ref={video} aria-label={label} onLoadedData={onReady} autoPlay muted playsInline />
}

function LiveLevel({ stream, label }: { stream: MediaStream; label: string }) {
  const meter = useRef<HTMLMeterElement>(null)
  useEffect(() => {
    if (typeof AudioContext !== 'function') return
    let context: AudioContext | undefined
    let frame = 0
    let active = true
    try {
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      const source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const update = () => {
        if (!active) return
        analyser.getByteTimeDomainData(samples)
        let square = 0
        for (const sample of samples) square += ((sample - 128) / 128) ** 2
        if (meter.current !== null) meter.current.value = Math.min(1, 3 * Math.sqrt(square / samples.length))
        frame = requestAnimationFrame(update)
      }
      void context.resume().then(update, () => undefined)
    } catch {
      // Capturing remains available if an audio analyser cannot be opened.
    }
    return () => {
      active = false
      cancelAnimationFrame(frame)
      if (context !== undefined && context.state !== 'closed') void context.close().catch(() => undefined)
    }
  }, [stream])
  return <label className={styles.field}>{label}<meter ref={meter} min={0} max={1} value={0} /></label>
}

function RecordingReview({ blob, mode, label }: { blob: Blob; mode: CaptureMode; label: string }) {
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])
  if (preview === undefined) return null
  return mode === 'audio'
    ? <audio className={styles.media} src={preview} controls aria-label={label} />
    : <video className={styles.media} src={preview} controls playsInline aria-label={label} />
}

/** Render the local media request; no device opens until Allow is clicked. */
export function CaptureCard({ mode, reason, confirmActive, decline, send, t }: CaptureCardProps) {
  const [stage, setStage] = useState<Stage>('permission')
  const [error, setError] = useState<CaptureKey>()
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [stream, setStream] = useState<MediaStream>()
  const [draft, setDraft] = useState<Blob>()
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [photoReady, setPhotoReady] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const photoExport = useRef<PhotoExport>(null)
  const lifetime = useRef<AbortController>()
  const currentStream = useRef<MediaStream>()
  const recording = useRef<MediaRecorder>()
  const audio = mode === 'audio'

  function releaseStream(): void {
    const live = currentStream.current
    currentStream.current = undefined
    if (live !== undefined) stopTracks(live)
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      const active = recording.current
      recording.current = undefined
      if (active !== undefined && active.state !== 'inactive') active.stop()
      releaseStream()
    }
  }, [])

  useEffect(() => {
    if (stage !== 'recording') return
    const start = performance.now()
    const tick = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 250)
    return () => window.clearInterval(tick)
  }, [stage])

  useEffect(() => {
    if (stream === undefined) return
    const tracks = stream.getTracks()
    const ended = () => {
      if (currentStream.current !== stream || recording.current !== undefined) return
      releaseStream()
      setStream(undefined)
      setStage('permission')
      setError('deviceUnavailable')
    }
    for (const track of tracks) track.addEventListener('ended', ended)
    return () => { for (const track of tracks) track.removeEventListener('ended', ended) }
  }, [stream])

  async function open(id: string): Promise<void> {
    const signal = lifetime.current?.signal
    if (signal === undefined || signal.aborted) return
    setStage('opening')
    setError(undefined)
    setPhotoReady(false)
    releaseStream()
    setStream(undefined)
    try {
      if (!await confirmActive(signal)) {
        if (!signal.aborted) setStage('closed')
        return
      }
    } catch {
      if (!signal.aborted) { setError('requestFailed'); setStage('permission') }
      return
    }
    if (signal.aborted) return
    const constraint = id === '' ? true : { deviceId: { exact: id } }
    let live: MediaStream
    try {
      live = await navigator.mediaDevices.getUserMedia({ audio: audio ? constraint : false, video: audio ? false : constraint })
    } catch {
      if (!signal.aborted) { setError('deviceUnavailable'); setStage('permission') }
      return
    }
    if (signal.aborted) { stopTracks(live); return }
    currentStream.current = live
    setStream(live)
    setDeviceId(id)
    setStage('preview')
    try {
      const available = await navigator.mediaDevices.enumerateDevices()
      if (!signal.aborted && currentStream.current === live) {
        setDevices(available.filter(device => device.deviceId !== '' && device.kind === (audio ? 'audioinput' : 'videoinput')))
      }
    } catch { /* The active default device still works when enumeration is unavailable. */ }
  }

  function review(blob: Blob): void {
    releaseStream()
    setStream(undefined)
    setDraft(blob)
    setNote('')
    setStage('review')
  }

  function takePhoto(): void {
    const element = video.current
    const signal = lifetime.current?.signal
    const live = currentStream.current
    if (element === null || element.videoWidth === 0 || element.videoHeight === 0 || live === undefined) return
    setError(undefined)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, PHOTO_SIDE_LIMIT / Math.max(element.videoWidth, element.videoHeight))
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (context === null) { setError('captureFailed'); return }
    setPhotoReady(false)
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (signal?.aborted || currentStream.current !== live) return
      if (blob === null) { setPhotoReady(true); setError('captureFailed'); return }
      review(blob)
    }, 'image/jpeg', 0.92)
  }

  function startRecording(): void {
    const live = currentStream.current
    if (live === undefined || mode === 'photo') return
    setError(undefined)
    const format = typeof MediaRecorder === 'function' && FORMATS[mode].find(candidate => MediaRecorder.isTypeSupported(candidate))
    if (!format) { setError('formatUnavailable'); return }
    let recorder: MediaRecorder
    try { recorder = new MediaRecorder(live, { mimeType: format }) }
    catch { setError('captureFailed'); return }
    const chunks: Blob[] = []
    let size = 0
    let failure: CaptureKey | undefined
    recorder.ondataavailable = ({ data }) => {
      if (recording.current !== recorder || failure !== undefined || data.size === 0) return
      size += data.size
      if (size > RECORDING_LIMIT) {
        failure = 'recordingTooLarge'
        if (recorder.state !== 'inactive') recorder.stop()
      } else chunks.push(data)
    }
    recorder.onerror = () => { failure = 'captureFailed' }
    recorder.onstop = () => {
      if (recording.current !== recorder) return
      recording.current = undefined
      if (failure === undefined && chunks.length > 0) review(new Blob(chunks, { type: recorder.mimeType || format }))
      else {
        setError(failure ?? 'captureFailed')
        if (live.getTracks().some(track => track.readyState === 'live')) setStage('preview')
        else { releaseStream(); setStream(undefined); setStage('permission') }
      }
    }
    try {
      recording.current = recorder
      recorder.start(1000)
      setElapsed(0)
      setStage('recording')
    } catch {
      recording.current = undefined
      setError('captureFailed')
    }
  }

  async function declineRequest(): Promise<void> {
    const signal = lifetime.current?.signal
    if (signal === undefined || signal.aborted) return
    const active = recording.current
    recording.current = undefined
    if (active !== undefined && active.state !== 'inactive') active.stop()
    releaseStream()
    setStream(undefined)
    setDraft(undefined)
    setStage('declining')
    setError(undefined)
    try {
      await decline(signal)
      if (!signal.aborted) setStage('declined')
    } catch {
      if (!signal.aborted) { setError('requestFailed'); setStage('permission') }
    }
  }

  async function sendDraft(): Promise<void> {
    const signal = lifetime.current?.signal
    if (draft === undefined || signal === undefined || signal.aborted) return
    setStage('sending')
    setError(undefined)
    try {
      const file = mode === 'photo' ? await photoExport.current?.() : draft
      if (signal.aborted) return
      if (file == null) { setError('captureFailed'); setStage('review'); return }
      await send(file, mode === 'photo' ? undefined : note.trim(), signal)
      if (!signal.aborted) { setDraft(undefined); setStage('sent') }
    } catch {
      if (!signal.aborted) { setError('sendFailed'); setStage('review') }
    }
  }

  const title = audio ? 'audioRequest' : mode === 'photo' ? 'photoRequest' : 'videoRequest'
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  return <section className={styles.card} aria-label={t(title)}>
    <strong>{t(title)}</strong>
    <p className={styles.reason}>{reason}</p>
    {error !== undefined && <p className={styles.error} role="alert">{t(error)}</p>}
    {(stage === 'permission' || stage === 'opening' || stage === 'declining') && <div className={styles.controls}>
      <Button size="sm" variant="primary" disabled={stage !== 'permission'} onClick={() => { void open(deviceId) }}>
        {t(stage === 'opening' ? 'opening' : audio ? 'allowMicrophone' : 'allowCamera')}
      </Button>
      <Button size="sm" variant="outline" disabled={stage !== 'permission'} onClick={() => { void declineRequest() }}>{t('notNow')}</Button>
    </div>}
    {(stage === 'preview' || stage === 'recording') && stream !== undefined && <>
      <label className={styles.field}>
        {t(audio ? 'microphone' : 'camera')}
        <select value={deviceId} disabled={stage === 'recording'} onChange={(event) => { void open(event.currentTarget.value) }}>
          <option value="">{t('defaultDevice')}</option>
          {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${t(audio ? 'microphone' : 'camera')} ${index + 1}`}
          </option>)}
        </select>
      </label>
      {audio ? <LiveLevel stream={stream} label={t('microphoneLevel')} />
        : <LiveCamera stream={stream} label={t('cameraPreview')} video={video} onReady={() => setPhotoReady(true)} />}
      <div className={styles.controls}>
        {stage === 'recording' ? <>
          <span role="timer" aria-label={t('recordingTime')}>{timer}</span>
          <Button size="sm" variant="primary" onClick={() => {
            const active = recording.current
            if (active !== undefined && active.state !== 'inactive') active.stop()
          }}>{t('stopRecording')}</Button>
        </> : mode === 'photo'
          ? <Button size="sm" variant="primary" disabled={!photoReady} onClick={takePhoto}>{t('takePhoto')}</Button>
          : <Button size="sm" variant="primary" onClick={startRecording}>{t(audio ? 'recordAudio' : 'recordVideo')}</Button>}
        <Button size="sm" variant="outline" onClick={() => { void declineRequest() }}>{t('notNow')}</Button>
      </div>
    </>}
    {(stage === 'review' || stage === 'sending') && draft !== undefined && <>
      {mode === 'photo' ? <PhotoAnnotation blob={draft} exporter={photoExport} disabled={stage === 'sending'} t={t} /> : <>
        <RecordingReview blob={draft} mode={mode} label={t('recordingPreview')} />
        <label className={styles.field}>{t('recordingNote')}
          <textarea value={note} disabled={stage === 'sending'} maxLength={1000} rows={2} onChange={event => setNote(event.currentTarget.value)} />
        </label>
      </>}
      <div className={styles.controls}>
        <Button size="sm" variant="outline" disabled={stage === 'sending'} onClick={() => {
          setDraft(undefined)
          void open(deviceId)
        }}>{t('retake')}</Button>
        <Button size="sm" variant="primary" disabled={stage === 'sending'} onClick={() => { void sendDraft() }}>{t(stage === 'sending' ? 'sending' : 'send')}</Button>
        <Button size="sm" variant="outline" disabled={stage === 'sending'} onClick={() => { void declineRequest() }}>{t('notNow')}</Button>
      </div>
    </>}
    {stage === 'declined' && <span role="status">{t('declined')}</span>}
    {stage === 'sent' && <span role="status">{t('sent')}</span>}
    {stage === 'closed' && <span role="status">{t('closed')}</span>}
  </section>
}
