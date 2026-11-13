/** Deployment configuration for the managed local llama.cpp model. */
import z from '@deepseek-ai/schemastery'

/** One pinned download: where it comes from and what it must hash to. */
export interface ArtifactOverride {
  /** Download URL. */
  url: string
  /** Lowercase hex sha256 of the whole file. */
  sha256: string
  /** Exact size in bytes. */
  bytes: number
}

/** Paths, worker and launch settings. */
export interface Config {
  /** Absolute directory for models, the preset and state. */
  dataRoot: string
  /**
   * Absolute path of the bundled `jan-llama-worker` executable, with its ggml libraries beside it.
   * Absent or unusable, the service reports `failed` at boot and starts nothing.
   */
  workerPath?: string | undefined
  /** Which curated model the first-run offer installs; `small` is a 429 MB test model. */
  model: 'default' | 'small'
  /** Hugging Face origin for repository lookups and their downloads. */
  huggingFaceURL: string
  /**
   * `llm-pi-ai` settings namespace whose `providers.<provider>.models` the plugin keeps equal to
   * the active model, so the model picker names what the worker runs; empty disables the sync.
   */
  routeNamespace: string
  /** `maxTokens` written for the active model's route entry. */
  routeMaxTokens: number
  /**
   * Preset section name the active model is served under. Stable, so a session on the local route
   * keeps its selection when another model is put in use; only the display name the route lists changes.
   */
  routeModelId: string
  /** Credential reference the `local` route reads its key from, and the key the worker requires. */
  apiKeyRef: string
  /** Credential reference the `local` route reads its endpoint from (`baseURLEnv`); set while the worker serves. */
  baseURLRef: string
  /** Model provider route that serves the model (shown to clients). */
  provider: string
  /** Start the worker at boot when a model is installed and the user left it running. */
  autoStart: boolean
  /** Resident models the worker keeps loaded (`--models-max`); 0 removes the bound. */
  modelsMax: number
  /**
   * Context window (`ctx-size`); the harness's own prompt and tools take about 12k tokens.
   * `0` leaves it to `fit`, which starts from the model's trained context and shrinks it to
   * fit memory (never below {@link Config.fitCtx}); the route's `contextWindow` must then be
   * no larger than what the worker reports.
   */
  ctxSize: number
  /** Let llama.cpp size unset options (GPU layers, and context when `ctxSize` is 0) to device memory. */
  fit: boolean
  /** Memory `fit` keeps free on each device, in MiB. */
  fitTargetMiB: number
  /** Smallest context `fit` may choose when `ctxSize` is 0. */
  fitCtx: number
  /** KV cache element type; `q8_0` halves its memory against `f16`. */
  cacheType: 'f16' | 'q8_0'
  /** CPU threads; omitted lets llama.cpp decide. */
  threads?: number | undefined
  /** Layers offloaded to the GPU; omitted lets `fit` decide (or offloads all with fit off). */
  gpuLayers?: number | undefined
  /** Deadline from spawn until the handshake and the active model's load complete. */
  startTimeoutMs: number
  /** Wait after closing the worker's stdin (it drains requests and saves KV state) before terminating it. */
  stopTimeoutMs: number
  /** Grace period between SIGTERM and SIGKILL once the worker is terminated. */
  graceMs: number
  /** Minimum interval between download progress notifications. */
  progressIntervalMs: number
  /** Test-only: replaces the pinned download of the first-run model. */
  firstModelOverride?: ArtifactOverride | undefined
}

const artifact: z<ArtifactOverride> = z.object({
  url: z.string().min(1),
  sha256: z.string().pattern(/^[0-9a-f]{64}$/),
  bytes: z.natural(),
})

const credentialName = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Validate the deployment's choices at activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  dataRoot: z.string().min(1).required(),
  workerPath: z.union([z.string().min(1), z.const(undefined)]),
  model: z.union(['default', 'small']).default('default'),
  huggingFaceURL: z.string().pattern(/^https?:\/\/[^/]+$/).default('https://huggingface.co'),
  routeNamespace: z.string().default('llm-pi-ai'),
  routeMaxTokens: z.natural().min(1).default(8192),
  routeModelId: z.string().pattern(/^[\w.-]+$/).default('local'),
  apiKeyRef: z.string().pattern(credentialName).default('LLAMA_CPP_API_KEY'),
  baseURLRef: z.string().pattern(credentialName).default('LLAMA_CPP_BASE_URL'),
  provider: z.string().min(1).default('local'),
  autoStart: z.boolean().default(true),
  modelsMax: z.natural().default(1),
  ctxSize: z.natural().default(32768),
  fit: z.boolean().default(true),
  fitTargetMiB: z.natural().default(1024),
  fitCtx: z.natural().min(512).default(16384),
  cacheType: z.union(['f16', 'q8_0']).default('q8_0'),
  threads: z.union([z.natural().min(1), z.const(undefined)]),
  gpuLayers: z.union([z.natural(), z.const(undefined)]),
  startTimeoutMs: z.natural().min(1).default(120_000),
  stopTimeoutMs: z.natural().min(1).default(15_000),
  graceMs: z.natural().min(1).default(5000),
  progressIntervalMs: z.natural().min(1).default(250),
  firstModelOverride: z.union([artifact, z.const(undefined)]),
})
