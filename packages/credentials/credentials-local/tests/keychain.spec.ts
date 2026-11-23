import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@janhq/jan-credentials'
import type { CredentialRecord } from '@janhq/jan-credentials'
import { createLaunchEnvironmentSnapshot, JAN_LAUNCH_ENVIRONMENT_KEY } from '@janhq/jan-launch-environment'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import { LocalCredentialProvider, resetCredentialDocument } from '../src/index.ts'
import { loadKeychain } from '../src/keychain.ts'

const native = vi.hoisted(() => ({
  entries: new Map<string, Uint8Array>(),
  get: vi.fn<(address: string) => Promise<number[] | null>>(),
  set: vi.fn<(address: string, bytes: Uint8Array) => Promise<void>>(),
  remove: vi.fn<(address: string) => Promise<boolean>>(),
}))

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    private readonly address: string
    constructor(service: string, id: string, options: unknown) {
      expect(options).toEqual({ linux: { store: 'secret-service' } })
      this.address = `${service}/${id}`
    }
    getSecret() { return native.get(this.address) }
    setSecret(bytes: Uint8Array) { return native.set(this.address, bytes) }
    deleteCredential() { return native.remove(this.address) }
  },
}))
vi.mock('@janhq/jan-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<{ writeFileAtomic: typeof writeFileAtomic }>()
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) }
})

const REF = credentialRef('JAN_VAULT_TEST')
const OTHER = credentialRef('JAN_VAULT_OTHER')
const API_KEY = credentialKey('models', 'provider')
const GRANT = credentialKey('models', 'oauth')
const inaccessible = 'Jan could not read this saved credential from the OS keychain. Unlock it or save the credential again.'

beforeEach(() => {
  native.entries.clear()
  native.get.mockReset().mockImplementation(async (address: string) => {
    const value = native.entries.get(address)
    return value === undefined ? null : [...value]
  })
  native.set.mockReset().mockImplementation(async (address: string, bytes: Uint8Array) => {
    if (process.platform === 'win32' && bytes.length > 2560) throw new Error('Credential Manager limit')
    native.entries.set(address, bytes.slice())
  })
  native.remove.mockReset().mockImplementation(async (address: string) => native.entries.delete(address))
})

afterEach(() => vi.unstubAllGlobals())

async function documentPath() {
  const dir = await mkdtemp(join(tmpdir(), 'jan-native-credentials-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return join(dir, '.credentials.yaml')
}

async function boot(path: string, keychain = true, watch = false) {
  const ctx = new Context()
  ctx.provide(JAN_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
    { source: 'process', values: { [REF]: 'ambient-account' } },
  ]))
  const fiber = ctx.plugin(LocalCredentialProvider, { path, keychain, watch, debounceMs: 10 })
  await fiber
  onTestFinished(() => fiber.dispose())
  return { ctx, credentials: ctx.credentials, dispose: () => fiber.dispose() }
}

it('keeps only markers on disk and reads complete native values from a fresh provider with writes off', async () => {
  const path = await documentPath()
  const first = await boot(path)
  const apiKey = { kind: 'api-key', key: 'secret-key', env: { REGION: 'secret-region' } } as const
  const grant = { kind: 'grant', payload: { token: 'secret-token', expires: 1000 } } as const
  const updated = vi.fn()
  const recordUpdated = vi.fn()
  first.ctx.on('credentials/reference-updated', updated)
  first.ctx.on('credentials/record-updated', recordUpdated)
  expect(native.get).not.toHaveBeenCalled()
  expect(native.set).not.toHaveBeenCalled()
  await first.credentials.set(REF, 'secret-ref')
  await first.credentials.modifyRecord(API_KEY, async () => apiKey)
  await first.credentials.modifyRecord(GRANT, async () => grant)
  expect(updated).toHaveBeenCalledExactlyOnceWith(REF)
  expect(recordUpdated.mock.calls).toEqual([[API_KEY], [GRANT]])
  const text = await readFile(path, 'utf8')
  expect(text).not.toContain('secret-')
  expect(text.match(/keychain:/g)).toHaveLength(3)
  await first.dispose()

  const fresh = await boot(path, false)
  expect(await fresh.credentials.describe(REF)).toEqual({ source: 'file', configured: true, writable: true })
  expect(await fresh.credentials.describeRecord(GRANT)).toEqual({ kind: 'grant', configured: true, writable: true })
  expect(await fresh.credentials.listRecords()).toEqual([{ key: API_KEY, kind: 'api-key' }, { key: GRANT, kind: 'grant' }])
  expect(native.get).not.toHaveBeenCalled()
  expect(await fresh.credentials.resolve(REF)).toEqual({ source: 'file', value: 'secret-ref' })
  expect(await fresh.credentials.readRecord(API_KEY)).toEqual(apiKey)
  expect(await fresh.credentials.readRecord(GRANT)).toEqual(grant)
  await fresh.credentials.unset(REF)
  await fresh.credentials.deleteRecord(GRANT)
  await fresh.credentials.deleteRecord(API_KEY)
  expect(native.entries.size).toBe(0)
})

