import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Provider route that sends profile model requests to a loopback Anthropic Messages fixture. */
export const MOCK_MODEL_PROVIDER = 'mock-messages'

/** Credential variable the mock route resolves; the fixture ignores its value. */
export const MOCK_MODEL_KEY_ENV = 'MOCK_MESSAGES_API_KEY'

/** One model entry the mock route offers. */
export interface MockModelEntry {
  id: string
  input?: ('text' | 'image')[]
}

/**
 * Build the profile patch row that registers {@link MOCK_MODEL_PROVIDER} on the shipped `llm-pi-ai` row.
 * @param baseUrl - Loopback fixture origin serving `POST /v1/messages`.
 * @param models - Model ids, or entries with input modalities, the route offers.
 * @returns one JSON profile patch row.
 */
export function mockModelRouteRow(baseUrl: string, models: readonly (string | MockModelEntry)[]): object {
  return { id: 'llm-pi-ai', config: { providers: { [MOCK_MODEL_PROVIDER]: {
    api: 'anthropic-messages', baseURL: baseUrl, apiKeyEnv: MOCK_MODEL_KEY_ENV,
    models: models.map(model => typeof model === 'string' ? { id: model } : model),
  } } } }
}

/**
 * Write a profile patch file containing only {@link mockModelRouteRow}.
 * @param directory - Test-owned directory that receives the patch file.
 * @param baseUrl - Loopback fixture origin serving `POST /v1/messages`.
 * @param models - Model ids, or entries with input modalities, the route offers.
 * @returns the absolute patch path.
 */
export async function writeMockModelRoute(
  directory: string, baseUrl: string, models: readonly (string | MockModelEntry)[],
): Promise<string> {
  const path = join(directory, 'mock-model-route.patch.json')
  await writeFile(path, JSON.stringify([mockModelRouteRow(baseUrl, models)]))
  return path
}
