/**
 * Host-owned compaction preferences shared by every agent preset.
 *
 * Presets mount their own compaction backend inside an isolated realm, so no
 * single backend entry is a Settings namespace the user can edit. This entry
 * lives on the host plane, where Settings serves it, and every backend reads
 * it at each compaction decision.
 * @module @janhq/jan-compaction-basic/settings
 */
import type { Volatile } from '@janhq/cordis'
import { Context, Service } from '@janhq/cordis'
import z from '@janhq/schemastery'

declare module '@janhq/cordis' {
  interface Context {
    /** User compaction preferences read by every compaction-basic backend. */
    compactionSettings: CompactionSettings
  }
}

/** User preferences; an unset field leaves the backend's own config in force. */
export interface CompactionPreferences {
  /** Compact automatically before a request nears the context window. */
  auto?: boolean
  /** Context-window fraction that triggers automatic compaction. */
  thresholdRatio?: number
  /** Summary provider, paired with summarizationModel; empty means the conversation's model. */
  summarizationProvider?: string
  /** Summary model, paired with summarizationProvider; empty means the conversation's model. */
  summarizationModel?: string
}

/** Live references for the four preferences; each is undefined until the user sets it. */
export interface Config {
  /** Live automatic-compaction toggle. */
  auto: Volatile<boolean | undefined>
  /** Live context-window pressure fraction. */
  thresholdRatio: Volatile<number | undefined>
  /** Live summary provider. */
  summarizationProvider: Volatile<string | undefined>
  /** Live summary model. */
  summarizationModel: Volatile<string | undefined>
}

/** Host settings owner that every compaction backend consults. */
export class CompactionSettings extends Service {
  static Config = z.object({
    auto: z.boolean().volatile(),
    thresholdRatio: z.number().volatile(),
    summarizationProvider: z.string().volatile(),
    summarizationModel: z.string().volatile(),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'compactionSettings')
  }

  /**
   * Read the preferences the user has set.
   * @returns only the fields with a value; the backend validates them.
   */
  current(): CompactionPreferences {
    const preferences: CompactionPreferences = {}
    const auto = this.config.auto.get()
    const thresholdRatio = this.config.thresholdRatio.get()
    const summarizationProvider = this.config.summarizationProvider.get()
    const summarizationModel = this.config.summarizationModel.get()
    if (auto !== undefined) preferences.auto = auto
    if (thresholdRatio !== undefined) preferences.thresholdRatio = thresholdRatio
    if (summarizationProvider !== undefined) preferences.summarizationProvider = summarizationProvider
    if (summarizationModel !== undefined) preferences.summarizationModel = summarizationModel
    return preferences
  }
}

export const name = 'compaction-settings'
export default CompactionSettings
