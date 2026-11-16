/** The local model Remote delegates to the service and reports service failures as typed Remote errors. */
import { Context } from '@janhq/cordis'
import type { LlamaCpp } from '@janhq/jan-llama-cpp'
import { RemoteError } from '@janhq/jan-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import LlamaCppController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const service = {
    setDefault: vi.fn<LlamaCpp['setDefault']>().mockResolvedValue(undefined),
    loadModel: vi.fn<LlamaCpp['loadModel']>().mockResolvedValue(undefined),
    unloadModel: vi.fn<LlamaCpp['unloadModel']>().mockResolvedValue(undefined),
    removeModel: vi.fn<LlamaCpp['removeModel']>().mockResolvedValue(undefined),
    importModel: vi.fn<LlamaCpp['importModel']>().mockResolvedValue('mine'),
  }
  ctx.provide('llamaCpp', service as never)
  return { service, controller: new LlamaCppController(ctx) }
}

it('delegates the per-model operations by installed model id', async () => {
  const { service, controller } = fixture()
  await controller.setDefaultModel('qwen')
  expect(service.setDefault).toHaveBeenCalledExactlyOnceWith('qwen')
  await controller.loadModel('gemma')
  expect(service.loadModel).toHaveBeenCalledExactlyOnceWith('gemma')
  await controller.unloadModel('gemma')
  expect(service.unloadModel).toHaveBeenCalledExactlyOnceWith('gemma')
  await controller.deleteModel('gemma')
  expect(service.removeModel).toHaveBeenCalledExactlyOnceWith('gemma')
})

it('reports a refused operation as a llama-cpp/failed Remote error carrying the reason', async () => {
  const { service, controller } = fixture()
  const reason = 'the model has requests in flight; retry once they finish'
  service.unloadModel.mockRejectedValueOnce(new Error(reason))
  const failure = await controller.unloadModel('gemma').catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(RemoteError)
  expect(failure).toMatchObject({ code: 'llama-cpp/failed', message: reason, details: { reason } })
  service.loadModel.mockRejectedValueOnce(new Error('all 1 model slots are busy; retry shortly'))
  await expect(controller.loadModel('gemma')).rejects.toMatchObject({ code: 'llama-cpp/failed' })
  service.setDefault.mockRejectedValueOnce(new Error('no installed model "absent"'))
  await expect(controller.setDefaultModel('absent')).rejects.toMatchObject({ details: { reason: 'no installed model "absent"' } })
})

it('imports a file with its vision projector only when one is given', async () => {
  const { service, controller } = fixture()
  await expect(controller.importModel('/models/mine.gguf')).resolves.toBe('mine')
  expect(service.importModel).toHaveBeenLastCalledWith('/models/mine.gguf', undefined)
  await controller.importModel('/models/mine.gguf', '/models/mmproj-mine.gguf')
  expect(service.importModel).toHaveBeenLastCalledWith('/models/mine.gguf', { projector: '/models/mmproj-mine.gguf' })
  service.importModel.mockRejectedValueOnce(new Error('notes.gguf is not a vision projector: no clip metadata'))
  await expect(controller.importModel('/models/mine.gguf', '/models/notes.gguf'))
    .rejects.toMatchObject({ code: 'llama-cpp/failed', details: { reason: 'notes.gguf is not a vision projector: no clip metadata' } })
})
