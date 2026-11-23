import { createHash } from 'node:crypto'
import { dirname, basename, join } from 'node:path'
import { canonicalizeWatchPath } from '@janhq/jan-home-paths'

export interface KeychainBackend {
  read(entry: string): Promise<string | undefined>
  write(entry: string, value: string): Promise<void>
  remove(entry: string): Promise<void>
}

export const KEYCHAIN_ENTRY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const KEYCHAIN_REMOVE_FAILURE = 'Jan could not remove a credential entry from the OS keychain.'

// Credential Manager's limit for each binary credential blob, not UTF-16 characters.
const WINDOWS_BLOB_BYTES = 2560
const WINDOWS_MAX_PARTS = 65535
const INLINE = 0
const MANIFEST = 1

/** Scope entries to one document, including isolated Jan homes. */
export async function keychainService(filename: string): Promise<string> {
  // The atomic writer replaces the final file (including symlinks) rather than
  // writing through it. Only canonicalize the directory portion of its target.
  const canonical = join(await canonicalizeWatchPath(dirname(filename)), basename(filename))
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  return `ai.jan.credentials.${createHash('sha256').update(identity).digest('hex')}`
}

/** Open a native adapter without probing or touching an entry. */
export async function loadKeychain(service: string): Promise<KeychainBackend> {
  // Loading this platform-specific addon may fail; file-only profiles never need it.
  const { AsyncEntry } = await import('@napi-rs/keyring')
  const entry = (id: string) => new AsyncEntry(service, id, { linux: { store: 'secret-service' } })
  const read = async (id: string) => {
    const bytes = await entry(id).getSecret()
    return bytes === null ? undefined : Buffer.from(bytes)
  }
  const write = async (id: string, bytes: Uint8Array) => { await entry(id).setSecret(bytes) }
  const remove = async (id: string) => { await entry(id).deleteCredential() }
  if (process.platform !== 'win32') return {
    read: async id => (await read(id))?.toString('utf8'),
    write: (id, value) => write(id, Buffer.from(value, 'utf8')),
    remove,
  }

  const partId = (id: string, index: number) => `${id}.${index}`
  const partCount = (bytes: Buffer): number => {
    if (bytes[0] === MANIFEST && bytes.length === 3 && bytes.readUInt16LE(1) > 0) return bytes.readUInt16LE(1)
    throw new Error('Invalid Windows credential manifest.')
  }
  return {
    async read(id) {
      const root = await read(id)
      if (root === undefined) return undefined
      if (root[0] === INLINE) return root.toString('utf8', 1)
      const count = partCount(root)
      const parts: Buffer[] = []
      for (let i = 0; i < count; i++) {
        const part = await read(partId(id, i))
        if (part === undefined) return undefined
        parts.push(part)
      }
      return Buffer.concat(parts).toString('utf8')
    },
    async write(id, value) {
      const bytes = Buffer.from(value, 'utf8')
      if (bytes.length < WINDOWS_BLOB_BYTES) {
        const root = Buffer.allocUnsafe(bytes.length + 1)
        root[0] = INLINE
        bytes.copy(root, 1)
        await write(id, root)
        return
      }
      const count = Math.ceil(bytes.length / WINDOWS_BLOB_BYTES)
      if (count > WINDOWS_MAX_PARTS) throw new Error('Windows credential exceeds the chunk limit.')
      const root = Buffer.allocUnsafe(3)
      root[0] = MANIFEST
      root.writeUInt16LE(count, 1)
      let index = 0
      try {
        for (; index < count; index++) {
          await write(partId(id, index), bytes.subarray(index * WINDOWS_BLOB_BYTES, (index + 1) * WINDOWS_BLOB_BYTES))
        }
        await write(id, root)
      } catch (error) {
        // No YAML points here yet. Clean up every attempted part (including a
        // possible partial write) before the provider falls back to its file.
        for (let i = 0; i <= index && i < count; i++) await remove(partId(id, i)).catch(() => undefined)
        throw error
      }
    },
    async remove(id) {
      const root = await read(id)
      if (root === undefined) return
      if (root[0] !== INLINE) {
        const count = partCount(root)
        // Keep the manifest until all parts are gone so a failed reset can retry.
        for (let i = 0; i < count; i++) await remove(partId(id, i))
      }
      await remove(id)
    },
  }
}
