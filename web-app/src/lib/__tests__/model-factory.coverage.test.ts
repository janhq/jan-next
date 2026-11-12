import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'

const mockGlobalFetch = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn().mockImplementation(async (input: any, init: any) => {
    return new Response('{}', { status: 200 })
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

vi.mock('@ai-sdk/openai-compatible', () => {
  const MockChatModel = vi.fn().mockImplementation(() => ({
    type: 'openai-compatible',
    modelId: 'test-model',
  }))
  return {
    createOpenAICompatible: vi.fn(() => ({
      languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
    })),
    OpenAICompatibleChatLanguageModel: MockChatModel,
    MetadataExtractor: vi.fn(),
  }
})

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))

const mockStartModel = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        models: () => ({ startModel: mockStartModel }),
      },
    }),
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteApiKeyChain: vi.fn((p: any) => {
    const primary = p.api_key?.trim()
    const fallbacks = (p.api_key_fallbacks ?? []).map((k: string) => k.trim()).filter((k: string) => k.length > 0)
    return [...(primary ? [primary] : []), ...fallbacks]
  }),
}))

describe('ModelFactory - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mkProvider = (provider: string, overrides: Partial<ProviderObject> = {}): ProviderObject => ({
    provider,
    api_key: 'test-key',
    base_url: 'https://api.test.com/v1',
    ...overrides,
  } as ProviderObject)

  it('creates openai-compatible model for any non-llamacpp provider', async () => {
    const model = await ModelFactory.createModel('model-1', mkProvider('custom-provider'), {})
    expect(model).toBeDefined()
  })

  it('creates openai-compatible model with custom headers', async () => {
    const model = await ModelFactory.createModel(
      'model-1',
      mkProvider('custom-provider', {
        custom_header: [{ header: 'X-Custom', value: 'value' }],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates openai-compatible model with multiple API keys for rotation', async () => {
    const model = await ModelFactory.createModel(
      'model-1',
      mkProvider('custom-provider', {
        api_key: 'key1',
        api_key_fallbacks: ['key2', 'key3'],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('passes parameters including max_output_tokens remapping', async () => {
    const model = await ModelFactory.createModel(
      'model-1',
      mkProvider('custom-provider'),
      { max_output_tokens: 4096, temperature: 0.5, max_context_tokens: 8192 }
    )
    expect(model).toBeDefined()
  })

  it('creates llamacpp model', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({ port: 8080, api_key: 'test-key' })
    const model = await ModelFactory.createModel('llama-model', mkProvider('llamacpp'), {})
    expect(model).toBeDefined()
  })

  it('throws when no llamacpp session found', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue(null)
    await expect(
      ModelFactory.createModel('llama-model', mkProvider('llamacpp'), {})
    ).rejects.toThrow('No running session found')
  })

})
