/** Client-visible state of the managed local llama.cpp model. Carries no paths or keys. */

/** Lifecycle phase of the local engine and its one pinned model. */
export type LlamaCppPhase =
  | 'checking' | 'missing' | 'downloading' | 'installed' | 'starting' | 'running' | 'stopped' | 'failed'

/** What a download step is fetching. */
export type LlamaCppDownloadPhase = 'engine' | 'model'

/** Byte progress of the active download step. */
export interface LlamaCppProgress {
  phase: LlamaCppDownloadPhase
  receivedBytes: number
  totalBytes: number
}

/** Fixed facts about the pinned model, shown before anything is downloaded. */
export interface LlamaCppModelInfo {
  /** Model id served by the route (`--alias`). */
  id: string
  /** Display name. */
  name: string
  /** Bytes of the model file. */
  modelBytes: number
  /** Bytes of the engine archive for the configured backend. */
  engineBytes: number
  /** llama.cpp build in use: CPU only, Metal (Apple Silicon) or Vulkan. */
  backend: 'cpu' | 'metal' | 'vulkan'
  /** llama.cpp release tag. */
  engineVersion: string
}

/** Complete state snapshot. */
export interface LlamaCppState {
  phase: LlamaCppPhase
  model: LlamaCppModelInfo
  /** Model provider route that serves this model. */
  provider: string
  /** Present while downloading. */
  progress?: LlamaCppProgress
  /** Human-readable failure, present in `failed`. */
  error?: string
  /** Last engine log lines, present when the engine failed. */
  logTail?: string
}
