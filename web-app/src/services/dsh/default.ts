import type { DshService, DshStatus } from './types'

const unsupported = () =>
  Promise.reject(new Error('DeepSeek Harness needs the desktop app'))

export class DefaultDshService implements DshService {
  start = unsupported
  send = unsupported
  stop = async () => { }
  async status(): Promise<DshStatus> {
    return { running: false, launch: null }
  }
  checkRoot = unsupported
  webStart = unsupported
  pluginsList = unsupported
  pluginSetEnabled = unsupported
  pluginSetConfig = unsupported
  pluginInstall = unsupported
  pluginRemove = unsupported
  restart = unsupported
  threadWorkspace = unsupported
  readWorkspaceFile = unsupported
  async onFrame() {
    return () => { }
  }
  async onExit() {
    return () => { }
  }
}
