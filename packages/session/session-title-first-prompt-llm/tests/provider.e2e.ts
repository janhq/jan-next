import AgentRegistry from '@janhq/jan-agent'
import { createUserMessage } from '@janhq/jan-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import LlmRuntime from '@janhq/jan-llm'
import * as LlmPiAi from '@janhq/jan-llm-pi-ai'
import SessionStore, { SessionId } from '@janhq/jan-session'
import SessionTitleService from '@janhq/jan-session-title'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import * as FirstMessageTitleProvider from '@janhq/jan-session-title-first-prompt-llm'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe.skipIf(!process.env.TOKAMAK_API_KEY)('first-prompt title provider with real Tokamak API', () => {
  it('replaces the fallback with a short model title', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { tokamak: { api: 'openai-completions', baseURL: process.env.TOKAMAK_BASE_URL ?? 'https://api.tokamak.sh/v1', apiKeyEnv: 'TOKAMAK_API_KEY', models: [{ id: 'tokamak-1-preview' }], reasoning: 'off' } } })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 40,
      maxTitleBytes: 80,
    })
    await ctx.plugin(FirstMessageTitleProvider, {
      targetWords: 5,
      targetCjkCharacters: 10,
      maxInputBytes: 4_096,
      maxOutputTokens: 64,
      timeoutMs: 60_000,
      provider: 'tokamak',
      model: 'tokamak-1-preview',
    })
    const session = ctx.sessions.create(SessionId('real-title-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Explain why append-only logs make session titles durable.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const title = await ctx.sessionTitle.refresh(session)

    expect(title).toMatchObject({
      messageSeqs: [message.seq],
      source: {
        kind: 'provider',
        provider: 'session-title-first-prompt-llm',
        model: { provider: 'tokamak', model: 'tokamak-1-preview' },
      },
    })
    expect(title?.title.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(title?.title ?? '', 'utf8')).toBeLessThanOrEqual(80)
  })
})
