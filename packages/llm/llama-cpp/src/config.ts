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

/** Test-only replacements for the pinned downloads. */
export interface ArtifactOverrides {
  /** Engine archive (`tar.gz` containing `llama-server`). */
  engine?: ArtifactOverride | undefined
  /** GGUF model file. */
  model?: ArtifactOverride | undefined
}

/** Paths, backend and launch settings. */
export interface Config {
  /** Absolute directory for the engine, model and state. */
  dataRoot: string
  /** Linux/Windows build: CPU, or Vulkan for GPU offload (needs a Vulkan driver). macOS always uses its Metal build. */
  backend: 'cpu' | 'vulkan'
  /** Which pinned model to install; `small` is a 429 MB test model. */
  model: 'default' | 'small'
  /** Loopback port the server listens on; must match the `local` route's baseURL. */
  port: number
  /** Credential reference the `local` route reads, and the key the server requires. */
  apiKeyRef: string
  /** Model provider route that serves the model (shown to clients). */
  provider: string
  /** Start the server at boot when it is installed. */
  autoStart: boolean
  /** Context window passed as `-c`; the harness's own prompt and tools take about 12k tokens. */
  ctxSize: number
  /** KV cache element type (`-ctk`/`-ctv`); `q8_0` halves its memory against `f16`. */
  cacheType: 'f16' | 'q8_0'
  /** CPU threads (`-t`); omitted lets llama.cpp decide. */
  threads?: number | undefined
  /** Layers offloaded to the GPU (`-ngl`); used by the Metal and Vulkan builds. */
  gpuLayers: number
  /** Readiness deadline after spawning. */
  startTimeoutMs: number
  /** Grace period between SIGTERM and SIGKILL. */
  graceMs: number
  /** Minimum interval between download progress notifications. */
  progressIntervalMs: number
  /** Test-only: an existing server executable that replaces the downloaded engine. */
  binaryPath?: string | undefined
  /** Test-only: replaces the pinned downloads (engine, model). */
  artifactOverrides?: ArtifactOverrides | undefined
}

const artifact: z<ArtifactOverride> = z.object({
  url: z.string().min(1),
  sha256: z.string().pattern(/^[0-9a-f]{64}$/),
  bytes: z.natural(),
})

/** Validate the deployment's choices at activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  dataRoot: z.string().min(1).required(),
  backend: z.union(['cpu', 'vulkan']).default('cpu'),
  model: z.union(['default', 'small']).default('default'),
  port: z.natural().min(1).max(65535).default(39281),
  apiKeyRef: z.string().min(1).default('LLAMA_CPP_API_KEY'),
  provider: z.string().min(1).default('local'),
  autoStart: z.boolean().default(true),
  ctxSize: z.natural().min(512).default(32768),
  cacheType: z.union(['f16', 'q8_0']).default('q8_0'),
  threads: z.union([z.natural().min(1), z.const(undefined)]),
  gpuLayers: z.natural().default(99),
  startTimeoutMs: z.natural().min(1).default(120_000),
  graceMs: z.natural().min(1).default(5000),
  progressIntervalMs: z.natural().min(1).default(250),
  binaryPath: z.union([z.string().min(1), z.const(undefined)]),
  artifactOverrides: z.union([z.object({ engine: artifact, model: artifact }) as z<ArtifactOverrides>, z.const(undefined)]),
})
