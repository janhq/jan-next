import { createDecipheriv, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const salt = 'jan-provider-secrets-v1'
const service = 'jan-providers'
const KEYRING_TIMEOUT_MS = 5_000
const validProvider = provider => typeof provider === 'string' && provider.trim() !== '' && !/[\0\r\n]/.test(provider)
const firstKey = value => Array.isArray(value) ? value.find(key => typeof key === 'string' && key.length > 0) : undefined

async function nativeMachineId() {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      const line = stdout.split('\n').find(row => row.includes('IOPlatformUUID'))
      return line?.split('=').at(-1)?.trim().replace(/^"|"$/g, '') || 'jan-fallback-machine'
    }
    if (process.platform === 'linux') {
      try { return (await readFile('/var/lib/dbus/machine-id', 'utf8')).trim() }
      catch { return (await readFile('/etc/machine-id', 'utf8')).trim() }
    }
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography").MachineGuid'])
      return stdout.trim()
    }
  } catch { /* Rust uses the same fallback when machine-uid fails. */ }
  return 'jan-fallback-machine'
}

async function fallbackMap(folder, machineId) {
  let blob
  try { blob = await readFile(join(folder, 'provider_secrets.enc')) }
  catch (error) { return { map: {}, error: error?.code === 'ENOENT' ? 'missing' : 'unreadable' } }
  if (blob.length < 12 + 16) return { map: {}, error: 'unreadable' }
  try {
    const key = createHash('sha256').update(salt).update(machineId ?? await nativeMachineId()).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
    decipher.setAuthTag(blob.subarray(-16))
    const plain = Buffer.concat([decipher.update(blob.subarray(12, -16)), decipher.final()])
    const map = JSON.parse(plain.toString('utf8'))
    return { map: map && typeof map === 'object' && !Array.isArray(map) ? map : {}, error: null }
  } catch { return { map: {}, error: 'decrypt' } }
}

/** Provider ids Jan holds a key for: index file plus fallback-file entries, OAuth `auth:` entries excluded, sorted, unique. Missing files -> []. */
export async function janKeyNames(folder) {
  try {
    let index = []
    try { index = JSON.parse(await readFile(join(folder, 'provider_secrets.index.json'), 'utf8')) }
    catch { /* The encrypted file may still hold provider keys. */ }
    const { map } = await fallbackMap(folder)
    return [...new Set([...(Array.isArray(index) ? index : []), ...Object.keys(map)]
      .filter(name => validProvider(name) && !name.startsWith('auth:')))].sort()
  } catch { return [] }
}

const windowsSecret = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JanCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
        public uint Flags, Type;
        public IntPtr TargetName, Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes, TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    public static extern void Free(IntPtr credential);
}
'@
$pointer = [IntPtr]::Zero
if (-not [JanCredential]::Read($env:JAN_CREDENTIAL_TARGET, 1, 0, [ref]$pointer)) { exit 1 }
try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][JanCredential+Credential])
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    [Convert]::ToBase64String($bytes)
} finally { [JanCredential]::Free($pointer) }
`

async function keyringValue(provider, platform) {
  if (platform === 'darwin') {
    const { stdout } = await run('security', ['find-generic-password', '-s', service, '-a', provider, '-w'], { timeout: 300_000 })
    return stdout.trimEnd()
  }
  if (platform === 'linux') {
    const { stdout } = await run('secret-tool', ['lookup', 'service', service, 'username', provider], { timeout: KEYRING_TIMEOUT_MS })
    return stdout.trimEnd()
  }
  if (platform === 'win32') {
    const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', windowsSecret], {
      env: { ...process.env, JAN_CREDENTIAL_TARGET: `${provider}.${service}` }, timeout: KEYRING_TIMEOUT_MS,
    })
    return Buffer.from(stdout.trim(), 'base64').toString('utf16le')
  }
  return ''
}

/** The primary key Jan stored for one provider. Never throws.
 * @returns {Promise<{ key: string, source: 'keyring' | 'file' } | { error: string }>}
 */
export async function readJanKey(folder, provider, options = {}) {
  if (!validProvider(provider)) return { error: 'Invalid Jan provider name.' }
  try {
    const { platform = process.platform, machineId } = options ?? {}
    if (platform !== 'none') {
      try {
        const key = firstKey(JSON.parse(await keyringValue(provider, platform)))
        if (key !== undefined) return { key, source: 'keyring' }
      } catch { /* Missing/denied keyring entries fall through to the encrypted file. */ }
    }
    const { map, error } = await fallbackMap(folder, machineId)
    const key = firstKey(Object.hasOwn(map, provider) ? map[provider] : undefined)
    if (key !== undefined) return { key, source: 'file' }
    const reason = error === 'decrypt' ? 'encrypted backup could not be decrypted.' : 'no readable key was found.'
    return { error: `Jan's key for ${provider} could not be read: ${reason}` }
  } catch { return { error: `Jan's key for ${provider} could not be read: no readable key was found.` } }
}
