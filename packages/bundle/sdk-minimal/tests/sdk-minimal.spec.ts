/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@janhq/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('jan-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      jan?: { bundle?: { patch?: string } }
    }
    expect(manifest.jan?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.jan!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@janhq/jan-sdk-app'],
      ['sdk-jsonrpc-server', '@janhq/jan-sdk-jsonrpc-server'],
      ['llm-pi-ai', '@janhq/jan-llm-pi-ai'],
      ['sandbox', '@janhq/jan-sandbox-local'],
      ['filesystem', '@janhq/jan-fs-local'],
      ['attachment-local', '@janhq/jan-attachment-local'],
      ['tool-fs', '@janhq/jan-tool-fs'],
      ['working-directory', '@janhq/jan-working-directory'],
      ['tool-working-directory', '@janhq/jan-tool-working-directory'],
      ['session-projection', '@janhq/jan-session-projection'],
      ['token-meter', '@janhq/jan-token-meter'],
      ['compaction-basic', '@janhq/jan-compaction-basic'],
      ['image-offload', '@janhq/jan-compaction-image-offload'],
      ['sandbox-policy', '@janhq/jan-sandbox-policy'],
      ['subprocess', '@janhq/jan-subprocess-local'],
      ['pty', '@janhq/jan-terminal'],
      ['terminal-bash', '@janhq/jan-terminal-bash'],
      ['terminal-pwsh', '@janhq/jan-terminal-bash'],
      ['timer', '@janhq/cordis-plugin-timer'],
      ['llm', '@janhq/jan-llm'],
      ['session', '@janhq/jan-session'],
      ['session-title', '@janhq/jan-session-title'],
      ['system-prompt', '@janhq/jan-system-prompt'],
      ['tools', '@janhq/jan-tools'],
      ['tool-executor-native', '@janhq/jan-tool-executor-native'],
      ['mcp-resources', '@janhq/jan-mcp-resources'],
      ['agent', '@janhq/jan-agent'],
      ['llm-retry', '@janhq/jan-llm-retry'],
      ['jobs', '@janhq/jan-jobs-local'],
      ['agent-loop', '@janhq/jan-agent-loop'],
      ['persistent-bash', '@janhq/jan-tool-bash-persistent'],
      ['persistent-pwsh', '@janhq/jan-tool-pwsh-persistent'],
      ['sessions', '@janhq/jan-session-persistence-jsonl'],
      ['session-checkpoint-policy', '@janhq/jan-session-checkpoint-policy'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    const providers = rows.find(row => row.id === 'llm-pi-ai')?.config?.providers as Record<string, Record<string, unknown>>
    expect(Object.keys(providers)).toEqual(['tokamak'])
    expect(providers.tokamak).toMatchObject({
      api: 'openai-completions',
      apiKeyEnv: 'TOKAMAK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.JAN_CONTEXT_WINDOW ?? 200000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(providers.tokamak?.models).toContainEqual({ id: 'tokamak-1-preview' })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.JAN_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'tool-fs')?.config).toEqual({ read: false, readImage: true, write: false, edit: false })
    expect(rows.find(row => row.id === 'compaction-basic')?.config).toBeUndefined()
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
