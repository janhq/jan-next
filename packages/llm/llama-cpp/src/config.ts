/** Deployment configuration for the managed local llama.cpp model. */
import z from '@janhq/schemastery'

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
   * the installed models plus the default's alias, so the model picker names what the worker
   * serves; empty disables the sync.
   */
  routeNamespace: string
  /** `maxTokens` written for each route entry. */
  routeMaxTokens: number
  /**
   * Route model id that is an alias of the default model (an `alias-of` preset section), beside each
   * model's own id. Stable, so a session that selected it follows the default; no installed model
   * takes this id.
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
  /**
   * Resident models the worker keeps loaded (`--models-max`); loading another unloads the least
   * recently used idle one, and a request is refused while every resident model is busy. 1, as in
   * Jan, because one model usually fills the accelerator; 0 removes the bound.
   */
  modelsMax: number
  /**
   * Context window (`ctx-size`); the harness's own prompt and tools take about 12k tokens. A model
   * trained with a shorter context is served at its trained context. `0` leaves it to `fit`, which
   * starts from the trained context and shrinks it to fit memory (never below {@link Config.fitCtx}).
   * The route's `contextWindow` follows the context the worker reports once a model runs.
   */
  ctxSize: number
  /**
   * Let llama.cpp size unset options (GPU layers, and context when `ctxSize` is 0) to device memory.
   * Unset: on, except on macOS, where Metal counts the whole memory-mapped file against its working
   * set and `fit` plans loads that then fail (janhq/jan#9198).
   */
  fit?: boolean | undefined
  /** Memory `fit` keeps free on each device, in MiB. */
  fitTargetMiB: number
  /** Smallest context `fit` may choose when `ctxSize` is 0; also the context the route lists before the worker reports one. */
  fitCtx: number
  /** KV cache element type; `q8_0` halves its memory against `f16` and needs flash attention. */
  cacheType: 'f16' | 'q8_0'
  /** Flash attention (`flash-attn`); `off` requires `cacheType: f16`. */
  flashAttn: 'auto' | 'on' | 'off'
  /** CPU threads; omitted lets llama.cpp decide. */
  threads?: number | undefined
  /**
   * Layers offloaded to the GPU; omitted lets `fit` decide (or offloads all with fit off). Setting
   * it with fit on stops `fit` from sizing anything.
   */
  gpuLayers?: number | undefined
  /** Logical batch size (`batch-size`); omitted keeps llama.cpp's 2048. */
  batchSize?: number | undefined
  /** Physical batch size (`ubatch-size`); omitted keeps llama.cpp's 512. */
  ubatchSize?: number | undefined
  /**
   * Requests decoded at once (`parallel`), each with the full context, as the KV cache is unified
   * across them; omitted lets llama.cpp decide.
   */
  parallel?: number | undefined
  /** MoE layers whose expert weights stay in system memory (`n-cpu-moe`); omitted keeps them all offloadable. */
  nCpuMoe?: number | undefined
  /**
   * GPU cache, in MiB, for expert weights kept in system memory (`moe-cache-mib`). Written only for
   * a model whose file declares experts, and never with `splitMode: tensor` or `device: none`, where
   * llama.cpp refuses to load with it.
   */
  moeCacheMiB?: number | undefined
  /** Comma-separated devices to offload to (`device`), e.g. `Vulkan0`, or `none`; omitted uses every device. */
  device?: string | undefined
  /** How layers are split across several GPUs (`split-mode`); omitted keeps llama.cpp's `layer`. */
  splitMode?: 'none' | 'layer' | 'row' | 'tensor' | undefined
  /** GPU used with `splitMode: none`, or for intermediate results with `row` (`main-gpu`). */
  mainGpu?: number | undefined
  /** Keep the KV cache on the GPU; `false` writes `no-kv-offload`, which saves VRAM at a speed cost. */
  kvOffload: boolean
  /** How weights are read (`load-mode`); omitted lets llama.cpp memory-map them where devices allow. */
  loadMode?: 'none' | 'mmap' | 'mlock' | 'mmap+mlock' | undefined
  /** Run each model's vision projector on the GPU; `false` writes `mmproj-offload = false`, which keeps it in system memory. */
  mmprojOffload: boolean
  /** Prompt cache in system memory, in MiB (`cache-ram`); `-1` removes the bound, `0` disables it, omitted keeps llama.cpp's 8192. */
  cacheRamMiB?: number | undefined
  /**
   * Disk budget, in MiB, for per-thread KV state under `<dataRoot>/slots` (`--slot-cache-mib`);
   * `0` saves nothing. The `local` route names each conversation request's Session as its thread,
   * so returning to a Session after another one used the slot, or after a restart, restores its
   * cache instead of reading the conversation again. 8192, as Jan's conversation cache.
   */
  slotCacheMiB: number
  /** Deadline from spawn until the handshake and the active model's load complete. */
  startTimeoutMs: number
  /**
   * Delay before each attempt to resubscribe to a running worker's model feed after it errored or
   * ended; the attempt also re-reads every model's status.
   */
  feedRetryMs: number
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
  fit: z.union([z.boolean(), z.const(undefined)]),
  fitTargetMiB: z.natural().default(1024),
  fitCtx: z.natural().min(512).default(16384),
  cacheType: z.union(['f16', 'q8_0']).default('q8_0'),
  flashAttn: z.union(['auto', 'on', 'off']).default('on'),
  threads: z.union([z.natural().min(1), z.const(undefined)]),
  gpuLayers: z.union([z.natural(), z.const(undefined)]),
  batchSize: z.union([z.natural().min(1), z.const(undefined)]),
  ubatchSize: z.union([z.natural().min(1), z.const(undefined)]),
  parallel: z.union([z.natural().min(1), z.const(undefined)]),
  nCpuMoe: z.union([z.natural().min(1), z.const(undefined)]),
  moeCacheMiB: z.union([z.natural().min(1), z.const(undefined)]),
  device: z.union([z.string().pattern(/^[\w.-]+(,[\w.-]+)*$/), z.const(undefined)]),
  splitMode: z.union([z.union(['none', 'layer', 'row', 'tensor']), z.const(undefined)]),
  mainGpu: z.union([z.natural(), z.const(undefined)]),
  kvOffload: z.boolean().default(true),
  loadMode: z.union([z.union(['none', 'mmap', 'mlock', 'mmap+mlock']), z.const(undefined)]),
  mmprojOffload: z.boolean().default(true),
  cacheRamMiB: z.union([z.number().step(1).min(-1), z.const(undefined)]),
  slotCacheMiB: z.natural().default(8192),
  startTimeoutMs: z.natural().min(1).default(120_000),
  feedRetryMs: z.natural().min(1).default(1000),
  stopTimeoutMs: z.natural().min(1).default(15_000),
  graceMs: z.natural().min(1).default(5000),
  progressIntervalMs: z.natural().min(1).default(250),
  firstModelOverride: z.union([artifact, z.const(undefined)]),
})
