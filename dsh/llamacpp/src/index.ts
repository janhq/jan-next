import { LlamacppEngine } from './engine'

export type { LlamacppService, LocalEngineService, LocalModelProps, EngineDevice } from './types'
export { LlamacppEngine }

// One engine per app window; started on first use. A failed startup is logged
// and the engine stays usable so the provider and its models remain listed.
let engine: LlamacppEngine | undefined
let started: Promise<void> | undefined

export function getLlamacppEngine(): LlamacppEngine {
  if (!engine) engine = new LlamacppEngine()
  return engine
}

/** Resolves once the engine's settings and migrations have run. */
export function startLlamacppEngine(): Promise<void> {
  started ??= getLlamacppEngine()
    .start()
    .catch((error: unknown) => console.error('Engine startup failed:', error))
  return started
}

export function disposeLlamacppEngine(): void {
  engine?.dispose()
  engine = undefined
  started = undefined
}

/** The engine serving `provider`, or undefined for providers that are remote. */
export function getLocalEngine(provider: string): LlamacppEngine | undefined {
  return provider === 'llamacpp' ? getLlamacppEngine() : undefined
}

/** Every local engine with its provider name. */
export function listLocalEngines(): [string, LlamacppEngine][] {
  return [['llamacpp', getLlamacppEngine()]]
}
