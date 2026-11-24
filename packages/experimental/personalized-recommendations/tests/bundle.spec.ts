/** The bundle is the only layer that declares the six card rows, so the Plugins page addresses and switches each one. */
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import type { Context } from '@janhq/cordis'
import { entryListSchema } from '@janhq/cordis-plugin-include'
import Timer from '@janhq/cordis-plugin-timer'
import { boot, initProfile, loadProfileDirectory, readProfilePatches, type ProfileContext } from '@janhq/jan-app-boot'
import Hmr from '@janhq/jan-hmr'
import PluginManager from '@janhq/jan-plugin-manager'
import Sessions from '@janhq/jan-session'
import Projections from '@janhq/jan-session-projection'
import Agents from '@janhq/jan-agent'
import Llm from '@janhq/jan-llm'
import SystemPrompt from '@janhq/jan-system-prompt'
import Tools from '@janhq/jan-tools'
import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import Skills from '@janhq/jan-skill'
import Access from '@janhq/jan-api-remote-access'
import * as ActionCards from '@janhq/jan-action-cards'
import * as Pages from '@janhq/jan-creation-recommendations'
import * as Plugins from '@janhq/jan-plugin-recommendations'

interface Row { readonly id: string; readonly name: string }

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  publishConfig: { access: string }
  dependencies: Record<string, string>
  jan: { bundle: { patch: string } }
}
const patch = yaml.load(readFileSync(new URL(`../${manifest.jan.bundle.patch}`, import.meta.url), 'utf8'), {
  schema: entryListSchema,
}) as { insert: Row[] }[]
const rows = patch[0]?.insert ?? []

/** A browser row's Host entry is an empty `apply`; its contribution loads in the Client. */
function browserRow(): object {
  return { apply(): void {} }
}

/** Source modules standing in for the row packages, which the Loader would otherwise import from their built lib. */
const MODULES: Readonly<Record<string, object>> = {
  '@janhq/jan-action-cards': ActionCards,
  '@janhq/jan-client-ui-action-cards': browserRow(),
  '@janhq/jan-creation-recommendations': Pages,
  '@janhq/jan-client-ui-creation-recommendations': browserRow(),
  '@janhq/jan-plugin-recommendations': Plugins,
  '@janhq/jan-client-ui-plugin-recommendations': browserRow(),
}

it('publishes one layer inserting the card service, the card display and both features with their card bodies', () => {
  expect(manifest.publishConfig.access).toBe('public')
  expect(manifest.jan.bundle.patch).toBe('./cordis.patch.yml')
  expect(patch).toEqual([{ insert: [
    { id: 'action-cards', name: '@janhq/jan-action-cards' },
    { id: 'client-ui-action-cards', name: '@janhq/jan-client-ui-action-cards' },
    { id: 'creation-recommendations', name: '@janhq/jan-creation-recommendations' },
    { id: 'client-ui-creation-recommendations', name: '@janhq/jan-client-ui-creation-recommendations' },
    { id: 'plugin-recommendations', name: '@janhq/jan-plugin-recommendations' },
    { id: 'client-ui-plugin-recommendations', name: '@janhq/jan-client-ui-plugin-recommendations' },
  ] }])
  expect(Object.keys(manifest.dependencies).sort()).toEqual(rows.map(row => row.name).sort())
})

it('addresses every row through its own id and switches the shared card service and each feature', async () => {
  const home = await mkdtemp(join(tmpdir(), 'jan-personalized-recommendations-'))
  let owner: Context | undefined
  onTestFinished(async () => { await owner?.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  const anchor = join(home, 'package.json')
  await writeFile(anchor, JSON.stringify({ name: 'installation', dependencies: { [manifest.name]: '1.0.0' } }))
  initProfile(dir, ['fixture-base', manifest.name])
  async function bundle(root: string, name: string, inserted: object[]) {
    const path = join(root, 'node_modules', name)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify({
      name, version: '1.0.0', jan: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(join(path, 'cordis.patch.yml'), JSON.stringify([{ insert: inserted }]))
  }
  await bundle(dir, 'fixture-base', [
    ['session', 'sessions'], ['projection', 'projections'], ['llm', 'llm'], ['prompt', 'prompt'], ['tools', 'tools'],
    ['executor', 'executor'], ['skills', 'skills'], ['agents', 'agents'], ['access', 'access'], ['manager', 'manager'],
  ].map(([id, name]) => ({ id, name: `cordis:${name!}` })))
  // The shipped rows keep their ids; each name serves that row's package source through a Loader builtin.
  await bundle(home, manifest.name, rows.map(row => ({ id: row.id, name: `cordis:${row.id}` })))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', dir, home, cwd: home, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
    startedBundles: loadProfileDirectory('test', dir, anchor).layers.map(layer => layer.packageName),
    overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    owner = ctx
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
    // Personalized pages starts Creator children through this service only after a Create click.
    ctx.provide('subagents', {})
    Object.assign(ctx.loader.builtins, {
      sessions: Sessions, projections: Projections, llm: Llm, prompt: SystemPrompt, tools: Tools, executor: NativeToolExecutor,
      skills: Skills, agents: Agents, access: Access, manager: PluginManager,
      ...Object.fromEntries(rows.map(row => [row.id, MODULES[row.name]])),
    })
  })
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await ctx.hmr.runExclusive(async () => {})
  const skills = async () => (await ctx.skills.list()).map(skill => skill.name).sort()
  expect(await skills()).toEqual(['official-plugins', 'personalized-pages'])
  const listed = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === manifest.name)
  expect(listed).toMatchObject({ enabled: true, optional: true })
  expect(listed?.rows.map(row => row.rowId)).toEqual(rows.map(row => row.id))
  const plugins = await ctx.pluginManager.listPlugins()
  for (const row of listed?.rows ?? []) {
    expect([...ctx.loader.entries()].filter(entry => entry.options.id === row.rowId)).toHaveLength(1)
    const plugin = plugins.find(item => item.entryId === row.entryId)
    expect(plugin).toMatchObject({ patchId: row.rowId, enabled: true })
    expect(plugin?.readOnlyReason).toBeUndefined()
  }
  const toggle = async (id: string, enabled: boolean) => {
    const entryId = listed?.rows.find(row => row.rowId === id)?.entryId
    if (entryId === undefined) throw new Error(`the bundle lists no live ${id} row`)
    expect(await ctx.pluginManager.setPluginEnabled(entryId, enabled)).toMatchObject({ application: 'applied' })
    expect((await ctx.pluginManager.listPlugins()).find(item => item.entryId === entryId)?.enabled).toBe(enabled)
  }
  await toggle('creation-recommendations', false)
  expect(await skills()).toEqual(['official-plugins'])
  // Both features inject the card service, so switching it off withdraws them until it is on again.
  await toggle('action-cards', false)
  expect(ctx.get('actionCards')).toBeUndefined()
  expect(await skills()).toEqual([])
  expect(yaml.load(await readFile(profile.patchPath, 'utf8'))).toEqual([
    { id: 'creation-recommendations', disabled: true }, { id: 'action-cards', disabled: true },
  ])
  await toggle('action-cards', true)
  expect(await skills()).toEqual(['official-plugins'])
  await toggle('creation-recommendations', true)
  expect(await skills()).toEqual(['official-plugins', 'personalized-pages'])
  await toggle('plugin-recommendations', false)
  expect(await skills()).toEqual(['personalized-pages'])
  await toggle('plugin-recommendations', true)
  expect(await skills()).toEqual(['official-plugins', 'personalized-pages'])
  expect(yaml.load(await readFile(profile.patchPath, 'utf8'))).toEqual([])
}, 30_000)
