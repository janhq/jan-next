import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@janhq/cordis'
import type { Agent } from '@janhq/jan-agent'
import { provideWorkingDirectoryFixture } from '@janhq/jan-agent-loop-testkit'
import { LocalFileSystem } from '@janhq/jan-fs-local'
import { ToolCallId } from '@janhq/jan-llm'
import { bindScopeParent, createScope } from '@janhq/jan-scope'
import SystemPrompt from '@janhq/jan-system-prompt'
import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import * as ToolFs from '@janhq/jan-tool-fs'
import { executeToolFixture } from '@janhq/jan-tool-testkit'
import ToolRuntime from '@janhq/jan-tools'
import { expect, it } from 'vitest'
import * as ChatPolicy from '../chat-policy.mjs'

it('hides local media reads and prevents artifact overwrites only in Chat mode', async () => {
  const ctx = new Context()
  const cwd = await mkdtemp(join(tmpdir(), 'jan-chat-artifacts-'))
  try {
    provideWorkingDirectoryFixture(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(LocalFileSystem, { cwd })
    await ctx.plugin(ToolFs, { read: false, readImage: false, edit: false })
    for (const name of ['edit_image', 'transcribe_audio', 'generate_image']) {
      ctx.tools.register({ name, description: name, parameters: { type: 'object' },
        output: { schema: {}, render: () => [] }, execute: async () => null })
    }
    const presetKey = {}
    const preset = createScope(ctx, presetKey)
    await preset.ctx.plugin(ChatPolicy)
    const chat = { session: { header: { cwd } } } as Agent
    const standard = { session: { header: { cwd } } } as Agent
    bindScopeParent(chat, presetKey)
    for (const name of ['edit_image', 'transcribe_audio']) {
      expect(ctx.tools.get(name, chat)).toBeUndefined()
      expect(ctx.tools.get(name, standard)).toBeDefined()
      const result = await executeToolFixture(ctx, {
        agent: chat, name, arguments: {}, signal: new AbortController().signal,
        callId: ToolCallId(`forbidden-${name}`),
      })
      expect(result).toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })
    }
    expect(ctx.tools.get('generate_image', chat)).toBeDefined()

    let calls = 0
    const write = (agent: Agent, file_path: string, content: string) => executeToolFixture(ctx, {
      agent, name: 'write', arguments: { file_path, content }, signal: new AbortController().signal,
      callId: ToolCallId(`call-${++calls}`),
    })
    await writeFile(join(cwd, 'user.html'), 'User file')
    expect((await write(chat, 'user.html', 'overwrite')).isError).toBe(true)
    expect(await readFile(join(cwd, 'user.html'), 'utf8')).toBe('User file')
    expect((await write(chat, 'artifact.html', 'Created')).isError).toBe(false)
    expect((await write(chat, 'artifact.html', 'overwrite')).isError).toBe(true)
    expect(await readFile(join(cwd, 'artifact.html'), 'utf8')).toBe('Created')
    expect((await write(standard, 'user.html', 'Updated')).isError).toBe(false)
    expect(await readFile(join(cwd, 'user.html'), 'utf8')).toBe('Updated')
  } finally {
    await ctx.fiber.dispose()
    await rm(cwd, { recursive: true, force: true })
  }
})
