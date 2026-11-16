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
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@janhq/jan-session'
import AgentRegistry from '@janhq/jan-agent'
import type { Agent } from '@janhq/jan-agent'
import TerminalSessionService from '@janhq/jan-terminal'
import * as TerminalLocal from '@janhq/jan-terminal-bash'
import SandboxProvider from '@janhq/jan-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@janhq/jan-sandbox'
import SandboxPolicyService from '@janhq/jan-sandbox-policy'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import LocalSubprocessRuntime from '@janhq/jan-subprocess-local'
import SystemPrompt from '@janhq/jan-system-prompt'
import ToolRuntime from '@janhq/jan-tools'
import * as ToolBashPersistent from '@janhq/jan-tool-bash-persistent'

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

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId('persistent-bash-loader-agent')
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('persistent Bash through a real cordis.yml Loader composition', () => {
  it('preserves cwd and environment across calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'jan-persistent-bash-loader-'))
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
      // The silence tier is pushed beyond the send bound, so no send below can
      // settle as inferred_idle: every case proves the controlled-prompt fast
      // path that the production defaults (3.5s silence) would otherwise mask.
      '    idleSilenceMs: 30000',
      '    handoffGraceMs: 100',
      '    scrollbackLines: 20000',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@janhq/jan-tool-bash-persistent'",
      '  config:',
      '    timeoutMs: 5000',
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
      ['@janhq/jan-tool-bash-persistent', ToolBashPersistent],
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

    const owner = await agent(context, root)
    const signal = new AbortController().signal
    const execute = (id: string, command: string) => executeToolFixture(context!, {
      signal,
      callId: ToolCallId(id),
      name: 'bash',
      arguments: { command },
      agent: owner,
    })

    expect(context.tools.schemas().map(schema => schema.name)).toEqual(['bash'])
    await execute('state', 'export KEEP=loader; mkdir -p nested; cd nested')
    const observed = text(await execute('observe', 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"'))
    expect(observed).toContain(`cwd=${join(root, 'nested')} keep=loader`)
    expect(observed).not.toContain('JAN_PERSISTENT_BASH')

    const multiline = text(await execute(
      'multiline',
      'value="line one"\nprintf "%s:%s\\n" "$value" "it\'s fine"',
    ))
    expect(multiline).toBe("line one:it's fine\n[Command finished with exit code 0]")
    expect(multiline).not.toContain('JAN_PERSISTENT_BASH')

    const heredoc = text(await execute(
      'heredoc',
      "cat <<'EOF'\nalpha\nbeta\nEOF",
    ))
    expect(heredoc).toBe('alpha\nbeta\n[Command finished with exit code 0]')

    // Interactive bash applies history expansion to typed input before parsing;
    // it must neither rewrite `!` sequences nor drop the whole wrapper line.
    const history = text(await execute(
      'history-expansion',
      "echo '<!doctype html>' > page.html; cat page.html; echo 'it'; echo hi!!",
    ))
    expect(history).toBe('<!doctype html>\nit\nhi!!\n[Command finished with exit code 0]')

    const pipeline = text(await execute(
      'pipeline',
      '{ sleep 0.1; printf "delayed\\n"; } | cat',
    ))
    expect(pipeline).toBe('delayed\n[Command finished with exit code 0]')

    // Every trailing newline is dropped before the status trailer.
    const trailing = text(await execute('trailing-newlines', 'printf "tail\\n\\n\\n"'))
    expect(trailing).toBe('tail\n[Command finished with exit code 0]')
    expect(text(await execute('nonzero', 'exit_code() { return 3; }; exit_code')))
      .toBe('[Command finished with exit code 3]')

    const large = text(await execute('large-output', 'seq 1 12050'))
    expect(large.startsWith('1\n2\n3\n')).toBe(true)
    expect(large).toContain('<response clipped>')
    expect(large).not.toContain('beginning of this command output was dropped')

    // `exec` replaces the wrapper before its end marker prints; the seam's
    // stdin_read readiness is what returns the replacement shell's prompt
    // instead of spinning until the tool deadline.
    const execed = text(await execute('exec-replacement', 'exec bash --noprofile --norc -i'))
    expect(execed).toBe('jan> ')

    const exited = text(await execute('exit', 'exit'))
    expect(exited).toContain('next bash call starts from the workspace')
    expect(text(await execute('after-exit', 'printf "%s\\n" "$PWD"'))).toBe(`${root}\n[Command finished with exit code 0]`)
  }, 20_000)
})
