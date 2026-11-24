/** Client-visible state of the managed local llama.cpp worker and its models. Carries no paths or keys. */

/**
 * Lifecycle phase of the local worker. `running` means it serves the route: the default model is
 * loaded and the others load on first use.
 */
export type LlamaCppPhase =
  | 'checking' | 'missing' | 'downloading' | 'installed' | 'starting' | 'running' | 'stopped' | 'failed'

/** Byte progress of one model download and its speed. */
export interface LlamaCppProgress {
  receivedBytes: number
  totalBytes: number
  /** Recent transfer rate; 0 until enough has arrived to measure. */
  bytesPerSecond: number
}

/** How far the worker got reading the prompt of the request in flight, in tokens. */
export interface LlamaCppPrefill {
  /** Session the request belongs to, when the caller named one. */
  sessionId?: string
  /** Prompt tokens read so far, including {@link cache}. */
  processed: number
  total: number
  /** Prompt tokens reused from the worker's cache. */
  cache: number
}

/** Facts about the default model, or the model the first-run offer installs when none is installed. */
export interface LlamaCppModelInfo {
  /** Installed or catalog model id. */
  id: string
  /** Display name. */
  name: string
  /** Bytes of the model file. */
  modelBytes: number
}

/**
 * How a model's estimated memory compares with this machine's: `fits` runs entirely on the
 * accelerators (or with headroom in unified memory), `tight` also needs system memory (or leaves
 * little headroom), and `too-large` exceeds what the machine has.
 */
export type ModelFit = 'fits' | 'tight' | 'too-large'

/** One offload device the worker lists, with its memory. */
export interface LlamaCppDevice {
  /** ggml device id, e.g. `Vulkan0`. */
  id: string
  name: string
  totalMiB: number
  /** Free when the device was listed at boot. */
  freeMiB: number
}

/** What this machine offers the worker, read once at boot. */
export interface LlamaCppHardware {
  /** Backend of the first accelerator, e.g. `vulkan`, `cuda` or `metal`; `cpu` when there is none. */
  backend: string
  /** Accelerators the worker lists; host devices (CPU, BLAS) are left out. */
  devices: LlamaCppDevice[]
  /** System memory in bytes. */
  memoryBytes: number
}

/** Where an installed model came from. */
export type LocalModelSource = 'catalog' | 'huggingface' | 'import'

/** Whether an installed model is in the worker's memory; `unloaded` while the worker is not running. */
export type LocalModelStatus = 'loading' | 'loaded' | 'unloaded'

/** One installed model. */
export interface LocalModelEntry {
  /** Stable id; the route serves it as `<provider>/<id>`. */
  id: string
  name: string
  /** Bytes of the model file plus its vision projector, if any. */
  bytes: number
  source: LocalModelSource
  /** Hugging Face repository the file came from; absent for an imported file. With `name`, the file's identity. */
  repo?: string
  /** It has a vision projector that encodes images, so the route accepts image input for it. */
  vision: boolean
  /** The default model, which the route's alias id also serves and which loads when the worker starts. */
  active: boolean
  status: LocalModelStatus
  /** Context the worker settled on the last time it loaded this model. */
  contextSize?: number
  /** Saved context requested for this model, or the plugin default. */
  configuredContextSize: number
  /** Automatically fit GPU offload and (when context is zero) context to memory. */
  autoFit: boolean
  /** `general.architecture` of the GGUF file. */
  architecture: string
  /** Context the model was trained with, when its file declares it. */
  contextLength?: number
  /** Weights, projector and the KV cache at the configured context against this machine; absent until the hardware is known. */
  fit?: ModelFit
}

/** One curated model the manager offers. */
export interface CatalogModelInfo {
  id: string
  name: string
  /** Bytes of the model file plus its vision projector, if any. */
  bytes: number
  /** Hugging Face repository it comes from. */
  repo: string
  recommended: boolean
  installed: boolean
  /** It downloads with a vision projector and accepts image input. */
  vision: boolean
  /** Download size against this machine; absent until the hardware is known. */
  fit?: ModelFit
}

/** One model download, in progress, paused or failed. */
export interface LlamaCppDownload {
  /** Model id the download installs as. */
  id: string
  name: string
  /** Hugging Face repository the file comes from. With `name`, the file's identity. */
  repo: string
  /** Present once bytes flow; absent while queued. A paused download keeps the bytes it reached. */
  progress?: LlamaCppProgress
  /** Present when the download failed; retrying starts it again from its partial file. */
  error?: string
  /** Present when the user paused it; its partial file is kept and retrying resumes it. */
  paused?: true
}

/** One Jan-owned download on disk. A model includes its downloaded vision projector, if any. */
export interface StoredDownload {
  readonly name: string
  readonly kind: 'model' | 'partial' | 'cache'
  readonly bytes: number
  /** File or cache path relative to the Jan home, with forward separators on every platform. */
  readonly path: string
  /** Epoch milliseconds, for caches that explicitly track use. */
  readonly lastUsed?: number
  /** Why this item is temporarily unavailable for deletion. */
  readonly inUse?: string
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
  /** File size plus the repository's projector against this machine; absent until the hardware is known. */
  fit?: ModelFit
}

/** Result of a Hugging Face repository lookup. */
export interface HuggingFaceRepoInfo {
  /** `owner/name`. */
  repo: string
  /** Downloadable single-file GGUF models, smallest first. */
  files: HuggingFaceFileInfo[]
  /** Vision projector downloaded beside whichever file is chosen; absent when the repository has none. */
  projector?: { file: string; bytes: number }
}

/** Options of a model import. */
export interface ImportModelOptions {
  /** Display name; defaults to the file name. */
  name?: string
  /** Absolute path of a vision projector (`mmproj`) GGUF file for the model, left where it is. */
  projector?: string
}

/** Operating system of the Host, which resolves every model path a client sends; other POSIX systems report `linux`. */
export type LlamaCppHostPlatform = 'linux' | 'macos' | 'windows'

/** Complete state snapshot. */
export interface LlamaCppState {
  phase: LlamaCppPhase
  hostPlatform: LlamaCppHostPlatform
  model: LlamaCppModelInfo
  /** Model provider route that serves every installed model. */
  provider: string
  /** Progress of the first download in {@link downloads} that is running (not failed, paused or queued); present while bytes flow. */
  progress?: LlamaCppProgress
  /** Human-readable failure, present in `failed`. */
  error?: string
  /** Context size the default model settled on (after `fit`), present while running. */
  contextSize?: number
  /** Prompt reading of the request in flight, present from its first report until the prompt is read. */
  prefill?: LlamaCppPrefill
  /** Last worker log lines, present when the worker failed. */
  logTail?: string
  /** Installed models; exactly one is active (the default) when any is installed. */
  models: LocalModelEntry[]
  /** Downloads in progress, queued, paused or failed, in start order. */
  downloads: LlamaCppDownload[]
  /** Curated models the manager offers. */
  catalog: CatalogModelInfo[]
  /** Offload devices and memory; absent until the worker listed them, or when it could not. */
  hardware?: LlamaCppHardware
}
