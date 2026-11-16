/**
 * Whether a model's estimated memory fits this machine, from system RAM and the offload devices
 * the worker lists. The thresholds model driver and operating system overhead measured on real
 * hardware; they describe machines, not deployments.
 */
import type { LlamaCppDevice, ModelFit } from './types.ts'

/** Memory a model can be placed in. */
export interface MachineMemory {
  /** CPU and GPU share one pool (Apple Silicon), so offload devices add no memory. */
  unified: boolean
  /** System memory in bytes. */
  ramBytes: number
  /** Accelerator devices the worker lists; host devices (CPU, BLAS) excluded. */
  devices: readonly LlamaCppDevice[]
}

const MIB = 1024 * 1024

/** Driver and runtime overhead held back from GPU and system memory. */
const RESERVE_BYTES = 2_288_490_189
/** Unified memory: fixed share of the kernel, daemons and the Metal runtime. */
const UNIFIED_FIXED_OVERHEAD = 2_684_354_560
/** Unified memory: share of the pool Metal wires for itself, which grows with the pool. */
const UNIFIED_VARIABLE_OVERHEAD = 0.1
/** Unified memory: a model above this share of the usable pool leaves too little headroom. */
const UNIFIED_COMFORTABLE = 0.85

/** Devices that hold no model layers; the worker lists BLAS next to Metal on macOS. */
const HOST_DEVICES: ReadonlySet<string> = new Set(['cpu', 'blas'])

/** `Vulkan0` → `vulkan`, Metal's `MTL0` → `metal`. */
function backendName(id: string): string {
  const name = id.trim().replace(/\d+$/, '').toLowerCase()
  return name === 'mtl' ? 'metal' : name
}

/**
 * Keep the devices that run model layers.
 * @param devices - devices as the worker lists them.
 * @returns the accelerators, in order.
 */
export function accelerators(devices: readonly LlamaCppDevice[]): LlamaCppDevice[] {
  return devices.filter(device => !HOST_DEVICES.has(backendName(device.id)))
}

/**
 * Name the backend the worker offloads to: the first accelerator's, else `cpu`.
 * @param devices - devices as the worker lists them.
 * @returns e.g. `vulkan`, `cuda`, `metal` or `cpu`.
 */
export function backendOf(devices: readonly LlamaCppDevice[]): string {
  const first = accelerators(devices)[0]
  return first === undefined ? 'cpu' : backendName(first.id)
}

/**
 * Compare a model's memory with the machine's.
 * @param requiredBytes - weights plus, when known, the KV cache.
 * @param machine - the machine's memory.
 * @returns `fits` when it runs entirely on the accelerators (or with headroom in unified memory),
 * `tight` when it needs system memory beside them (or little headroom remains), `too-large` otherwise.
 */
export function assessFit(requiredBytes: number, machine: MachineMemory): ModelFit {
  if (machine.unified) {
    const usable = Math.max(0, machine.ramBytes - UNIFIED_FIXED_OVERHEAD - Math.floor(machine.ramBytes * UNIFIED_VARIABLE_OVERHEAD))
    if (requiredBytes > usable) return 'too-large'
    return requiredBytes <= Math.floor(usable * UNIFIED_COMFORTABLE) ? 'fits' : 'tight'
  }
  const devices = accelerators(machine.devices)
  // Without an accelerator, system memory is the pool layers run in.
  const deviceBytes = devices.length === 0 ? machine.ramBytes : devices.reduce((sum, device) => sum + device.totalMiB * MIB, 0)
  const systemBytes = devices.length === 0 ? 0 : machine.ramBytes
  const usableDevice = Math.max(0, deviceBytes - RESERVE_BYTES)
  const usableTotal = usableDevice + Math.max(0, systemBytes - RESERVE_BYTES)
  if (requiredBytes > usableTotal) return 'too-large'
  return requiredBytes <= usableDevice ? 'fits' : 'tight'
}
