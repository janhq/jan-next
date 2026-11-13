import type { SpeechService, SpeechStatus } from './types'

const unsupported = () =>
  Promise.reject(new Error('Voice needs the desktop app'))

export class DefaultSpeechService implements SpeechService {
  async status(): Promise<SpeechStatus> {
    return { installed: false, running: false, installing: false }
  }
  install = unsupported
  start = unsupported
  stop = async () => {}
  speak = unsupported
  transcribe = unsupported
  async onInstallProgress() {
    return () => {}
  }
  async onInstallDone() {
    return () => {}
  }
}
