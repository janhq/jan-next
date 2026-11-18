import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@janhq/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@janhq/jan-llm'
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

/** One translation request as the adapter received it. */
interface RecordedRequest {
  system: string | undefined
  entries: Record<string, string>
  purpose: string | undefined
  tools: unknown
  model: string
}

/** Reply to a translation request by mapping every entry through `rewrite`. */
class TranslatingAdapter extends LlmAdapter {
  readonly requests: RecordedRequest[] = []
  /** Model ids this adapter's catalog lists. */
  models: string[] = []
  rewrite: (key: string, text: string) => string = (_key, text) => `[ja] ${text}`

  override listModels(provider: string): Promise<LlmModelInfo[]> {
    return Promise.resolve(this.models.map(id => ({ provider, id, name: id.toUpperCase() })))
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const message = options.messages[0]
    const content = message?.role === 'user' ? message.content[0] : undefined
    const request = translationRequest.parse(JSON.parse(content?.type === 'text' ? content.text : '{}'))
    const { entries } = request
    this.requests.push({ system: options.system, entries, purpose: options.purpose, tools: options.tools, model: options.model })
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

interface Harness {
  service: PluginI18n
  adapter: TranslatingAdapter
  changes: PluginI18nChange[]
  dir: string
  ctx: Context
}

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
  return { service: ctx.get('pluginI18n')!, adapter, changes, dir, ctx }
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
      'clear', 'consent', 'route', 'routes', 'setConsent', 'setRoute', 'status', 'statuses', 'tables', 'translate', 'translateStrings',
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
    expect(await service.route()).toEqual({ provider: 'test', model: 'm', source: 'default' })
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

    it('lists a consented package\u2019s translated strings under it, counts them, and drops them on clear', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ pkg: 'dsh-cad', allowed: true })
      adapter.rewrite = (_key, text) => `EN ${text}`
      expect(await service.translateStrings(['建模区为空', '导出'], 'en', 'dsh-cad')).toEqual({ '建模区为空': 'EN 建模区为空', '导出': 'EN 导出' })
      await service.translateStrings(['导出', '装配'], 'en', 'dsh-cad')
      expect((await service.status('dsh-cad')).runtime).toEqual([{ locale: 'en', strings: 3 }])
      expect((await service.tables('en')).runtime).toEqual({ 'dsh-cad': ['建模区为空', '导出', '装配'] })
      expect((await service.statuses()).map(status => status.pkg)).toEqual(['dsh-cad'])
      await service.clear('dsh-cad')
      expect(await service.statuses()).toEqual([])
      expect((await service.tables('en')).runtime).toEqual({})
    })

    it('keeps a string another package displayed when one package is cleared', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ pkg: 'a', allowed: true })
      await service.setConsent({ pkg: 'b', allowed: true })
      adapter.rewrite = (_key, text) => `EN ${text}`
      await service.translateStrings(['装配', '导出'], 'en', 'a')
      await service.translateStrings(['装配'], 'en', 'b')
      await service.clear('a')
      expect((await service.tables('en')).strings).toEqual({ '装配': 'EN 装配' })
    })

    it('needs the package\u2019s own consent for strings attributed to it', async () => {
      const { service, adapter } = await harness()
      await service.setConsent({ allowed: true })
      await service.setConsent({ pkg: 'a', allowed: true })
      await expect(service.translateStrings(['装配'], 'en', 'b')).rejects.toMatchObject({ code: 'plugin-i18n/not-consented' })
      expect(adapter.requests).toEqual([])
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

  describe('translation model', () => {
    /** Register a second route whose catalog lists `big`. */
    async function withAlt(): Promise<Harness & { alt: TranslatingAdapter }> {
      const made = await harness()
      const alt = new TranslatingAdapter()
      alt.models = ['big']
      made.ctx.llm.registerAdapter(['alt'], alt)
      return { ...made, alt }
    }

    it('follows the default model until a pick is saved, then until it is changed back', async () => {
      const { service, adapter, alt, dir } = await withAlt()
      await service.setConsent({ pkg: 'p', allowed: true })
      adapter.rewrite = (_key, text) => `EN ${text}`
      alt.rewrite = (_key, text) => `ALT ${text}`
      expect(await service.route()).toEqual({ provider: 'test', model: 'm', source: 'default' })
      const picked = await service.setRoute({ provider: 'alt', model: 'big' })
      expect(picked).toMatchObject({
        route: { provider: 'alt', model: 'big', source: 'saved' }, saved: { provider: 'alt', model: 'big' },
        default: { provider: 'test', model: 'm', usable: true }, models: [{ provider: 'alt', model: 'big', name: 'BIG', local: false, loaded: false }],
      })
      expect(await service.translateStrings(['装配'], 'en', 'p')).toEqual({ '装配': 'ALT 装配' })
      expect(adapter.requests).toEqual([])
      expect(alt.requests.map(request => request.model)).toEqual(['big'])
      await service.translate({ pkg: 'p', locale: 'ja', sourceLocale: 'en', sources })
      await settled(service, 'p')
      expect((await service.status('p')).locales[0]?.model).toBe('alt/big')
      const restarted = new Context()
      contexts.push(restarted)
      await restarted.plugin(LlmRuntime)
      restarted.llm.registerAdapter(['test'], adapter)
      restarted.llm.registerAdapter(['alt'], alt)
      await liveConfig(restarted, DefaultModel, { provider: 'test', model: 'm' })
      await restarted.plugin(PluginI18n, configFor(dir))
      expect(await restarted.get('pluginI18n')!.route()).toMatchObject({ provider: 'alt', model: 'big', source: 'saved' })
      const back = await service.setRoute(null)
      expect(back).toMatchObject({ route: { provider: 'test', model: 'm', source: 'default' }, saved: null })
      await service.translateStrings(['导出'], 'en', 'p')
      expect(adapter.requests.map(request => request.model)).toEqual(['m'])
    })

    it('refuses a pick whose provider has no adapter or whose model is empty', async () => {
      const { service } = await harness()
      await expect(service.setRoute({ provider: 'nope', model: 'x' })).rejects.toMatchObject({ code: 'plugin-i18n/invalid-route' })
      await expect(service.setRoute({ provider: 'test', model: '' })).rejects.toMatchObject({ code: 'plugin-i18n/invalid-route' })
      expect((await service.routes()).saved).toBeNull()
    })

    it('announces a change of model so clients read again', async () => {
      const { service, changes } = await withAlt()
      await service.setRoute({ provider: 'alt', model: 'big' })
      expect(changes.at(-1)).toEqual({})
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
