export interface SpeechStatus {
  installed: boolean
  running: boolean
  installing: boolean
}

export interface SpeechInstallProgress {
  file: string
  downloaded: number
  total: number
}

export interface SpeechService {
  status(): Promise<SpeechStatus>
  install(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  /** WAV bytes for `text`, read by Kokoro preset `voice`. */
  speak(text: string, voice: string): Promise<ArrayBuffer>
  /** Text for a 16 kHz mono PCM16 WAV. */
  transcribe(wav: Uint8Array): Promise<string>
  onInstallProgress(cb: (p: SpeechInstallProgress) => void): Promise<() => void>
  onInstallDone(cb: (error: string | null) => void): Promise<() => void>
}
