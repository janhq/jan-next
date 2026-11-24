// System load for the status bar: CPU, memory and GPU use, read on the Host
// with each system's own tools. Every reader returns null when its source is
// missing, so one unsupported meter never hides the others.
import os from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {{ percent: number, used: number, total: number }} MemoryLoad
 * @typedef {{ percent: number, source: string }} GpuLoad
 * @typedef {{ cpu: number | null, memory: MemoryLoad | null, gpu: GpuLoad | null, process: number, sampledAt: number }} Resources
 * @typedef {(command: string, args: string[], signal: AbortSignal | undefined, window: 'hidden') => Promise<{ stdout: string }>} Runner
 */

/**
 * Busy share of all cores between two `os.cpus()` readings.
 * @param {os.CpuInfo[]} before - earlier reading.
 * @param {os.CpuInfo[]} after - later reading.
 * @returns {number | null} percent from 0 to 100, or null without elapsed time.
 */
export function cpuPercent(before, after) {
  let idle = 0
  let total = 0
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    const start = before[index].times
    const end = after[index].times
    const spent = (end.user - start.user) + (end.nice - start.nice) + (end.sys - start.sys) + (end.irq - start.irq) + (end.idle - start.idle)
    idle += end.idle - start.idle
    total += spent
  }
  return total > 0 ? clampPercent(100 * (1 - idle / total)) : null
}

/**
 * Memory in use on macOS, counted the way Activity Monitor's "Memory Used" is:
 * app memory (anonymous pages that cannot be purged) plus wired plus compressed.
 * @param {string} text - `vm_stat` output.
 * @param {number} total - physical memory in bytes.
 * @returns {MemoryLoad | null} null when the output has no page counts.
 */
export function parseVmStat(text, total) {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1])
  const pages = name => Number(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? Number.NaN)
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor')
  const anonymous = pages('Anonymous pages')
  const purgeable = pages('Pages purgeable')
  const app = Number.isFinite(anonymous) ? anonymous - (Number.isFinite(purgeable) ? purgeable : 0) : pages('Pages active')
  if (!pageSize || ![wired, compressed, app].every(Number.isFinite)) return null
  return memoryLoad((app + wired + compressed) * pageSize, total)
}

/**
 * Memory in use on Linux: everything the kernel cannot hand out without swapping.
 * @param {string} text - `/proc/meminfo` contents.
 * @returns {MemoryLoad | null} null when the file lacks the fields.
 */
export function parseMeminfo(text) {
  const kib = name => Number(text.match(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm'))?.[1] ?? Number.NaN)
  const total = kib('MemTotal')
  const available = kib('MemAvailable')
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0) return null
  return memoryLoad((total - available) * 1024, total * 1024)
}

/**
 * Busiest Apple GPU from the accelerator registry (no administrator rights needed).
 * @param {string} text - `ioreg -r -d 1 -w 0 -c IOAccelerator` output.
 * @returns {number | null} percent, or null when no device reports utilization.
 */
export function parseIoreg(text) {
  const values = [...text.matchAll(/"Device Utilization %"\s*=\s*(\d+)/g)].map(match => Number(match[1]))
  return values.length ? clampPercent(Math.max(...values)) : null
}

/**
 * Busiest NVIDIA GPU.
 * @param {string} text - `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits` output.
 * @returns {number | null} percent, or null when no line is a number.
 */
export function parseNvidiaSmi(text) {
  const values = text.split(/\r?\n/).filter(line => line.trim() !== '').map(line => Number(line.trim()))
  return values.length && values.every(Number.isFinite) ? clampPercent(Math.max(...values)) : null
}

/**
 * Sum of the Windows "GPU Engine" 3D counters, which is what Task Manager shows per GPU.
 * @param {string} text - one number printed by the PowerShell counter query.
 * @returns {number | null} percent, or null when the output is not a number.
 */
export function parseWindowsCounter(text) {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) ? clampPercent(value) : null
}

const WINDOWS_GPU_QUERY = "$s=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples; [math]::Round(($s | Measure-Object -Property CookedValue -Sum).Sum, 1)"

/**
 * Create a sampler that answers every caller from one shared reading at most
 * every `minInterval` milliseconds, so several windows cost one set of reads.
 * @param {{ run: Runner, platform?: NodeJS.Platform, now?: () => number, minInterval?: number, readText?: (path: string) => Promise<string>, listDir?: (path: string) => Promise<string[]> }} options - system boundary.
 * @returns {{ read(): Promise<Resources> }} the sampler.
 */
export function createResourceSampler({
  run, platform = process.platform, now = Date.now, minInterval = 900,
  readText = path => readFile(path, 'utf8'), listDir = path => readdir(path),
}) {
  let previousCpu = os.cpus()
  let last
  let pending
  // A GPU source that failed once (tool missing, counter absent) is not retried every tick.
  const unavailable = new Set()

  async function attempt(source, read) {
    if (unavailable.has(source)) return null
    try {
      const percent = await read()
      if (percent === null) unavailable.add(source)
      return percent === null ? null : { percent, source }
    } catch {
      unavailable.add(source)
      return null
    }
  }

  async function memory() {
    const total = os.totalmem()
    try {
      if (platform === 'darwin') return parseVmStat((await run('vm_stat', [], undefined, 'hidden')).stdout, total)
      if (platform === 'linux') return parseMeminfo(await readText('/proc/meminfo'))
    } catch {
      // Fall through to the portable reading.
    }
    return memoryLoad(total - os.freemem(), total)
  }

  async function amdBusy() {
    const cards = (await listDir('/sys/class/drm')).filter(name => /^card\d+$/.test(name))
    const values = []
    for (const card of cards) {
      const text = await readText(join('/sys/class/drm', card, 'device', 'gpu_busy_percent')).catch(() => '')
      if (text.trim() !== '' && Number.isFinite(Number(text))) values.push(Number(text))
    }
    return values.length ? clampPercent(Math.max(...values)) : null
  }

  async function gpu() {
    if (platform === 'darwin') return attempt('ioreg', async () => parseIoreg((await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], undefined, 'hidden')).stdout))
    const nvidia = await attempt('nvidia-smi', async () => parseNvidiaSmi((await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], undefined, 'hidden')).stdout))
    if (nvidia) return nvidia
    if (platform === 'linux') return attempt('amdgpu', amdBusy)
    if (platform === 'win32') return attempt('gpu-counter', async () => parseWindowsCounter((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_GPU_QUERY], undefined, 'hidden')).stdout))
    return null
  }

  async function sample() {
    const nextCpu = os.cpus()
    const [memoryLoadNow, gpuLoad] = await Promise.all([memory(), gpu()])
    const cpu = cpuPercent(previousCpu, nextCpu)
    previousCpu = nextCpu
    return { cpu, memory: memoryLoadNow, gpu: gpuLoad, process: process.memoryUsage().rss, sampledAt: now() }
  }

  return {
    read() {
      if (last && now() - last.sampledAt < minInterval) return Promise.resolve(last)
      return pending ??= sample().then(result => { last = result; return result }).finally(() => { pending = undefined })
    },
  }
}

function memoryLoad(used, total) {
  return total > 0 ? { percent: clampPercent((100 * used) / total), used, total } : null
}

function clampPercent(value) {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10
}
