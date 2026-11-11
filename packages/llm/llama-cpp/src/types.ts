/** Client-visible state of the managed local llama.cpp engine and its models. Carries no paths or keys. */

/** Lifecycle phase of the local engine and the active model it serves. */
export type LlamaCppPhase =
  | 'checking' | 'missing' | 'downloading' | 'installed' | 'starting' | 'running' | 'stopped' | 'failed'

/** What a download step is fetching. */
export type LlamaCppDownloadPhase = 'engine' | 'model'

/** Byte progress of one download: its current step, the whole download, and its speed. */
export interface LlamaCppProgress {
  phase: LlamaCppDownloadPhase
  receivedBytes: number
  totalBytes: number
  /** Bytes received over the whole download, engine included when it is needed. */
  overallReceivedBytes: number
  /** Bytes of the whole download, engine included when it is needed. */
  overallTotalBytes: number
  /** Recent transfer rate; 0 until enough has arrived to measure. */
  bytesPerSecond: number
}

/** Facts about the active model, or the model the first-run offer installs when none is active. */
export interface LlamaCppModelInfo {
  /** Model id served by the route (`--alias`). */
  id: string
  /** Display name. */
  name: string
  /** Bytes of the model file. */
  modelBytes: number
  /** Bytes of the engine archive still to download; 0 once the engine is installed. */
  engineBytes: number
  /** llama.cpp build in use: CPU only, Metal (Apple Silicon) or Vulkan. */
  backend: 'cpu' | 'metal' | 'vulkan'
  /** llama.cpp release tag. */
  engineVersion: string
}

/** Where an installed model came from. */
export type LocalModelSource = 'catalog' | 'huggingface' | 'import'

/** One installed model. */
export interface LocalModelEntry {
  id: string
  name: string
  bytes: number
  source: LocalModelSource
  /** The model the server runs. */
  active: boolean
}

/** One curated model the manager offers. */
export interface CatalogModelInfo {
  id: string
  name: string
  bytes: number
  /** Hugging Face repository it comes from. */
  repo: string
  recommended: boolean
  installed: boolean
}

/** One model download, in progress or failed. */
export interface LlamaCppDownload {
  /** Model id the download installs as. */
  id: string
  name: string
  /** Present once bytes flow; absent while queued. */
  progress?: LlamaCppProgress
  /** Present when the download failed; retrying starts it again. */
  error?: string
}

/** One GGUF file of a looked-up Hugging Face repository. */
export interface HuggingFaceFileInfo {
  file: string
  bytes: number
  /** Quantization read from the file name, when present. */
  quant?: string
  recommended: boolean
  /** Already installed from this repository. */
  installed: boolean
}

/** Result of a Hugging Face repository lookup. */
export interface HuggingFaceRepoInfo {
  /** `owner/name`. */
  repo: string
  /** Downloadable single-file GGUF models, smallest first. */
  files: HuggingFaceFileInfo[]
}

/** Complete state snapshot. */
export interface LlamaCppState {
  phase: LlamaCppPhase
  model: LlamaCppModelInfo
  /** Model provider route that serves the active model. */
  provider: string
  /** Progress of the first download in {@link downloads}, present while it runs. */
  progress?: LlamaCppProgress
  /** Human-readable failure, present in `failed`. */
  error?: string
  /** Context size the running server settled on (after `--fit`), present while running. */
  contextSize?: number
  /** Last engine log lines, present when the engine failed. */
  logTail?: string
  /** Installed models; at most one is active. */
  models: LocalModelEntry[]
  /** Downloads in progress, queued or failed, in start order. */
  downloads: LlamaCppDownload[]
  /** Curated models the manager offers. */
  catalog: CatalogModelInfo[]
}
