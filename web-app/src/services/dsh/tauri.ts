import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  DshLaunch,
  DshPluginEntry,
  DshShellSetup,
  DshService,
  DshStatus,
  WorkspaceFile,
} from './types'

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
  webStart(setup: DshShellSetup) {
    return invoke<void>('dsh_web_start', { setup })
  }
  checkRoot(root: string) {
    return invoke<void>('dsh_check_root', { root })
  }
  pluginsList() {
    return invoke<DshPluginEntry[]>('dsh_plugins_list')
  }
  pluginSetEnabled(id: string, enabled: boolean) {
    return invoke<void>('dsh_plugin_set_enabled', { id, enabled })
  }
  pluginSetConfig(id: string, config: string) {
    return invoke<void>('dsh_plugin_set_config', { id, config })
  }
  pluginInstall(pkg: string) {
    return invoke<void>('dsh_plugin_install', { package: pkg })
  }
  pluginRemove(id: string) {
    return invoke<void>('dsh_plugin_remove', { id })
  }
  restart() {
    return invoke<void>('dsh_restart')
  }
  threadWorkspace(threadId: string) {
    return invoke<string>('dsh_thread_workspace', { threadId })
  }
  readWorkspaceFile(folder: string, path: string) {
    return invoke<WorkspaceFile>('dsh_read_workspace_file', { folder, path })
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
