import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriHardwareService } from '../tauri'

vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  refreshSystemInfo: vi.fn(),
}))

const h = vi.hoisted(() => ({
  engine: { getDevices: vi.fn(), reconcileEngineDevices: vi.fn() },
}))
vi.mock('../../../../../dsh/llamacpp/src', () => ({
  getLlamacppEngine: () => h.engine,
}))

describe('TauriHardwareService – coverage', () => {
  let svc: TauriHardwareService

  beforeEach(() => {
    svc = new TauriHardwareService()
    vi.clearAllMocks()
  })

  describe('getLlamacppDevices', () => {
    it('returns devices from the llamacpp engine', async () => {
      const devices = [{ id: 0, name: 'GPU 0' }]
      h.engine.getDevices.mockResolvedValue(devices)

      await expect(svc.getLlamacppDevices()).resolves.toEqual(devices)
    })
  })

  describe('reconcileLlamacppDevices', () => {
    it('asks the llamacpp engine to reconcile and returns its answer', async () => {
      h.engine.reconcileEngineDevices.mockResolvedValue('restarted')

      await expect(svc.reconcileLlamacppDevices()).resolves.toBe('restarted')
    })
  })

  describe('refreshHardwareInfo', () => {
    it('drops the cached detection through the hardware plugin', async () => {
      const { refreshSystemInfo } = await import('@janhq/tauri-plugin-hardware-api')
      vi.mocked(refreshSystemInfo).mockResolvedValue(undefined)

      await svc.refreshHardwareInfo()

      expect(refreshSystemInfo).toHaveBeenCalled()
    })
  })
})