it('migrates only the rewritten plaintext key and leaves no-op mutations untouched', async () => {
  const path = await documentPath()
  const text = `version: 1\nrefs:\n  ${REF}: before\n  ${OTHER}: untouched\nrecords:\n  ${GRANT}: { kind: grant, payload: 1 }\n`
  await writeFile(path, text, { mode: 0o600 })
  const { credentials } = await boot(path)
  expect((await credentials.resolve(REF))?.value).toBe('before')
  expect(await credentials.modifyRecord(GRANT, async () => undefined)).toEqual({ kind: 'grant', payload: 1 })
  expect(await readFile(path, 'utf8')).toBe(text)
  expect(native.set).not.toHaveBeenCalled()
  await credentials.set(REF, 'before')
  expect(await readFile(path, 'utf8')).toMatch(/keychain: [a-f\d-]+\n  JAN_VAULT_OTHER: untouched\nrecords:\n  models\/oauth: \{ kind: grant, payload: 1 \}/)
  expect(native.entries.size).toBe(1)
})

it('warns once and continues private-file writes when the keychain cannot accept a new value', async () => {
  const path = await documentPath()
  const { ctx, credentials } = await boot(path)
  await credentials.set(REF, 'past-secret')
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  native.set.mockRejectedValueOnce(new Error('native diagnostic with a secret'))
  await credentials.set(OTHER, 'fallback-plaintext')
  await credentials.modifyRecord(GRANT, async () => ({ kind: 'grant', payload: 'fallback-grant' }))
  expect(native.set).toHaveBeenCalledTimes(2)
  expect(warn).toHaveBeenCalledExactlyOnceWith('The OS keychain is unavailable. Jan will save new credentials in its private file for this run.')
  expect((await credentials.resolve(REF))?.value).toBe('past-secret')
  expect((await readFile(path, 'utf8'))).toContain('fallback-plaintext')
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
})

it('never falls through or presents a missing native entry as an absent grant', async () => {
  const path = await documentPath()
  const { credentials } = await boot(path)
  await credentials.set(REF, 'stored')
  await credentials.modifyRecord(GRANT, async () => ({ kind: 'grant', payload: 'stored' }))
  native.entries.clear()
  await expect(credentials.resolve(REF)).rejects.toThrow(inaccessible)
  await expect(credentials.resolve(REF, { dereference: false })).rejects.toThrow(inaccessible)
  await expect(credentials.readRecord(GRANT)).rejects.toThrow(inaccessible)
  const replace = vi.fn(async () => ({ kind: 'grant', payload: 'replacement' } as const))
  await expect(credentials.modifyRecord(GRANT, replace)).rejects.toThrow(inaccessible)
  expect(replace).not.toHaveBeenCalled()
  await credentials.set(REF, 'recovered')
  expect((await credentials.resolve(REF))?.value).toBe('recovered')
})

it('rolls back the new native secret when the index could not be committed', async () => {
  const path = await documentPath()
  const { ctx, credentials } = await boot(path)
  await credentials.set(REF, 'before')
  const old = await readFile(path, 'utf8')
  const updated = vi.fn()
  ctx.on('credentials/reference-updated', updated)
  vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error('read-only file system'))
  await expect(credentials.set(REF, 'after')).rejects.toThrow('read-only file system')
  expect(await readFile(path, 'utf8')).toBe(old)
  expect((await credentials.resolve(REF))?.value).toBe('before')
  expect(native.entries.size).toBe(1)
  expect(updated).not.toHaveBeenCalled()
})

