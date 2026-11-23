import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('skill listing skips dangling links without losing other skills', { skip: process.platform === 'win32' }, (t) => {
  const root = skillsRoot(['writing'])
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync('gone', join(root, 'stale'))
  assert.deepEqual(skillFolders(root).map(skill => skill.name), ['writing'])
})

test('skill uploads preserve the selected alias and safe nested links without overwriting files', { skip: process.platform === 'win32' }, async (t) => {
  const root = skillsRoot([])
  const sources = skillsRoot(['original', 'unsafe'])
  const home = mkdtempSync(join(tmpdir(), 'jan-hosts-skill-dest-'))
  const dest = join(home, '.jan/hosts-runtime/home/skills')
  const env = { PATH: process.env.PATH, HOME: process.env.HOME }
  t.after(() => {
    Object.assign(process.env, env)
    for (const directory of [root, sources, home]) rmSync(directory, { recursive: true, force: true })
  })
  symlinkSync(join(sources, 'original'), join(root, 'renamed'))
  symlinkSync(join(sources, 'unsafe'), join(root, 'unsafe'))
  symlinkSync('SKILL.md', join(sources, 'original', 'same'))
  symlinkSync('../original/SKILL.md', join(sources, 'unsafe', 'outside'))
  mkdirSync(join(dest, 'renamed'), { recursive: true })
  writeFileSync(join(dest, 'renamed', 'SKILL.md'), 'existing')
  writeFileSync(join(home, 'ssh'), '#!/bin/sh\nfor arg do command=$arg; done\nexec sh -c "$command"\n', { mode: 0o755 })
  process.env.PATH = `${home}:${env.PATH}`
  process.env.HOME = home
  const source = { settings: settingsWith({}), skillRoots: [root] }
  const target = { ssh: ['box'] }
  const offer = await customizationOffer(source, { skills: [], servers: [], plugins: false })
  await assert.rejects(copyCustomizations(source, target, offer, { skills: ['unsafe'] }), /outside the skill/)
  const result = await copyCustomizations(source, target, offer, { skills: ['renamed'] })
  assert.deepEqual(result.skills, ['renamed'])
  assert.equal(readFileSync(join(dest, 'renamed', 'SKILL.md'), 'utf8'), 'existing')
  assert.equal(readlinkSync(join(dest, 'renamed', 'same')), 'SKILL.md')
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
