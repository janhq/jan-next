import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { credentialKey, credentialRef } from '@janhq/jan-credentials'
import { createLaunchEnvironmentSnapshot, JAN_LAUNCH_ENVIRONMENT_KEY } from '@janhq/jan-launch-environment'
import { LocalCredentialProvider } from '../src/index.ts'

type ExecMock = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => { stdin: { end: () => void } }

const { exec, closeStdin, secrets } = vi.hoisted(() => ({
  exec: vi.fn<ExecMock>(), closeStdin: vi.fn<() => void>(), secrets: new Map<string, string>(),
}))
vi.mock('node:child_process', () => ({ execFile: exec }))
vi.mock('../src/keychain.ts', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadKeychain: async () => ({
    read: async (id: string) => secrets.get(id),
    write: async (id: string, value: string) => { secrets.set(id, value) },
    remove: async (id: string) => { secrets.delete(id) },
  }),
}))

const REF = credentialRef('JAN_PASSWORD_MANAGER_TEST')
const ITEM = 'Engineering API'
const ID = '97454717-5445-4cf7-837a-52e74ffcb3d3'
const OP_REFERENCE = 'op://Private/Jan/Provider Keys/api-key'
const trustedPath = process.platform === 'win32' ? join(tmpdir(), `jan-vault-cli-${process.pid}`) : resolve('trusted-launch-bin')
const bw = process.platform === 'win32' ? join(trustedPath, 'bw.exe') : 'bw'
const op = process.platform === 'win32' ? join(trustedPath, 'op.exe') : 'op'

beforeEach(async () => {
  if (process.platform !== 'win32') return
  await mkdir(trustedPath)
  onTestFinished(() => rm(trustedPath, { recursive: true, force: true }))
  await Promise.all(['bw.exe', 'op.exe'].map(name => writeFile(join(trustedPath, name), '')))
})

interface CliResponse { stdout?: string; stderr?: string; error?: Error }
const responses: CliResponse[] = []

beforeEach(() => {
  responses.length = 0
  secrets.clear()
  closeStdin.mockClear()
  exec.mockReset().mockImplementation((_command, _args, _options, callback) => {
    queueMicrotask(() => {
      const { stdout = '', stderr = '', error } = responses.shift() ?? {}
      callback(error ?? null, stdout, stderr)
    })
    return { stdin: { end: closeStdin } }
  })
})

async function fixture(keychain = false, environment: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jan-password-manager-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, '.credentials.yaml')
  const ctx = new Context()
  ctx.provide(JAN_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
    { source: 'process', values: {
      PATH: `${trustedPath}${delimiter}.${delimiter}relative`,
      OP_ACCOUNT: 'organization', OP_CACHE: 'true', OP_DEBUG: 'true', BW_SESSION: 'bw-unlock-session',
      ...environment,
    } },
    { source: 'project-env', values: {
      PATH: resolve(dir, 'project-bin'), OP_CONNECT_HOST: 'https://not-the-user.example', BW_SESSION: 'untrusted',
      NODE_OPTIONS: '--require untrusted', PROJECT_TOKEN: 'not-for-cli',
    } },
  ]))
  const fiber = ctx.plugin(LocalCredentialProvider, { path, keychain, watch: false })
  await fiber
  onTestFinished(() => fiber.dispose())
  return { path, credentials: ctx.credentials }
}

