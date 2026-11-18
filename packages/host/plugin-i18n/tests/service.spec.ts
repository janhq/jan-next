import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@janhq/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@janhq/jan-llm'
import DefaultModel from '@janhq/jan-agent-default-model'
import { z } from 'zod'
import { remoteMethods } from '@janhq/jan-typert-protocol'
import PluginI18n, { type Config, type PluginI18nChange, type PluginI18nJob } from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

/** The JSON data of one translation request. */
const translationRequest = z.object({ entries: z.record(z.string(), z.string()) })

/** A complete configuration with small limits. */
function configFor(dir: string, overrides: Partial<Config> = {}): Config {
  return {
    dir, maxEntries: 50, maxSourceBytes: 4096, batchEntries: 2, batchBytes: 4096, maxOutputTokens: 512, timeoutMs: 5000,
    maxStrings: 3, maxStringLength: 40, ...overrides,
  }
}

/** Reply to a translation request by mapping every entry through `rewrite`. */
class TranslatingAdapter extends LlmAdapter {
  readonly requests: { system: string | undefined; entries: Record<string, string>; purpose: string | undefined; tools: unknown }[] = []
  rewrite: (key: string, text: string) => string = (_key, text) => `[ja] ${text}`

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const message = options.messages[0]
    const content = message?.role === 'user' ? message.content[0] : undefined
    const request = translationRequest.parse(JSON.parse(content?.type === 'text' ? content.text : '{}'))
    const { entries } = request
    this.requests.push({ system: options.system, entries, purpose: options.purpose, tools: options.tools })
    const reply = JSON.stringify(Object.fromEntries(Object.entries(entries).map(([key, text]) => [key, this.rewrite(key, text)])))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Harness { service: PluginI18n; adapter: TranslatingAdapter; changes: PluginI18nChange[]; dir: string }

async function harness(overrides: Partial<Config> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'jan-plugin-i18n-service-'))
  dirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const adapter = new TranslatingAdapter()
  ctx.llm.registerAdapter(['test'], adapter)
  await liveConfig(ctx, DefaultModel, { provider: 'test', model: 'm' })
  const config = configFor(dir, overrides)
  await ctx.plugin(PluginI18n, config)
  const changes: PluginI18nChange[] = []
  ctx.on('plugin-i18n/changed', (change) => { changes.push(change) })
  return { service: ctx.get('pluginI18n')!, adapter, changes, dir }
}

/** Wait until the job of a package and locale leaves `running`. */
async function settled(service: PluginI18n, pkg: string): Promise<PluginI18nJob> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await service.status(pkg)).job
    if (job !== null && job.state !== 'running') return job
    await sleep(5)
  }
  throw new Error('job never settled')
}

const sources = { ns: { a: 'Hello {name}', b: 'Close', c: 'Open' } }

