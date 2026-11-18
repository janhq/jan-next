/** The local model Remote delegates to the service and reports service failures as typed Remote errors. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@janhq/cordis'
import type { LlamaCpp } from '@janhq/jan-llama-cpp'
import { RemoteError } from '@janhq/jan-typert-protocol'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import LlamaCppController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function fixture(home?: string) {
  const ctx = new Context()
  roots.push(ctx)
  const service = {
    setDefault: vi.fn<LlamaCpp['setDefault']>().mockResolvedValue(undefined),
    loadModel: vi.fn<LlamaCpp['loadModel']>().mockResolvedValue(undefined),
    unloadModel: vi.fn<LlamaCpp['unloadModel']>().mockResolvedValue(undefined),
    removeModel: vi.fn<LlamaCpp['removeModel']>().mockResolvedValue(undefined),
    importModel: vi.fn<LlamaCpp['importModel']>().mockResolvedValue('mine'),
    getModelContext: vi.fn<LlamaCpp['getModelContext']>().mockReturnValue({ current: 8192, maximum: 131072, fit: false }),
    setModelContext: vi.fn<LlamaCpp['setModelContext']>().mockResolvedValue(undefined),
    setModelFit: vi.fn<LlamaCpp['setModelFit']>().mockResolvedValue(undefined),
    increaseModelContext: vi.fn<LlamaCpp['increaseModelContext']>().mockResolvedValue(32768),
    listStoredDownloads: vi.fn<LlamaCpp['listStoredDownloads']>().mockResolvedValue([]),
    deleteStoredDownload: vi.fn<LlamaCpp['deleteStoredDownload']>().mockResolvedValue(undefined),
  }
  ctx.provide('llamaCpp', service as never)
  if (home !== undefined) ctx.provide('profileContext', { home, dir: join(home, 'profiles', 'desktop') })
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

it('exposes saved context, automatic fit and the reload-before-retry context step', async () => {
  const { service, controller } = fixture()
  expect(controller.getModelContext('local')).toEqual({ current: 8192, maximum: 131072, fit: false })
  await controller.setModelContext('local', 32768)
  await controller.setModelFit('local', true)
  expect(await controller.increaseModelContext('local')).toBe(32768)
  expect(service.setModelContext).toHaveBeenCalledWith('local', 32768)
  expect(service.setModelFit).toHaveBeenCalledWith('local', true)
  expect(service.increaseModelContext).toHaveBeenCalledWith('local')
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

it('lists only known Jan speech cache files and confines deletion to one listed file', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'jan-speech-cache-'))
  onTestFinished(() => rm(parent, { recursive: true, force: true }))
  const home = join(parent, 'jan')
  const cache = 'speech-to-text/sensevoice/models/sensevoice-onnx'
  const model = `${cache}/model.int8.onnx`
  const outside = join(parent, 'outside.txt')
  await mkdir(dirname(join(home, model)), { recursive: true })
  await Promise.all([join(home, model), join(home, cache, 'private.txt'), outside].map(path => writeFile(path, '1234')))
  await symlink(outside, join(home, cache, 'model.onnx'), 'file')
  const { controller, service } = fixture(home)
  expect(await controller.listStoredDownloads()).toEqual([{ name: 'SenseVoice speech model (INT8)', kind: 'cache', bytes: 4, path: model }])
  for (const path of [outside, '../outside.txt', `${cache}/private.txt`, `${cache}/model.onnx`]) {
    service.deleteStoredDownload.mockRejectedValueOnce(new Error('This item is not a Jan download.'))
    await expect(controller.deleteStoredDownload(path)).rejects.toThrow('not a Jan download')
  }
  await controller.deleteStoredDownload(model)
  expect(await controller.listStoredDownloads()).toEqual([])
  expect(await readFile(outside, 'utf8')).toBe('1234')
  expect(await readFile(join(home, cache, 'private.txt'), 'utf8')).toBe('1234')
})
