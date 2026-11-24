import type { Volatile } from '@janhq/cordis'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Menu icon: a product glyph name or one emoji. */
  readonly icon?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** Preset for a new Session by provider route, below a Settings pick. */
  routeDefaults: Record<string, string>
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
}
