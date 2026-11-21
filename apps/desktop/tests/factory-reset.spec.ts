import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { parseFactoryResetRequest, performFactoryReset } from '../src/factory-reset.ts'

/** A populated installation: Jan home, desktop profile, userData, and a workspace folder beside them. */
function installation() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-factory-reset-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const janHome = join(root, 'home')
  const profile = join(janHome, 'profiles', 'desktop')
  const userData = join(root, 'user-data')
  const files = {
    chat: join(janHome, 'sessions', 'workspace', 'session.jsonl'),
    attachment: join(janHome, 'attachments', 'v1', 'image.png'),
    patch: join(profile, 'cordis.patch.yml'),
    profileRoot: join(profile, 'cordis.yml'),
    manifest: join(profile, 'package.json'),
    plugin: join(profile, 'node_modules', 'plugin', 'index.js'),
    credentials: join(janHome, '.credentials.yaml'),
    skill: join(janHome, 'skills', 'mine', 'SKILL.md'),
    log: join(janHome, 'logs', 'jan.log'),
    zoom: join(userData, 'desktop', 'zoom-level'),
    keybindings: join(userData, 'keybindings.json'),
    agents: join(janHome, 'AGENTS.md'),
    workspace: join(root, 'workspace', 'notes.md'),
  }
  for (const file of Object.values(files)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x')
  }
  return { roots: { janHome, profile, userData }, files }
}

it('removes only the chosen data and never the workspace or the profile root', async () => {
  const { roots, files } = installation()
  await performFactoryReset(parseFactoryResetRequest(['settings', 'chats']), roots)
  const left = Object.entries(files).filter(([, path]) => existsSync(path)).map(([name]) => name)
  expect(left.sort()).toEqual(['agents', 'credentials', 'log', 'manifest', 'plugin', 'profileRoot', 'skill', 'workspace'])
})

it('resets everything on the list while the workspace and the profile root stay', async () => {
  const { roots, files } = installation()
  await performFactoryReset(parseFactoryResetRequest(['logs', 'skills', 'credentials', 'plugins', 'settings', 'chats']), roots)
  const left = Object.entries(files).filter(([, path]) => existsSync(path)).map(([name]) => name)
  expect(left.sort()).toEqual(['agents', 'profileRoot', 'workspace'])
})

it('rejects an empty or unknown selection before anything is removed', () => {
  expect(() => parseFactoryResetRequest([])).toThrow()
  expect(() => parseFactoryResetRequest(['chats', 'workspace'])).toThrow()
  expect(() => parseFactoryResetRequest('chats')).toThrow()
  expect(parseFactoryResetRequest(['logs', 'chats', 'logs'])).toEqual(['chats', 'logs'])
})
