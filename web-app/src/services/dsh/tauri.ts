import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DshLaunch, DshService, DshStatus } from './types'

export class TauriDshService implements DshService {
  start(launch: DshLaunch) {
    return invoke<void>('dsh_start', { launch })
  }
  send(frame: unknown) {
    return invoke<void>('dsh_send', { line: JSON.stringify(frame) })
  }
  stop() {
    return invoke<void>('dsh_stop')
  }
  status() {
    return invoke<DshStatus>('dsh_status')
  }
  checkRoot(root: string) {
    return invoke<void>('dsh_check_root', { root })
  }
  onFrame(cb: (frame: Record<string, unknown>) => void) {
    return listen<string>('dsh-line', (e) => {
      // stdout is protocol-only, but a stray non-JSON line must not kill the
      // listener for every frame after it.
      try {
        cb(JSON.parse(e.payload))
      } catch {
        console.warn('[dsh] non-JSON line:', e.payload)
      }
    })
  }
  onExit(cb: (stderr: string) => void) {
    return listen<{ stderr: string }>('dsh-exit', (e) => cb(e.payload.stderr))
  }
}