describe('PluginI18n', () => {
  it('declares its Remote methods', async () => {
    const { service } = await harness()
    expect(remoteMethods(service).map(marker => marker.method).toSorted()).toEqual([
      'clear', 'consent', 'route', 'setConsent', 'status', 'statuses', 'tables', 'translate', 'translateStrings',
    ])
  })

  it('translates in the Host without tools, stores the result, and records consent for the package', async () => {
    const { service, adapter, changes } = await harness()
    const started = await service.translate({ pkg: 'dsh-cad', locale: 'ja', sourceLocale: 'en', sources })
    expect(started).toMatchObject({ state: 'running', total: 3 })
    const job = await settled(service, 'dsh-cad')
    expect(job).toMatchObject({ state: 'done', done: 3, total: 3 })
    expect(adapter.requests.map(request => Object.keys(request.entries).length)).toEqual([2, 1])
    expect(adapter.requests.every(request => request.purpose === 'plugin-i18n' && request.tools === undefined)).toBe(true)
    const status = await service.status('dsh-cad')
    expect(status.consented).toBe(true)
    expect(status.locales).toMatchObject([{ locale: 'ja', sourceLocale: 'en', model: 'test/m', namespaces: ['ns'], entries: 3, kept: 0 }])
    expect((await service.tables('ja')).packages['dsh-cad']?.entries['ns']?.['a']).toEqual({ src: 'Hello {name}', text: '[ja] Hello {name}' })
    expect(changes.at(-1)).toEqual({ pkg: 'dsh-cad', locale: 'ja' })
    expect(service.route()).toEqual({ provider: 'test', model: 'm' })
  })

  it('re-translates only changed and new keys when the source changes', async () => {
    const { service, adapter } = await harness()
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    await settled(service, 'p')
    adapter.requests.length = 0
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources: { ns: { a: 'Hello {name}', b: 'Close window', c: 'Open', d: 'New' } } })
    for (let attempt = 0; attempt < 200 && adapter.requests.length === 0; attempt++) await sleep(5)
    await settled(service, 'p')
    expect(adapter.requests.flatMap(request => Object.values(request.entries)).toSorted()).toEqual(['Close window', 'New'])
    const entries = (await service.tables('ja')).packages['p']?.entries['ns']
    expect(entries?.['b']).toEqual({ src: 'Close window', text: '[ja] Close window' })
    expect(entries?.['c']).toEqual({ src: 'Open', text: '[ja] Open' })
  })

  it('translates every key again on rerun', async () => {
    const { service, adapter } = await harness()
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    await settled(service, 'p')
    adapter.requests.length = 0
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources, rerun: true })
    await sleep(50)
    await settled(service, 'p')
    expect(adapter.requests.flatMap(request => Object.keys(request.entries))).toHaveLength(3)
  })

  it('keeps a key in the source language when its placeholders never validate', async () => {
    const { service, adapter } = await harness()
    adapter.rewrite = (_key, text) => text.replace('{name}', '{nome}')
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    expect(await settled(service, 'p')).toMatchObject({ state: 'done' })
    const [locale] = (await service.status('p')).locales
    expect(locale).toMatchObject({ entries: 2, kept: 1 })
    expect((await service.tables('ja')).packages['p']?.entries['ns']?.['a']).toBeUndefined()
  })

  it('fails the job with the model diagnostic and leaves nothing stored', async () => {
    const { service, adapter } = await harness()
    adapter.rewrite = () => { throw new Error('quota exceeded') }
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    const job = await settled(service, 'p')
    expect(job.state).toBe('failed')
    expect(job.message).toContain('quota exceeded')
    expect((await service.status('p')).locales).toEqual([])
  })

  it('refuses invalid names and oversized requests', async () => {
    const { service } = await harness({ maxEntries: 2 })
    await expect(service.translate({ pkg: '../x', locale: 'ja', sourceLocale: 'en', sources })).rejects.toMatchObject({ code: 'plugin-i18n/invalid-package' })
    await expect(service.translate({ pkg: 'p', locale: 'not a tag', sourceLocale: 'en', sources })).rejects.toMatchObject({ code: 'plugin-i18n/invalid-locale' })
    await expect(service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })).rejects.toMatchObject({
      code: 'plugin-i18n/too-large', details: { entries: 3, maxEntries: 2 },
    })
    await expect(service.status('')).rejects.toMatchObject({ code: 'plugin-i18n/invalid-package' })
  })

  it('shares one running job per package and locale', async () => {
    const { service } = await harness()
    const first = await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    const second = await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    expect(second).toBe(first)
    await settled(service, 'p')
  })

  it('clears stored text and consent, and lists packages by status', async () => {
    const { service } = await harness()
    await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
    await settled(service, 'p')
    expect((await service.statuses()).map(status => status.pkg)).toEqual(['p'])
    await service.clear('p')
    expect(await service.statuses()).toEqual([])
    expect(await service.consent()).toEqual({ global: false, packages: [] })
    expect((await service.tables('ja')).packages).toEqual({})
  })

  describe('runtime strings', () => {
    it('refuses to send strings before consent', async () => {
      const { service, adapter } = await harness()
      await expect(service.translateStrings(['工程图 body1'], 'en')).rejects.toMatchObject({ code: 'plugin-i18n/not-consented' })
      expect(adapter.requests).toEqual([])
    })

    it('translates once per exact string, caches it, and bounds the cache', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ allowed: true })
      adapter.rewrite = (_key, text) => `EN ${text}`
      expect(await service.translateStrings(['工程图 body1', ' ', 'x'.repeat(41)], 'en')).toEqual({ '工程图 body1': 'EN 工程图 body1' })
      expect(adapter.requests).toHaveLength(1)
      await service.translateStrings(['工程图 body1'], 'en')
      expect(adapter.requests).toHaveLength(1)
      await service.translateStrings(['装配', '装配插入', '约束求解'], 'en')
      expect((await service.tables('en')).strings).toEqual({ '装配': 'EN 装配', '装配插入': 'EN 装配插入', '约束求解': 'EN 约束求解' })
    })

    it('does not send a refused string again', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ pkg: 'p', allowed: true })
      adapter.rewrite = () => ''
      expect(await service.translateStrings(['装配'], 'en')).toEqual({})
      const sent = adapter.requests.length
      expect(await service.translateStrings(['装配'], 'en')).toEqual({})
      expect(adapter.requests).toHaveLength(sent)
    })

    it('reports a model failure and serves strings only while consent stands', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ allowed: true })
      adapter.rewrite = () => { throw new Error('offline') }
      await expect(service.translateStrings(['装配'], 'en')).rejects.toMatchObject({ code: 'plugin-i18n/model-failed' })
      adapter.rewrite = (_key, text) => `EN ${text}`
      await service.translateStrings(['装配'], 'en')
      expect((await service.tables('en')).strings).toEqual({ '装配': 'EN 装配' })
      await service.setConsent({ allowed: false })
      expect((await service.tables('en')).strings).toEqual({})
    })
  })

  it('persists the consent record across a restart', async () => {
    const first = await harness()
    await first.service.setConsent({ pkg: 'b', allowed: true })
    await first.service.setConsent({ pkg: 'a', allowed: true })
    await first.service.setConsent({ allowed: true })
    await first.service.setConsent({ pkg: 'b', allowed: false })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await liveConfig(ctx, DefaultModel, { provider: 'test', model: 'm' })
    await ctx.plugin(PluginI18n, configFor(first.dir))
    expect(await ctx.get('pluginI18n')!.consent()).toEqual({ global: true, packages: ['a'] })
  })

  it('requires an absolute cache directory without a Jan home', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await liveConfig(ctx, DefaultModel, { provider: 'test', model: 'm' })
    await expect(ctx.plugin(PluginI18n, configFor('relative'))).rejects.toThrow('absolute')
  })
})
