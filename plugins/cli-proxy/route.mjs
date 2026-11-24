import { InMemoryCredentialStore, defaultProviderAuthContext } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all'
import { LlmError, resolveImageAttachmentAccess } from '@janhq/jan-llm'
import { PiAiAdapter } from '@janhq/jan-llm-pi-ai'

const PROVIDER = 'cli-proxy'
const TITLE = 'Subscriptions (CLIProxyAPI)'
const PROTOCOLS = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-responses': openAIResponsesApi,
  'openai-completions': openAICompletionsApi,
}
const CATALOGS = {
  'antigravity': ['google', 'anthropic'], 'claude': ['anthropic'], 'anthropic': ['anthropic'],
  'codex': ['openai-codex', 'openai'], 'openai': ['openai', 'openai-codex'], 'google': ['google'],
  'gemini': ['google'], 'xai': ['xai'], 'grok': ['xai'], 'kimi': ['kimi-coding', 'moonshotai'],
  'kimi-ai': ['kimi-coding', 'moonshotai'],
}

function protocolFor(owner, id) {
  if (/^claude-/i.test(id)) return 'anthropic-messages'
  if ((owner === 'openai' || owner === 'codex' || !owner) && /^(gpt-|o[1-9](?:-|$))/i.test(id)) return 'openai-responses'
  return 'openai-completions'
}

function modelMetadata(owner, id) {
  const names = Object.hasOwn(CATALOGS, owner) ? CATALOGS[owner] : []
  for (const name of names) {
    const known = getBuiltinModel(name, id)
    if (known) return known
  }
  return undefined
}

/** Build the normal pi-ai model descriptors from a successful proxy listing without guessing image/tool capabilities. */
export function modelProfiles(session, listing) {
  if (!session || !listing.length) return new Map()
  const models = []
  const seen = new Set()
  for (const { id, owned_by: owner } of listing) {
    if (seen.has(id) || /^(gpt-image|dall-e|text-embedding|omni-moderation|grok-imagine|veo-|imagen-)/i.test(id)) continue
    seen.add(id)
    const api = protocolFor(owner, id)
    const known = modelMetadata(owner, id)
    models.push({
      id, api, provider: PROVIDER, name: known?.name ?? id,
      baseUrl: api === 'anthropic-messages' ? session.origin : `${session.origin}/v1`,
      reasoning: known?.reasoning ?? false, input: known?.input ?? ['text'],
      contextWindow: known?.contextWindow ?? 128_000, maxTokens: known?.maxTokens ?? 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })
  }
  if (!models.length) return new Map()
  const protocols = new Map()
  for (const { api } of models) if (!protocols.has(api)) protocols.set(api, PROTOCOLS[api]())
  const piProvider = {
    id: PROVIDER, name: TITLE, getModels: () => models,
    auth: { apiKey: { name: TITLE, resolve: async ({ credential }) => ({ auth: { apiKey: credential?.key }, source: TITLE }) } },
    stream: (model, context, options) => protocols.get(model.api).stream(model, context, options),
    streamSimple: (model, context, options) => protocols.get(model.api).streamSimple(model, context, options),
  }
  return new Map([[PROVIDER, {
    provider: PROVIDER, displayName: TITLE, piProvider, modelErrors: new Map(), configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: 300_000, maxRequestImageBytes: 20 * 1024 * 1024, maxRequestImages: 50,
    imageOffloadCountQuantum: 10, requestImagePixelBudget: 2048 * 2048, requestImageMaxBytes: 1024 * 1024,
  }]])
}

/** Publish a model route only while there are usable models, and notify the model picker on catalog changes. */
export function modelRoute(ctx) {
  let profiles = new Map()
  // Keep each prepared call's key paired with the endpoint in its captured profile.
  const keys = new WeakMap()
  let registration
  const credentials = new InMemoryCredentialStore()
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: { credentials, authContext: defaultProviderAuthContext() },
    resolveApiKey: async (_provider, profile) => {
      const key = keys.get(profile)
      if (!key) throw new LlmError('Subscription proxy is not running', 'MISSING_CREDENTIAL')
      return key
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
      path => ctx.get('fs')?.processPathFromHostPath(path), ref),
  })
  return (session, models) => {
    const hadModels = profiles.size > 0
    profiles = modelProfiles(session, models)
    const profile = profiles.get(PROVIDER)
    if (profile) keys.set(profile, session.apiKey)
    if (profiles.size === 0) {
      if (hadModels) registration?.replace([])
    } else if (!registration) {
      registration = ctx.llm.registerAdapter([PROVIDER], adapter)
    } else if (hadModels) {
      registration.modelsChanged()
    } else {
      registration.replace([PROVIDER])
    }
  }
}
