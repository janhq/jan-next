import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  accelerators, assessFit, backendOf, Config, estimateKvBytes, modelFacts, parseDeviceList, plannedContext, readModelFacts,
  renderPreset, resolvePresetSettings, UnsupportedModelError, WorkerProtocolError, type ModelFacts,
} from '../src/index.ts'
import { chatModel, ggufFile } from './gguf-fixture.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

describe('GGUF facts', () => {
  it('records architecture, trained context, chat template, quantization and KV dimensions', () => {
    expect(modelFacts(chatModel(40960))).toEqual({
      architecture: 'qwen3', contextLength: 40960, hasChatTemplate: true, expertCount: 0, fileType: 'Q4_K_M',
      kvElementsPerToken: 28 * 8 * (128 + 128),
    })
  })

  it('derives head dimensions from the embedding length when the file omits them, and reads per-layer arrays', () => {
    const facts = modelFacts({
      'general.architecture': 'llama', 'llama.block_count': 2, 'llama.embedding_length': 4096,
      'llama.attention.head_count': 32, 'llama.expert_count': 8,
    })
    expect(facts).toMatchObject({ kvElementsPerToken: 2 * 32 * 256, expertCount: 8, hasChatTemplate: false })
    expect(facts).not.toHaveProperty('contextLength')
    expect(modelFacts({ 'general.architecture': 'gemma', 'gemma.block_count': 1, 'gemma.attention.head_count': [4, 8], 'gemma.attention.key_length': 1, 'gemma.attention.value_length': 1 }).kvElementsPerToken).toBe(16)
  })

  it('refuses projectors, embedding models and files without an architecture', () => {
    expect(() => modelFacts({ 'general.architecture': 'clip' })).toThrow(/vision projector/)
    expect(() => modelFacts({ 'general.architecture': 'bert' })).toThrow(/embedding model/)
    expect(() => modelFacts({ 'general.architecture': 'qwen3', 'qwen3.pooling_type': 1 })).toThrow(UnsupportedModelError)
    expect(() => modelFacts({ 'general.architecture': 'gte-embed' })).toThrow(/embedding model/)
    expect(() => modelFacts({})).toThrow(/no model architecture/)
  })

  it('reads a file from disk and rejects one that is not GGUF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llama-gguf-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, 'a.gguf'), ggufFile(chatModel(8192), 4096))
    await writeFile(join(dir, 'b.gguf'), 'not a model')
    expect((await readModelFacts(join(dir, 'a.gguf'))).contextLength).toBe(8192)
    await expect(readModelFacts(join(dir, 'b.gguf'))).rejects.toThrow()
  })

  it('estimates the KV cache at the context, capped at the trained one, and averages sliding windows', () => {
    const facts: ModelFacts = { architecture: 'x', hasChatTemplate: true, expertCount: 0, contextLength: 4096, kvElementsPerToken: 1000 }
    expect(estimateKvBytes(facts, 2048, 'f16')).toBe(2048 * 2000)
    expect(estimateKvBytes(facts, 100_000, 'f16')).toBe(4096 * 2000)
    expect(estimateKvBytes(facts, 2048, 'q8_0')).toBe(2048 * 1062.5)
    expect(estimateKvBytes({ ...facts, slidingWindow: 1024 }, 4096, 'f16')).toBe((4096 * 2000 + 1024 * 2000) / 2)
    expect(estimateKvBytes({ architecture: 'x', hasChatTemplate: true, expertCount: 0 }, 4096, 'f16')).toBeUndefined()
  })
})

