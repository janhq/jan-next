import {
  toolSchemas,
  executeTool,
  sandboxStatus,
  threadWorkspaceDelete,
  threadWorkspaceSweep,
  memoryCatalog,
  memoryRead,
  cancelThreadBash,
  type SandboxStatus,
  type ToolImage,
  type ToolSchema,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'

/**
 * The built-in agent tools the desktop can dispatch.
 *
 * `write` and `edit` are included: they can only touch the thread's ephemeral
 * sandbox, which is deleted with the conversation, so `execute_tool` allows them
 * without a prompt. Withholding them while `shell` can write the same files would
 * be a restriction a sibling tool trivially bypasses.
 */
export const AGENT_TOOL_NAMES = new Set([
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
  'shell',
  // One tool for every memory op (view/search/write/edit/delete/move).
  'memory',
  'skill_list',
  'skill_read',
  'skill_write',
  // Renders a local .html/.svg with headless Chrome so the agent can see what
  // it built. Read capability: it writes nothing back.
  'screenshot',
])

/**
 * Whether a recorded tool call ran the shell, for *displaying saved history*
 * only. Turns saved before the tool was renamed carry its old name `bash`; they
 * keep their terminal view and artifacts. Nothing dispatches or allows `bash`:
 * the sets above and below name only `shell`.
 */
export const isRecordedShellCall = (toolName: string): boolean =>
  toolName === 'shell' || toolName === 'bash'

/**
 * The subset the main chat surface advertises and dispatches: the sandboxed
 * shell alone, with no network. Chat is a conversation that occasionally runs a
 * command, not an agent surface.
 */
export const CHAT_AGENT_TOOL_NAMES = new Set(['shell'])

/**
 * Tools that only run under an enforcing OS sandbox. They stay in
 * `AGENT_TOOL_NAMES` -- the desktop still owns dispatching them -- but are held
 * back from the advertised schemas when no backend can confine them.
 */
const SANDBOX_REQUIRED_TOOLS = new Set(['shell'])

let schemaCache: ToolSchema[] | null = null
let statusCache: Promise<SandboxStatus> | null = null

/**
 * The sandbox backend for this machine, fetched once. A failure is treated as
 * "no sandbox", which withholds `shell` rather than offering something that
 * cannot run.
 */
export function getSandboxStatus(): Promise<SandboxStatus> {
  statusCache ??= sandboxStatus()
    .catch((e) => {
      console.warn('[agentTools] Failed to read sandbox status:', messageOf(e))
      return { backend: 'none', enforces: false }
    })
    .then((s) => {
      enforcesNow = s.enforces
      return s
    })
  return statusCache
}

let enforcesNow = false

/**
 * Re-probe the sandbox, dropping both caches. Installing a backend (bubblewrap
 * on Linux) cannot take effect otherwise: `statusCache` is module-level, and
 * leaving `schemaCache` behind would keep `shell` withheld even once a backend
 * enforces.
 */
export function refreshSandboxStatus(): Promise<SandboxStatus> {
  statusCache = null
  schemaCache = null
  return getSandboxStatus()
}

/**
 * Synchronous view of the sandbox, for building the system prompt. `false` until
 * the probe resolves, which is safe: the prompt is assembled after
 * `getAgentToolSchemas`, so by then the answer is known.
 */
export function sandboxEnforces(): boolean {
  return enforcesNow
}

/**
 * Schemas for the advertised subset. Rust's `schema.rs` is the only source, and
 * the sandbox decides whether `shell` is among them.
 */
export async function getAgentToolSchemas(): Promise<ToolSchema[]> {
  if (schemaCache) return schemaCache
  const [all, sandbox] = await Promise.all([toolSchemas(), getSandboxStatus()])
  schemaCache = all.filter(
    (s) =>
      AGENT_TOOL_NAMES.has(s.function.name) &&
      (sandbox.enforces || !SANDBOX_REQUIRED_TOOLS.has(s.function.name))
  )
  return schemaCache
}

export type { ToolImage }

/**
 * Injection cap for the shared memory store. The *store* is unbounded; what
 * every conversation pays for is not: chat's digest carries at most 2 KiB of
 * whole notes. Beyond that, the settings page is the pruning tool.
 */
export const MEMORY_DIGEST_BUDGET = 2048

type MemorySnapshot = { digest: string }

let memoryCache: Promise<MemorySnapshot> | null = null
let digestNow = ''

/**
 * Drop the cached snapshot so the next run/send re-reads the store. Called from
 * every in-app write path (a `memory` tool change, the settings editors, the
 * chat Remember action); an edit made outside the app is picked up on restart.
 */
export function invalidateMemory(): void {
  memoryCache = null
}

async function loadMemorySnapshot(): Promise<MemorySnapshot> {
  const dataFolder = await getServiceHub().app().getJanDataFolder()
  if (!dataFolder) return { digest: '' }
  const newestFirst = (await memoryCatalog(dataFolder)).sort(
    (a, b) => b.mtimeMs - a.mtimeMs
  )

  // The digest is self-contained: whole notes only, newest first, under a
  // strict budget. A note that does not fit is simply absent -- chat has no
  // memory tool to dereference a truncated one with.
  let remaining = MEMORY_DIGEST_BUDGET
  const parts: string[] = []
  for (const entry of newestFirst) {
    if (remaining <= 0) break
    const body = (await memoryRead(dataFolder, entry.name).catch(() => ''))
      .trim()
    if (!body) continue
    const block = `## ${entry.name}\n${body}`
    // The joiner counts too, or the assembled digest could exceed the budget.
    const cost = block.length + (parts.length > 0 ? 2 : 0)
    if (cost > remaining) continue
    parts.push(block)
    remaining -= cost
  }
  return { digest: parts.join('\n\n') }
}

function getMemorySnapshot(): Promise<MemorySnapshot> {
  memoryCache ??= loadMemorySnapshot()
    .catch((e) => {
      console.warn('[agentTools] Failed to load memory:', messageOf(e))
      return { digest: '' }
    })
    .then((snapshot) => {
      digestNow = snapshot.digest
      return snapshot
    })
  return memoryCache
}

/** Ensure the digest is loaded; chat awaits this before building its prompt. */
export async function refreshMemoryDigest(): Promise<string> {
  return (await getMemorySnapshot()).digest
}

/**
 * Synchronous view of the digest, for the sync prompt builder. `''` until
 * `refreshMemoryDigest` resolves, which `sendMessages` awaits first.
 */
export function memoryDigestNow(): string {
  return digestNow
}

type AgentToolResult = {
  content?: unknown
  error?: string
  /** Unified diff from `write`/`edit`. Display-only; never sent to the model. */
  diff?: string
  /** Images the tool returned, for a vision model to see. */
  images?: ToolImage[]
}

const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)

