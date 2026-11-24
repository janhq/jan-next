import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@janhq/jan-llm'

const streamSimple = vi.hoisted(() => vi.fn())

// A hand-declared route is built by `createProvider` over the protocol table in
// `src/provider.ts`, so the table's lazy api module is the SDK boundary this
// test can observe. A catalog route dispatches through pi-ai's own provider and
// would not see this mock.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { streamSimple.mockReset() })

/** A hand-declared OpenAI-compatible route with one fully described model. */
function gatewayAdapter(extra: { threadCache?: boolean } = {}): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles({
      'local-gateway': {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'local-model', contextWindow: 8192, maxTokens: 1024 }],
        ...extra,
      },
    }),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function drain(adapter: PiAiAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: 'local-gateway',
    model: 'local-model',
    messages: [],
  })) chunks.push(chunk)
  return chunks
}

describe('pi-ai SDK retry boundary', () => {
  it('pins one SDK attempt even when the installed provider currently defaults to zero retries', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    const chunks = await drain(gatewayAdapter())

    expect(streamSimple).toHaveBeenCalledOnce()
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0, apiKey: 'test-key' })
    // pi-ai reports a setup failure as a terminal in-stream error rather than
    // throwing, which the converter turns into the harness error finish.
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'mock SDK boundary' } },
    })
  })

  it('dispatches a hand-declared route to the endpoint and model its configuration describes', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    await drain(gatewayAdapter())

    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: 'local-model',
      provider: 'local-gateway',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1',
      contextWindow: 8192,
      maxTokens: 1024,
    })
  })
})

describe('pi-ai thread cache', () => {
  async function samplingFor(adapter: PiAiAdapter, options: { sessionId?: string; purpose?: string }): Promise<unknown> {
    streamSimple.mockReset()
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })
    // `purpose` keys are declared by their producer packages, which this suite does not load.
    const request: Parameters<PiAiAdapter['stream']>[0] = { provider: 'local-gateway', model: 'local-model', messages: [], ...options } as never
    for await (const _ of adapter.stream(request)) { /* drain */ }
    return (streamSimple.mock.calls[0]?.[2] as { samplingParams?: unknown } | undefined)?.samplingParams
  }

  it('names the Session as the llama.cpp thread in slot 0 and moves auxiliary requests to slot 1 on an opted-in route', async () => {
    const opted = gatewayAdapter({ threadCache: true })
    expect(await samplingFor(opted, { sessionId: 'session-a' })).toEqual({ thread_id: 'session-a', id_slot: 0 })
    // A title or compaction request parks nothing over the Session's saved state and does not
    // queue the Session's own turn behind it in slot 0.
    expect(await samplingFor(opted, { sessionId: 'session-a', purpose: 'session-title' })).toEqual({ id_slot: 1 })
    expect(await samplingFor(opted, {})).toBeUndefined()
    // Other OpenAI-compatible servers may reject unknown fields.
    expect(await samplingFor(gatewayAdapter(), { sessionId: 'session-a' })).toBeUndefined()
  })
})
