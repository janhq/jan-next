import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { janKeyNames, readJanKey } from '../jan-secrets.mjs'

const run = promisify(execFile)
const machineId = 'known-test-machine'

async function writeSecrets(folder, entries, id = machineId) {
  const key = createHash('sha256').update('jan-provider-secrets-v1').update(id).digest()
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries)), cipher.final()])
  await writeFile(join(folder, 'provider_secrets.enc'), Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]))
}

async function withFolder(callback) {
  const folder = await mkdtemp(join(tmpdir(), 'jan-secrets-'))
  try { await callback(folder) } finally { await rm(folder, { recursive: true, force: true }) }
}

test('lists indexed provider names without OAuth records, sorted and unique', async () => withFolder(async folder => {
  await writeSecrets(folder, { groq: ['gsk-primary', 'gsk-fallback'], stub: ['test'], 'auth:auth:openai': ['oauth'] })
  await writeFile(join(folder, 'provider_secrets.index.json'), JSON.stringify(['tokamak', 'groq', 'minimax', 'stub', 'groq', 'auth:auth:openai']))
  assert.deepEqual(await janKeyNames(folder), ['groq', 'minimax', 'stub', 'tokamak'])
}))

test('reads primary key from AES-GCM fallback with a supplied machine id', async () => withFolder(async folder => {
  await writeSecrets(folder, { groq: ['', 'gsk-primary', 'gsk-fallback'] })
  assert.deepEqual(await readJanKey(folder, 'groq', { platform: 'none', machineId }), { key: 'gsk-primary', source: 'file' })
  assert.deepEqual(await readJanKey(folder, 'groq', { platform: 'none', machineId: 'wrong-machine' }), { error: "Jan's key for groq could not be read: encrypted backup could not be decrypted." })
}))

test('rejects invalid providers without spawning a keyring process', async () => withFolder(async folder => {
  for (const provider of ['', ' ', 'bad\nname', 'bad\0name']) {
    assert.deepEqual(await readJanKey(folder, provider), { error: 'Invalid Jan provider name.' })
  }
}))

test('missing secret files return no names and a safe error', async () => withFolder(async folder => {
  assert.deepEqual(await janKeyNames(folder), [])
  assert.deepEqual(await readJanKey(folder, 'groq', { platform: 'none', machineId }), { error: "Jan's key for groq could not be read: no readable key was found." })
}))

test('never throws for a null options object and invalid provider', async () => withFolder(async folder => {
  assert.deepEqual(await readJanKey(folder, '', null), { error: 'Invalid Jan provider name.' })
}))

test('includes fallback-only provider names with the native machine id', async t => {
  let id
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      id = stdout.split('\n').find(line => line.includes('IOPlatformUUID'))?.split('=').at(-1)?.trim().replace(/^"|"$/g, '')
    } catch { t.skip('native machine id unavailable'); return }
  } else if (process.platform === 'linux') {
    try { id = (await readFile('/var/lib/dbus/machine-id', 'utf8')).trim() }
    catch { try { id = (await readFile('/etc/machine-id', 'utf8')).trim() } catch { t.skip('native machine id unavailable'); return } }
  } else { t.skip('native machine id not covered here'); return }
  if (!id) { t.skip('native machine id unavailable'); return }
  await withFolder(async folder => {
    await writeSecrets(folder, { 'fallback-only': ['backup-key'], 'auth:auth:openai': ['oauth'] }, id)
    assert.deepEqual(await janKeyNames(folder), ['fallback-only'])
  })
})