it('resolves a saved 1Password pointer per request, preserving whitespace and never storing output', async () => {
  const { credentials, path } = await fixture()
  await credentials.set(REF, OP_REFERENCE)
  expect((await credentials.describe(REF)).configured).toBe(true)
  expect(await credentials.resolve(REF, { dereference: false })).toEqual({ value: OP_REFERENCE, source: 'file' })
  expect(exec).not.toHaveBeenCalled()
  responses.push({ stdout: ' first secret\n' }, { stdout: ' bw://not-a-recursive-pointer/password\n' })
  expect(await credentials.resolve(REF)).toEqual({ value: ' first secret\n', source: 'file' })
  expect(await credentials.resolve(REF)).toEqual({ value: ' bw://not-a-recursive-pointer/password\n', source: 'file' })
  expect(exec).toHaveBeenCalledTimes(2)
  expect(exec.mock.calls[0]?.slice(0, 2)).toEqual([op, ['read', '--no-newline', OP_REFERENCE]])
  expect(exec.mock.calls[0]?.[2]).toMatchObject({
    shell: false, encoding: 'utf8', maxBuffer: 1024 * 1024, killSignal: 'SIGKILL',
    env: { PATH: trustedPath, OP_ACCOUNT: 'organization', OP_CACHE: 'false', OP_DEBUG: 'false' },
  })
  expect(exec.mock.calls[0]?.[2].env).not.toHaveProperty('BW_SESSION')
  expect(exec.mock.calls[0]?.[2].env).not.toHaveProperty('OP_CONNECT_HOST')
  expect(exec.mock.calls[0]?.[2].env).not.toHaveProperty('NODE_OPTIONS')
  expect(exec.mock.calls[0]?.[2].env).not.toHaveProperty('PROJECT_TOKEN')
  expect(exec.mock.calls[0]?.[2].timeout).toBeLessThanOrEqual(5000)
  expect(closeStdin).toHaveBeenCalledTimes(2)
  const text = await readFile(path, 'utf8')
  expect(text).toContain(OP_REFERENCE)
  expect(text).not.toContain('first secret')
  expect(text).not.toContain('bw://')
})

it('resolves a native Bitwarden reference per request without caching the result', async () => {
  const { credentials, path } = await fixture(true)
  const pointer = 'bw://Engineering%20API/password'
  await credentials.set(REF, pointer)
  expect((await credentials.describe(REF)).configured).toBe(true)
  expect(await credentials.resolve(REF, { dereference: false })).toEqual({ value: pointer, source: 'file' })
  expect(exec).not.toHaveBeenCalled()
  for (const password of [' rotated early ', 'rotated later\n']) {
    responses.push({ stdout: JSON.stringify({ id: ID, name: ITEM, login: { password }, fields: [{ name: 'password', value: 'loses' }] }) })
    expect(await credentials.resolve(REF)).toEqual({ value: password, source: 'file' })
  }
  expect(exec.mock.calls.map(call => call.slice(0, 2))).toEqual([
    [bw, ['--nointeraction', '--raw', 'get', 'item', '--', ITEM]],
    [bw, ['--nointeraction', '--raw', 'get', 'item', '--', ITEM]],
  ])
  expect(exec.mock.calls[0]?.[2].env).toMatchObject({ PATH: trustedPath, BW_SESSION: 'bw-unlock-session' })
  expect(exec.mock.calls[0]?.[2].env).not.toHaveProperty('OP_ACCOUNT')
  expect(await readFile(path, 'utf8')).not.toContain(pointer)
  expect([...secrets.values()]).toEqual([JSON.stringify(pointer)])
})

it.each([
  ['username', ' alice\n'], ['notes', ' keep the whitespace '], ['API%20token', ' custom-value\n'],
])('extracts the exact Bitwarden field %s by item ID', async (field, expected) => {
  const { credentials } = await fixture()
  await credentials.set(REF, `bw://${ID}/${field}`)
  responses.push({ stdout: JSON.stringify({ id: ID, name: ITEM, notes: ' keep the whitespace ', login: { username: ' alice\n' }, fields: [{ name: 'API token', value: ' custom-value\n' }] }) })
  expect(await credentials.resolve(REF)).toEqual({ value: expected, source: 'file' })
})

it('gets a Bitwarden TOTP by the verified item ID instead of returning the seed', async () => {
  const { credentials } = await fixture()
  await credentials.set(REF, `bw://${ITEM}/totp`)
  responses.push({ stdout: JSON.stringify({ id: ID, name: ITEM, login: { totp: 'not-to-be-returned' } }) }, { stdout: '002714' })
  expect(await credentials.resolve(REF)).toEqual({ value: '002714', source: 'file' })
  expect(exec.mock.calls.map(call => call.slice(0, 2))).toEqual([
    [bw, ['--nointeraction', '--raw', 'get', 'item', '--', ITEM]],
    [bw, ['--nointeraction', '--raw', 'get', 'totp', '--', ID]],
  ])
  expect(exec.mock.calls[1]?.[2].timeout).toBeLessThanOrEqual(exec.mock.calls[0]?.[2].timeout ?? 0)
})

