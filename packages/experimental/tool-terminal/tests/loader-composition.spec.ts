import { executeToolFixture } from '@janhq/jan-tool-testkit'
import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { unsupportedModel, provideWorkingDirectoryFixture, unsupportedInbox } from '@janhq/jan-agent-loop-testkit'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import { ToolCallId } from '@janhq/jan-llm'
import { Session, SessionId } from '@janhq/jan-session'
import AgentRegistry from '@janhq/jan-agent'
import type { Agent } from '@janhq/jan-agent'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime from '@janhq/jan-tools'
import TerminalSessionService from '@janhq/jan-terminal'
import SandboxProvider from '@janhq/jan-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@janhq/jan-sandbox'
import SandboxPolicyService from '@janhq/jan-sandbox-policy'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import LocalSubprocessRuntime from '@janhq/jan-subprocess-local'
import * as TerminalLocal from '@janhq/jan-terminal-bash'
import * as ToolPty from '@janhq/jan-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  async confine(argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'jan-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@janhq/jan-agent'",
      "- name: '@janhq/jan-system-prompt'",
      "- name: '@janhq/jan-tools'",
      "- name: '@janhq/jan-tool-executor-native'",
      "- name: '@janhq/jan-terminal'",
      "- name: '@janhq/jan-test-sandbox'",
      "- name: '@janhq/jan-session-projection'",
      "- name: '@janhq/jan-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@janhq/jan-subprocess-local'",
      "- name: '@janhq/jan-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@janhq/jan-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()

    provideWorkingDirectoryFixture(context)
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@janhq/jan-agent', AgentRegistry],
      ['@janhq/jan-system-prompt', SystemPrompt],
      ['@janhq/jan-tools', ToolRuntime],
      ['@janhq/jan-tool-executor-native', NativeToolExecutor],
      ['@janhq/jan-terminal', TerminalSessionService],
      ['@janhq/jan-test-sandbox', PassthroughSandbox],
      ['@janhq/jan-session-projection', SessionProjectionRegistry],
      ['@janhq/jan-sandbox-policy', SandboxPolicyService],
      ['@janhq/jan-subprocess-local', LocalSubprocessRuntime],
      ['@janhq/jan-terminal-bash', TerminalLocal],
      ['@janhq/jan-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = await agent(context)
    const signal = new AbortController().signal
    const spawn = await executeToolFixture(context, {
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await executeToolFixture(context, {
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await executeToolFixture(context, {
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
