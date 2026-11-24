import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { unzipSync } from 'fflate'
import { extract } from 'tar'

const VERSION = '8.1.2'
const BASE_URL = `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${VERSION}/`
const ASSETS = {
  'darwin-arm64': ['darwin_aarch64.tar.gz', '95d746c8d6cb418a88cb79937ca90194388faa707c30e3ec53e7d41f469cd6ec'],
  'darwin-x64': ['darwin_amd64.tar.gz', '3e4ae8dc26676ada1db8b5f8e95bf097670e7aefb0bf6c3f5a3340c00cb42f0e'],
  'linux-arm64': ['linux_aarch64_no-plugin.tar.gz', '4036e1a0bbcd9ebbbde928bfa0090ee5d85986aada9c7312a8b1e47e4381d1a1'],
  'linux-x64': ['linux_amd64_no-plugin.tar.gz', '0b6906bc869c264855b7ab7ce8cc3ee0d7a0a084e378c81590be43115fa7bd53'],
  'win32-arm64': ['windows_aarch64.zip', '6d47dd274fee7c2f2cdae2d48792ea63ec7939cdd62dcea516e9d4d247efee3d'],
  'win32-x64': ['windows_amd64.zip', 'f7032bfa516350698d5dadcaa305991d0a85d000b9dc7c8c6742071ec7f2f8fc'],
}

/** Install only the verified version's executable, never the archive's ancillary files. */
export async function installBinary(root, signal, progress, {
  fetchAsset = fetch, platform = process.platform, arch = process.arch,
} = {}) {
  const asset = ASSETS[`${platform}-${arch}`]
  if (!asset) throw new Error('unsupported')
  const [suffix, expectedHash] = asset
  const exe = platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api'
  const directory = join(root, `v${VERSION}`)
  const destination = join(directory, exe)
  try {
    if (!(await lstat(destination)).isFile()) throw new Error('Untrusted CLIProxyAPI executable')
    return destination
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(directory, 'install-'))
  try {
    progress(null)
    const response = await fetchAsset(`${BASE_URL}CLIProxyAPI_${VERSION}_${suffix}`, { signal })
    if (!response.ok || !response.body) throw new Error('download')
    const total = Number(response.headers.get('content-length'))
    const archive = join(staging, 'archive')
    const hash = createHash('sha256')
    let bytes = 0
    await pipeline(response.body, new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > 128 * 1024 * 1024) { callback(new Error('download')); return }
      hash.update(chunk)
      if (total > 0) progress(Math.min(99, Math.floor(bytes / total * 100)))
      callback(null, chunk)
    } }), createWriteStream(archive, { mode: 0o600 }), { signal })
    if (hash.digest('hex') !== expectedHash) throw new Error('checksum')
    const candidate = join(staging, exe)
    if (suffix.endsWith('.zip')) {
      const entries = unzipSync(await readFile(archive, { signal }), { filter: entry => entry.name === exe })
      if (!Object.hasOwn(entries, exe)) throw new Error('download')
      await writeFile(candidate, entries[exe], { mode: 0o700, flag: 'wx', signal })
    } else {
      await extract({ cwd: staging, file: archive, strict: true, filter: (path, entry) => path === exe && entry.type === 'File' })
      await chmod(candidate, 0o700)
    }
    signal.throwIfAborted()
    await rename(candidate, destination)
    progress(100)
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