describe('device memory and fit', () => {
  const MIB = 1024 * 1024
  const GIB = 1024 * MIB
  const gpu = (id: string, totalMiB: number) => ({ id, name: id, totalMiB, freeMiB: totalMiB })

  it('names the backend from the first accelerator, skipping host devices', () => {
    expect(backendOf([gpu('CUDA0', 1)])).toBe('cuda')
    expect(backendOf([gpu('Vulkan10', 1)])).toBe('vulkan')
    expect(backendOf([gpu('BLAS', 0), gpu('MTL0', 1)])).toBe('metal')
    expect(backendOf([gpu('CPU', 0), gpu('CUDA0', 1)])).toBe('cuda')
    expect(backendOf([gpu('BLAS', 0)])).toBe('cpu')
    expect(backendOf([])).toBe('cpu')
    expect(accelerators([gpu('BLAS', 0), gpu('MTL0', 1)]).map(device => device.id)).toEqual(['MTL0'])
  })

  it('parses the worker device listing and refuses anything else', () => {
    expect(parseDeviceList('[{"id":"Vulkan0","name":"RTX","mem":24822,"free":23721}]\n'))
      .toEqual([{ id: 'Vulkan0', name: 'RTX', totalMiB: 24822, freeMiB: 23721 }])
    expect(parseDeviceList('[]')).toEqual([])
    expect(() => parseDeviceList('ggml_vulkan: found')).toThrow(WorkerProtocolError)
    expect(() => parseDeviceList('[{"id":"Vulkan0","name":"RTX"}]')).toThrow(/invalid devices/)
  })

  it('places a model on the GPU, beside system memory, or nowhere', () => {
    const machine = { unified: false, ramBytes: 32 * GIB, devices: [gpu('CUDA0', 8192)] }
    expect(assessFit(4 * GIB, machine)).toBe('fits')
    expect(assessFit(12 * GIB, machine)).toBe('tight')
    expect(assessFit(40 * GIB, machine)).toBe('too-large')
    // A host device holds no layers, so its memory is not GPU memory.
    expect(assessFit(4 * GIB, { ...machine, devices: [gpu('BLAS', 65536)] })).toBe('fits')
    expect(assessFit(31 * GIB, { ...machine, devices: [gpu('BLAS', 65536)] })).toBe('too-large')
  })

  it('treats system memory as the pool on a machine without accelerators', () => {
    const machine = { unified: false, ramBytes: 16 * GIB, devices: [] }
    expect(assessFit(8 * GIB, machine)).toBe('fits')
    expect(assessFit(15 * GIB, machine)).toBe('too-large')
  })

  // Thresholds of Jan's Apple Silicon check: usable = total - 2.5 GiB - 10%, comfortable = 85% of usable.
  it('keeps headroom in unified memory', () => {
    const mac = (gib: number) => ({ unified: true, ramBytes: gib * GIB, devices: [gpu('MTL0', gib * 1024)] })
    expect(assessFit(1_825_361_100, mac(8))).toBe('fits')
    expect(assessFit(4_724_464_025, mac(8))).toBe('tight')
    expect(assessFit(5_368_709_120, mac(8))).toBe('too-large')
    expect(assessFit(7_945_689_497, mac(16))).toBe('fits')
    expect(assessFit(11_811_160_064, mac(16))).toBe('tight')
    expect(assessFit(12_777_527_706, mac(16))).toBe('tight')
    expect(assessFit(12_777_527_707, mac(16))).toBe('too-large')
    expect(assessFit(26_843_545_600, mac(32))).toBe('tight')
    expect(assessFit(0, mac(16))).toBe('fits')
  })
})

