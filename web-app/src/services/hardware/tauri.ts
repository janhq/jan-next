/**
 * Tauri Hardware Service - Desktop implementation
 */

import {
  getSystemInfo,
  getSystemUsage,
  refreshSystemInfo,
} from '@janhq/tauri-plugin-hardware-api'
import { getLlamacppEngine } from '../../../../dsh/llamacpp/src'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    const info = await getSystemInfo()
    // The plugin reports static facts only; `usage` is the app's live reading,
    // filled in later from getSystemUsage().
    return { ...info, cpu: { ...info.cpu, usage: 0 } }
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return getSystemUsage()
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    return getLlamacppEngine().getDevices()
  }

  async reconcileLlamacppDevices(): Promise<'unchanged' | 'restarted' | 'busy'> {
    return getLlamacppEngine().reconcileEngineDevices()
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    // TODO: llama.cpp extension should handle this
    console.log(data)
  }

  async refreshHardwareInfo(): Promise<void> {
    await refreshSystemInfo()
  }
}
