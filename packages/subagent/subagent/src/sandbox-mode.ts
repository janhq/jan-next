/** Sandbox-mode comparison shared by delegation admission and tool execution. */
import type { SandboxMode } from '@janhq/jan-sandbox'

const rank: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/**
 * Recognize mode values read from Session JSON or tool arguments.
 * @param value - a recorded or requested mode.
 * @returns Whether the value is a known sandbox mode.
 */
export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === 'string' && Object.hasOwn(rank, value)
}

/**
 * Compare sandbox modes by the file access they grant.
 * @param mode - the mode being checked.
 * @param cap - the maximum allowed mode.
 * @returns Whether the mode grants more than the cap.
 */
export function isWiderSandboxMode(mode: SandboxMode, cap: SandboxMode): boolean {
  return rank[mode] > rank[cap]
}
