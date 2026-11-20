/** Stage the pinned agent-desktop executables that Desktop computer use runs. */

import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { DesktopBuildPlatform } from './desktop-build-paths.mjs'

/** Executable name under `<resources>/runtime/agent-desktop` for one target platform. */
export function agentDesktopExecutable(platform: DesktopBuildPlatform['platform']): string {
  return platform === 'win32' ? 'agent-desktop.exe' : 'agent-desktop'
}

/**
 * Copy the target's CLI and its colocated helper out of the pinned npm tarball,
 * verifying each against the checksum the tarball ships.
 * @param target - Packaged platform and architecture.
 * @param destination - Directory that becomes `<resources>/runtime/agent-desktop`.
 * @param source - The agent-desktop package's `bin` directory.
 */
export function prepareAgentDesktop(
  { platform, arch }: DesktopBuildPlatform,
  destination: string,
  source = join(dirname(createRequire(import.meta.url).resolve('agent-desktop/package.json')), 'bin'),
): void {
  const suffix = platform === 'win32' ? '.exe' : ''
  const files: Array<[from: string, to: string]> = [[`agent-desktop-${platform}-${arch}${suffix}`, agentDesktopExecutable(platform)]]
  // The CLI only accepts a helper beside itself under its packaged basename.
  if (platform === 'darwin') files.push([`agent-desktop-macos-helper-darwin-${arch}`, 'agent-desktop-macos-helper'])
  if (platform === 'linux') files.push([`agent-desktop-linux-clipboard-owner-linux-${arch}`, 'agent-desktop-linux-clipboard-owner'])
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const [from, to] of files) {
    const bytes = readFileSync(join(source, from))
    const expected = readFileSync(join(source, `${from}.sha256`), 'utf8').trim().split(/\s+/)[0]?.toLowerCase()
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`agent-desktop: ${from} does not match its published checksum`)
    copyFileSync(join(source, from), join(destination, to))
    chmodSync(join(destination, to), 0o755)
  }
}
