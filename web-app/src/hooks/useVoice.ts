import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useVoiceSettings } from '@/hooks/useVoiceSettings'

// SenseVoice's VAD only accepts 16 kHz, so recordings are captured at that rate.
const SAMPLE_RATE = 16000

interface Recorder {
  ctx: AudioContext
  stream: MediaStream
  node: ScriptProcessorNode
  chunks: Float32Array[]
}

interface VoiceState {
  /** Message id whose audio is loading or playing. */
  speakingId: string | null
  recording: boolean
  recordStartedAt: number | null
  transcribing: boolean
  toggleSpeak: (id: string, text: string) => Promise<void>
  startRecording: () => Promise<void>
  /** Stops capture and resolves with the transcript. */
  stopRecording: () => Promise<string>
}

let audio: HTMLAudioElement | null = null
let recorder: Recorder | null = null

function stopAudio() {
  if (!audio) return
  audio.pause()
  URL.revokeObjectURL(audio.src)
  audio = null
}

function encodeWav(chunks: Float32Array[]): Uint8Array {
  const samples = chunks.reduce((n, c) => n + c.length, 0)
  const buf = new DataView(new ArrayBuffer(44 + samples * 2))
  const str = (o: number, s: string) =>
    [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  buf.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVEfmt ')
  buf.setUint32(16, 16, true)
  buf.setUint16(20, 1, true)
  buf.setUint16(22, 1, true)
  buf.setUint32(24, SAMPLE_RATE, true)
  buf.setUint32(28, SAMPLE_RATE * 2, true)
  buf.setUint16(32, 2, true)
  buf.setUint16(34, 16, true)
  str(36, 'data')
  buf.setUint32(40, samples * 2, true)
  let o = 44
  for (const c of chunks)
    for (const v of c) {
      const s = Math.max(-1, Math.min(1, v))
      buf.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  return new Uint8Array(buf.buffer)
}

export const useVoice = create<VoiceState>()((set, get) => ({
  speakingId: null,
  recording: false,
  recordStartedAt: null,
  transcribing: false,

  toggleSpeak: async (id, text) => {
    const wasSpeaking = get().speakingId === id
    stopAudio()
    if (wasSpeaking) {
      set({ speakingId: null })
      return
    }
    set({ speakingId: id })
    try {
      const wav = await getServiceHub()
        .speech()
        .speak(text, useVoiceSettings.getState().voice)
      // Another message was clicked while this one was synthesizing.
      if (get().speakingId !== id) return
      const el = new Audio(
        URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
      )
      audio = el
      el.onended = () => {
        if (audio === el) stopAudio()
        if (get().speakingId === id) set({ speakingId: null })
      }
      await el.play()
    } catch (e) {
      if (get().speakingId === id) set({ speakingId: null })
      throw e
    }
  },

  startRecording: async () => {
    if (recorder) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    // ScriptProcessor rather than MediaRecorder: MediaRecorder only emits
    // compressed WebM/Opus, and the server accepts WAV only.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const node = ctx.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    node.onaudioprocess = (e) =>
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    ctx.createMediaStreamSource(stream).connect(node)
    node.connect(ctx.destination)
    recorder = { ctx, stream, node, chunks }
    set({ recording: true, recordStartedAt: Date.now() })
  },

  stopRecording: async () => {
    const r = recorder
    recorder = null
    set({ recording: false, recordStartedAt: null })
    if (!r) return ''
    r.node.disconnect()
    r.stream.getTracks().forEach((t) => t.stop())
    await r.ctx.close()
    if (r.chunks.length === 0) return ''
    set({ transcribing: true })
    try {
      return (
        await getServiceHub().speech().transcribe(encodeWav(r.chunks))
      ).trim()
    } finally {
      set({ transcribing: false })
    }
  },
}))