describe('preset', () => {
  const config = Config({ dataRoot: '/data' })
  const facts = modelFacts(chatModel(40960))
  const settings = resolvePresetSettings(config, 'linux', '/data/slots')
  const model = { id: 'local', path: '/m/a.gguf', facts }

  it('writes the configured sizing and runtime options, and omits what llama.cpp decides', () => {
    expect(renderPreset(settings, [model])).toBe([
      '[*]', 'fit = on', 'fit-target = 1024', 'ctx-size = 32768', 'flash-attn = on', 'cache-type-k = q8_0', 'cache-type-v = q8_0',
      'slot-save-path = /data/slots', '', '[local]', 'model = /m/a.gguf', '',
    ].join('\n'))
  })

  it('lets fit choose the context when ctxSize is 0, and pins context and layers with fit off', () => {
    const auto = renderPreset({ ...settings, ctxSize: 0, threads: 4 }, [model])
    expect(auto).toContain('fit = on\nfit-target = 1024\nfit-ctx = 16384\n')
    expect(auto).toContain('threads = 4\n')
    expect(auto).not.toContain('ctx-size')
    expect(renderPreset({ ...settings, fit: false, ctxSize: 0, gpuLayers: 20 }, [model])).toContain('fit = off\nctx-size = 16384\nn-gpu-layers = 20\n')
    expect(renderPreset({ ...settings, fit: false }, [model])).toContain('n-gpu-layers = 999\n')
  })

  it('turns fit off by default on macOS only, and refuses a quantized cache without flash attention', () => {
    expect(resolvePresetSettings(config, 'darwin', '/s').fit).toBe(false)
    expect(resolvePresetSettings(config, 'win32', '/s').fit).toBe(true)
    expect(resolvePresetSettings(Config({ dataRoot: '/data', fit: true }), 'darwin', '/s').fit).toBe(true)
    expect(() => resolvePresetSettings(Config({ dataRoot: '/data', flashAttn: 'off' }), 'linux', '/s')).toThrow(/needs flash attention/)
    expect(resolvePresetSettings(Config({ dataRoot: '/data', flashAttn: 'off', cacheType: 'f16' }), 'linux', '/s').flashAttn).toBe('off')
  })

  it('writes optional server options only when set, and unifies the KV cache with an explicit parallel count', () => {
    const ini = renderPreset({
      ...settings, batchSize: 1024, ubatchSize: 256, parallel: 2, nCpuMoe: 4, device: 'Vulkan0', splitMode: 'row', mainGpu: 1,
      kvOffload: false, loadMode: 'mmap+mlock', cacheRamMiB: -1,
    }, [model])
    expect(ini).toContain([
      'batch-size = 1024', 'ubatch-size = 256', 'parallel = 2', 'kv-unified = true', 'n-cpu-moe = 4', 'device = Vulkan0',
      'split-mode = row', 'main-gpu = 1', 'no-kv-offload = true', 'load-mode = mmap+mlock', 'cache-ram = -1',
    ].join('\n'))
  })

  it('serves a model trained with a shorter context at its trained context', () => {
    const short = { ...model, facts: modelFacts(chatModel(8192)) }
    expect(renderPreset(settings, [short])).toContain('[local]\nmodel = /m/a.gguf\nctx-size = 8192\n')
    expect(renderPreset({ ...settings, ctxSize: 0 }, [short])).not.toContain('ctx-size')
    expect(renderPreset({ ...settings, ctxSize: 0, fit: false }, [short])).toContain('[local]\nmodel = /m/a.gguf\nctx-size = 8192\n')
    expect(plannedContext(settings, short.facts)).toBe(8192)
    expect(plannedContext({ ...settings, ctxSize: 0 }, facts)).toBe(16384)
  })

  it('writes the MoE cache only for a model with experts and a split llama.cpp accepts it with', () => {
    const moe = { ...model, facts: { ...facts, expertCount: 64 } }
    expect(renderPreset({ ...settings, moeCacheMiB: 2048 }, [model])).not.toContain('moe-cache-mib')
    expect(renderPreset({ ...settings, moeCacheMiB: 2048 }, [moe])).toContain('[local]\nmodel = /m/a.gguf\nmoe-cache-mib = 2048\n')
    expect(renderPreset({ ...settings, moeCacheMiB: 2048, splitMode: 'tensor' }, [moe])).not.toContain('moe-cache-mib')
    expect(renderPreset({ ...settings, moeCacheMiB: 2048, device: 'none' }, [moe])).not.toContain('moe-cache-mib')
  })

  it('keeps every value on one line', () => {
    expect(renderPreset({ ...settings, slotSavePath: '/s\n[evil]' }, [{ ...model, path: '/m/b\n[evil]' }]))
      .toContain('slot-save-path = /s [evil]\n\n[local]\nmodel = /m/b [evil]\n')
  })
})
