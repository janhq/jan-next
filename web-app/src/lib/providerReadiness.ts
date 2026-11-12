
type ModelLike = {
  id: string
  embedding?: boolean
  capabilities?: string[]
}

type ProviderLike = {
  provider: string
  models?: ModelLike[]
  api_key?: string
  api_key_fallbacks?: string[]
}

/**
 * An embedding model cannot answer a message. Jan installs one on its own during
 * first-run setup, so counting it would end onboarding before the user has any
 * model to chat with.
 */
function isChatCapable(model: ModelLike): boolean {
  return !model.embedding && !model.capabilities?.includes('embeddings')
}

/**
 * Whether the user can actually send a message through this provider: it has
 * at least one chat-capable model (installed locally, or added to a custom
 * OpenAI-compatible provider).
 */
export function isProviderUsable(provider: ProviderLike): boolean {
  const hasModels = (provider.models ?? []).some(isChatCapable)

  // llamacpp and custom providers are user-configured endpoints, so models
  // alone qualify.
  return hasModels
}

/**
 * The gate that decides whether onboarding is still required. Shared so the
 * setup route and the post-setup nudge cannot drift apart.
 */
export function hasUsableProvider(providers: ProviderLike[]): boolean {
  return (providers ?? []).some(isProviderUsable)
}
