/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import type { Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@janhq/jan-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `JAN_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * End a Windows process tree while its root still links the descendants.
 * @param pid - root process id, or `null` before spawn and after exit.
 */
function endProcessTree(pid: number | null): void {
  // Status unchecked: an already-gone tree is the expected case after a clean exit.
  if (pid !== null) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

/**
 * On Windows a launcher such as `npx` runs the server as a grandchild under
 * `cmd.exe`; the SDK ends only the direct child, so the server keeps its ports
 * and the next start of the same server fails. Both SDK teardown paths end the
 * whole tree first: `close()`, and the internal `_dispose()` that reaps the
 * disposable sibling `'auto'` version negotiation spawns from this class
 * before the session transport starts.
 */
class WindowsTreeStdioTransport extends StdioClientTransport {
  /** @param server - stdio launch parameters, as for the SDK transport. */
  constructor(server: StdioServerParameters) {
    super(server)
    const dispose: unknown = Reflect.get(StdioClientTransport.prototype, '_dispose')
    if (typeof dispose === 'function') {
      Object.defineProperty(this, '_dispose', {
        value: async (): Promise<void> => {
          endProcessTree(this.pid)
          await dispose.call(this)
        },
      })
    }
  }

  /** @returns once the SDK closes the transport after the tree ends. */
  override close(): Promise<void> {
    endProcessTree(this.pid)
    return super.close()
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns an unstarted MCP transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio': {
      const Stdio = process.platform === 'win32' ? WindowsTreeStdioTransport : StdioClientTransport
      return new Stdio({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    }
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      )
  }
}