it('logs failed native cleanup without reviving a removed document entry', async () => {
  const path = await documentPath()
  const { ctx, credentials } = await boot(path)
  await credentials.set(REF, 'stored')
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  native.remove.mockRejectedValueOnce(new Error('native diagnostic with a secret'))
  await credentials.unset(REF)
  expect(warn).toHaveBeenCalledExactlyOnceWith('Jan could not remove a credential entry from the OS keychain.')
  expect(await credentials.resolve(REF)).toEqual({ source: 'env', value: 'ambient-account' })
  expect(await readFile(path, 'utf8')).not.toContain('keychain:')
})

it('reads the authoritative marker after another provider removes a stale generation', async () => {
  const path = await documentPath()
  const writer = await boot(path)
  await writer.credentials.set(REF, 'before')
  await writer.credentials.modifyRecord(GRANT, async () => ({ kind: 'grant', payload: 'before' }))
  const reader = await boot(path)
  await writer.credentials.set(REF, 'after')
  await writer.credentials.modifyRecord(GRANT, async () => ({ kind: 'grant', payload: 'after' }))
  expect((await reader.credentials.resolve(REF))?.value).toBe('after')
  expect(await reader.credentials.readRecord(GRANT)).toEqual({ kind: 'grant', payload: 'after' })
})

it('notifies watchers for changed native generations but not untouched markers', async () => {
  const path = await documentPath()
  const writer = await boot(path)
  await writer.credentials.set(REF, 'before')
  await writer.credentials.set(OTHER, 'unchanged')
  const reader = await boot(path, false, true)
  const updated = vi.fn()
  reader.ctx.on('credentials/reference-updated', updated)
  await writer.credentials.set(REF, 'after')
  await vi.waitFor(() => { expect(updated).toHaveBeenCalledExactlyOnceWith(REF) })
  expect((await reader.credentials.resolve(REF))?.value).toBe('after')
})

it('preserves both increments when different providers modify the same native grant', async () => {
  const path = await documentPath()
  const first = await boot(path)
  const second = await boot(path)
  const increment = async (current: CredentialRecord | undefined) => ({
    kind: 'grant', payload: 1 + (current?.kind === 'grant' ? Number(current.payload) : 0),
  } as const)
  await Promise.all([first.credentials.modifyRecord(GRANT, increment), second.credentials.modifyRecord(GRANT, increment)])
  const { credentials } = await boot(path)
  expect(await credentials.readRecord(GRANT)).toEqual({ kind: 'grant', payload: 2 })
  expect(native.entries.size).toBe(1)
})

it.each([
  'refs:\n  JAN_VAULT_TEST: { keychain: arbitrary }\n',
  'refs:\n  JAN_VAULT_TEST: { keychain: 7879db4b-29ba-481c-9bfc-5ef66454f6d2, extra: 1 }\n',
  'records:\n  models/oauth: { kind: grant, keychain: 7879db4b-29ba-481c-9bfc-5ef66454f6d2, payload: 1 }\n',
])('rejects malformed storage markers without native I/O', async (body) => {
  const path = await documentPath()
  await writeFile(path, `version: 1\n${body}`, { mode: 0o600 })
  const ctx = new Context()
  await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false })).rejects.toThrow(/invalid OS keychain marker/)
  expect(native.get).not.toHaveBeenCalled()
})

it('keeps the index after a reset cleanup failure and can retry', async () => {
  const path = await documentPath()
  const { credentials, dispose } = await boot(path)
  await credentials.set(REF, 'stored')
  await credentials.modifyRecord(GRANT, async () => ({ kind: 'grant', payload: 'stored' }))
  await dispose()
  const text = await readFile(path, 'utf8')
  native.remove.mockRejectedValueOnce(new Error('native diagnostic with a secret'))
  await expect(resetCredentialDocument(path)).rejects.toThrow('Jan could not remove a credential entry from the OS keychain.')
  expect(await readFile(path, 'utf8')).toBe(text)
  await resetCredentialDocument(path)
  await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(native.entries.size).toBe(0)
})

it('round-trips a large OAuth grant within Windows byte limits and cleans up every chunk', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  onTestFinished(() => { if (descriptor !== undefined) Object.defineProperty(process, 'platform', descriptor) })
  const backend = await loadKeychain('scratch')
  const payload = JSON.stringify({ access: createHash('sha256').update('test').digest('hex').repeat(48), refresh: '鍵🔒'.repeat(500) })
  await backend.write('id', payload)
  expect(native.entries.size).toBeGreaterThan(2)
  expect(await backend.read('id')).toBe(payload)
  await backend.remove('id')
  expect(native.entries.size).toBe(0)
})