/**
 * Execute one built-in agent tool.
 *
 * The filesystem tools are confined to this thread's own sandbox, so scratch
 * files from one conversation are invisible to the next; memory and skill tools
 * reach the permanent store instead and persist. No project path is passed --
 * the desktop has no project picker yet, so the plugin uses the permanent store
 * in the Jan data folder.
 *
 * `shell` additionally runs under an OS sandbox whose network access is closed
 * (chat never opens it).
 */
export async function executeAgentTool(
  toolName: string,
  input: unknown,
  threadId: string,
  /**
   * A project folder to attach read-only. Rust validates it and refuses one
   * that overlaps the workspace or the Jan data folder, rather than silently
   * dropping it, so an unusable attachment surfaces as a tool error.
   */
  readOnlyProject?: string | null
): Promise<AgentToolResult> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return { error: 'Jan data folder is unavailable' }
    const args =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {}
    const result = await executeTool(
      dataFolder,
      threadId,
      toolName,
      args,
      undefined,
      undefined,
      undefined,
      readOnlyProject ?? undefined
    )
    if (result.isError) return { error: result.content }
    // The store changed, so the recall injections must not keep serving the
    // snapshot taken before this note existed.
    if (toolName === 'memory' && isMemoryChange(args)) invalidateMemory()
    return {
      content: result.content,
      diff: result.diff ?? undefined,
      images: result.images?.length ? result.images : undefined,
    }
  } catch (e) {
    return { error: messageOf(e) }
  }
}

/** Whether a `memory` call changes the store (anything but view/search). */
function isMemoryChange(args: Record<string, unknown>): boolean {
  return args.op !== 'view' && args.op !== 'search'
}

/**
 * Kill every `shell` tree this session started when the user presses Stop.
 * Best-effort: aborting the JS run already unwinds the turn, so a failure here
 * only means a shell keeps running, not user-visible damage.
 */
export async function cancelAgentThreadBash(sessionId: string): Promise<void> {
  try {
    await cancelThreadBash(sessionId)
  } catch (e) {
    console.warn('[agentTools] Failed to cancel session shells:', messageOf(e))
  }
}

/**
 * Delete a thread's sandbox. Best-effort: a failure here leaves a directory
 * behind for the next startup sweep to collect, which is not worth surfacing
 * while the user is deleting a thread.
 */
export async function cleanupThreadWorkspace(threadId: string): Promise<void> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return
    await threadWorkspaceDelete(dataFolder, threadId)
  } catch (e) {
    console.warn(
      `[agentTools] Failed to delete workspace for thread ${threadId}:`,
      messageOf(e)
    )
  }
}

/**
 * Delete sandboxes left behind by threads that no longer exist, returning how
 * many were removed. Best-effort, same reasoning as above.
 */
export async function sweepThreadWorkspaces(
  liveThreadIds: string[]
): Promise<number> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return 0
    return await threadWorkspaceSweep(dataFolder, liveThreadIds)
  } catch (e) {
    console.warn('[agentTools] Failed to sweep thread workspaces:', messageOf(e))
    return 0
  }
}
