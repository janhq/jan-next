/** Shared model configuration and context assertions for real Office workflows. */
import { expect } from 'vitest'
import { Session, SessionId, type SessionEvent } from '@janhq/jan-session'

/** @returns Model provider patches for the Tokamak API, or the endpoint and model named by the environment. */
export function officeModelPatches() {
  const model = process.env.MODEL_NAME ?? 'tokamak-1-preview'
  return [
    { id: 'llm-pi-ai', config: { providers: { 'office-test': {
      api: 'openai-completions', apiKeyEnv: 'TOKAMAK_API_KEY', baseURL: process.env.TOKAMAK_BASE_URL ?? 'https://api.tokamak.sh/v1',
      models: [{ id: model, contextWindow: 128000, maxTokens: 8192, input: ['text', 'image'] }],
    } } } },
    { id: 'agent-default-model', config: { provider: 'office-test', model } },
  ]
}

/**
 * Assert that a non-rendering task has received no rendering commands or detailed guidance.
 * @param events - Recorded task events, including nested skill and shell results.
 */
export function expectNoRenderContext(events: SessionEvent[]): void {
  const messages = Session.create(SessionId('office-context'), events).deriveMessages()
  expect(JSON.stringify(messages)).not.toMatch(/imageRendering|maxPixels|fragment rectangles|render --input|--output-dir|uniformly blank/)
}
