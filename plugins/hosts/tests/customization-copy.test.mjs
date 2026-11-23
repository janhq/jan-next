import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { customizationState, skillFolders } from '../customization-copy.mjs'

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

test('the receiving side reports its servers, skills and bundles', async () => {
  const janHome = mkdtempSync(join(tmpdir(), 'jan-hosts-home-'))
  mkdirSync(join(janHome, 'skills'))
  mkdirSync(join(janHome, 'skills', 'mine'))
  writeFileSync(join(janHome, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n')
  const pluginManager = { listBundles: async () => [{ name: '@janhq/jan-base', enabled: true, installed: false, availability: 'installation' }] }
  const state = await customizationState({ settings: settingsWith({ fetch: {} }), janHome, pluginManager })
  assert.deepEqual(state, { servers: ['fetch'], skills: ['mine'], bundles: { '@janhq/jan-base': { installed: true, enabled: true } }, plugins: true })
})
