/** Gate the staged jan-llama-worker directory that desktop packaging copies to `<resources>/llama-worker`. */

import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory `pnpm run stage:llama-worker` writes and CI extracts the worker artifact into. */
export const LLAMA_WORKER_STAGE = fileURLToPath(new URL('../../../native/llama-worker/dist', import.meta.url))

const ELF_MACHINES = new Map([[0x3e, 'x64'], [0xb7, 'arm64']])
const MACH_O_CPU_TYPES = new Map([[0x01000007, 'x64'], [0x0100000c, 'arm64']])
const PE_MACHINES = new Map([[0x8664, 'x64'], [0xaa64, 'arm64']])

function readAt(descriptor, position, length) {
  const bytes = Buffer.alloc(length)
  return bytes.subarray(0, readSync(descriptor, bytes, 0, length, position))
}

/**
 * Read the platform and CPU architectures an ELF, Mach-O (thin or universal) or PE executable targets.
 * @param {string} path - Executable to inspect.
 * @returns {{ platform: NodeJS.Platform, archs: string[] } | undefined} The platform its format runs on and its Node architecture names, omitting unknown machine types; undefined for any other file.
 */
export function executableTarget(path) {
  const descriptor = openSync(path, 'r')
  const known = (machines, ...machine) => machine.map(value => machines.get(value)).filter(arch => arch !== undefined)
  try {
    const header = readAt(descriptor, 0, 64)
    if (header.length >= 20 && header.readUInt32BE(0) === 0x7f454c46) {
      return { platform: 'linux', archs: known(ELF_MACHINES, header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18)) }
    }
    if (header.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf) {
      return { platform: 'darwin', archs: known(MACH_O_CPU_TYPES, header.readUInt32LE(4)) }
    }
    if (header.length >= 8 && header.readUInt32BE(0) === 0xcafebabe) {
      const slices = readAt(descriptor, 8, 20 * header.readUInt32BE(4))
      const cpuTypes = []
      for (let offset = 0; offset + 4 <= slices.length; offset += 20) cpuTypes.push(slices.readUInt32BE(offset))
      return { platform: 'darwin', archs: known(MACH_O_CPU_TYPES, ...cpuTypes) }
    }
    if (header.length >= 64 && header.readUInt16LE(0) === 0x5a4d) {
      const pe = readAt(descriptor, header.readUInt32LE(0x3c), 6)
      if (pe.length === 6 && pe.readUInt32LE(0) === 0x4550) return { platform: 'win32', archs: known(PE_MACHINES, pe.readUInt16LE(4)) }
    }
    return undefined
  } finally { closeSync(descriptor) }
}

/**
 * Reject packaging when the staged worker is absent or built for another platform or architecture; electron-builder only warns about a missing resource.
 * @param {NodeJS.Platform} platform - Packaged platform, which selects the executable name.
 * @param {string} arch - Packaged Node architecture, such as `x64` or `arm64`.
 * @param {string} stage - Staged worker directory.
 * @returns {void}
 */
export function assertStagedLlamaWorker(platform, arch, stage = LLAMA_WORKER_STAGE) {
  const executable = join(stage, platform === 'win32' ? 'jan-llama-worker.exe' : 'jan-llama-worker')
  if (!existsSync(executable)) {
    throw new Error(`desktop package: ${executable} is missing; run \`pnpm run stage:llama-worker\` after \`pnpm run build:llama-worker\`, or set JAN_DESKTOP_OMIT_LLAMA_WORKER=1 to package without local models`)
  }
  const target = executableTarget(executable)
  if (target?.platform !== platform || !target.archs.includes(arch)) {
    const found = target === undefined ? 'no known executable format' : `${target.platform} ${target.archs.join('+') || 'unknown architecture'}`
    throw new Error(`desktop package: ${executable} targets ${found}, not ${platform} ${arch}; stage a worker built for the packaged target`)
  }
}
