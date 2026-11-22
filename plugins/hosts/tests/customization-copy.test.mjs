import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyCustomizations, customizationOffer, customizationState, skillFolders } from '../customization-copy.mjs'

function settingsWith(servers) {
  return { describe: () => [{ ns: 'mcp-manager', value: { servers } }] }
}

function skillsRoot(names) {
  const root = mkdtempSync(join(tmpdir(), 'jan-hosts-skills-'))
  for (const name of names) {
    mkdirSync(join(root, name))
    writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Does ${name}\n---\nbody\n`)
  }
  mkdirSync(join(root, 'not-a-skill'))
  return root
}

const bundles = [
  { name: '@janhq/jan-base', enabled: true, installed: false, optional: false, availability: 'installation' },
  { name: '@me/browser-pack', enabled: true, installed: true, optional: false, availability: 'profile', source: '@me/browser-pack@1.2.0', version: '1.2.0' },
  { name: '@me/local-pack', enabled: true, installed: true, optional: false, availability: 'profile', source: 'C:\\Users\\me\\local-pack' },
  { name: '@janhq/jan-experimental-voice-input-bundle', enabled: true, installed: false, optional: true, availability: 'installation' },
]

test('skill folders are the directories holding SKILL.md, with their description', () => {
  const root = skillsRoot(['writing', 'research'])
  assert.deepEqual(skillFolders(root).map(skill => [skill.name, skill.description]), [['research', 'Does research'], ['writing', 'Does writing']])
  assert.deepEqual(skillFolders(join(root, 'missing')), [])
})

test('the offer lists only what the other Jan lacks, and marks what would not run there', async () => {
  const here = {
    settings: settingsWith({
      fetch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      serper: { transport: 'stdio', command: 'C:\\Program Files\\nodejs\\node.exe', args: [] },
      docs: { transport: 'http', url: 'https://docs.example/mcp' },
    }),
    skillRoots: [skillsRoot(['writing', 'research'])],
    pluginManager: { listBundles: async () => bundles },
  }
  const remote = {
    servers: ['docs'], skills: ['research'], plugins: true,
    bundles: { '@janhq/jan-base': { installed: true, enabled: true }, '@janhq/jan-experimental-voice-input-bundle': { installed: true, enabled: false } },
  }
  const offer = await customizationOffer(here, remote)
  assert.deepEqual(offer.servers.map(item => [item.id, item.problem]), [['fetch', undefined], ['serper', 'local-path']])
  assert.deepEqual(offer.skills.map(item => item.id), ['writing'])
  assert.deepEqual(offer.plugins.map(item => [item.id, item.install, item.problem]), [
    ['@me/browser-pack', '@me/browser-pack@1.2.0', undefined],
    ['@me/local-pack', 'C:\\Users\\me\\local-pack', 'local-path'],
    // Shipped with Jan there: switched on, not installed.
    ['@janhq/jan-experimental-voice-input-bundle', undefined, undefined],
  ])
})

test('a Jan without a plugin manager is offered no plugins', async () => {
  const here = { settings: settingsWith({}), skillRoots: [], pluginManager: { listBundles: async () => bundles } }
  const offer = await customizationOffer(here, { servers: [], skills: [], bundles: {}, plugins: false })
  assert.deepEqual(offer.plugins, [])
})

test('the receiving side reports its servers, skills and bundles', async () => {
  const janHome = mkdtempSync(join(tmpdir(), 'jan-hosts-home-'))
  mkdirSync(join(janHome, 'skills'))
  mkdirSync(join(janHome, 'skills', 'mine'))
  writeFileSync(join(janHome, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n')
  const state = await customizationState({ settings: settingsWith({ fetch: {} }), janHome, pluginManager: { listBundles: async () => bundles.slice(0, 1) } })
  assert.deepEqual(state, { servers: ['fetch'], skills: ['mine'], bundles: { '@janhq/jan-base': { installed: true, enabled: true } }, plugins: true })
})

test('copying sends the chosen servers as one settings merge and each plugin by its own call', async () => {
  const here = { settings: settingsWith({ fetch: { transport: 'stdio', command: 'uvx' }, other: { transport: 'stdio', command: 'x' } }), skillRoots: [] }
  const calls = []
  const target = {
    ssh: [],
    async remote(endpoint, args) {
      calls.push([endpoint, args])
      if (args.spec === 'bad@1') return { failures: [{ message: 'not found' }] }
      return {}
    },
  }
  const offer = {
    servers: [{ id: 'fetch', name: 'fetch' }, { id: 'other', name: 'other' }],
    skills: [],
    plugins: [{ id: 'good', name: 'Good', install: 'good@1' }, { id: 'bad', name: 'Bad', install: 'bad@1' }, { id: 'shipped', name: 'Shipped' }],
  }
  const result = await copyCustomizations(here, target, offer, { servers: ['fetch'], plugins: ['good', 'bad', 'shipped'] })
  assert.deepEqual(calls, [
    ['settings/update', { ns: 'mcp-manager', patch: { servers: { fetch: { transport: 'stdio', command: 'uvx' } } } }],
    ['pluginManager/installBundle', { spec: 'good@1', options: { enabled: true } }],
    ['pluginManager/installBundle', { spec: 'bad@1', options: { enabled: true } }],
    ['pluginManager/setBundleEnabled', { name: 'shipped', enabled: true }],
  ])
  assert.deepEqual(result, { servers: ['fetch'], skills: [], plugins: ['Good', 'Shipped'], failed: [{ name: 'Bad', error: 'not found' }] })
})
