import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { parseFactoryResetRequest, performFactoryReset } from '../src/factory-reset.ts'

/** A populated installation: Jan home, desktop profile, userData, and a workspace folder beside them. */
function installation() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-factory-reset-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const janHome = join(root, 'home')
  const profile = join(janHome, 'profiles', 'desktop')
  const userData = join(root, 'user-data')
  const desktopLogs = join(root, 'desktop-logs')
  const files = {
    chat: join(janHome, 'sessions', 'workspace', 'session.jsonl'),
    attachment: join(janHome, 'attachments', 'v1', 'image.png'),
    slot: join(janHome, 'llama-cpp', 'slots', 'thread.kv'),
    model: join(janHome, 'llama-cpp', 'models', 'model.gguf'),
    patch: join(profile, 'cordis.patch.yml'),
    profileRoot: join(profile, 'cordis.yml'),
    manifest: join(profile, 'package.json'),
    plugin: join(profile, 'node_modules', 'plugin', 'index.js'),
    credentials: join(janHome, '.credentials.yaml'),
    pairedDevices: join(janHome, 'hosts', 'devices.json'),
    connections: join(janHome, 'hosts', 'connections.json'),
    skill: join(janHome, 'skills', 'mine', 'SKILL.md'),
    log: join(janHome, 'logs', 'jan.log'),
    desktopLog: join(desktopLogs, 'crash.log'),
    zoom: join(userData, 'desktop', 'zoom-level'),
    keybindings: join(userData, 'keybindings.json'),
    agents: join(janHome, 'AGENTS.md'),
    workspace: join(root, 'workspace', 'notes.md'),
  }
  for (const file of Object.values(files)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x')
  }
  return { roots: { janHome, profile, userData, desktopLogs }, files }
}

it('removes only the chosen data and never the workspace or the profile root', async () => {
  const { roots, files } = installation()
  const resetCredentials = vi.fn(async () => {})
  await performFactoryReset(parseFactoryResetRequest(['settings', 'chats']), roots, async () => {}, resetCredentials)
  expect(resetCredentials).not.toHaveBeenCalled()
  const left = Object.entries(files).filter(([, path]) => existsSync(path)).map(([name]) => name)
  expect(left.sort()).toEqual([
    'agents', 'connections', 'credentials', 'desktopLog', 'log', 'manifest', 'model', 'pairedDevices', 'plugin', 'profileRoot', 'skill', 'workspace',
  ])
})

it('resets everything on the list while the workspace and the profile root stay', async () => {
  const { roots, files } = installation()
  await performFactoryReset(parseFactoryResetRequest(['logs', 'skills', 'credentials', 'plugins', 'settings', 'chats']), roots,
    async () => {}, () => rm(files.credentials))
  const left = Object.entries(files).filter(([, path]) => existsSync(path)).map(([name]) => name)
  expect(left.sort()).toEqual(['agents', 'connections', 'model', 'profileRoot', 'workspace'])
})

it('removes CLI Proxy subscription sign-ins without removing the installed binary', async () => {
  const { roots } = installation()
  const authDir = join(roots.janHome, 'cli-proxy', 'auth')
  const binary = join(roots.janHome, 'cli-proxy', 'v8.1.2', 'cli-proxy-api')
  mkdirSync(authDir, { recursive: true })
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(join(authDir, 'account.json'), '{}')
  writeFileSync(binary, 'proxy')
  await performFactoryReset(['settings'], roots, async () => {}, async () => {})
  expect(existsSync(authDir)).toBe(true)

  const result = await performFactoryReset(['credentials'], roots, async () => {}, async () => {})
  expect(result.completed).toEqual(['credentials'])
  expect(existsSync(authDir)).toBe(false)
  expect(existsSync(binary)).toBe(true)
})

it('preserves the credentials index and reports an incomplete reset when keychain cleanup fails', async () => {
  const { roots, files } = installation()
  const error = new Error('Cannot read keychain')
  const result = await performFactoryReset(['credentials', 'logs'], roots, async () => {}, async () => { throw error })
  expect(result.completed).toEqual(['logs'])
  expect(result.incomplete.get('credentials')).toEqual([error])
  expect(existsSync(files.credentials)).toBe(true)
  expect(existsSync(files.pairedDevices)).toBe(false)
})

it('rejects an empty or unknown selection before anything is removed', () => {
  expect(() => parseFactoryResetRequest([])).toThrow()
  expect(() => parseFactoryResetRequest(['chats', 'workspace'])).toThrow()
  expect(() => parseFactoryResetRequest('chats')).toThrow()
  expect(parseFactoryResetRequest(['logs', 'chats', 'logs'])).toEqual(['chats', 'logs'])
})

it('removes the scoped settings document only when Settings is reset', async () => {
  const { roots } = installation()
  const scoped = join(roots.janHome, 'settings', 'scoped.json')
  mkdirSync(dirname(scoped), { recursive: true })
  writeFileSync(scoped, JSON.stringify({ version: 1, global: { toolsDisabled: ['bash'] }, projects: {}, sessions: {} }))
  await performFactoryReset(['chats'], roots, async () => {}, async () => {})
  expect(existsSync(scoped)).toBe(true)

  const result = await performFactoryReset(['settings'], roots, async () => {}, async () => {})
  expect(result.completed).toEqual(['settings'])
  expect(existsSync(scoped)).toBe(false)
})