it('does not reinterpret ambient fallbacks or opaque records', async () => {
  const { credentials } = await fixture(false, { [REF]: OP_REFERENCE })
  expect(await credentials.resolve(REF)).toEqual({ value: OP_REFERENCE, source: 'env' })
  const key = credentialKey('test', 'grant')
  const grant = { kind: 'grant', payload: { pointer: OP_REFERENCE } } as const
  await credentials.modifyRecord(key, async () => grant)
  expect(await credentials.readRecord(key)).toEqual(grant)
  expect(exec).not.toHaveBeenCalled()
})

it.each([
  [OP_REFERENCE, { error: Object.assign(new Error('secret argv'), { code: 'ENOENT' }) }, 'missing-cli', 'Install the 1Password CLI (`op`) and make sure Jan can find it.'],
  ['bw://item/password', { error: Object.assign(new Error('secret argv'), { code: 'ENOENT' }) }, 'missing-cli', 'Install the Bitwarden CLI (`bw`) and make sure Jan can find it.'],
  [OP_REFERENCE, { error: new Error('secret argv'), stderr: '[ERROR] You are not currently signed in. secret output' }, 'locked', 'Unlock 1Password or sign in to its CLI, then try again.'],
  ['bw://item/password', { error: new Error('secret argv'), stderr: 'Vault is locked.' }, 'locked', 'Unlock Bitwarden and make `BW_SESSION` available to Jan, then try again.'],
  ['bw://item/password', { error: new Error('secret argv'), stderr: '[{"title":"You are not logged in."}]' }, 'locked', 'Unlock Bitwarden and make `BW_SESSION` available to Jan, then try again.'],
  [OP_REFERENCE, { error: new Error('secret argv'), stderr: 'could not find item: secret name' }, 'not-found', 'That item or field was not found in 1Password.'],
  ['bw://item/password', { error: new Error('secret argv'), stderr: 'Not found.' }, 'not-found', 'That item or field was not found in Bitwarden.'],
  ['bw://item/password', { error: new Error('secret argv'), stderr: 'More than one result was found. Try getting a specific object by `id` instead.' }, 'ambiguous', 'More than one Bitwarden item matches. Use the item ID instead.'],
  ['bw://item/password', { stdout: JSON.stringify({ id: ID, name: 'item but longer', login: { password: 'incorrect match' } }) }, 'not-found', 'That item or field was not found in Bitwarden.'],
  [OP_REFERENCE, { error: Object.assign(new Error('secret argv'), { killed: true }) }, 'timeout', 'The 1Password CLI did not answer in time. Try again.'],
  ['bw://item/password', { error: Object.assign(new Error('secret argv'), { killed: true }) }, 'timeout', 'Jan could not read the Bitwarden CLI result. Check your CLI setup and try again.'],
  ['bw://item/password', { stdout: 'invalid JSON with a secret value' }, 'cli-failed', 'Jan could not read the Bitwarden CLI result. Check your CLI setup and try again.'],
  ['bw://item/password', { stdout: JSON.stringify({ id: ID, name: 'item', login: {} }) }, 'not-found', 'That item or field was not found in Bitwarden.'],
] satisfies [string, CliResponse, string, string][])('sanitizes password-manager failures (%s, %j)', async (pointer, response, code, message) => {
  const { credentials } = await fixture()
  await credentials.set(REF, pointer)
  responses.push(response)
  const failure = credentials.resolve(REF)
  await expect(failure).rejects.toMatchObject({ code, message })
  await expect(failure).rejects.not.toHaveProperty('cause')
  expect(await credentials.resolve(REF, { dereference: false })).toEqual({ value: pointer, source: 'file' })
})

it.each(['op://vault/item', 'op://vault//field', 'bw://item/%gg', 'bw://item/password/else', 'bw://item/%00'])('rejects an invalid pointer without spawning a subprocess (%s)', async (pointer) => {
  const { credentials } = await fixture()
  await credentials.set(REF, pointer)
  await expect(credentials.resolve(REF)).rejects.toMatchObject({ code: 'invalid-reference' })
  expect(exec).not.toHaveBeenCalled()
})
