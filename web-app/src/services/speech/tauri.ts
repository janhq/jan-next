import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  SpeechInstallProgress,
  SpeechService,
  SpeechStatus,
} from './types'

export class TauriSpeechService implements SpeechService {
  status() {
    return invoke<SpeechStatus>('speech_status')
  }
  install() {
    return invoke<void>('speech_install')
  }
  start() {
    return invoke<void>('speech_start')
  }
  stop() {
    return invoke<void>('speech_stop')
  }
  speak(text: string, voice: string) {
    return invoke<ArrayBuffer>('speech_speak', { text, voice })
  }
  // Raw body: a recording is too large to round-trip through JSON number arrays.
  transcribe(wav: Uint8Array) {
    return invoke<string>('speech_transcribe', wav)
  }
  onInstallProgress(cb: (p: SpeechInstallProgress) => void) {
    return listen<SpeechInstallProgress>('speech-install-progress', (e) =>
      cb(e.payload)
    )
  }
  onInstallDone(cb: (error: string | null) => void) {
    return listen<{ error: string | null }>('speech-install-done', (e) =>
      cb(e.payload.error ?? null)
    )
  }
}
