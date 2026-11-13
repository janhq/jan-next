import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Assistant } from '@janhq/core'

const h = vi.hoisted(() => ({
  store: {
    prepare: vi.fn(),
    getAssistants: vi.fn(),
    createAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
  },
}))

vi.mock('../assistants/store', () => ({
  Assistants: vi.fn(function () {
    return h.store
  }),
}))

import { DefaultAssistantsService } from '../assistants/default'

const assistant = (id: string) =>
  ({ id, name: id, description: id }) as unknown as Assistant

describe('DefaultAssistantsService', () => {
  let assistantsService: DefaultAssistantsService
  const impl = h.store

  beforeEach(() => {
    vi.clearAllMocks()
    impl.prepare.mockResolvedValue(undefined)
    assistantsService = new DefaultAssistantsService()
  })

  const provide = () => {}

  describe('getAssistants', () => {
    it('returns the assistants of the provided Assistants service', async () => {
      provide()
      const list = [assistant('a1'), assistant('a2')]
      impl.getAssistants.mockResolvedValue(list)
      await expect(assistantsService.getAssistants()).resolves.toEqual(list)
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.getAssistants.mockRejectedValue(new Error('Failed to get assistants'))
      await expect(assistantsService.getAssistants()).rejects.toThrow(
        'Failed to get assistants'
      )
    })
  })

  describe('createAssistant', () => {
    it('delegates to the Assistants service', async () => {
      provide()
      impl.createAssistant.mockResolvedValue(undefined)
      const a = assistant('new')
      await expect(assistantsService.createAssistant(a)).resolves.toBeUndefined()
      expect(impl.createAssistant).toHaveBeenCalledWith(a)
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.createAssistant.mockRejectedValue(new Error('Failed to create assistant'))
      await expect(
        assistantsService.createAssistant(assistant('new'))
      ).rejects.toThrow('Failed to create assistant')
    })
  })

  describe('deleteAssistant', () => {
    it('delegates to the Assistants service', async () => {
      provide()
      impl.deleteAssistant.mockResolvedValue(undefined)
      const a = assistant('gone')
      await expect(assistantsService.deleteAssistant(a)).resolves.toBeUndefined()
      expect(impl.deleteAssistant).toHaveBeenCalledWith(a)
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.deleteAssistant.mockRejectedValue(new Error('Failed to delete assistant'))
      await expect(
        assistantsService.deleteAssistant(assistant('gone'))
      ).rejects.toThrow('Failed to delete assistant')
    })
  })
})
