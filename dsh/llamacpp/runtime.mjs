const owIsMacOS = process.platform === 'darwin'

// dsh/llamacpp/src/engine-types.ts
var AIEngine = class {
  /** The stored value of one setting, or `defaultValue` when it has none. */
  async getSetting(key, defaultValue) {
    const setting = (await this.getSettings()).find((s) => s.key === key);
    return setting?.controllerProps.value ?? defaultValue;
  }
  // Stops an import but keeps the partial download so it can be resumed.
  // Default no-op for engines without resumable downloads.
  async pauseImport(_modelId) {
  }
};

// dsh/llamacpp/src/engine.ts
import {
  getJanDataFolderPath as getJanDataFolderPath2,
  fs as fs4,
  joinPath as joinPath4,
  events,
  AppEvent,
  DownloadEvent,
  logger as logger4
} from "../native/runtime.mjs";
import { loopbackFetch } from "../native/fetch.mjs";

// dsh/llamacpp/src/download-service.ts
import { HUGGINGFACE_TOKEN_SECRET_KEY } from "../native/runtime.mjs";
import { downloads } from "../native/runtime.mjs";
import { getServiceHub } from "../native/service-hub.mjs";
var headers = async () => {
  const token = await getServiceHub().core().invoke("get_secret", { key: HUGGINGFACE_TOKEN_SECRET_KEY }).catch((error) => {
    console.warn("Could not read the Hugging Face token:", error);
    return null;
  });
  return token ? { Authorization: `Bearer ${token}` } : {};
};
var downloadFiles = async (items, taskId, onProgress) => {
  const unsubscribe = await downloads.onDownloadProgress(
    taskId,
    (progress) => onProgress?.(progress.transferred, progress.total)
  );
  try {
    await downloads.downloadFiles(items, taskId, await headers());
  } catch (error) {
    console.error("Error downloading task", taskId, error);
    throw error;
  } finally {
    unsubscribe();
  }
};
var downloadService = {
  downloadFiles,
  downloadFile: (url, savePath, taskId, proxyConfig = {}, onProgress) => downloadFiles(
    [{ url, save_path: savePath, proxy: proxyConfig }],
    taskId,
    onProgress
  ),
  cancelDownload: async (taskId) => {
    try {
      await downloads.cancelDownload(taskId);
    } catch (error) {
      console.error("Error cancelling download:", error);
      throw error;
    }
  },
  pauseDownload: async (taskId) => {
    try {
      await downloads.pauseDownload(taskId);
    } catch (error) {
      console.error("Error pausing download:", error);
      throw error;
    }
  }
};

// dsh/llamacpp/src/settings.json
var settings_default = [
  {
    key: "llamacpp_env",
    title: "Environmental variables",
    description: "Environmental variables for llama.cpp(KEY=VALUE), separated by ';'",
    controllerType: "input",
    controllerProps: {
      value: "",
      placeholder: "Eg. GGML_VK_VISIBLE_DEVICES=0,1",
      type: "text",
      textAlign: "right"
    }
  },
  {
    key: "models_max",
    title: "Max Concurrently Loaded Models",
    description: "Maximum number of models the router will keep loaded at once. 0 = unlimited.",
    controllerType: "input",
    controllerProps: {
      value: 1,
      placeholder: "e.g 1",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "timeout",
    title: "Timeout for llamacpp",
    description: "Llamacpp connection and load timeout in seconds",
    controllerType: "input",
    controllerProps: {
      value: 600,
      placeholder: "e.g 600",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "fit",
    title: "Fit (auto-adjust to device memory)",
    description: "Whether to adjust unset arguments to fit in device memory ('on' or 'off'). (env: LLAMA_ARG_FIT)",
    controllerType: "checkbox",
    controllerProps: {
      value: true
    }
  },
  {
    key: "fit_target",
    title: "Fit Target per Device (MiB)",
    description: "Target margin per device for fit, comma-separated list of MiB values. Single value is broadcast across all devices. (env: LLAMA_ARG_FIT_TARGET)",
    controllerType: "input",
    controllerProps: {
      value: "1024",
      placeholder: "1024 or MiB0,MiB1,...",
      type: "text",
      textAlign: "right"
    }
  },
  {
    key: "fit_ctx",
    title: "Fit Minimum Context Size",
    description: "Minimum context size (tokens) that can be set by the auto-fit option.",
    controllerType: "input",
    controllerProps: {
      value: 4096,
      placeholder: "4096",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "threads",
    title: "Threads",
    description: "Number of threads to use during generation (-1 for logical cores).",
    controllerType: "input",
    controllerProps: {
      value: -1,
      placeholder: "-1",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "threads_batch",
    title: "Threads (Batch)",
    description: "Number of threads for batch and prompt processing (default: same as Threads).",
    controllerType: "input",
    controllerProps: {
      value: -1,
      placeholder: "-1 (same as Threads)",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "ctx_shift",
    title: "Context Shift",
    description: "Allow model to cut text in the beginning to accommodate new text in its memory",
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "n_predict",
    title: "Max Tokens to Predict",
    description: "Maximum number of tokens to generate (-1 = infinity).",
    controllerType: "input",
    controllerProps: {
      value: -1,
      placeholder: "-1",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "batch_size",
    title: "Batch Size",
    description: "Logical maximum batch size for processing prompts.",
    controllerType: "input",
    controllerProps: {
      value: 2048,
      placeholder: "2048",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "ubatch_size",
    title: "uBatch Size",
    description: "Physical maximum batch size for processing prompts.",
    controllerType: "input",
    controllerProps: {
      value: 512,
      placeholder: "512",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "n_cpu_moe",
    title: "MoE Layers on CPU",
    description: "Keep the Mixture-of-Experts weights of the first N layers in CPU memory. Lets a large MoE model fit in limited VRAM. 0 disables it.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "n_cpu_ffn",
    title: "Dense FFN Layers on CPU",
    description: "Keep the dense feed-forward weights of the first N layers in CPU memory. The counterpart of the MoE setting above, for dense models. 0 disables it.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "no_kv_offload",
    title: "Disable KV Cache Offload",
    description: "Keep the KV cache in system RAM instead of GPU memory. Useful when VRAM is scarce, at the cost of speed.",
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "device",
    title: "Devices for Offload",
    description: 'Comma-separated accelerators to offload to, named as in the detected hardware list. Leave empty to use every available accelerator, or set "none" to disable offload entirely.',
    controllerType: "input",
    controllerProps: {
      value: "",
      placeholder: "CUDA0",
      type: "text"
    }
  },
  {
    key: "split_mode",
    title: "GPU Split Mode",
    description: "How to split the model across multiple GPUs.",
    controllerType: "dropdown",
    controllerProps: {
      value: "layer",
      options: [
        {
          value: "none",
          name: "None"
        },
        {
          value: "layer",
          name: "Layer"
        },
        {
          value: "row",
          name: "Row"
        },
        {
          value: "tensor",
          name: "Tensor (experimental)"
        }
      ]
    }
  },
  {
    key: "main_gpu",
    title: "Main GPU Index",
    description: "The GPU to use for the model (split-mode=none) or intermediate results (split-mode=row).",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "tensor_split",
    title: "Tensor Split",
    description: 'Comma-separated proportions for splitting the model across devices, e.g. "3,1". Leave empty for an even split.',
    controllerType: "input",
    controllerProps: {
      value: "",
      placeholder: "3,1",
      type: "text"
    }
  },
  {
    key: "no_op_offload",
    title: "Disable Op Offload",
    description: "Keep host tensor operations on the CPU instead of offloading them to the accelerator.",
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "flash_attn",
    title: "Flash Attention",
    description: "Enable Flash Attention for optimized performance.",
    controllerType: "dropdown",
    controllerProps: {
      value: "auto",
      options: [
        {
          value: "auto",
          name: "Auto"
        },
        {
          value: "on",
          name: "On"
        },
        {
          value: "off",
          name: "Off"
        }
      ]
    }
  },
  {
    key: "parallel",
    title: "Parallel Sequences",
    description: "Number of parallel sequences to decode (0 = llama.cpp default). Jan reserves no slot of its own: chat and background requests all share slot 0 and their KV caches are parked and restored per conversation.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right",
      min: 0
    }
  },
  {
    key: "cont_batching",
    title: "Continuous Batching",
    description: "Enable continuous batching (a.k.a dynamic batching) for concurrent requests. Enabled by default, matching llama.cpp.",
    controllerType: "checkbox",
    controllerProps: {
      value: true
    }
  },
  {
    key: "no_mmap",
    title: "Disable mmap",
    description: "Do not memory-map model (slower load but may reduce pageouts if not using mlock).",
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "lazy_mode",
    title: "Lazy Tensor Reading",
    description: "Read the rows of large arch-marked tensors (e.g. per-layer embeddings) from disk on demand instead of keeping them in memory. Auto applies it above 4 GiB. Requires mmap.",
    controllerType: "dropdown",
    controllerProps: {
      value: "auto",
      options: [
        {
          value: "auto",
          name: "Auto"
        },
        {
          value: "on",
          name: "On"
        },
        {
          value: "off",
          name: "Off"
        }
      ]
    }
  },
  {
    key: "mlock",
    title: "MLock",
    description: 'Lock the model in RAM so it is never swapped out. Combined with "Disable mmap" this loads the weights without mmap and then locks them.',
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "cache_type_k",
    title: "KV Cache K Type",
    description: "KV cache data type for Keys (default: f16).",
    controllerType: "dropdown",
    controllerProps: {
      value: "f16",
      options: [
        {
          value: "f32",
          name: "f32"
        },
        {
          value: "f16",
          name: "f16"
        },
        {
          value: "bf16",
          name: "bf16"
        },
        {
          value: "q8_0",
          name: "q8_0"
        },
        {
          value: "q4_0",
          name: "q4_0"
        },
        {
          value: "q4_1",
          name: "q4_1"
        },
        {
          value: "iq4_nl",
          name: "iq4_nl"
        },
        {
          value: "q5_0",
          name: "q5_0"
        },
        {
          value: "q5_1",
          name: "q5_1"
        }
      ]
    }
  },
  {
    key: "cache_type_v",
    title: "KV Cache V Type",
    description: "KV cache data type for Values (default: f16).",
    controllerType: "dropdown",
    controllerProps: {
      value: "f16",
      options: [
        {
          value: "f32",
          name: "f32"
        },
        {
          value: "f16",
          name: "f16"
        },
        {
          value: "bf16",
          name: "bf16"
        },
        {
          value: "q8_0",
          name: "q8_0"
        },
        {
          value: "q4_0",
          name: "q4_0"
        },
        {
          value: "q4_1",
          name: "q4_1"
        },
        {
          value: "iq4_nl",
          name: "iq4_nl"
        },
        {
          value: "q5_0",
          name: "q5_0"
        },
        {
          value: "q5_1",
          name: "q5_1"
        }
      ]
    }
  },
  {
    key: "rope_scaling",
    title: "RoPE Scaling Method",
    description: 'RoPE frequency scaling method. "Model default" leaves it to the model; "None" explicitly disables scaling.',
    controllerType: "dropdown",
    controllerProps: {
      value: "auto",
      options: [
        {
          value: "auto",
          name: "Model default"
        },
        {
          value: "none",
          name: "None"
        },
        {
          value: "linear",
          name: "Linear"
        },
        {
          value: "yarn",
          name: "YaRN"
        }
      ]
    }
  },
  {
    key: "rope_freq_base",
    title: "RoPE Frequency Base",
    description: "RoPE base frequency (0 = loaded from model).",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0 (model default)",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "rope_freq_scale",
    title: "RoPE Frequency Scale Factor",
    description: "RoPE frequency scaling factor. 0 loads the value from the model; 1 forces no scaling.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right",
      min: 0,
      step: 0.01
    }
  },
  {
    key: "cache_ram",
    title: "Prompt Cache RAM (MiB)",
    description: "Prompt cache size in MiB (default: 8192, or off for decision models unless changed). -1 is unlimited, 0 disables it.",
    controllerType: "input",
    controllerProps: {
      value: 8192,
      placeholder: "8192",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "persist_thread_cache",
    title: "Remember Conversations Between Sessions",
    description: "Keep each conversation's prompt cache on disk so reopening it does not re-read the whole conversation. Restored only when the model, its settings and the llama.cpp build all match what saved it.",
    controllerType: "checkbox",
    controllerProps: {
      value: true
    }
  },
  {
    key: "thread_cache_size",
    title: "Conversation Cache Disk Limit (MiB)",
    description: "Disk budget for saved conversation caches (default: 8192). The oldest are dropped first once it is reached. One long conversation can take hundreds of MiB.",
    controllerType: "input",
    controllerProps: {
      value: 8192,
      placeholder: "8192",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "cache_reuse",
    title: "Cache Reuse",
    description: "Min chunk size of matching prefix tokens to reuse from cache. 0 = disabled.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right",
      min: 0
    }
  },
  {
    key: "ctx_checkpoints",
    title: "Context Checkpoints",
    description: "Maximum context checkpoints kept per slot, which let a shifted context be restored instead of reprocessed.",
    controllerType: "input",
    controllerProps: {
      value: 32,
      placeholder: "32",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "checkpoint_min_step",
    title: "Checkpoint Minimum Step",
    description: "Minimum number of tokens between context checkpoints.",
    controllerType: "input",
    controllerProps: {
      value: 8192,
      placeholder: "8192",
      type: "number",
      textAlign: "right"
    }
  },
  {
    key: "swa_full",
    title: "Full SWA Cache",
    description: "Use full-size KV cache for sliding-window-attention models (e.g. Gemma). Enable this if such a model reprocesses the entire prompt every turn instead of reusing cache; costs more memory.",
    controllerType: "checkbox",
    controllerProps: {
      value: false
    }
  },
  {
    key: "kv_unified",
    title: "Unified KV Cache",
    description: "Use a single unified KV buffer shared across all slots. Saves memory when running multiple parallel slots.",
    controllerType: "dropdown",
    controllerProps: {
      value: "auto",
      options: [
        {
          value: "auto",
          name: "Auto"
        },
        {
          value: "on",
          name: "On"
        },
        {
          value: "off",
          name: "Off"
        }
      ]
    }
  },
  {
    key: "kv_unified_per_slot",
    title: "Context Per Slot",
    description: "Cap how much of the unified KV cache one slot may use, in tokens. 0 leaves a slot free to fill the whole cache. Only applies when the cache is unified.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right",
      min: 0
    }
  },
  {
    key: "reasoning_preserve",
    title: "Preserve Reasoning History",
    description: "Keep the reasoning of every earlier assistant turn in the prompt, not just the most recent one. Only affects models whose chat template supports it, and costs prompt tokens.",
    controllerType: "checkbox",
    controllerProps: {
      value: true
    }
  },
  {
    key: "keep",
    title: "Keep First N Tokens",
    description: "Number of tokens from the initial prompt to keep when context is shifted. -1 = keep all.",
    controllerType: "input",
    controllerProps: {
      value: 0,
      placeholder: "0",
      type: "number",
      textAlign: "right"
    }
  }
];

// dsh/llamacpp/src/settings-store.ts
import { fs, joinPath, getJanDataFolderPath } from "../native/runtime.mjs";
var DIR_NAME = "ow-llamacpp";
var LEGACY_DIR_NAME = "llamacpp";
var FILE_NAME = "settings.json";
var TMP_NAME = "settings.json.tmp";
var writeChain = Promise.resolve();
async function paths() {
  const profileHome = process.env.DSH_HOME?.trim();
  if (!profileHome) {
    const root = await getJanDataFolderPath();
    const dir2 = await joinPath([root, LEGACY_DIR_NAME]);
    const file2 = await joinPath([dir2, FILE_NAME]);
    const tmp2 = await joinPath([dir2, TMP_NAME]);
    return { dir: dir2, file: file2, tmp: tmp2 };
  }
  const dir = await joinPath([profileHome, DIR_NAME]);
  const file = await joinPath([dir, FILE_NAME]);
  const tmp = await joinPath([dir, TMP_NAME]);
  return { dir, file, tmp };
}
async function legacyPath() {
  const root = await getJanDataFolderPath();
  return await joinPath([root, LEGACY_DIR_NAME, FILE_NAME]);
}
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}
async function readSettingsFile() {
  const { file } = await paths();
  if (await fs.existsSync(file)) return await readSettingsAt(file);
  if (!process.env.DSH_HOME?.trim()) return [];
  const legacy = await legacyPath();
  if (!await fs.existsSync(legacy)) return [];
  try {
    return await readSettingsAt(legacy);
  } catch {
    return [];
  }
}
async function readSettingsAt(file) {
  let raw;
  try {
    raw = await fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Engine settings could not be read from ${file}: ${reasonOf(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Engine settings at ${file} are not valid JSON: ${reasonOf(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Engine settings at ${file} are not a settings list, so they were left untouched`);
  }
  return parsed;
}
async function preserveInvalidSettingsFile() {
  const { file } = await paths();
  try {
    if (!await fs.existsSync(file)) return void 0;
    const backup = `${file}.invalid-${Date.now()}`;
    await fs.mv(file, backup);
    return backup;
  } catch {
    return void 0;
  }
}
async function mutateSettingsFile(mutate) {
  let landed = [];
  const task = async () => {
    const { dir, file, tmp } = await paths();
    const current = await readSettingsFile();
    const next = mutate(current);
    if (next === null) {
      landed = current;
      return;
    }
    if (!await fs.existsSync(dir)) await fs.mkdir(dir);
    const json = JSON.stringify(next, null, 2);
    await fs.writeFileSync(tmp, json);
    try {
      await fs.mv(tmp, file);
    } catch {
      await fs.writeFileSync(file, json);
      try {
        if (await fs.existsSync(tmp)) await fs.rm(tmp);
      } catch {
      }
    }
    let written;
    try {
      written = await fs.readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(`Engine settings were not saved to ${file}: ${reasonOf(error)}`);
    }
    if (written !== json) {
      throw new Error(`Engine settings were not saved to ${file}: the file does not hold what was just written`);
    }
    landed = next;
  };
  writeChain = writeChain.then(task, task);
  await writeChain;
  return landed;
}
async function writeSettingsFile(settings) {
  await mutateSettingsFile(() => settings);
}
async function settingsFileExists() {
  const { file } = await paths();
  if (await fs.existsSync(file)) return true;
  if (!process.env.DSH_HOME?.trim()) return false;
  return await fs.existsSync(await legacyPath());
}

// dsh/llamacpp/src/fit-default.ts
function applyPlatformFitDefault(settings, isMac) {
  if (!isMac) return;
  const fit = settings.find((s) => s.key === "fit");
  if (fit) fit.controllerProps.value = false;
}

// dsh/llamacpp/src/model-tree.ts
import { fs as fs2, joinPath as joinPath2, logger } from "../native/runtime.mjs";
async function findModelEntries(modelsDir) {
  const entries = [];
  const stack = [modelsDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    const configPath = await joinPath2([currentDir, "model.yml"]);
    if (await fs2.existsSync(configPath)) {
      entries.push({ modelId: currentDir.slice(modelsDir.length + 1), configPath });
      continue;
    }
    let children = [];
    try {
      children = await fs2.readdirSync(currentDir);
    } catch (err) {
      logger.warn(`models scan: readdir failed for ${currentDir}: ${String(err)}`);
      continue;
    }
    for (const child of children) {
      try {
        const stat = await fs2.fileStat(child);
        if (stat?.isDirectory) stack.push(child);
      } catch (err) {
        logger.warn(`models scan: stat failed for ${child}: ${String(err)}`);
      }
    }
  }
  return entries;
}

// dsh/llamacpp/src/context.ts
var FIT_FLOOR_CTX_SIZE = 4096;
var PRESET_CTX_SIZE = 8192;
var MAX_OUTPUT_TOKENS = 8192;
function outputCapFor(contextWindow) {
  const quarter = Math.floor(contextWindow / 4);
  return Math.max(1, Math.min(MAX_OUTPUT_TOKENS, quarter));
}
function resolveEffectiveContext(input) {
  const { nCtx, configured, fit, fitFloor } = input;
  if (typeof nCtx === "number" && Number.isFinite(nCtx) && nCtx > 0) {
    return { tokens: Math.floor(nCtx), source: "engine" };
  }
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return { tokens: Math.floor(configured), source: "model-settings" };
  }
  if (fit !== false) {
    const floor = typeof fitFloor === "number" && Number.isFinite(fitFloor) && fitFloor > 0 ? Math.floor(fitFloor) : FIT_FLOOR_CTX_SIZE;
    return { tokens: floor, source: "fit-floor" };
  }
  return { tokens: PRESET_CTX_SIZE, source: "preset" };
}
function contextBudget(input) {
  const { tokens, source } = resolveEffectiveContext(input);
  return { contextWindow: tokens, maxOutputTokens: outputCapFor(tokens), source };
}
function contextCandidates(nativeLimit, floor) {
  const lower = Math.max(1, Math.floor(floor));
  const upper = Math.max(lower, Math.floor(nativeLimit));
  const candidates = [];
  for (let size = upper; size > lower; size = Math.floor(size / 2)) {
    candidates.push(size);
  }
  candidates.push(lower);
  return candidates;
}
function pickRecommendation(input) {
  const { probes, nativeLimit, vramBound, floor } = input;
  const bounded = vramBound === void 0 ? {} : { vramBound };
  if (probes.length === 0) {
    return {
      tokens: floor,
      fit: "RED",
      nativeLimit,
      ...bounded,
      unknown: "no device-fit probe was possible"
    };
  }
  const usable = probes.find((probe) => probe.fit !== "RED");
  if (usable === void 0) {
    return { tokens: probes[probes.length - 1].tokens, fit: "RED", nativeLimit, ...bounded };
  }
  const resident = probes.find((probe) => probe.fit === "GREEN");
  return resident === void 0 ? { tokens: usable.tokens, fit: usable.fit, nativeLimit, ...bounded } : { tokens: resident.tokens, fit: "GREEN", nativeLimit, ...bounded };
}
function vramContextBound(input) {
  const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
  const weights = positive(input.weightsBytes);
  const perToken = positive(input.kvBytesPerToken);
  const vram = positive(input.vramBytes);
  if (weights === void 0 || perToken === void 0 || vram === void 0) return void 0;
  const budget = vram * (input.fill ?? VRAM_FILL_LIMIT) - weights;
  if (budget <= 0) return void 0;
  return Math.floor(budget / perToken);
}
var KV_OVERHEAD_RATIO = 0.25;
var VRAM_FILL_LIMIT = 0.9;
function estimateCatalogFit(input) {
  const { bytes, vram, ram } = input;
  const usable = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
  const size = usable(bytes);
  const gpu = usable(vram);
  const memory = usable(ram);
  if (size === void 0) {
    return {
      label: "Fit unknown",
      tone: "neutral",
      detail: "The download size of this quant is not published, so memory use cannot be estimated."
    };
  }
  const gb = (value) => `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (gpu === void 0 && memory === void 0) {
    return {
      label: "Fit unknown",
      tone: "neutral",
      detail: `The weights are ${gb(size)}. This machine's memory could not be read, so no estimate is possible.`
    };
  }
  const weightsWithOverhead = Math.ceil(size * (1 + KV_OVERHEAD_RATIO));
  const notes = [
    `${gb(size)} of weights`,
    `${Math.round(KV_OVERHEAD_RATIO * 100)}% added for the KV cache and compute buffers a chat-sized context needs`,
    "the real overhead depends on the architecture and context, which a catalog entry does not publish"
  ];
  if (gpu !== void 0 && weightsWithOverhead <= gpu * VRAM_FILL_LIMIT) {
    return {
      label: "Likely fits",
      tone: "success",
      detail: `Fits in ${gb(gpu)} of free VRAM, keeping ${Math.round((1 - VRAM_FILL_LIMIT) * 100)}% free: ${notes.join("; ")}.`
    };
  }
  const fitsRam = memory !== void 0 && weightsWithOverhead <= memory;
  const fitsVramAlone = gpu !== void 0 && size <= gpu;
  if (fitsVramAlone || fitsRam) {
    const where = fitsVramAlone ? `the weights alone fit in ${gb(gpu)} of free VRAM, but not with room for the KV cache and a working reserve` : `${gb(memory ?? 0)} of RAM holds the weights and that overhead`;
    return {
      label: "May need CPU offload",
      tone: "warning",
      detail: `Runs only with layers offloaded to the CPU: ${where}; ${notes.join("; ")}.`
    };
  }
  const available = [
    gpu === void 0 ? null : `${gb(gpu)} of free VRAM`,
    memory === void 0 ? null : `${gb(memory)} of RAM`
  ].filter(Boolean).join(" and ");
  return {
    label: "Unlikely to fit",
    tone: "danger",
    detail: `${gb(size)} of weights against ${available || "an unreadable memory total"}: ${notes.join("; ")}.`
  };
}

// dsh/llamacpp/src/util.ts
import { logger as logger3 } from "../native/runtime.mjs";

// dsh/llamacpp/src/backend-settings.ts
import { appSettings, logger as logger2 } from "../native/runtime.mjs";
async function getBackendSetting(key) {
  try {
    return await appSettings.get(key);
  } catch (error) {
    logger2.warn(`settings_get failed for '${key}':`, error);
    return null;
  }
}
async function setBackendSetting(key, value) {
  try {
    await appSettings.set(key, value);
  } catch (error) {
    logger2.warn(`settings_set failed for '${key}':`, error);
  }
}

// dsh/llamacpp/src/util.ts
function fileName(path) {
  return path.split(/[\\/]/).pop() ?? path;
}
var DEFAULT_EMBEDDING_MODEL_KEY = "default-embedding-model";
async function readDefaultEmbeddingModelRaw() {
  return getBackendSetting(DEFAULT_EMBEDDING_MODEL_KEY);
}
async function getDefaultEmbeddingModelId(provider = "llamacpp") {
  try {
    const raw = await readDefaultEmbeddingModelRaw();
    if (!raw) return void 0;
    const parsed = JSON.parse(raw);
    const map = parsed?.state?.defaultByProvider;
    const id = map && map[provider];
    return typeof id === "string" && id.length > 0 ? id : void 0;
  } catch {
    return void 0;
  }
}
async function setDefaultEmbeddingModelId(provider, modelId) {
  try {
    const raw = await readDefaultEmbeddingModelRaw();
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    const state = parsed.state ?? {};
    const map = state.defaultByProvider ?? {};
    map[provider] = modelId;
    parsed.state = { ...state, defaultByProvider: map };
    if (parsed.version === void 0) parsed.version = 0;
    const serialized = JSON.stringify(parsed);
    await setBackendSetting(DEFAULT_EMBEDDING_MODEL_KEY, serialized);
  } catch {
  }
}
async function getProxyConfig() {
  try {
    const proxyConfigString = await getBackendSetting("setting-proxy-config");
    if (!proxyConfigString) {
      return null;
    }
    const proxyConfigData = JSON.parse(proxyConfigString);
    const proxyState = proxyConfigData?.state;
    if (!proxyState || !proxyState.proxyEnabled || !proxyState.proxyUrl) {
      return null;
    }
    const proxyConfig = {
      url: proxyState.proxyUrl
    };
    if (proxyState.proxyUsername && proxyState.proxyPassword) {
      proxyConfig.username = proxyState.proxyUsername;
      proxyConfig.password = proxyState.proxyPassword;
    }
    if (proxyState.noProxy) {
      const noProxyList = proxyState.noProxy.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (noProxyList.length > 0) {
        proxyConfig.no_proxy = noProxyList;
      }
    }
    proxyConfig.ignore_ssl = proxyState.proxyIgnoreSSL;
    proxyConfig.verify_proxy_ssl = proxyState.verifyProxySSL;
    proxyConfig.verify_proxy_host_ssl = proxyState.verifyProxyHostSSL;
    proxyConfig.verify_peer_ssl = proxyState.verifyPeerSSL;
    proxyConfig.verify_host_ssl = proxyState.verifyHostSSL;
    logger3.info("Using proxy configuration:", {
      url: proxyState.proxyUrl,
      hasAuth: !!(proxyState.proxyUsername && proxyState.proxyPassword),
      noProxyCount: proxyConfig.no_proxy ? proxyConfig.no_proxy.length : 0,
      ignoreSSL: proxyState.proxyIgnoreSSL,
      verifyProxySSL: proxyState.verifyProxySSL,
      verifyProxyHostSSL: proxyState.verifyProxyHostSSL,
      verifyPeerSSL: proxyState.verifyPeerSSL,
      verifyHostSSL: proxyState.verifyHostSSL
    });
    return proxyConfig;
  } catch (error) {
    logger3.error("Failed to parse proxy configuration:", error);
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}
var DEFAULT_CHARS_PER_TOKEN = 3;
var UBATCH_SAFETY_MARGIN = 0.5;
var EMBEDDING_GGUF_ARCHS = /* @__PURE__ */ new Set([
  "bert",
  "nomic-bert",
  "nomic-bert-moe",
  "jina-bert-v2",
  "jina-bert-v3",
  "xlm-roberta",
  "mpnet",
  "t5encoder"
]);
function detectEmbeddingFromGgufMeta(meta) {
  if (!meta) return false;
  const arch = meta["general.architecture"];
  if (typeof arch !== "string") return false;
  if (EMBEDDING_GGUF_ARCHS.has(arch)) return true;
  if (arch.toLowerCase().includes("embed")) return true;
  const raw = meta[`${arch}.pooling_type`];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.length > 0 ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0;
}
function resolveSpecDraftKind(meta, opts = {}) {
  const arch = meta?.["general.architecture"];
  if (arch === "eagle3") return "eagle3";
  if (arch === "dflash") {
    const isDspark = opts.hasMarkovHead ?? opts.hint === "dspark";
    return isDspark ? "dspark" : "dflash";
  }
  return "mtp";
}
function detectExpertCountFromGgufMeta(meta) {
  if (!meta) return 0;
  const arch = meta["general.architecture"];
  if (typeof arch !== "string" || arch.length === 0) return 0;
  const raw = meta[`${arch}.expert_count`];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.length > 0 ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function detectMtpLayersFromGgufMeta(meta) {
  if (!meta) return 0;
  const tryParse = (raw) => {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.length > 0 ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const arch = meta["general.architecture"];
  if (typeof arch === "string" && arch.length > 0) {
    const n = tryParse(meta[`${arch}.nextn_predict_layers`]);
    if (n > 0) return n;
  }
  for (const [key, value] of Object.entries(meta)) {
    if (key.endsWith(".nextn_predict_layers")) {
      const n = tryParse(value);
      if (n > 0) return n;
    }
  }
  return 0;
}
var TEMPLATE_KWARG_RE = /\{%-?\s*set\s+([A-Za-z_]\w*)\s*=\s*\1\s*\|\s*default\(\s*([^)]*?)\s*\)/g;
function parseJinjaDefault(raw) {
  const trimmed = raw.trim();
  if (trimmed === "true" || trimmed === "false") {
    return { type: "boolean", value: trimmed === "true" };
  }
  const quoted = trimmed.match(/^(['"])(.*)\1$/);
  if (quoted) {
    return { type: "string", value: quoted[2] };
  }
  const n = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(n)) {
    return { type: "number", value: n };
  }
  return { type: "string", value: trimmed };
}
function detectTemplateKwargsFromChatTemplate(template) {
  if (typeof template !== "string" || template.length === 0) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const re = new RegExp(TEMPLATE_KWARG_RE.source, "g");
  let m;
  while ((m = re.exec(template)) !== null) {
    const name = m[1];
    if (name === "enable_thinking" || seen.has(name)) continue;
    seen.add(name);
    const { type, value } = parseJinjaDefault(m[2]);
    out.push({ name, type, default: value });
  }
  return out;
}
function estimateTokensFromText(text, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  return Math.max(1, Math.ceil(text.length / Math.max(charsPerToken, 1)));
}
function truncateToTokenBudget(text, maxTokens, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const cpt = Math.max(charsPerToken, 1);
  const maxChars = Math.max(1, maxTokens) * cpt;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
function buildEmbedBatches(inputs, ubatchSize, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const minUbatchSize = Math.ceil(1 / UBATCH_SAFETY_MARGIN);
  if (ubatchSize < minUbatchSize) {
    throw new Error(
      `ubatch_size (${ubatchSize}) is too small. Minimum required: ${minUbatchSize}`
    );
  }
  const safeLimit = Math.floor(ubatchSize * UBATCH_SAFETY_MARGIN);
  const batches = [];
  let current = [];
  let currentTokens = 0;
  let offset = 0;
  const push = () => {
    if (current.length) {
      batches.push({ batch: current, offset });
      offset += current.length;
      current = [];
      currentTokens = 0;
    }
  };
  for (const raw of inputs) {
    const text = estimateTokensFromText(raw, charsPerToken) > safeLimit ? truncateToTokenBudget(raw, safeLimit, charsPerToken) : raw;
    const estTokens = estimateTokensFromText(text, charsPerToken);
    if (currentTokens + estTokens > safeLimit && current.length) {
      push();
    }
    current.push(text);
    currentTokens += estTokens;
  }
  push();
  if (batches.some((b) => b.batch.length === 0)) {
    throw new Error("Internal error: empty batch detected");
  }
  return batches;
}
function mergeEmbedResponses(model, batchResults) {
  const aggregated = {
    model,
    object: "list",
    usage: { prompt_tokens: 0, total_tokens: 0 },
    data: []
  };
  for (const { result, offset } of batchResults) {
    aggregated.usage.prompt_tokens += result.usage?.prompt_tokens ?? 0;
    aggregated.usage.total_tokens += result.usage?.total_tokens ?? 0;
    for (const item of result.data || []) {
      aggregated.data.push({ ...item, index: item.index + offset });
    }
  }
  return aggregated;
}

// dsh/llamacpp/src/preset.ts
import { fs as fs3, joinPath as joinPath3 } from "../native/runtime.mjs";
var DEFAULT_EMBEDDING_UBATCH = 2048;
function threadCacheDir(providerPath) {
  const sep = isWindowsPath(providerPath) ? "\\" : "/";
  return `${providerPath.replace(/[\\/]+$/, "")}${sep}thread-cache`;
}
function isWindowsPath(p) {
  return /^(?:[A-Za-z]:|\\\\)/.test(p);
}
var DEFAULT_CTX_SIZE = 8192;
var SPEC_TYPES = /* @__PURE__ */ new Set([
  "draft-mtp",
  "draft-eagle3",
  "draft-dflash",
  "draft-dspark"
]);
var DEFAULT_SPEC_TYPE = "draft-mtp";
var NON_DEFAULT_DRAFT_SAMPLING = "probabilistic";
var BUILTIN_TEMPLATE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
async function existingFilePath(value) {
  if (!ABSOLUTE_PATH_RE.test(value)) return null;
  try {
    return await fs3.existsSync(value) ? value : null;
  } catch {
    return null;
  }
}
function explicitParallel(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return void 0;
  const slots = Math.floor(n);
  return slots > 0 ? slots : void 0;
}
function escapeIniValue(v) {
  return String(v).replace(/[\r\n]+/g, " ").trim();
}
async function generatePreset(providerPath, janDataFolderPath, config) {
  const modelsDir = await joinPath3([providerPath, "models"]);
  if (!await fs3.existsSync(modelsDir)) {
    await fs3.mkdir(modelsDir);
  }
  const modelEntries = (await findModelEntries(modelsDir)).filter(
    (e) => e.modelId.length > 0
  );
  modelEntries.sort((a, b) => a.modelId.localeCompare(b.modelId));
  const kvUnifiedIsAuto = config.kv_unified !== "on" && config.kv_unified !== "off";
  const lines = [];
  lines.push("[*]");
  if (config.fit === false) {
    lines.push("fit = off");
  }
  if (typeof config.fit_target === "string" && config.fit_target.length > 0 && config.fit_target !== "1024") {
    lines.push(`fit-target = ${escapeIniValue(config.fit_target)}`);
  }
  const fitCtxNum = typeof config.fit_ctx === "number" ? config.fit_ctx : typeof config.fit_ctx === "string" && config.fit_ctx.length > 0 ? Number(config.fit_ctx) : NaN;
  if (Number.isFinite(fitCtxNum) && fitCtxNum > 0 && fitCtxNum !== 4096) {
    lines.push(`fit-ctx = ${fitCtxNum}`);
  }
  const fitEnabled = config.fit !== false;
  if (!fitEnabled) {
    lines.push(`ctx-size = ${DEFAULT_CTX_SIZE}`);
  }
  if (typeof config.flash_attn === "string" && (config.flash_attn === "on" || config.flash_attn === "off")) {
    lines.push(`flash-attn = ${config.flash_attn}`);
  }
  if (typeof config.cache_type_k === "string" && config.cache_type_k.length > 0 && config.cache_type_k !== "f16") {
    lines.push(`cache-type-k = ${escapeIniValue(config.cache_type_k)}`);
  }
  if (typeof config.cache_type_v === "string" && config.cache_type_v.length > 0 && config.cache_type_v !== "f16") {
    lines.push(`cache-type-v = ${escapeIniValue(config.cache_type_v)}`);
  }
  const globalParallel = explicitParallel(config.parallel);
  if (globalParallel !== void 0) {
    lines.push(`parallel = ${globalParallel}`);
    if (kvUnifiedIsAuto) lines.push("kv-unified = true");
  }
  if (config.cont_batching === false) {
    lines.push("cont-batching = false");
  }
  if (typeof config.threads === "number" && Number.isFinite(config.threads) && config.threads > 0) {
    lines.push(`threads = ${Math.floor(config.threads)}`);
  }
  if (typeof config.threads_batch === "number" && Number.isFinite(config.threads_batch) && config.threads_batch > 0 && config.threads_batch !== config.threads) {
    lines.push(`threads-batch = ${Math.floor(config.threads_batch)}`);
  }
  if (typeof config.n_predict === "number" && Number.isFinite(config.n_predict) && config.n_predict !== -1) {
    lines.push(`n-predict = ${Math.floor(config.n_predict)}`);
  }
  if (typeof config.batch_size === "number" && Number.isFinite(config.batch_size) && config.batch_size > 0 && config.batch_size !== 2048) {
    lines.push(`batch-size = ${Math.floor(config.batch_size)}`);
  }
  if (typeof config.ubatch_size === "number" && Number.isFinite(config.ubatch_size) && config.ubatch_size > 0 && config.ubatch_size !== 512) {
    lines.push(`ubatch-size = ${Math.floor(config.ubatch_size)}`);
  }
  if (typeof config.n_cpu_moe === "number" && Number.isFinite(config.n_cpu_moe) && config.n_cpu_moe > 0) {
    lines.push(`n-cpu-moe = ${Math.floor(config.n_cpu_moe)}`);
  }
  if (typeof config.n_cpu_ffn === "number" && Number.isFinite(config.n_cpu_ffn) && config.n_cpu_ffn > 0) {
    lines.push(`n-cpu-ffn = ${Math.floor(config.n_cpu_ffn)}`);
  }
  if (config.no_kv_offload === true) {
    lines.push("no-kv-offload = true");
  }
  if (typeof config.tensor_split === "string" && config.tensor_split.trim().length > 0) {
    lines.push(`tensor-split = ${escapeIniValue(config.tensor_split.trim())}`);
  }
  if (config.no_op_offload === true) {
    lines.push("no-op-offload = true");
  }
  if (typeof config.ctx_checkpoints === "number" && Number.isFinite(config.ctx_checkpoints) && config.ctx_checkpoints >= 0 && config.ctx_checkpoints !== 32) {
    lines.push(`ctx-checkpoints = ${Math.floor(config.ctx_checkpoints)}`);
  }
  if (typeof config.checkpoint_min_step === "number" && Number.isFinite(config.checkpoint_min_step) && config.checkpoint_min_step >= 0 && config.checkpoint_min_step !== 8192) {
    lines.push(`checkpoint-min-step = ${Math.floor(config.checkpoint_min_step)}`);
  }
  if (typeof config.device === "string" && config.device.trim().length > 0) {
    lines.push(`device = ${escapeIniValue(config.device)}`);
  }
  if (typeof config.split_mode === "string" && config.split_mode.length > 0 && config.split_mode !== "layer") {
    lines.push(`split-mode = ${escapeIniValue(config.split_mode)}`);
  }
  if (typeof config.main_gpu === "number" && Number.isFinite(config.main_gpu) && config.main_gpu > 0) {
    lines.push(`main-gpu = ${Math.floor(config.main_gpu)}`);
  }
  const wantsMlock = config.mlock === true;
  const wantsNoMmap = config.no_mmap === true;
  if (wantsMlock || wantsNoMmap) {
    const loadMode = wantsMlock ? wantsNoMmap ? "mlock" : "mmap+mlock" : "none";
    lines.push(`load-mode = ${loadMode}`);
  }
  if (typeof config.rope_scaling === "string" && config.rope_scaling.length > 0 && config.rope_scaling !== "auto") {
    lines.push(`rope-scaling = ${escapeIniValue(config.rope_scaling)}`);
  }
  if (typeof config.rope_freq_base === "number" && Number.isFinite(config.rope_freq_base) && config.rope_freq_base > 0) {
    lines.push(`rope-freq-base = ${config.rope_freq_base}`);
  }
  if (typeof config.rope_freq_scale === "number" && Number.isFinite(config.rope_freq_scale) && config.rope_freq_scale > 0) {
    lines.push(`rope-freq-scale = ${config.rope_freq_scale}`);
  }
  if (config.ctx_shift === true) {
    lines.push("context-shift = true");
  }
  if (typeof config.cache_ram === "number" && Number.isFinite(config.cache_ram) && config.cache_ram !== 8192) {
    lines.push(`cache-ram = ${Math.floor(config.cache_ram)}`);
  }
  if (config.lazy_mode === "on" || config.lazy_mode === "off") {
    lines.push(`lazy-mode = ${config.lazy_mode}`);
  }
  lines.push(`slot-save-path = ${escapeIniValue(threadCacheDir(providerPath))}`);
  if (typeof config.cache_reuse === "number" && Number.isFinite(config.cache_reuse) && config.cache_reuse > 0) {
    lines.push(`cache-reuse = ${Math.floor(config.cache_reuse)}`);
  }
  if (config.swa_full === true) {
    lines.push("swa-full = true");
  }
  if (config.kv_unified === "on") {
    lines.push("kv-unified = true");
  } else if (config.kv_unified === "off") {
    lines.push("kv-unified = false");
  }
  if (typeof config.kv_unified_per_slot === "number" && Number.isFinite(config.kv_unified_per_slot) && config.kv_unified_per_slot > 0) {
    lines.push(`kv-unified-per-slot = ${Math.floor(config.kv_unified_per_slot)}`);
  }
  if (config.reasoning_preserve === false) {
    lines.push("reasoning-preserve = false");
  }
  if (typeof config.keep === "number" && Number.isFinite(config.keep) && config.keep !== 0) {
    lines.push(`keep = ${Math.floor(config.keep)}`);
  }
  lines.push("");
  const moeCacheAllowed = config.split_mode !== "tensor" && !(typeof config.device === "string" && config.device.trim().toLowerCase() === "none");
  let embeddingCount = 0;
  for (const { modelId, configPath } of modelEntries) {
    let mc;
    try {
      mc = await fs3.readYaml(configPath);
    } catch {
      continue;
    }
    if (!mc?.model_path) continue;
    const modelAbs = await joinPath3([janDataFolderPath, mc.model_path]);
    lines.push(`[${modelId}]`);
    lines.push(`model = ${escapeIniValue(modelAbs)}`);
    if (mc.mmproj_path) {
      const mmprojAbs = await joinPath3([janDataFolderPath, mc.mmproj_path]);
      lines.push(`mmproj = ${escapeIniValue(mmprojAbs)}`);
    }
    const chatTemplate = typeof mc.chat_template === "string" ? mc.chat_template.trim() : "";
    if (chatTemplate.length > 0) {
      const templateFile = await existingFilePath(chatTemplate);
      if (templateFile) {
        lines.push(`chat-template-file = ${escapeIniValue(templateFile)}`);
      } else if (BUILTIN_TEMPLATE_NAME_RE.test(chatTemplate)) {
        lines.push(`chat-template = ${chatTemplate}`);
      } else {
        const templatePath = await joinPath3([
          modelsDir,
          modelId,
          "chat_template.jinja"
        ]);
        await fs3.writeFileSync(templatePath, chatTemplate);
        lines.push(`chat-template-file = ${escapeIniValue(templatePath)}`);
      }
    }
    const grammar = typeof mc.grammar === "string" ? mc.grammar.trim() : "";
    if (grammar.length > 0) {
      const grammarFile = await existingFilePath(grammar);
      if (grammarFile) {
        lines.push(`grammar-file = ${escapeIniValue(grammarFile)}`);
      } else {
        const grammarPath = await joinPath3([modelsDir, modelId, "grammar.gbnf"]);
        await fs3.writeFileSync(grammarPath, grammar);
        lines.push(`grammar-file = ${escapeIniValue(grammarPath)}`);
      }
    }
    let ctxEmitted = false;
    if (typeof mc.ctx_size === "number" && Number.isFinite(mc.ctx_size) && mc.ctx_size >= 0) {
      lines.push(`ctx-size = ${mc.ctx_size}`);
      ctxEmitted = true;
    }
    if (!fitEnabled && typeof mc.n_gpu_layers === "number" && mc.n_gpu_layers >= -2) {
      lines.push(`n-gpu-layers = ${mc.n_gpu_layers}`);
    }
    if (typeof mc.flash_attn === "string" && (mc.flash_attn === "on" || mc.flash_attn === "off")) {
      lines.push(`flash-attn = ${mc.flash_attn}`);
    }
    if (typeof mc.cache_type_k === "string" && mc.cache_type_k.length > 0 && mc.cache_type_k !== "f16") {
      lines.push(`cache-type-k = ${escapeIniValue(mc.cache_type_k)}`);
    }
    if (typeof mc.cache_type_v === "string" && mc.cache_type_v.length > 0 && mc.cache_type_v !== "f16") {
      lines.push(`cache-type-v = ${escapeIniValue(mc.cache_type_v)}`);
    }
    const hasMtpModel = typeof mc.mtp_model_path === "string" && mc.mtp_model_path.length > 0;
    const hasMtpLayers = typeof mc.mtp_layers === "number" && mc.mtp_layers > 0;
    const specDecoding = mc.mtp === true && (hasMtpLayers || hasMtpModel);
    const modelParallel = explicitParallel(mc.parallel);
    if (modelParallel !== void 0) {
      lines.push(`parallel = ${modelParallel}`);
      if (kvUnifiedIsAuto) lines.push("kv-unified = true");
    } else if (specDecoding && explicitParallel(config.parallel) === void 0) {
      lines.push("parallel = 1");
      if (kvUnifiedIsAuto) lines.push("kv-unified = true");
    }
    if (mc.cont_batching === false) {
      lines.push("cont-batching = false");
    }
    if (typeof mc.batch_size === "number" && mc.batch_size > 0 && mc.batch_size !== 2048) {
      lines.push(`batch-size = ${Math.floor(mc.batch_size)}`);
    }
    if (typeof mc.ubatch_size === "number" && mc.ubatch_size > 0 && mc.ubatch_size !== 512) {
      lines.push(`ubatch-size = ${Math.floor(mc.ubatch_size)}`);
    }
    if (mc.cpu_moe === true) {
      lines.push("cpu-moe = true");
    }
    if (typeof mc.n_cpu_moe === "number" && mc.n_cpu_moe > 0) {
      lines.push(`n-cpu-moe = ${Math.floor(mc.n_cpu_moe)}`);
    }
    if (typeof mc.n_cpu_ffn === "number" && mc.n_cpu_ffn > 0) {
      lines.push(`n-cpu-ffn = ${Math.floor(mc.n_cpu_ffn)}`);
    }
    if (moeCacheAllowed && typeof mc.expert_count === "number" && mc.expert_count > 0 && typeof mc.moe_cache_mib === "number" && Number.isFinite(mc.moe_cache_mib) && mc.moe_cache_mib > 0) {
      lines.push(`moe-cache-mib = ${Math.floor(mc.moe_cache_mib)}`);
    }
    if (mc.no_kv_offload === true) {
      lines.push("no-kv-offload = true");
    }
    if (typeof mc.override_tensor === "string" && mc.override_tensor.trim().length > 0) {
      lines.push(`override-tensor = ${escapeIniValue(mc.override_tensor)}`);
    }
    if (mc.mmproj_offload === false) {
      lines.push("mmproj-offload = false");
    }
    if (specDecoding) {
      const specType = typeof mc.spec_type === "string" && SPEC_TYPES.has(mc.spec_type) ? mc.spec_type : DEFAULT_SPEC_TYPE;
      lines.push(`spec-type = ${specType}`);
      if (hasMtpModel) {
        const mtpAbs = await joinPath3([janDataFolderPath, mc.mtp_model_path]);
        lines.push(`spec-draft-model = ${escapeIniValue(mtpAbs)}`);
      }
      if (typeof mc.spec_draft_n_max === "number" && mc.spec_draft_n_max > 0) {
        lines.push(`spec-draft-n-max = ${Math.floor(mc.spec_draft_n_max)}`);
      }
      if (typeof mc.spec_draft_n_min === "number" && mc.spec_draft_n_min >= 0) {
        lines.push(`spec-draft-n-min = ${Math.floor(mc.spec_draft_n_min)}`);
      }
      if (typeof mc.spec_draft_p_min === "number" && mc.spec_draft_p_min >= 0 && mc.spec_draft_p_min <= 1) {
        lines.push(`spec-draft-p-min = ${mc.spec_draft_p_min}`);
      }
      if (mc.spec_draft_sampling === NON_DEFAULT_DRAFT_SAMPLING) {
        lines.push(`spec-draft-sampling = ${NON_DEFAULT_DRAFT_SAMPLING}`);
      }
      if (typeof mc.spec_draft_n_ubatch === "number" && Number.isFinite(mc.spec_draft_n_ubatch) && mc.spec_draft_n_ubatch > 0) {
        lines.push(`spec-draft-n-ubatch = ${Math.floor(mc.spec_draft_n_ubatch)}`);
      }
    }
    const samplingIniKeys = [
      ["temperature", "temperature", 0.8],
      ["top_k", "top-k", 40],
      ["top_p", "top-p", 0.95],
      ["min_p", "min-p", 0.05],
      ["repeat_last_n", "repeat-last-n", 64],
      ["repeat_penalty", "repeat-penalty", 1],
      ["presence_penalty", "presence-penalty", null],
      ["frequency_penalty", "frequency-penalty", null]
    ];
    for (const [yamlKey, iniKey, upstreamDefault] of samplingIniKeys) {
      const v = mc[yamlKey];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (upstreamDefault !== null && v === upstreamDefault) continue;
      if (iniKey === "repeat-last-n" && v < 0) continue;
      lines.push(`${iniKey} = ${v}`);
    }
    if (mc.embedding === true) {
      embeddingCount++;
      lines.push("embeddings = true");
      if (!ctxEmitted) {
        lines.push("ctx-size = 0");
      }
      const pooling = typeof mc.pooling === "string" && mc.pooling.length > 0 ? mc.pooling : "mean";
      lines.push(`pooling = ${escapeIniValue(pooling)}`);
      const ubatch = typeof mc.ubatch_size === "number" && mc.ubatch_size > 0 ? mc.ubatch_size : DEFAULT_EMBEDDING_UBATCH;
      const batch = typeof mc.batch_size === "number" && mc.batch_size >= ubatch ? mc.batch_size : ubatch;
      lines.push(`ubatch-size = ${ubatch}`);
      lines.push(`batch-size = ${batch}`);
    }
    lines.push("load-on-startup = false");
    lines.push("");
  }
  const outPath = await joinPath3([providerPath, "router.preset.ini"]);
  const tmpPath = await joinPath3([providerPath, "router.preset.ini.tmp"]);
  const body = lines.join("\n");
  await fs3.writeFileSync(tmpPath, body);
  try {
    if (await fs3.existsSync(outPath)) {
      try {
        await fs3.rm(outPath);
      } catch {
      }
    }
    await fs3.mv(tmpPath, outPath);
  } catch {
    await fs3.writeFileSync(outPath, body);
    try {
      await fs3.rm(tmpPath);
    } catch {
    }
  }
  return { path: outPath, embeddingCount };
}

// dsh/llamacpp/src/readiness.ts
var HOST_DEVICES = { cpu: true, blas: true };
function deviceNames(deviceIds) {
  return deviceIds.map((id) => id.trim().replace(/\d+$/, "").toLowerCase()).filter((name) => name !== "").map((name) => name === "mtl" ? "metal" : name);
}
function countAcceleratorDevices(deviceIds) {
  return deviceNames(deviceIds).filter((name) => HOST_DEVICES[name] !== true).length;
}
function backendFromDeviceIds(deviceIds) {
  const names = deviceNames(deviceIds);
  return names.find((name) => HOST_DEVICES[name] !== true) ?? names[0] ?? "";
}
function evaluateGpuOffload(input) {
  const { engineDeviceCount, hardwareGpuCount } = input;
  const gpuExpected = hardwareGpuCount > 0;
  if (!gpuExpected || engineDeviceCount > 0) {
    return { status: "ok", gpuExpected, engineDeviceCount };
  }
  return {
    status: "warning",
    gpuExpected,
    engineDeviceCount,
    reason: "runtimeUnreachable"
  };
}
function evaluateEmbeddingVector(vector) {
  if (!Array.isArray(vector)) {
    return { ok: false, dimension: 0, problem: "missing" };
  }
  if (vector.length === 0) {
    return { ok: false, dimension: 0, problem: "empty" };
  }
  const dimension = vector.length;
  const hasInvalid = vector.some(
    (value) => typeof value !== "number" || !Number.isFinite(value)
  );
  if (hasInvalid) {
    return { ok: false, dimension, problem: "nonFinite" };
  }
  if (vector.every((value) => value === 0)) {
    return { ok: false, dimension, problem: "degenerate" };
  }
  return { ok: true, dimension };
}

// src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index.ts
import { invoke } from "../native/tauri.mjs";
import { listen } from "../native/tauri.mjs";
function asNumber(v, defaultValue = 0) {
  if (v === "" || v === null || v === void 0) return defaultValue;
  const n = Number(v);
  return isFinite(n) ? n : defaultValue;
}
var I32_MAX = 2147483647;
var I32_MIN = -2147483648;
function asI32(v, defaultValue = 0) {
  const n = Math.trunc(asNumber(v, defaultValue));
  if (n > I32_MAX) return I32_MAX;
  if (n < I32_MIN) return I32_MIN;
  return n;
}
async function loadLlamaModel(modelId, isEmbedding = false) {
  return await invoke("plugin:llamacpp|load_llama_model", {
    modelId,
    isEmbedding
  });
}
async function unloadLlamaModel(modelId) {
  return await invoke("plugin:llamacpp|unload_llama_model", { modelId });
}
async function ensureSessionReady(modelId, isEmbedding = false) {
  return await invoke("plugin:llamacpp|ensure_session_ready", {
    modelId,
    isEmbedding
  });
}
async function findSessionByModel(modelId) {
  return await invoke("plugin:llamacpp|find_session_by_model", { modelId });
}
async function getLoadedModels() {
  return await invoke("plugin:llamacpp|get_loaded_models");
}
async function startEngine(presetPath, modelsMax, slotCacheMib = 0, envs = {}) {
  return await invoke("plugin:llamacpp|start_engine", {
    presetPath,
    modelsMax,
    slotCacheMib: asI32(slotCacheMib),
    envs
  });
}
async function stopEngine() {
  return await invoke("plugin:llamacpp|stop_engine");
}
async function getEngineInfo() {
  return await invoke("plugin:llamacpp|get_engine_info");
}
async function getEngineVersion() {
  return await invoke("plugin:llamacpp|get_engine_version");
}
async function engineDevices(envs = {}) {
  return await invoke("plugin:llamacpp|engine_devices", { envs });
}
async function beginEngineRestart() {
  return await invoke("plugin:llamacpp|begin_engine_restart");
}
async function endEngineRestart() {
  return await invoke("plugin:llamacpp|end_engine_restart");
}
async function eraseThreadSlotState(args) {
  return await invoke("plugin:llamacpp|erase_thread_slot_state", {
    threadId: args.threadId,
    modelId: args.modelId,
    cacheDir: args.cacheDir
  });
}
async function reloadEngineModels(presetPath, modelsMax, slotCacheMib) {
  return await invoke("plugin:llamacpp|reload_engine_models", {
    presetPath,
    modelsMax,
    slotCacheMib: slotCacheMib === void 0 ? void 0 : asI32(slotCacheMib)
  });
}
async function readGgufMetadata(path) {
  return await invoke("plugin:llamacpp|read_gguf_metadata", { path });
}
async function findGgufTensors(path, names) {
  return await invoke("plugin:llamacpp|find_gguf_tensors", { path, names });
}
async function isModelSupported(path, ctxSize) {
  return await invoke("plugin:llamacpp|is_model_supported", {
    path,
    ctxSize
  });
}

// dsh/llamacpp/src/deviceMemory.ts
function overrideAmdVulkanMemory(devices, gpus, usage) {
  const uuidToUsage = /* @__PURE__ */ new Map();
  for (const u of usage) {
    if (u && typeof u.uuid === "string") uuidToUsage.set(u.uuid, u);
  }
  const gpuByName = /* @__PURE__ */ new Map();
  for (const gpu of gpus) {
    if (typeof gpu?.vendor !== "string" || !gpu.vendor.toUpperCase().includes("AMD") || typeof gpu.vulkan_info?.index !== "number" || typeof gpu.uuid !== "string" || typeof gpu.name !== "string") {
      continue;
    }
    gpuByName.set(gpu.name, gpuByName.has(gpu.name) ? null : gpu.uuid);
  }
  if (gpuByName.size === 0) return devices;
  const deviceCountByName = /* @__PURE__ */ new Map();
  for (const dev of devices) {
    if (/^Vulkan\d+/.test(dev.id ?? "")) {
      deviceCountByName.set(
        dev.name,
        (deviceCountByName.get(dev.name) ?? 0) + 1
      );
    }
  }
  const uuidFor = (dev) => /^Vulkan\d+/.test(dev.id ?? "") && deviceCountByName.get(dev.name) === 1 ? gpuByName.get(dev.name) : void 0;
  return devices.map((dev) => {
    const uuid = uuidFor(dev);
    const u = uuid ? uuidToUsage.get(uuid) : void 0;
    if (!u || typeof u.total_memory !== "number" || typeof u.used_memory !== "number") {
      return dev;
    }
    const total = Math.max(0, Math.floor(u.total_memory));
    const free = Math.max(0, Math.floor(u.total_memory - u.used_memory));
    return { ...dev, mem: total, free };
  });
}

// src-tauri/plugins/tauri-plugin-hardware/guest-js/index.ts
import { invoke as invoke2 } from "../native/tauri.mjs";
async function getSystemInfo() {
  return await invoke2("plugin:hardware|get_system_info");
}
async function getSystemUsage() {
  return await invoke2("plugin:hardware|get_system_usage");
}

// dsh/llamacpp/src/engine.ts
var EMBEDDING_CHECK_VERSION = 3;
var MTP_CHECK_VERSION = 1;
var EXPERT_CHECK_VERSION = 1;
var MARKOV_HEAD_TENSOR = "markov_w1.weight";
var TEMPLATE_KWARGS_CHECK_VERSION = 1;
var PRESET_AFFECTING_KEYS = /* @__PURE__ */ new Set([
  "fit",
  "fit_target",
  "fit_ctx",
  "flash_attn",
  "cache_type_k",
  "cache_type_v",
  "parallel",
  "cont_batching",
  "threads",
  "threads_batch",
  "n_predict",
  "batch_size",
  "ubatch_size",
  "n_cpu_moe",
  "n_cpu_ffn",
  "no_kv_offload",
  "device",
  "split_mode",
  "main_gpu",
  "no_mmap",
  "mlock",
  "rope_scaling",
  "rope_freq_base",
  "rope_freq_scale",
  "ctx_shift",
  "cache_ram",
  // persist_thread_cache decides whether slot-save-path is emitted at all;
  // thread_cache_size is not a preset key but rides the same reload, which
  // carries it to the worker (see reload_engine_models).
  "persist_thread_cache",
  "thread_cache_size",
  "cache_reuse",
  "swa_full",
  "keep",
  "kv_unified",
  "tensor_split",
  "no_op_offload",
  "ctx_checkpoints",
  "checkpoint_min_step",
  "kv_unified_per_slot",
  "reasoning_preserve",
  "lazy_mode"
]);
var MODEL_PROVIDER_STORE_KEY = "model-provider";
var EMBEDDER_BOOTSTRAP_KEY = "llamacpp-embedder-bootstrapped";
var SETUP_CONSENT_KEY = "llamacpp-first-run-setup-started";
var FALLBACK_EMBEDDING_MODEL_ID = "sentence-transformer-mini";
var FALLBACK_EMBEDDING_MODEL_URL = "https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true";
var LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY = "llamacpp_model_yaml_backfill_v2";
var LEGACY_NGL_DEFAULT = 100;
var LEGACY_NGL_SWEPT_KEY = "llamacpp_legacy_ngl_swept_v1";
var SEEDED_CTX_SIZE = 8192;
var SEEDED_CTX_CLEARED_KEY = "llamacpp_seeded_ctx_cleared_v1";
var DEFAULT_TIMEOUT = 600;
var EMBEDDING_PROBE_TEXT = "jan setup embedding probe";
var coerceFloatSetting = (v) => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
var coerceIntSetting = (v) => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};
var MODEL_SETTINGS_YAML_MAPPING = {
  // Sampling defaults: persisted to model.yml and emitted into the router
  // preset so they apply server-side to every request (chat and external API),
  // overridable per-request. Keys mirror MODEL_SAMPLING_SETTING_KEYS in the
  // web-app transport.
  temperature: { yamlKey: "temperature", coerce: coerceFloatSetting },
  top_k: { yamlKey: "top_k", coerce: coerceIntSetting },
  top_p: { yamlKey: "top_p", coerce: coerceFloatSetting },
  min_p: { yamlKey: "min_p", coerce: coerceFloatSetting },
  // Not coerceIntSetting: upstream throws on a negative window on both the
  // preset path and the per-request path, so a legacy -1 from the old
  // "-1 = full context" UI has to be dropped, not passed through. Omitting the
  // key lets upstream's own default (64) apply.
  repeat_last_n: {
    yamlKey: "repeat_last_n",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
  },
  repeat_penalty: { yamlKey: "repeat_penalty", coerce: coerceFloatSetting },
  presence_penalty: { yamlKey: "presence_penalty", coerce: coerceFloatSetting },
  frequency_penalty: {
    yamlKey: "frequency_penalty",
    coerce: coerceFloatSetting
  },
  ctx_len: {
    yamlKey: "ctx_size",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  ngl: {
    yamlKey: "n_gpu_layers",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= -2 ? Math.floor(n) : null;
    }
  },
  chat_template: {
    yamlKey: "chat_template",
    coerce: (v) => typeof v === "string" && v.trim().length > 0 ? v : null
  },
  grammar: {
    yamlKey: "grammar",
    coerce: (v) => typeof v === "string" && v.trim().length > 0 ? v : null
  },
  batch_size: {
    yamlKey: "batch_size",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  ubatch_size: {
    yamlKey: "ubatch_size",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  cpu_moe: {
    yamlKey: "cpu_moe",
    coerce: (v) => v === true ? true : null
  },
  n_cpu_moe: {
    yamlKey: "n_cpu_moe",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  n_cpu_ffn: {
    yamlKey: "n_cpu_ffn",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  moe_cache_mib: {
    yamlKey: "moe_cache_mib",
    coerce: (v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  },
  no_kv_offload: {
    yamlKey: "no_kv_offload",
    coerce: (v) => v === true ? true : null
  },
  override_tensor_buffer_t: {
    yamlKey: "override_tensor",
    coerce: (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : null
  },
  offload_mmproj: {
    yamlKey: "mmproj_offload",
    coerce: (v) => v === false ? false : null
  }
};
async function readPersistedLlamacppModels() {
  try {
    const raw = await getBackendSetting(MODEL_PROVIDER_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const providers = parsed?.state?.providers;
    if (!Array.isArray(providers)) return [];
    const llamacpp = providers.find(
      (provider) => provider?.provider === "llamacpp"
    );
    return Array.isArray(llamacpp?.models) ? llamacpp.models : [];
  } catch (error) {
    logger4.warn("Failed to read persisted llamacpp model settings:", error);
    return [];
  }
}
var PACKAGE_NAME = "@janhq/llamacpp-extension";
var LlamacppEngine = class extends AIEngine {
  provider = "llamacpp";
  timeout = 600;
  llamacpp_env = "";
  providerId = "llamacpp";
  config;
  providerPath;
  /** Keyed by modelId; two imports of one model would cancel each other. */
  pendingImports = /* @__PURE__ */ new Map();
  embedderBootstrapError;
  /**
   * True while the fallback embedder is being fetched.
   *
   * The old readiness gate keyed off "no backend selected yet", which happened
   * to cover this window on a fresh install. The engine ships with the app now,
   * so that proxy is gone and this is the direct signal -- without it, a normal
   * first-run download is reported as a failed embedding check.
   */
  embedderBootstrapping = false;
  loadingModels = /* @__PURE__ */ new Map();
  // Track loading promises
  engineVersion;
  engineStartLock = null;
  // Requests holding the engine's port and key (see acquireEngineLease), and the
  // gate a device restart raises so that none is admitted while it decides.
  engineLeases = 0;
  engineGate = null;
  // Reconciliations run one after another; see reconcileEngineDevices.
  reconcileQueue = Promise.resolve();
  userModelsMax = 1;
  loadedChatOrder = [];
  // The engine worker spawn runs off the onLoad critical path; awaited via
  // ensureEngineReady() before any model load so inference never races it.
  backgroundInit;
  /** Single-flight provisioning run; see ensureProvisioned(). */
  provisioning;
  // Requests to the engine on loopback go through a proxy-bypassing client;
  // see lib/loopback-fetch.ts.
  loopbackFetch = loopbackFetch;
  async start() {
    await this.migrateLocalStorageToFile();
    const settings = structuredClone(settings_default);
    applyPlatformFitDefault(settings, owIsMacOS);
    await this.registerSettings(settings);
    let loadedConfig = {};
    for (const item of settings) {
      const defaultValue = item.controllerProps.value;
      loadedConfig[item.key] = await this.getSetting(
        item.key,
        defaultValue
      );
    }
    this.config = loadedConfig;
    await this.migrateAutoUnloadToModelsMax();
    await this.migrateParallelToDefault();
    this.timeout = asI32(this.config.timeout, DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT;
    this.llamacpp_env = this.config.llamacpp_env;
    await this.getProviderPath();
    await this.migrateLegacyNgl();
    await this.migratePersistedModelSettingsToYaml();
    await this.migrateSeededCtxSize();
    this.backgroundInit = this.ensureProvisioned();
  }
  /**
   * Runs the first-run provisioning the setup screen asked for, and remembers
   * that it was asked so a later launch does not wait again.
   */
  async startFirstRunSetup() {
    try {
      await setBackendSetting(SETUP_CONSENT_KEY, "true");
    } catch (e) {
      logger4.warn("Could not persist the first-run setup flag:", e);
    }
    await this.ensureProvisioned();
  }
  /**
   * Starts the engine, then installs the fallback embedder. Single-flight:
   * startup, the setup screen and the first model load can all ask for it, and
   * only one run happens.
   *
   * There is no backend selection step any more -- the engine is linked into
   * the shipped worker at a pinned version, so the ordering dance between
   * "download a backend first" and "start first for availability" is gone.
   */
  ensureProvisioned() {
    this.provisioning ??= (async () => {
      try {
        await this.startEngine();
      } catch (e) {
        logger4.error("Engine failed to start during provisioning:", e);
        this.reportMissingLibrariesFromError(e);
      }
      await this.bootstrapDefaultEmbedder();
    })();
    this.backgroundInit = this.provisioning;
    return this.provisioning;
  }
  /**
   * One-shot startup install of the fallback embedder so the router reserves
   * the +1 embedding slot from its first start instead of importing the model
   * mid-session on the first RAG call. Runs after the router is up so the
   * download never delays chat availability; the import's preset refresh then
   * resizes models_max via an idle restart (nothing is loaded yet at startup).
   * The persisted flag keeps this from resurrecting a model the user deleted,
   * and is only set on success so a failed download retries next launch.
   */
  async bootstrapDefaultEmbedder() {
    try {
      if (await getBackendSetting(EMBEDDER_BOOTSTRAP_KEY)) return;
      if (!await this.hasEmbedderInstalled()) {
        this.embedderBootstrapping = true;
        await this.import(FALLBACK_EMBEDDING_MODEL_ID, {
          modelPath: FALLBACK_EMBEDDING_MODEL_URL
        });
        if (!await this.hasEmbedderInstalled()) {
          throw new Error(
            `Import of "${FALLBACK_EMBEDDING_MODEL_ID}" did not complete`
          );
        }
        logger4.info(
          `Pre-installed fallback embedding model "${FALLBACK_EMBEDDING_MODEL_ID}" at startup`
        );
      }
      await setBackendSetting(EMBEDDER_BOOTSTRAP_KEY, "true");
      this.embedderBootstrapError = void 0;
    } catch (e) {
      this.embedderBootstrapError = e instanceof Error ? e.message : String(e);
      logger4.warn(
        "Fallback embedder bootstrap failed (will import on demand):",
        e
      );
    } finally {
      this.embedderBootstrapping = false;
    }
  }
  async hasEmbedderInstalled() {
    const models = await this.list();
    return models.some((m) => m.embedding === true);
  }
  /**
   * Why the startup embedder install failed, for setup to report. Undefined
   * when it succeeded or has not run; the import is retried on demand, so this
   * is advisory rather than terminal.
   */
  /**
   * A launch failure that names unresolvable libraries is the one dependency
   * problem a bundled engine still has: the GPU driver runtime (CUDA, Vulkan)
   * lives on the user's machine, not in the app. Raises the same dependency
   * dialog the old pre-flight backend verification did.
   */
  reportMissingLibrariesFromError(error) {
    const err = error;
    if (err?.code !== "MISSING_SHARED_LIBRARY") return;
    const libs = Array.isArray(err.missing_libraries) ? err.missing_libraries.filter(
      (lib) => typeof lib === "string"
    ) : [];
    if (libs.length === 0) return;
    const joined = libs.join(" ").toLowerCase();
    const backend = ["cuda", "vulkan", "hip", "metal"].find(
      (b) => joined.includes(b)
    );
    events.emit(AppEvent.onBackendVerificationFailed, {
      backend: backend ?? "",
      missingLibraries: libs
    });
  }
  getEmbedderBootstrapError() {
    return this.embedderBootstrapError;
  }
  /**
   * Proves the embedding model can actually produce a usable vector, rather
   * than inferring health from a completed download. Never throws: setup
   * reports the problem and lets the user continue.
   */
  async verifyEmbeddingModel() {
    if (this.embedderBootstrapping) {
      return { status: "ok", pending: true };
    }
    let modelId;
    try {
      const sInfo = await this.ensureEmbeddingModelLoaded();
      modelId = sInfo.model_id;
      const response = await this.embed([EMBEDDING_PROBE_TEXT]);
      const check = evaluateEmbeddingVector(response?.data?.[0]?.embedding);
      return {
        status: check.ok ? "ok" : "warning",
        modelId,
        dimension: check.dimension,
        problem: check.problem
      };
    } catch (e) {
      return {
        status: "warning",
        modelId,
        error: this.getEmbedderBootstrapError() ?? (e instanceof Error ? e.message : String(e))
      };
    }
  }
  /**
   * Detects a GPU backend that runs entirely on the CPU. Such a router starts
   * cleanly and reports healthy, so this comparison against the engine's own
   * device list is the only signal that offload never happened.
   */
  async verifyGpuOffload() {
    let devices;
    try {
      devices = await this.getDevices();
    } catch (e) {
      return {
        status: "warning",
        backend: "",
        gpuExpected: false,
        engineDeviceCount: 0,
        error: e instanceof Error ? e.message : String(e)
      };
    }
    let hardwareGpuCount = 0;
    try {
      hardwareGpuCount = (await getSystemInfo())?.gpus?.length ?? 0;
    } catch (e) {
      logger4.warn("Hardware GPU probe failed during setup verification:", e);
    }
    const deviceIds = devices.map((d) => d.id);
    return {
      backend: backendFromDeviceIds(deviceIds),
      ...evaluateGpuOffload({
        engineDeviceCount: countAcceleratorDevices(deviceIds),
        hardwareGpuCount
      })
    };
  }
  async getSettings() {
    return readSettingsFile();
  }
  async updateSettings(componentProps) {
    const previousConfig = { ...this.config };
    const previousTimeout = this.timeout;
    const previousEnv = this.llamacpp_env;
    const changed = [];
    await mutateSettingsFile((current) => {
      changed.length = 0;
      if (current.length === 0) {
        const list = componentProps;
        for (const s of list) {
          changed.push({ key: s.key, previous: void 0, value: s.controllerProps.value });
        }
        return list;
      }
      const updated = current.map((s) => {
        const patch = componentProps.find((p) => p.key === s.key);
        if (!patch?.controllerProps) return s;
        const nextValue = patch.controllerProps.value;
        const prevValue = s.controllerProps.value;
        if (nextValue !== prevValue) {
          changed.push({ key: s.key, previous: prevValue, value: nextValue });
        }
        return {
          ...s,
          controllerProps: { ...s.controllerProps, value: nextValue }
        };
      });
      return changed.length === 0 ? null : updated;
    });
    if (changed.length === 0) return;
    for (const { key, value } of changed) {
      this.onSettingUpdate(key, value);
    }
    if (this.presetRefreshTimer) {
      clearTimeout(this.presetRefreshTimer);
      this.presetRefreshTimer = null;
      if (this.backgroundInit) {
        try {
          await this.refreshEnginePreset();
        } catch (error) {
          this.config = previousConfig;
          this.timeout = previousTimeout;
          this.llamacpp_env = previousEnv;
          const reverted = changed.filter(
            (c) => PRESET_AFFECTING_KEYS.has(c.key) || c.key === "models_max"
          );
          if (reverted.length > 0) {
            await mutateSettingsFile((file) => {
              const restored = file.flatMap((s) => {
                const touched = reverted.find((c) => c.key === s.key);
                if (touched === void 0) return [s];
                if (touched.previous === void 0) return [];
                return [{
                  ...s,
                  controllerProps: { ...s.controllerProps, value: touched.previous }
                }];
              });
              return restored;
            });
            throw new Error(
              `Saved, but the engine could not apply ${reverted.map((c) => c.key).join(", ")}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          logger4.warn(
            `Engine preset reload failed after saving ${changed.map((c) => c.key).join(", ")}; the saved values stand:`,
            error
          );
        }
      }
    }
  }
  async registerSettings(settings) {
    settings.forEach((s) => {
      s.extensionName = PACKAGE_NAME;
    });
    let old;
    try {
      old = await readSettingsFile();
    } catch (error) {
      const backup = await preserveInvalidSettingsFile();
      logger4.error(
        `Engine settings could not be read (${error instanceof Error ? error.message : String(error)}); ` + (backup ? `kept them at ${backup} and reset to defaults` : "could not keep a copy, resetting to defaults")
      );
      old = [];
    }
    if (old.length) {
      settings.forEach((s) => {
        const prev = old.find((o) => o.key === s.key);
        if (!prev) return;
        const cp = s.controllerProps;
        const pcp = prev.controllerProps;
        if (pcp.value !== void 0) cp.value = pcp.value;
        if ("options" in cp) {
          const newOptions = cp.options ?? [];
          if (newOptions.length === 0 && Array.isArray(pcp.options)) {
            cp.options = pcp.options;
          }
          const opts = cp.options ?? [];
          if (opts.length && !opts.some((o) => o.value === cp.value)) {
            cp.value = opts[0]?.value;
          }
        }
      });
    }
    await writeSettingsFile(settings);
  }
  // The ONLY sanctioned localStorage use in this extension: a one-time read +
  // clear migrating pre-backend llamacpp settings into the file store. All
  // other persistence goes through backend-settings.ts. Guarded by
  // no-localstorage.test.ts via the `localstorage-migration-allowed` markers.
  async migrateLocalStorageToFile() {
    if (await settingsFileExists()) return;
    let raw = null;
    try {
      raw = localStorage.getItem(PACKAGE_NAME);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        await writeSettingsFile(parsed);
        logger4.info(
          `Migrated llamacpp settings from localStorage \u2192 file (${parsed.length} entries)`
        );
      }
    } catch (e) {
      logger4.warn("Failed to migrate localStorage settings to file:", e);
      return;
    }
    try {
      localStorage.removeItem(PACKAGE_NAME);
    } catch (e) {
      logger4.warn("Failed to clear migrated localStorage entry:", e);
    }
  }
  /**
   * Serialized: two concurrent calls would each run the stop-then-spawn
   * sequence, and the second would kill the worker the first had just brought
   * up. A late caller gets the in-flight start rather than a restart.
   */
  async startEngine() {
    const inflight = this.engineStartLock;
    if (inflight) {
      logger4.info("startEngine already in progress; awaiting the in-flight run");
      await inflight.catch(() => void 0);
      return;
    }
    this.engineStartLock = this.runStartEngine().finally(() => {
      this.engineStartLock = null;
    });
    return this.engineStartLock;
  }
  async runStartEngine() {
    const providerPath = await this.getProviderPath();
    const janDataFolderPath = await getJanDataFolderPath2();
    const { path: presetPath, embeddingCount } = await generatePreset(
      providerPath,
      janDataFolderPath,
      await this.presetConfig()
    );
    const modelsMax = this.resolveModelsMax(embeddingCount);
    const envs = {};
    envs["LLAMA_ARG_TIMEOUT"] = String(this.timeout);
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env);
    const info = await startEngine(
      presetPath,
      modelsMax,
      this.resolveThreadCacheBudget(),
      envs
    );
    logger4.info(
      `Engine devices at start: ${info.devices ? this.deviceKeys(info.devices).join(", ") : "not reported"}; device setting: ${String(this.config.device ?? "") || "(auto)"}`
    );
    logger4.info(
      `Engine worker started on port ${info.port} (pid ${info.pid}, models_max=${modelsMax}, ${info.models.length} models registered, preset=${presetPath})`
    );
  }
  /**
   * Drops a thread's saved prompt cache, for a thread the user deleted.
   *
   * Best-effort by design: the cache is invisible to the user and the store
   * prunes by size anyway, so failing here must not make deleting a thread
   * fail. Returns how many states were dropped.
   */
  async forgetThreadCache(threadId) {
    try {
      return await eraseThreadSlotState({
        threadId,
        cacheDir: threadCacheDir(await this.getProviderPath())
      });
    } catch (e) {
      logger4.warn(`could not drop the saved cache for thread ${threadId}: ${e}`);
      return 0;
    }
  }
  /**
   * The disk budget for saved thread caches, in MiB.
   *
   * 0 is the off switch on the worker side, so the toggle and the size collapse
   * into one number: a disabled feature and a zero budget are the same thing,
   * and keeping them separate would let the worker create a directory it would
   * never write to.
   */
  resolveThreadCacheBudget() {
    if (this.config.persist_thread_cache === false) return 0;
    const raw = Number(this.config.thread_cache_size);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.floor(raw);
  }
  /**
   * `models_max` including the embedding slot bonus.
   *
   * Reserves one extra slot when any embedder is installed so loading it does
   * not evict the user's chat model. Only one embedding model is ever resident
   * (RAG calls load() once per request), so the bonus is +1 regardless of how
   * many are installed. 0 (unlimited) stays unlimited.
   */
  resolveModelsMax(embeddingCount) {
    const raw = this.config.models_max;
    let modelsMax = 1;
    if (typeof raw === "number") modelsMax = raw;
    else if (typeof raw === "string" && raw.trim().length > 0) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 0) modelsMax = n;
    }
    this.userModelsMax = modelsMax;
    const bonus = modelsMax > 0 && embeddingCount > 0 ? 1 : 0;
    return modelsMax + bonus;
  }
  /**
   * Apply a preset change (model added/removed/renamed or a per-model setting)
   * to the running worker. Models whose preset section is unchanged stay
   * loaded, so an embedder import or a settings write no longer cold-reloads
   * the model the user is talking to.
   *
   * Unlike the router this also resizes `models_max`, so a change in the
   * embedding slot bonus no longer needs a restart either -- which was the one
   * remaining case that evicted a live chat model.
   */
  async refreshEnginePreset() {
    if (!await this.getEngineInfo()) {
      await this.startEngine();
      return;
    }
    const providerPath = await this.getProviderPath();
    const janDataFolderPath = await getJanDataFolderPath2();
    const { path: presetPath, embeddingCount } = await generatePreset(
      providerPath,
      janDataFolderPath,
      await this.presetConfig()
    );
    try {
      const report = await reloadEngineModels(
        presetPath,
        this.resolveModelsMax(embeddingCount),
        this.resolveThreadCacheBudget()
      );
      logger4.info(
        `Engine preset reloaded: +${report.added.length} ~${report.changed.length} -${report.removed.length}, ${report.kept.length} kept loaded`
      );
    } catch (e) {
      logger4.warn("Live engine reload failed; falling back to restart:", e);
      await this.startEngine();
    }
  }
  /**
   * Public accessor for downstream consumers. Returns `null` if the engine
   * worker hasn't started successfully yet.
   */
  async getEngineInfo() {
    try {
      const info = await getEngineInfo();
      if (info) {
        return { port: info.port, apiKey: info.api_key };
      }
    } catch (e) {
      logger4.warn("get_engine_info failed:", e);
    }
    return null;
  }
  /**
   * The bundled engine's identity. Cached after the first call: these are
   * compile-time constants of the plugin, so they cannot change while the app
   * is running, and the settings screen asks on every mount.
   */
  async getEngineVersion() {
    if (!this.engineVersion) {
      this.engineVersion = await getEngineVersion();
    }
    return this.engineVersion;
  }
  /**
   * Fetch runtime properties for a loaded model from the router's
   * `/props?model=<id>` endpoint. Returns `undefined` if the router isn't
   * running, the model isn't loaded, or the response is unusable. `nCtx` is
   * the post-fit value — what `fit_ctx` settled on — so it's the right
   * denominator for the token-usage popup.
   */
  async getModelProps(modelId) {
    const engine = await this.getEngineInfo();
    if (!engine || !modelId) return void 0;
    try {
      const loaded = await this.getLoadedModels();
      if (!loaded.includes(modelId)) return void 0;
    } catch {
      return void 0;
    }
    try {
      const url = `http://127.0.0.1:${engine.port}/props?model=${encodeURIComponent(modelId)}`;
      const res = await this.loopbackFetch(url, {
        headers: { Authorization: `Bearer ${engine.apiKey}` }
      });
      if (!res.ok) return void 0;
      const json = await res.json();
      const n = json?.default_generation_settings?.n_ctx;
      if (typeof n !== "number" || n <= 0) return void 0;
      const m = json.modalities;
      return {
        nCtx: n,
        totalSlots: typeof json.total_slots === "number" ? json.total_slots : void 0,
        modelAlias: json.model_alias,
        isSleeping: !!json.is_sleeping,
        modalities: m ? { vision: !!m.vision, video: !!m.video, audio: !!m.audio } : void 0
      };
    } catch {
      return void 0;
    }
  }
  async readMmprojCapabilities(mmprojPath) {
    try {
      const janDataFolderPath = await getJanDataFolderPath2();
      const fullPath = await joinPath4([janDataFolderPath, mmprojPath]);
      const meta = (await readGgufMetadata(fullPath)).metadata ?? {};
      const truthy = (v) => typeof v === "string" && v.toLowerCase() === "true";
      const vision = truthy(meta["clip.has_vision_encoder"]);
      const audio = truthy(meta["clip.has_audio_encoder"]);
      if (!vision && !audio) return { vision: true, audio: false };
      return { vision, audio };
    } catch (error) {
      logger4.warn("Failed to read mmproj capabilities:", error);
      return { vision: true, audio: false };
    }
  }
  async migrateAutoUnloadToModelsMax() {
    const MIGRATION_KEY = "llamacpp_models_max_migrated_v1";
    if (await getBackendSetting(MIGRATION_KEY)) return;
    try {
      const old = await this.getSetting(
        "auto_unload",
        void 0
      );
      if (old !== void 0) {
        const targetValue = old ? "1" : "0";
        const settings = await this.getSettings();
        await this.updateSettings(
          settings.map((item) => {
            if (item.key === "models_max") {
              item.controllerProps.value = targetValue;
            }
            return item;
          })
        );
        this.config.models_max = targetValue;
        logger4.info(
          `Migrated auto_unload=${old} -> models_max=${targetValue}`
        );
      }
    } catch (e) {
      logger4.warn("migrateAutoUnloadToModelsMax failed:", e);
      return;
    }
    await setBackendSetting(MIGRATION_KEY, "1");
  }
  // The old default was 1 plus two slots Jan reserved for background work and
  // other agent surfaces; both now share slot 0, so the reservation is gone and a persisted
  // 1 would pin the engine to a single slot rather than letting it resolve its
  // own count. Only the old default value is moved.
  async migrateParallelToDefault() {
    const MIGRATION_KEY = "llamacpp_parallel_default_v1";
    if (await getBackendSetting(MIGRATION_KEY)) return;
    try {
      if (asI32(this.config.parallel, 0) === 1) {
        const settings = await this.getSettings();
        await this.updateSettings(
          settings.map((item) => {
            if (item.key === "parallel") {
              item.controllerProps.value = 0;
            }
            return item;
          })
        );
        this.config.parallel = 0;
        logger4.info("Migrated parallel: 1 -> 0 (llama.cpp default)");
      }
    } catch (e) {
      logger4.warn("migrateParallelToDefault failed:", e);
      return;
    }
    await setBackendSetting(MIGRATION_KEY, "1");
  }
  async migratePersistedModelSettingsToYaml() {
    if (await getBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY)) return;
    const persistedModels = await readPersistedLlamacppModels();
    const providerPath = await this.getProviderPath();
    if (persistedModels.length === 0) {
      await setBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY, "1");
      return;
    }
    for (const persistedModel of persistedModels) {
      const modelId = typeof persistedModel.id === "string" ? persistedModel.id : void 0;
      if (!modelId || !persistedModel.settings) continue;
      const configPath = await joinPath4([
        providerPath,
        "models",
        modelId,
        "model.yml"
      ]);
      if (!await fs4.existsSync(configPath)) continue;
      const cfg = await fs4.readYaml(configPath);
      let touched = false;
      if (cfg.n_gpu_layers === LEGACY_NGL_DEFAULT) {
        delete cfg.n_gpu_layers;
        touched = true;
        logger4.info(
          `Removed legacy n_gpu_layers=${LEGACY_NGL_DEFAULT} from ${modelId}; GPU offload is auto again`
        );
      }
      for (const [sidebarKey, persistedSetting] of Object.entries(
        persistedModel.settings
      )) {
        const mapping = MODEL_SETTINGS_YAML_MAPPING[sidebarKey];
        if (!mapping) continue;
        if (mapping.yamlKey in cfg) continue;
        const value = persistedSetting?.controller_props?.value;
        if (sidebarKey === "ngl" && Number(value) === LEGACY_NGL_DEFAULT) {
          continue;
        }
        const next = mapping.coerce(value);
        if (next === null) continue;
        cfg[mapping.yamlKey] = next;
        touched = true;
      }
      if (touched) {
        await fs4.writeYaml(configPath, cfg);
      }
    }
    await setBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY, "1");
  }
  /**
   * One-shot: removes v1's `n_gpu_layers: 100` stamp from every model.yml. It
   * lives in the yaml, not in the persisted settings, so it is swept even when
   * nothing is persisted.
   */
  async migrateLegacyNgl() {
    if (await getBackendSetting(LEGACY_NGL_SWEPT_KEY)) return;
    await this.stripModelYamlValue(
      await this.getProviderPath(),
      "n_gpu_layers",
      LEGACY_NGL_DEFAULT
    );
    await setBackendSetting(LEGACY_NGL_SWEPT_KEY, "1");
  }
  /**
   * One-shot: drops the `ctx_size: 8192` the web-app seeded into every model
   * (and the settings backfill then copied into model.yml), so auto-fit may
   * shrink the context down to `fit_ctx`; upstream's fit leaves a set context
   * alone. The seed has no provenance, so 8192 is taken to be it. Nothing
   * changes with fit off: preset.ts's `[*] ctx-size` is 8192 too.
   */
  async migrateSeededCtxSize() {
    if (await getBackendSetting(SEEDED_CTX_CLEARED_KEY)) return;
    await this.stripModelYamlValue(
      await this.getProviderPath(),
      "ctx_size",
      SEEDED_CTX_SIZE
    );
    await setBackendSetting(SEEDED_CTX_CLEARED_KEY, "1");
  }
  /**
   * Removes `key` from every model.yml where it equals `value`.
   *
   * Walks the models directory rather than the persisted settings because a
   * stamped value is in the yaml even for models that no longer appear in the
   * persisted provider settings, so iterating the persisted list would miss them.
   */
  async stripModelYamlValue(providerPath, key, value) {
    const modelsDir = await joinPath4([providerPath, "models"]);
    if (!await fs4.existsSync(modelsDir)) return;
    for (const { configPath } of await findModelEntries(modelsDir)) {
      try {
        const cfg = await fs4.readYaml(configPath);
        if (cfg?.[key] !== value) continue;
        delete cfg[key];
        await fs4.writeYaml(configPath, cfg);
        logger4.info(`Removed ${key}=${value} from ${configPath}`);
      } catch (e) {
        logger4.warn(`${key} sweep skipped ${configPath}:`, e);
      }
    }
  }
  async getProviderPath() {
    if (!this.providerPath) {
      this.providerPath = await joinPath4([
        await getJanDataFolderPath2(),
        this.providerId
      ]);
    }
    return this.providerPath;
  }
  dispose() {
  }
  onSettingUpdate(key, value) {
    ;
    this.config[key] = value;
    if (key === "llamacpp_env") {
      this.llamacpp_env = value;
    } else if (key === "timeout") {
      this.timeout = asI32(value, DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT;
    } else if (key === "models_max") {
      this.schedulePresetRefresh();
    } else if (PRESET_AFFECTING_KEYS.has(key)) {
      this.schedulePresetRefresh();
    }
  }
  presetRefreshTimer = null;
  schedulePresetRefresh() {
    if (this.presetRefreshTimer) clearTimeout(this.presetRefreshTimer);
    this.presetRefreshTimer = setTimeout(() => {
      this.presetRefreshTimer = null;
      this.refreshEnginePreset().catch(
        (e) => logger4.warn("Preset refresh after settings update failed:", e)
      );
    }, 600);
  }
  async get(modelId) {
    const modelPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId
    ]);
    const path = await joinPath4([modelPath, "model.yml"]);
    if (!await fs4.existsSync(path)) return void 0;
    const modelConfig = await fs4.readYaml(path);
    const isEmbedding = await this.resolveEmbeddingConfig(modelId, modelConfig);
    await this.resolveMtpLayersConfig(modelId, modelConfig);
    await this.resolveExpertCountConfig(modelId, modelConfig);
    const templateKwargs = await this.resolveTemplateKwargsConfig(
      modelId,
      modelConfig
    );
    return {
      id: modelId,
      name: modelConfig.name ?? modelId,
      quant_type: void 0,
      // TODO: parse quantization type from model.yml or model.gguf
      providerId: this.provider,
      port: 0,
      // port is not known until the model is loaded
      sizeBytes: modelConfig.size_bytes ?? 0,
      embedding: isEmbedding,
      template_kwargs: templateKwargs
    };
  }
  async getModelContextLimit(modelId) {
    const config = await fs4.readYaml(
      await joinPath4([await this.getProviderPath(), "models", modelId, "model.yml"])
    );
    const path = await joinPath4([await getJanDataFolderPath2(), config.model_path]);
    const { metadata } = await readGgufMetadata(path);
    const limit = Number(metadata?.[`${metadata?.["general.architecture"]}.context_length`]);
    return Number.isInteger(limit) && limit > 0 ? limit : void 0;
  }
  /**
   * The context this model is configured to load with, and the output a request
   * may reserve against it. `nCtx` wins when the model is loaded, because the
   * router reports what fit actually settled on; otherwise the per-model
   * `ctx_size` is the answer, and failing that the preset's own guard applies.
   *
   * This is the single source for both the chat adapter and the compaction
   * policy, so the two can never price a request against different windows.
   */
  async getModelContextBudget(modelId) {
    let nCtx;
    let configured;
    try {
      nCtx = (await this.getModelProps(modelId))?.nCtx;
    } catch (e) {
      logger4.warn(`Could not read the loaded context of ${modelId}:`, e);
    }
    try {
      configured = await this.getModelContextSize(modelId);
    } catch (e) {
      logger4.warn(`Could not read ctx_size of ${modelId}:`, e);
    }
    return contextBudget({
      nCtx,
      configured,
      fit: this.config.fit !== false,
      fitFloor: Number(this.config.fit_ctx)
    });
  }
  /**
   * `ctx_size` from model.yml. `0` means "the model's own trained context", so
   * it is reported as undefined here: what the engine will serve becomes the
   * GGUF's limit, not zero.
   */
  async getModelContextSize(modelId) {
    const config = await fs4.readYaml(
      await joinPath4([await this.getProviderPath(), "models", modelId, "model.yml"])
    );
    const size = config?.ctx_size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return void 0;
    }
    return Math.floor(size);
  }
  /**
   * The largest context this machine can hold for the model, from the engine's
   * own device-fit estimate at each candidate size.
   *
   * This is the number that fixes the reported failure: with fit off, the preset
   * pins 8192 for every model, so a model trained for 262144 tokens is served
   * 8192 and a normal agent prompt overruns it. Auto-configuration writes the
   * per-model `ctx_size` the device supports instead, and the published window
   * comes from the same figure, so the prompt is budgeted against reality.
   * @param modelId - installed model id.
   * @returns the recommendation, with `fit: 'RED'` when nothing fits.
   */
  async getRecommendedContext(modelId) {
    const floor = Number(this.config.fit_ctx);
    const fallbackFloor = Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : FIT_FLOOR_CTX_SIZE;
    let nativeLimit;
    let modelPath;
    try {
      const config = await fs4.readYaml(
        await joinPath4([await this.getProviderPath(), "models", modelId, "model.yml"])
      );
      modelPath = await joinPath4([await getJanDataFolderPath2(), config.model_path]);
      nativeLimit = await this.getModelContextLimit(modelId);
    } catch (e) {
      logger4.warn(`No context recommendation for ${modelId}:`, e);
      return {
        tokens: fallbackFloor,
        fit: "RED",
        unknown: "the model file could not be read"
      };
    }
    if (nativeLimit === void 0) {
      return {
        tokens: fallbackFloor,
        fit: "RED",
        unknown: "the model file does not declare a trained context length"
      };
    }
    const candidates = contextCandidates(nativeLimit, fallbackFloor);
    let bounded = candidates;
    let ceiling;
    try {
      ceiling = await this.getVramContextCeiling(modelId);
    } catch (e) {
      logger4.warn(`Could not bound the context of ${modelId} by VRAM:`, e);
    }
    if (ceiling !== void 0) {
      const inside = candidates.filter((tokens) => tokens <= ceiling);
      if (inside.length > 0) bounded = inside;
    }
    const probes = [];
    for (const tokens of bounded) {
      let fit;
      try {
        fit = await this.isModelSupported(modelPath, tokens);
      } catch (e) {
        logger4.warn(`Device-fit probe failed at ${tokens} tokens:`, e);
        break;
      }
      probes.push({ tokens, fit });
      if (fit !== "RED") break;
    }
    return pickRecommendation({ probes, nativeLimit, floor: fallbackFloor, vramBound: ceiling });
  }
  /**
   * The context the GPUs' dedicated memory can hold for this model.
   *
   * `isModelSupported` answers the same question from the driver's own VRAM
   * report, which on Windows Vulkan includes the shared pool: every large window
   * comes back GREEN and the automatic pick then runs with the KV cache in system
   * RAM. This bound uses the hardware plugin's dedicated figures, the model's
   * own size and the KV bytes per token its GGUF metadata implies, so a window it
   * allows stays on the GPU.
   * @returns the largest token count, or undefined when a term is unknown.
   */
  async getVramContextCeiling(modelId) {
    const config = await fs4.readYaml(
      await joinPath4([await this.getProviderPath(), "models", modelId, "model.yml"])
    );
    const path = await joinPath4([await getJanDataFolderPath2(), config.model_path]);
    const { metadata } = await readGgufMetadata(path);
    const arch = metadata?.["general.architecture"];
    if (typeof arch !== "string") return void 0;
    const number = (key) => {
      const raw = metadata?.[`${arch}.${key}`];
      const value = typeof raw === "string" ? Number(raw) : void 0;
      return value !== void 0 && Number.isFinite(value) && value > 0 ? value : void 0;
    };
    const layers = number("block_count");
    const heads = number("attention.head_count_kv") ?? number("attention.head_count");
    const headCount = number("attention.head_count");
    const embedding = number("embedding_length");
    let keyLength = number("attention.key_length");
    let valueLength = number("attention.value_length");
    if ((keyLength === void 0 || valueLength === void 0) && embedding !== void 0 && headCount !== void 0) {
      const headDim = embedding / headCount;
      keyLength = keyLength ?? headDim;
      valueLength = valueLength ?? headDim;
    }
    if (layers === void 0 || heads === void 0 || keyLength === void 0 || valueLength === void 0) return void 0;
    const kvBytesPerToken = layers * heads * (keyLength + valueLength) * 2;
    const usage = await getSystemUsage();
    const free = (usage?.gpus ?? []).map(
      (gpu) => (
        // The hardware plugin reports both figures in MiB.
        typeof gpu?.total_memory === "number" && typeof gpu?.used_memory === "number" ? (gpu.total_memory - gpu.used_memory) * 1024 * 1024 : void 0
      )
    ).filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
    const vram = free.length > 0 ? free.reduce((sum, value) => sum + value, 0) : void 0;
    return vramContextBound({ weightsBytes: config.size_bytes, kvBytesPerToken, vramBytes: vram });
  }
  /**
   * Give a model a context it can actually be used at, once.
   *
   * A model with no per-model `ctx_size` inherits the preset's guard (8192 with
   * fit off, the fit floor with it on), which is not what the model or this
   * machine can do. Writing the recommendation makes the loaded window, the
   * published window and the trained maximum agree. A value the user set is
   * never overwritten, and a recommendation that is not backed by a real device
   * probe is never written.
   * @param modelId - installed model id.
   * @param options.overwrite - replace an existing `ctx_size` as well.
   * @returns what was written, or the reason nothing was.
   */
  async configureModelContext(modelId, options = {}) {
    const recommendation = await this.getRecommendedContext(modelId);
    if (options.automatic === true && this.config.fit !== false) {
      return { reason: "auto-fit sizes this model at load", recommendation };
    }
    if (recommendation.unknown !== void 0) {
      return { reason: recommendation.unknown, recommendation };
    }
    if (recommendation.fit === "RED") {
      return {
        reason: "this model does not fit the available device memory at any tested context",
        recommendation
      };
    }
    let existing;
    try {
      existing = await this.getModelContextSize(modelId);
    } catch (e) {
      return {
        reason: `ctx_size could not be read: ${e instanceof Error ? e.message : String(e)}`,
        recommendation
      };
    }
    if (existing !== void 0 && !options.overwrite) {
      return { reason: "the model already sets its own context size", recommendation };
    }
    if (existing === recommendation.tokens) {
      return { reason: "the model already uses the recommended context", recommendation };
    }
    await this.updateModelSettings(modelId, { ctx_len: recommendation.tokens });
    logger4.info(
      `Configured ${modelId} context at ${recommendation.tokens} tokens (${recommendation.fit}, trained maximum ${recommendation.nativeLimit})`
    );
    return { applied: recommendation.tokens, recommendation };
  }
  /**
   * Checks if embedding status is known. If not, reads GGUF, detects it,
   * and updates the model.yml for future performance.
   */
  async resolveEmbeddingConfig(modelId, modelConfig) {
    const cfg = modelConfig;
    const hasFlag = typeof cfg.embedding === "boolean";
    const upToDate = cfg.embedding_check_v === EMBEDDING_CHECK_VERSION;
    if (hasFlag && upToDate) {
      return cfg.embedding;
    }
    if (hasFlag && cfg.embedding === true) {
      return true;
    }
    let isEmbedding = false;
    try {
      const janDataFolderPath = await getJanDataFolderPath2();
      const fullModelPath = await joinPath4([
        janDataFolderPath,
        modelConfig.model_path
      ]);
      if (await fs4.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath);
        if (detectEmbeddingFromGgufMeta(metadata.metadata)) {
          isEmbedding = true;
        }
      }
    } catch (e) {
      logger4.warn(`Failed to check metadata for ${modelId}`, e);
      return cfg.embedding === true;
    }
    try {
      const configPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "model.yml"
      ]);
      cfg.embedding = isEmbedding;
      cfg.embedding_check_v = EMBEDDING_CHECK_VERSION;
      if (isEmbedding) {
        const c = cfg;
        if (!c.pooling) c.pooling = "mean";
        if (!c.ubatch_size) c.ubatch_size = 2048;
        if (!c.batch_size) c.batch_size = 2048;
      }
      await fs4.writeYaml(configPath, cfg);
    } catch (e) {
      logger4.warn(`Failed to update config for ${modelId}`, e);
    }
    return isEmbedding;
  }
  /**
   * Record the GGUF's MoE expert count in model.yml, which the preset reads to
   * decide whether `moe-cache-mib` may be emitted: llama.cpp refuses to load a
   * model without experts when it is set. Backfilled lazily, like mtp_layers,
   * for models imported before the count was recorded.
   */
  async resolveExpertCountConfig(modelId, modelConfig) {
    const cfg = modelConfig;
    if (typeof cfg.expert_count === "number" && cfg.expert_check_v === EXPERT_CHECK_VERSION) {
      return cfg.expert_count;
    }
    let expertCount = 0;
    try {
      const janDataFolderPath = await getJanDataFolderPath2();
      const fullModelPath = await joinPath4([
        janDataFolderPath,
        modelConfig.model_path
      ]);
      if (await fs4.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath);
        expertCount = detectExpertCountFromGgufMeta(metadata.metadata);
      }
    } catch (e) {
      logger4.warn(`Failed to check expert count for ${modelId}`, e);
      return cfg.expert_count ?? 0;
    }
    try {
      const configPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "model.yml"
      ]);
      cfg.expert_count = expertCount;
      cfg.expert_check_v = EXPERT_CHECK_VERSION;
      await fs4.writeYaml(configPath, cfg);
    } catch (e) {
      logger4.warn(`Failed to persist expert count for ${modelId}`, e);
    }
    return expertCount;
  }
  async resolveMtpLayersConfig(modelId, modelConfig) {
    const cfg = modelConfig;
    if (typeof cfg.mtp_layers === "number" && cfg.mtp_check_v === MTP_CHECK_VERSION) {
      return cfg.mtp_layers;
    }
    let mtpLayers = 0;
    try {
      const janDataFolderPath = await getJanDataFolderPath2();
      const fullModelPath = await joinPath4([
        janDataFolderPath,
        modelConfig.model_path
      ]);
      if (await fs4.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath);
        mtpLayers = detectMtpLayersFromGgufMeta(metadata.metadata);
      }
    } catch (e) {
      logger4.warn(`Failed to check MTP metadata for ${modelId}`, e);
      return cfg.mtp_layers ?? 0;
    }
    try {
      const configPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "model.yml"
      ]);
      cfg.mtp_layers = mtpLayers;
      cfg.mtp_check_v = MTP_CHECK_VERSION;
      await fs4.writeYaml(configPath, cfg);
    } catch (e) {
      logger4.warn(`Failed to persist MTP layers for ${modelId}`, e);
    }
    return mtpLayers;
  }
  /**
   * Detect which chat-template kwargs (e.g. `preserve_thinking`) a model's
   * embedded jinja template accepts, caching the result in model.yml. Migrates
   * pre-existing models lazily the first time list() sees a stale check version.
   */
  async resolveTemplateKwargsConfig(modelId, modelConfig) {
    const cfg = modelConfig;
    if (Array.isArray(cfg.template_kwargs) && cfg.template_kwargs_check_v === TEMPLATE_KWARGS_CHECK_VERSION) {
      return cfg.template_kwargs;
    }
    let kwargs = [];
    try {
      const janDataFolderPath = await getJanDataFolderPath2();
      const fullModelPath = await joinPath4([
        janDataFolderPath,
        modelConfig.model_path
      ]);
      if (await fs4.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath);
        kwargs = detectTemplateKwargsFromChatTemplate(
          metadata.metadata?.["tokenizer.chat_template"]
        );
      }
    } catch (e) {
      logger4.warn(`Failed to check template kwargs for ${modelId}`, e);
      return cfg.template_kwargs ?? [];
    }
    try {
      const configPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "model.yml"
      ]);
      cfg.template_kwargs = kwargs;
      cfg.template_kwargs_check_v = TEMPLATE_KWARGS_CHECK_VERSION;
      await fs4.writeYaml(configPath, cfg);
    } catch (e) {
      logger4.warn(`Failed to persist template kwargs for ${modelId}`, e);
    }
    return kwargs;
  }
  // Implement the required LocalProvider interface methods
  async list() {
    const modelsDir = await joinPath4([await this.getProviderPath(), "models"]);
    if (!await fs4.existsSync(modelsDir)) {
      await fs4.mkdir(modelsDir);
    }
    try {
      await this.migrateLegacyModels();
    } catch (err) {
      logger4.warn(`list: migrateLegacyModels failed, continuing: ${String(err)}`);
    }
    const modelIds = (await findModelEntries(modelsDir)).map((e) => e.modelId);
    let modelInfos = [];
    for (const modelId of modelIds) {
      try {
        const path = await joinPath4([modelsDir, modelId, "model.yml"]);
        const modelConfig = await fs4.readYaml(path);
        const isEmbedding = await this.resolveEmbeddingConfig(
          modelId,
          modelConfig
        );
        const templateKwargs = await this.resolveTemplateKwargsConfig(
          modelId,
          modelConfig
        );
        const capabilities = [];
        if (modelConfig.mmproj_path) {
          const caps = await this.readMmprojCapabilities(
            modelConfig.mmproj_path
          );
          if (caps.vision) capabilities.push("vision");
          if (caps.audio) capabilities.push("audio");
        }
        const mp = modelConfig.model_path ?? "";
        const isAbsolute = mp.startsWith("/") || /^[A-Za-z]:[\\/]/.test(mp);
        const modelInfo = {
          id: modelId,
          name: modelConfig.name ?? modelId,
          quant_type: void 0,
          // TODO: parse quantization type from model.yml or model.gguf
          providerId: this.provider,
          port: 0,
          // port is not known until the model is loaded
          sizeBytes: modelConfig.size_bytes ?? 0,
          embedding: isEmbedding,
          imported: isAbsolute,
          capabilities: capabilities.length > 0 ? capabilities : void 0,
          template_kwargs: templateKwargs
        };
        modelInfos.push(modelInfo);
      } catch (err) {
        logger4.warn(`list: skipping model ${modelId}: ${String(err)}`);
      }
    }
    return modelInfos;
  }
  async migrateLegacyModels() {
    if (await getBackendSetting("cortex_models_migrated") === "true") return;
    const janDataFolderPath = await getJanDataFolderPath2();
    const modelsDir = await joinPath4([janDataFolderPath, "models"]);
    if (!await fs4.existsSync(modelsDir)) return;
    let stack = [modelsDir];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      const files = await fs4.readdirSync(currentDir);
      for (const child of files) {
        try {
          const childPath = await joinPath4([currentDir, child]);
          const stat = await fs4.fileStat(childPath);
          if (files.some((e) => e.endsWith("model.yml")) && !child.endsWith("model.yml"))
            continue;
          if (!stat.isDirectory && child.endsWith(".yml")) {
            const modelConfigPath = child;
            if (await fs4.existsSync(modelConfigPath)) {
              const legacyModelConfig = await fs4.readYaml(modelConfigPath);
              const legacyModelPath = legacyModelConfig.files?.[0];
              if (!legacyModelPath) continue;
              let modelId = currentDir.slice(modelsDir.length + 1);
              modelId = modelId !== "imported" ? modelId.replace(/^(cortex\.so|huggingface\.co)[\/\\]/, "") : fileName(child).replace(".yml", "");
              const modelName = legacyModelConfig.model ?? modelId;
              const configPath = await joinPath4([
                await this.getProviderPath(),
                "models",
                modelId,
                "model.yml"
              ]);
              if (await fs4.existsSync(configPath)) continue;
              const modelDir = `${this.providerId}/models/${modelId}`;
              let size_bytes = (await fs4.fileStat(
                await joinPath4([janDataFolderPath, legacyModelPath])
              )).size;
              const modelConfig = {
                model_path: legacyModelPath,
                mmproj_path: void 0,
                // legacy models do not have mmproj
                name: modelName,
                size_bytes
              };
              await fs4.mkdir(await joinPath4([janDataFolderPath, modelDir]));
              await fs4.writeYaml(configPath, modelConfig);
              continue;
            }
          }
        } catch (error) {
          logger4.error(`Error migrating model ${child}:`, error);
        }
      }
      let subdirs = [];
      try {
        subdirs = await fs4.readdirSync(currentDir);
      } catch (err) {
        logger4.warn(
          `migrateLegacyModels: readdir failed for ${currentDir}: ${String(err)}`
        );
        continue;
      }
      for (const child of subdirs) {
        try {
          const dirInfo = await fs4.fileStat(child);
          if (!dirInfo?.isDirectory) continue;
          stack.push(child);
        } catch (err) {
          logger4.warn(
            `migrateLegacyModels: stat failed for ${child}: ${String(err)}`
          );
        }
      }
    }
    await setBackendSetting("cortex_models_migrated", "true");
  }
  /**
   * Update a model with new information.
   * @param modelId
   * @param model
   */
  async update(modelId, model) {
    const modelFolderPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId
    ]);
    const modelConfig = await fs4.readYaml(
      await joinPath4([modelFolderPath, "model.yml"])
    );
    const newFolderPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      model.id
    ]);
    if (await fs4.existsSync(newFolderPath)) {
      throw new Error(`Model with ID ${model.id} already exists`);
    }
    const newModelConfigPath = await joinPath4([newFolderPath, "model.yml"]);
    await fs4.mv(modelFolderPath, newFolderPath).then(
      () => (
        // now replace what values have previous model name with format
        fs4.writeYaml(newModelConfigPath, {
          ...modelConfig,
          model_path: modelConfig?.model_path?.replace(
            `${this.providerId}/models/${modelId}`,
            `${this.providerId}/models/${model.id}`
          ),
          mmproj_path: modelConfig?.mmproj_path?.replace(
            `${this.providerId}/models/${modelId}`,
            `${this.providerId}/models/${model.id}`
          )
        })
      )
    );
    try {
      await this.refreshEnginePreset();
    } catch (e) {
      logger4.warn(`Router restart after model rename (${modelId} \u2192 ${model.id}) failed`, e);
    }
  }
  /**
   * Joins concurrent imports of the same model instead of starting a second one.
   * Two callers racing (startup embedder bootstrap and an on-demand embed) both
   * passed the `model.yml` existence guard, then registered the same download
   * task id -- which Rust resolves by cancelling the first and deleting its
   * partial file. The loser then returned without writing `model.yml`, so its
   * caller went on to load a model that was never installed.
   */
  async import(modelId, opts) {
    const inFlight = this.pendingImports.get(modelId);
    if (inFlight) {
      logger4.info(`Joining in-flight import of "${modelId}"`);
      return inFlight;
    }
    const task = this.runImport(modelId, opts).finally(() => {
      this.pendingImports.delete(modelId);
    });
    this.pendingImports.set(modelId, task);
    return task;
  }
  async runImport(modelId, opts) {
    const isValidModelId = (id) => {
      if (!/^[a-zA-Z0-9/_\-\.]+$/.test(id)) return false;
      const parts = id.split("/");
      return parts.every((s) => s !== "" && s !== "." && s !== "..");
    };
    if (!isValidModelId(modelId))
      throw new Error(
        `Invalid modelId: ${modelId}. Only alphanumeric and / _ - . characters are allowed.`
      );
    const configPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId,
      "model.yml"
    ]);
    if (await fs4.existsSync(configPath))
      throw new Error(`Model ${modelId} already exists`);
    const modelDir = `${this.providerId}/models/${modelId}`;
    let downloadItems = [];
    const maybeDownload = async (path, saveName) => {
      if (path.startsWith("https://")) {
        const localPath = `${modelDir}/${saveName}`;
        downloadItems.push({
          url: path,
          save_path: localPath,
          proxy: await getProxyConfig() ?? void 0,
          sha256: saveName === "model.gguf" ? opts.modelSha256 : saveName === "mmproj.gguf" ? opts.mmprojSha256 : void 0,
          size: saveName === "model.gguf" ? opts.modelSize : saveName === "mmproj.gguf" ? opts.mmprojSize : void 0,
          model_id: modelId
        });
        return localPath;
      }
      if (!await fs4.existsSync(path))
        throw new Error(`File not found: ${path}`);
      return path;
    };
    let modelPath = await maybeDownload(opts.modelPath, "model.gguf");
    let mmprojPath = opts.mmprojPath ? await maybeDownload(opts.mmprojPath, "mmproj.gguf") : void 0;
    let draftModelPath = opts.specDraftPath ? await maybeDownload(opts.specDraftPath, "mtp.gguf") : void 0;
    if (downloadItems.length > 0) {
      try {
        const onProgress = (transferred, total) => {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId,
            percent: transferred / total,
            size: { transferred, total },
            downloadType: "Model"
          });
        };
        await this.downloads().downloadFiles(
          downloadItems,
          this.createDownloadTaskId(modelId),
          onProgress
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCancellationError = errorMessage.includes("Download cancelled") || errorMessage.includes("Validation cancelled") || errorMessage.includes("Hash computation cancelled") || errorMessage.includes("cancelled") || errorMessage.includes("aborted");
        const isValidationError = errorMessage.includes("Hash verification failed") || errorMessage.includes("Size verification failed") || errorMessage.includes("Failed to verify file");
        if (isCancellationError) {
          logger4.info("Download stopped for model:", modelId);
          events.emit(DownloadEvent.onFileDownloadStopped, {
            modelId,
            downloadType: "Model"
          });
          return;
        }
        logger4.error("Error downloading model:", modelId, opts, error);
        if (isValidationError) {
          try {
            this.abortImport(modelId);
          } catch (cancelError) {
            logger4.warn("Failed to cancel download task:", cancelError);
          }
          events.emit(DownloadEvent.onModelValidationFailed, {
            modelId,
            downloadType: "Model",
            error: errorMessage,
            reason: "validation_failed"
          });
        } else {
          events.emit(DownloadEvent.onFileDownloadError, {
            modelId,
            downloadType: "Model",
            error: errorMessage
          });
        }
        throw error;
      }
    }
    const janDataFolderPath = await getJanDataFolderPath2();
    const fullModelPath = await joinPath4([janDataFolderPath, modelPath]);
    let isEmbedding = false;
    let mtpLayers = 0;
    let expertCount = 0;
    let specKind = "mtp";
    let templateKwargs = [];
    let resolvedName;
    try {
      const modelMetadata = await readGgufMetadata(fullModelPath);
      logger4.info(
        `Model GGUF validation successful: version ${modelMetadata.version}, tensors: ${modelMetadata.tensor_count}`
      );
      if (detectEmbeddingFromGgufMeta(modelMetadata.metadata)) {
        isEmbedding = true;
      }
      mtpLayers = detectMtpLayersFromGgufMeta(modelMetadata.metadata);
      expertCount = detectExpertCountFromGgufMeta(modelMetadata.metadata);
      templateKwargs = detectTemplateKwargsFromChatTemplate(
        modelMetadata.metadata?.["tokenizer.chat_template"]
      );
      const rawName = modelMetadata.metadata?.["general.name"];
      if (typeof rawName === "string") {
        const normalized = rawName.trim().replace(/\s+/g, "-");
        if (normalized.length > 0) resolvedName = normalized;
      }
      if (mmprojPath) {
        const fullMmprojPath = await joinPath4([janDataFolderPath, mmprojPath]);
        const mmprojMetadata = await readGgufMetadata(fullMmprojPath);
        logger4.info(
          `Mmproj GGUF validation successful: version ${mmprojMetadata.version}, tensors: ${mmprojMetadata.tensor_count}`
        );
      }
      if (draftModelPath) {
        const fullDraftPath = await joinPath4([janDataFolderPath, draftModelPath]);
        const draftMetadata = await readGgufMetadata(fullDraftPath);
        const hasMarkovHead = draftMetadata.metadata?.["general.architecture"] === "dflash" ? (await findGgufTensors(fullDraftPath, [MARKOV_HEAD_TENSOR])).length > 0 : void 0;
        specKind = resolveSpecDraftKind(draftMetadata.metadata, {
          hasMarkovHead,
          hint: opts.specDraftKind
        });
        const draftLayers = detectMtpLayersFromGgufMeta(draftMetadata.metadata);
        mtpLayers = draftLayers > 0 ? draftLayers : Math.max(mtpLayers, 1);
      }
    } catch (error) {
      logger4.error("GGUF validation failed:", error);
      throw new Error(
        `Invalid GGUF file(s): ${error.message || "File format validation failed"}`
      );
    }
    let size_bytes = (await fs4.fileStat(fullModelPath)).size;
    if (mmprojPath) {
      size_bytes += (await fs4.fileStat(await joinPath4([janDataFolderPath, mmprojPath]))).size;
    }
    if (draftModelPath) {
      size_bytes += (await fs4.fileStat(await joinPath4([janDataFolderPath, draftModelPath]))).size;
    }
    if (!resolvedName) {
      resolvedName = fileName(opts.modelPath).replace(/\.gguf$/i, "") || modelId;
    }
    const modelConfig = {
      model_path: modelPath,
      mmproj_path: mmprojPath,
      name: resolvedName,
      size_bytes,
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      mmproj_sha256: opts.mmprojSha256,
      mmproj_size_bytes: opts.mmprojSize,
      embedding: isEmbedding,
      embedding_check_v: EMBEDDING_CHECK_VERSION,
      mtp_layers: mtpLayers,
      mtp_check_v: MTP_CHECK_VERSION,
      expert_count: expertCount,
      expert_check_v: EXPERT_CHECK_VERSION,
      template_kwargs: templateKwargs,
      template_kwargs_check_v: TEMPLATE_KWARGS_CHECK_VERSION,
      // A separate draft gguf is downloaded only to be used, so enable it by
      // default. Embedded-MTP models stay opt-in (no flag written here) and
      // need no spec_type: their flavour is always draft-mtp.
      ...draftModelPath ? {
        mtp_model_path: draftModelPath,
        mtp: true,
        spec_type: `draft-${specKind}`
      } : {},
      ...isEmbedding ? { pooling: "mean", ubatch_size: 2048, batch_size: 2048 } : {}
    };
    await fs4.mkdir(await joinPath4([janDataFolderPath, modelDir]));
    await fs4.writeYaml(configPath, modelConfig);
    events.emit(AppEvent.onModelImported, {
      modelId,
      modelPath,
      mmprojPath,
      size_bytes,
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      mmproj_sha256: opts.mmprojSha256,
      mmproj_size_bytes: opts.mmprojSize,
      embedding: isEmbedding
    });
    if (downloadItems.length > 0) {
      events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
        modelId,
        downloadType: "Model"
      });
    }
    if (!isEmbedding) {
      try {
        await this.configureModelContext(modelId, { automatic: true });
      } catch (e) {
        logger4.warn(`Could not configure the context of imported ${modelId}:`, e);
      }
    }
    try {
      await this.refreshEnginePreset();
    } catch (e) {
      logger4.warn(`Router refresh after import(${modelId}) failed:`, e);
    }
  }
  /**
   * Deletes the entire model folder for a given modelId
   * @param modelId The model ID to delete
   */
  async deleteModelFolder(modelId) {
    try {
      const modelDir = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId
      ]);
      if (await fs4.existsSync(modelDir)) {
        logger4.info(`Cleaning up model directory: ${modelDir}`);
        await fs4.rm(modelDir);
      }
    } catch (deleteError) {
      logger4.warn("Failed to delete model directory:", deleteError);
    }
  }
  async abortImport(modelId) {
    const taskId = this.createDownloadTaskId(modelId);
    try {
      await this.downloads().cancelDownload(taskId);
    } catch (cancelError) {
      logger4.warn("Failed to cancel download task:", cancelError);
    }
    await this.deleteModelFolder(modelId);
  }
  async pauseImport(modelId) {
    const taskId = this.createDownloadTaskId(modelId);
    await this.downloads().pauseDownload(taskId);
  }
  parseEnvFromString(target, envString) {
    envString.split(";").filter((pair) => pair.trim()).forEach((pair) => {
      const [key, ...valueParts] = pair.split("=");
      const cleanKey = key?.trim();
      if (cleanKey && valueParts.length > 0 && !cleanKey.startsWith("LLAMA")) {
        target[cleanKey] = valueParts.join("=").trim();
      }
    });
  }
  async load(modelId, _settings, isEmbedding = false) {
    const sInfo = await this.findSessionByModel(modelId);
    if (sInfo) {
      throw new Error("Model already loaded!!");
    }
    if (this.loadingModels.has(modelId)) {
      return this.loadingModels.get(modelId);
    }
    const loadingPromise = this.performLoad(modelId, isEmbedding);
    this.loadingModels.set(modelId, loadingPromise);
    try {
      return await loadingPromise;
    } finally {
      this.loadingModels.delete(modelId);
    }
  }
  // Awaits the deferred startup, then makes one direct attempt if the worker
  // still isn't up. Safe to call redundantly: start_engine returns the running
  // worker rather than spawning a second one.
  async ensureEngineReady() {
    await this.ensureProvisioned().catch(() => void 0);
    if (!await this.getEngineInfo()) {
      await this.startEngine();
    }
  }
  async performLoad(modelId, isEmbedding = false) {
    await this.ensureEngineReady();
    if (!isEmbedding) {
      try {
        const configured = await this.configureModelContext(modelId, { automatic: true });
        if (configured.applied !== void 0) {
          logger4.info(`Using ${configured.applied} tokens of context for ${modelId}`);
        }
      } catch (e) {
        logger4.warn(`Could not configure the context of ${modelId} before loading:`, e);
      }
    }
    try {
      await this.reconcileEngineDevices(modelId);
    } catch (e) {
      logger4.warn("Could not re-check the engine devices before loading:", e);
    }
    if (!await this.getEngineInfo()) {
      throw new Error(
        "The llama.cpp engine is not running. Please restart the app."
      );
    }
    if (!isEmbedding) {
      await this.evictChatIfAtCapacity(modelId);
    }
    try {
      const info = await loadLlamaModel(modelId, isEmbedding);
      if (!isEmbedding) {
        this.loadedChatOrder = this.loadedChatOrder.filter((m) => m !== modelId);
        this.loadedChatOrder.push(modelId);
      }
      return info;
    } catch (error) {
      logger4.error("Error in load command:\n", error);
      throw error;
    }
  }
  /**
   * Enforce `userModelsMax` against chat models only. Reconciles the local
   * FIFO against the router's loaded set, then unloads the oldest chat model
   * if loading `incomingModelId` would exceed the user-configured cap.
   */
  async evictChatIfAtCapacity(incomingModelId) {
    if (this.userModelsMax <= 0) return;
    let loaded = [];
    try {
      loaded = await this.getLoadedModels();
    } catch {
      loaded = [...this.loadedChatOrder];
    }
    const loadedSet = new Set(loaded);
    this.loadedChatOrder = this.loadedChatOrder.filter(
      (m) => loadedSet.has(m) && m !== incomingModelId
    );
    while (this.loadedChatOrder.length >= this.userModelsMax) {
      const victim = this.loadedChatOrder.shift();
      if (!victim) break;
      try {
        const result = await unloadLlamaModel(victim);
        if (!result.success) {
          logger4.warn(
            `Pre-eviction of ${victim} reported failure: ${result.error}`
          );
        } else {
          logger4.info(
            `Pre-evicted chat model ${victim} to make room for ${incomingModelId}`
          );
        }
      } catch (e) {
        logger4.warn(`Pre-eviction of ${victim} threw:`, e);
      }
    }
  }
  async unload(modelId) {
    const sInfo = await this.findSessionByModel(modelId);
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`);
    }
    try {
      const result = await unloadLlamaModel(modelId);
      if (result.success) {
        this.loadedChatOrder = this.loadedChatOrder.filter((m) => m !== modelId);
        logger4.info(`Successfully unloaded model ${modelId}`);
      } else {
        logger4.warn(`Failed to unload model ${modelId}: ${result.error}`);
      }
      return result;
    } catch (error) {
      logger4.error("Error in unload command:", error);
      return {
        success: false,
        error: `Failed to unload model: ${error}`
      };
    }
  }
  downloads() {
    return downloadService;
  }
  /**
   * The id becomes a Tauri event name (`download-<taskId>`), which cannot contain
   * a dot. Dots are replaced rather than truncated at: truncating collapsed every
   * `Jan-v3.*` quant onto one id, and Rust cancels an in-flight task whose id
   * repeats -- deleting its partial file -- so downloading one quant destroyed
   * another's, and pause/cancel hit whichever quant happened to be registered.
   */
  createDownloadTaskId(modelId) {
    return `${this.provider}/${modelId.replace(/\./g, "-")}`;
  }
  async *handleStreamingResponse(url, headers2, body, abortController) {
    const combinedController = new AbortController();
    const timeoutId = setTimeout(
      () => combinedController.abort(new Error("Request timed out")),
      this.timeout * 1e3
    );
    if (abortController?.signal) {
      if (abortController.signal.aborted) {
        combinedController.abort(abortController.signal.reason);
      } else {
        abortController.signal.addEventListener(
          "abort",
          () => combinedController.abort(abortController.signal.reason),
          { once: true }
        );
      }
    }
    const response = await this.loopbackFetch(url, {
      method: "POST",
      headers: headers2,
      body,
      connectTimeout: Number(this.timeout) * 1e3,
      // default 10 minutes
      signal: combinedController.signal
    }).finally(() => clearTimeout(timeoutId));
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      );
    }
    if (!response.body) {
      throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let jsonStr = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === "data: [DONE]") {
            continue;
          }
          if (trimmedLine.startsWith("data: ")) {
            jsonStr = trimmedLine.slice(6);
          } else if (trimmedLine.startsWith("error: ")) {
            jsonStr = trimmedLine.slice(7);
            const error = JSON.parse(jsonStr);
            throw new Error(error.message);
          } else {
            throw new Error("Malformed chunk");
          }
          try {
            const data = JSON.parse(jsonStr);
            const chunk = data;
            yield chunk;
          } catch (e) {
            logger4.error("Error parsing JSON from stream or server error:", e);
            throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  async findSessionByModel(modelId) {
    try {
      return await findSessionByModel(modelId);
    } catch (e) {
      logger4.error(e);
      throw new Error(String(e));
    }
  }
  async ensureHealthySession(modelId) {
    return ensureSessionReady(modelId, false);
  }
  async chat(opts, abortController) {
    const release = await this.acquireEngineLease();
    let streaming = false;
    try {
      const result = await this.chatOnEngine(opts, abortController);
      if (opts.stream && Symbol.asyncIterator in result) {
        streaming = true;
        const signal = abortController?.signal;
        if (signal?.aborted) {
          release();
        } else {
          signal?.addEventListener("abort", release, { once: true });
        }
        return this.releaseWhenDone(release, result);
      }
      return result;
    } finally {
      if (!streaming) release();
    }
  }
  async chatOnEngine(opts, abortController) {
    const sessionInfo = await this.ensureHealthySession(opts.model);
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`;
    const url = `${baseUrl}/chat/completions`;
    const headers2 = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sessionInfo.api_key}`
    };
    opts.return_progress = true;
    opts.timings_per_token = true;
    const body = JSON.stringify(opts);
    if (opts.stream) {
      return this.handleStreamingResponse(url, headers2, body, abortController);
    }
    const response = await this.loopbackFetch(url, {
      method: "POST",
      headers: headers2,
      body,
      signal: abortController?.signal
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      );
    }
    const completionResponse = await response.json();
    return completionResponse;
  }
  async delete(modelId) {
    const modelDir = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId
    ]);
    if (!await fs4.existsSync(await joinPath4([modelDir, "model.yml"]))) {
      throw new Error(`Model ${modelId} does not exist`);
    }
    await fs4.rm(modelDir);
    try {
      await this.refreshEnginePreset();
    } catch (e) {
      logger4.warn(`Router refresh after delete(${modelId}) failed:`, e);
    }
  }
  async getLoadedModels() {
    try {
      let models = await getLoadedModels();
      return models;
    } catch (e) {
      logger4.error(e);
      throw new Error(String(e));
    }
  }
  /**
   * Check if mmproj.gguf file exists for a given model ID
   * @param modelId - The model ID to check for mmproj.gguf
   * @returns Promise<boolean> - true if mmproj.gguf exists, false otherwise
   */
  async checkMmprojExists(modelId) {
    try {
      const modelConfigPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "model.yml"
      ]);
      const modelConfig = await fs4.readYaml(modelConfigPath);
      if (modelConfig.mmproj_path) {
        return true;
      }
      const mmprojPath = await joinPath4([
        await this.getProviderPath(),
        "models",
        modelId,
        "mmproj.gguf"
      ]);
      return await fs4.existsSync(mmprojPath);
    } catch (e) {
      logger4.error(`Error checking mmproj.gguf for model ${modelId}:`, e);
      return false;
    }
  }
  async getMtpInfo(modelId) {
    const path = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId,
      "model.yml"
    ]);
    if (!await fs4.existsSync(path)) {
      return { mtp_layers: 0, mtp: false };
    }
    const cfg = await fs4.readYaml(path);
    return {
      mtp_layers: typeof cfg.mtp_layers === "number" ? cfg.mtp_layers : 0,
      mtp: cfg.mtp === true,
      spec_draft_n_max: cfg.spec_draft_n_max,
      spec_draft_n_min: cfg.spec_draft_n_min,
      spec_draft_p_min: cfg.spec_draft_p_min,
      spec_draft_sampling: cfg.spec_draft_sampling,
      spec_draft_n_ubatch: cfg.spec_draft_n_ubatch
    };
  }
  async updateMtpSettings(modelId, patch) {
    const configPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId,
      "model.yml"
    ]);
    if (!await fs4.existsSync(configPath)) {
      throw new Error(`model.yml not found for ${modelId}`);
    }
    const cfg = await fs4.readYaml(configPath);
    if (typeof patch.mtp === "boolean") cfg.mtp = patch.mtp;
    const assignNumeric = (key, value) => {
      if (value === null) {
        delete cfg[key];
      } else if (typeof value === "number" && Number.isFinite(value)) {
        cfg[key] = value;
      }
    };
    if ("spec_draft_n_max" in patch) assignNumeric("spec_draft_n_max", patch.spec_draft_n_max);
    if ("spec_draft_n_min" in patch) assignNumeric("spec_draft_n_min", patch.spec_draft_n_min);
    if ("spec_draft_p_min" in patch) assignNumeric("spec_draft_p_min", patch.spec_draft_p_min);
    if ("spec_draft_n_ubatch" in patch)
      assignNumeric("spec_draft_n_ubatch", patch.spec_draft_n_ubatch);
    if (patch.spec_draft_sampling === null) {
      delete cfg.spec_draft_sampling;
    } else if (typeof patch.spec_draft_sampling === "string") {
      cfg.spec_draft_sampling = patch.spec_draft_sampling;
    }
    await fs4.writeYaml(configPath, cfg);
    try {
      await this.refreshEnginePreset();
    } catch (e) {
      logger4.warn(`Failed to restart router after MTP update for ${modelId}`, e);
    }
  }
  /**
   * Persist a per-model setting into `model.yml` and apply the engine preset
   * before resolving. A failed application restores the saved configuration
   * and rejects so the caller can report the error.
   *
   * Sidebar keys are mapped to the canonical `model.yml` / preset keys here.
   * Keys not in the mapping are silently ignored because they are Jan-side
   * concerns or are not emitted by `preset.ts`.
   */
  async updateModelSettings(modelId, patch) {
    const configPath = await joinPath4([
      await this.getProviderPath(),
      "models",
      modelId,
      "model.yml"
    ]);
    if (!await fs4.existsSync(configPath)) {
      throw new Error(`model.yml not found for ${modelId}`);
    }
    const cfg = await fs4.readYaml(configPath);
    const previousConfig = { ...cfg };
    let touched = false;
    for (const [sidebarKey, value] of Object.entries(patch)) {
      const m = MODEL_SETTINGS_YAML_MAPPING[sidebarKey];
      if (!m) continue;
      const next = m.coerce(value);
      if (next === null) {
        if (m.yamlKey in cfg) {
          delete cfg[m.yamlKey];
          touched = true;
        }
      } else {
        ;
        cfg[m.yamlKey] = next;
        touched = true;
      }
    }
    if (!touched) return;
    await fs4.writeYaml(configPath, cfg);
    try {
      await this.refreshEnginePreset();
    } catch (e) {
      await fs4.writeYaml(configPath, previousConfig);
      throw e;
    }
  }
  /**
   * The config the preset is written from, with the device setting cut down
   * to devices this engine build reports. The setting outlives the engine: one
   * saved under a Vulkan build names `Vulkan1`, and llama.cpp refuses to start
   * on any unknown name, which fails every load. Dropped names are logged, and
   * a setting with none left falls back to auto-pick instead of `none` (CPU),
   * which the user never asked for.
   */
  async presetConfig() {
    const setting = typeof this.config.device === "string" ? this.config.device.trim() : "";
    if (!setting || setting.toLowerCase() === "none") return this.config;
    const envs = {};
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env);
    let known;
    try {
      known = new Set((await engineDevices(envs)).map((d) => d.id));
    } catch (e) {
      logger4.warn("Could not list engine devices; using the device setting as is:", e);
      return this.config;
    }
    const wanted = setting.split(",").map((d) => d.trim()).filter(Boolean);
    const kept = wanted.filter((d) => known.has(d));
    if (kept.length === wanted.length) return this.config;
    logger4.warn(
      `Device setting names devices this engine does not have (${wanted.filter((d) => !known.has(d)).join(", ")}); using ${kept.join(",") || "auto"}`
    );
    return { ...this.config, device: kept.join(",") };
  }
  /** Stable identity of a device list: id and name, not the changing free memory. */
  deviceKeys(list) {
    return list.map((d) => `${d.id}|${d.name}`).sort();
  }
  /** The machine's devices right now, or null when they could not be listed. */
  async currentDeviceKeys(envs) {
    try {
      const list = await engineDevices(envs);
      return Array.isArray(list) ? this.deviceKeys(list) : null;
    } catch (e) {
      logger4.warn("Could not enumerate the engine devices:", e);
      return null;
    }
  }
  /**
   * A request holds this from before it resolves the worker's port and key
   * until it is done with them, so a restart cannot stop the worker in between:
   * `reconcileEngineDevices` declines while any lease is held, and while it
   * decides, new leases queue behind it. The worker's own idle check cannot
   * cover that, because it only sees requests the worker has already admitted.
   */
  async acquireEngineLease() {
    while (this.engineGate) await this.engineGate;
    this.engineLeases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.engineLeases--;
    };
  }
  async withEngineLease(fn) {
    const release = await this.acquireEngineLease();
    try {
      return await fn();
    } finally {
      release();
    }
  }
  /**
   * Keeps the lease for as long as a stream is being read, and drops it when
   * the reader finishes, fails or stops early. A stream that is never read
   * keeps it until the request is aborted; that only defers a restart.
   */
  async *releaseWhenDone(release, stream) {
    try {
      yield* stream;
    } finally {
      release();
    }
  }
  /**
   * Restarts the engine when the machine now offers different devices than the
   * running worker initialised, so a GPU that appeared after launch is used for
   * the next load instead of only being listed in Settings.
   *
   * The baseline is what the worker itself reported when it started, so it is
   * right even if the GPU appeared between the worker starting and this call,
   * and for a worker this page did not start. A worker that reported nothing
   * has no baseline, so the answer is 'unchanged'.
   *
   * It never interrupts work: a request holding a lease, a generation in
   * flight, or a load of a model other than `loadingModelId` returns 'busy' and
   * leaves the worker alone. A load passes its own id because it is already
   * registered as loading by the time it asks.
   *
   * Two layers keep requests safe. The lease and gate here cover this
   * extension's own requests. The native local API proxy, the agent loop and
   * the model-lifecycle commands hold a lease in Rust, from before they read
   * the worker's address until their response is finished, and
   * `beginEngineRestart` only agrees when none is held; while the restart runs,
   * those requests wait for the new worker instead of failing.
   */
  async reconcileEngineDevices(loadingModelId) {
    const run = this.reconcileQueue.then(
      () => this.reconcileOnce(loadingModelId)
    );
    this.reconcileQueue = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async reconcileOnce(loadingModelId) {
    const engine = await getEngineInfo().catch(() => null);
    if (!engine?.devices) return "unchanged";
    const before = this.deviceKeys(engine.devices);
    const envs = {};
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env);
    const now = await this.currentDeviceKeys(envs);
    if (!now || now.join("\n") === before.join("\n")) return "unchanged";
    let openGate = () => {
    };
    this.engineGate = new Promise((resolve) => {
      openGate = resolve;
    });
    try {
      const otherLoads = [...this.loadingModels.keys()].some(
        (id) => id !== loadingModelId
      );
      if (this.engineLeases > 0 || otherLoads || !await beginEngineRestart()) {
        logger4.info("Device list changed but the engine is busy; not restarting");
        return "busy";
      }
      try {
        logger4.info(
          `Device list changed (${before.join(", ")} -> ${now.join(", ")}); restarting the engine`
        );
        await stopEngine();
        this.loadedChatOrder = [];
        await this.startEngine();
        return "restarted";
      } finally {
        await endEngineRestart().catch(() => void 0);
      }
    } finally {
      this.engineGate = null;
      openGate();
    }
  }
  async getDevices() {
    const envs = {};
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env);
    try {
      const dList = await engineDevices(envs);
      try {
        const sysInfo = await getSystemInfo();
        if (sysInfo?.os_type === "linux" && Array.isArray(sysInfo.gpus)) {
          const usage = await getSystemUsage();
          if (usage && Array.isArray(usage.gpus)) {
            return overrideAmdVulkanMemory(dList, sysInfo.gpus, usage.gpus);
          }
        }
      } catch (e) {
        logger4.warn("Device memory override (AMD/Linux) failed:", e);
      }
      return dList;
    } catch (error) {
      logger4.error("Failed to query devices:\n", error);
      throw new Error("Failed to load llamacpp backend");
    }
  }
  /**
   * How much memory this machine has for a model, for a catalog entry that has
   * not been downloaded.
   *
   * Both numbers come from the hardware plugin in bytes: free VRAM is what its
   * GPU usage reports as unused, and RAM is the installed total. The engine's own
   * device list is deliberately not used: llama.cpp reports those figures in
   * MiB, so mixing the two understated the machine by six orders of magnitude
   * and labelled every download "Unlikely to fit". Either value is reported as
   * unknown rather than guessed when its source fails, so the label can say so.
   *
   * @returns free VRAM across devices and total RAM, both in bytes.
   */
  async getMemoryTotals() {
    let vram;
    const problems = [];
    try {
      const usage = await getSystemUsage();
      const free = (usage?.gpus ?? []).map(
        (gpu) => (
          // The hardware plugin reports both figures in MiB.
          typeof gpu?.total_memory === "number" && typeof gpu?.used_memory === "number" ? (gpu.total_memory - gpu.used_memory) * 1024 * 1024 : void 0
        )
      ).filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
      if (free.length > 0) vram = free.reduce((sum, value) => sum + value, 0);
      else problems.push("no GPU usage was reported");
    } catch (e) {
      logger4.warn("Could not read GPU usage for a fit estimate:", e);
      problems.push("GPU memory could not be read");
    }
    let ram;
    try {
      const total = (await getSystemInfo())?.total_memory;
      if (typeof total === "number" && Number.isFinite(total) && total > 0) ram = Math.floor(total) * 1024 * 1024;
      else problems.push("system memory could not be read");
    } catch (e) {
      logger4.warn("Could not read system memory for a fit estimate:", e);
      problems.push("system memory could not be read");
    }
    return {
      vram,
      ram,
      ...problems.length > 0 ? { unknown: problems.join("; ") } : {}
    };
  }
  /**
   * The label a catalog quant gets before it is downloaded.
   * @param bytes - the quant's published download size.
   * @returns the label, its detail line and the tone the panel paints it in.
   */
  async catalogFit(bytes) {
    const totals = await this.getMemoryTotals();
    return estimateCatalogFit({ bytes, vram: totals.vram, ram: totals.ram });
  }
  /**
   * Resolves the default/preferred embedding model, importing and loading
   * sentence-transformer-mini as the fallback, then ensures a session exists.
   * Shared by embed() and getEmbeddingContextSize() so both agree on which
   * model is "the" embedding model.
   */
  async ensureEmbeddingModelLoaded() {
    const downloadedModelList = await this.list();
    const installedEmbedding = downloadedModelList.filter(
      (m) => m.embedding === true
    );
    const hasMini = downloadedModelList.some(
      (m) => m.id === FALLBACK_EMBEDDING_MODEL_ID
    );
    let preferred = await getDefaultEmbeddingModelId("llamacpp");
    if (!preferred && installedEmbedding.length === 1 && !hasMini) {
      preferred = installedEmbedding[0].id;
      await setDefaultEmbeddingModelId("llamacpp", preferred);
      logger4.info(
        `Auto-promoted "${preferred}" as default embedding model (single installed model, sentence-transformer-mini not present)`
      );
    }
    const preferredMatch = preferred && installedEmbedding.find((m) => m.id === preferred);
    if (preferred && !preferredMatch) {
      logger4.warn(
        `Default embedding model "${preferred}" not installed; falling back to sentence-transformer-mini`
      );
    }
    const targetModelId = preferredMatch ? preferred : FALLBACK_EMBEDDING_MODEL_ID;
    let sInfo = await this.findSessionByModel(targetModelId);
    if (!sInfo) {
      if (targetModelId === FALLBACK_EMBEDDING_MODEL_ID && !hasMini) {
        await this.import(FALLBACK_EMBEDDING_MODEL_ID, {
          modelPath: FALLBACK_EMBEDDING_MODEL_URL
        });
      }
      sInfo = await this.load(targetModelId, void 0, true);
    }
    return sInfo;
  }
  /**
   * Actual post-fit context window of the embedding model, read from the
   * router's /props endpoint (the same source getModelProps uses for chat
   * models). Used by RAG ingestion to size chunks so they don't exceed the
   * model's n_ctx (e.g. sentence-transformer-mini natively caps at 256).
   */
  async getEmbeddingContextSize() {
    const sInfo = await this.ensureEmbeddingModelLoaded();
    const props = await this.getModelProps(sInfo.model_id);
    return props?.nCtx;
  }
  /**
   * Real token counts from the embedding model's own tokenizer via /tokenize
   * on its session port. Char-based chunking can't reliably predict token
   * count (subword tokenizers vary widely by content), so callers that need
   * a hard guarantee against exceed_context_size_error should verify with
   * this rather than estimating from character length.
   */
  async countEmbeddingTokens(texts) {
    return this.withEngineLease(() => this.countEmbeddingTokensOnEngine(texts));
  }
  async countEmbeddingTokensOnEngine(texts) {
    const sInfo = await this.ensureEmbeddingModelLoaded();
    const counts = [];
    for (const text of texts) {
      const res = await this.loopbackFetch(`http://localhost:${sInfo.port}/tokenize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sInfo.api_key}`
        },
        body: JSON.stringify({ content: text, model: sInfo.model_id })
      });
      if (!res.ok) {
        throw new Error(`Tokenize request failed with status ${res.status}`);
      }
      const json = await res.json();
      counts.push(Array.isArray(json.tokens) ? json.tokens.length : 0);
    }
    return counts;
  }
  /**
   * Token budget for one embedding request.
   *
   * Deliberately not the engine-wide `ubatch_size`: preset.ts pins every
   * embedding model's section to its own ubatch (DEFAULT_EMBEDDING_UBATCH) and
   * to `ctx-size = 0`, so the real ceiling is the embedder's own trained
   * context -- 512 on MiniLM. llama.cpp rejects a batch wider than either with
   * no retry path, so the budget is the smaller of the two.
   */
  async embedBatchBudget(sInfo) {
    let budget = DEFAULT_EMBEDDING_UBATCH;
    try {
      const props = await this.getModelProps(sInfo.model_id);
      const nCtx = props?.nCtx;
      if (typeof nCtx === "number" && nCtx > 0) {
        budget = Math.min(budget, nCtx);
      }
    } catch (e) {
      logger4.warn("Could not read embedder context size; using the pinned ubatch:", e);
    }
    return budget;
  }
  async embed(text) {
    return this.withEngineLease(() => this.embedOnEngine(text));
  }
  async embedOnEngine(text) {
    const sInfo = await this.ensureEmbeddingModelLoaded();
    const batches = buildEmbedBatches(text, await this.embedBatchBudget(sInfo));
    const attemptRequest = async (session, batchInput) => {
      const baseUrl = `http://localhost:${session.port}/v1/embeddings`;
      const headers2 = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.api_key}`
      };
      const body = JSON.stringify({
        input: batchInput,
        model: session.model_id,
        encoding_format: "float"
      });
      const response = await this.loopbackFetch(baseUrl, {
        method: "POST",
        headers: headers2,
        body
      });
      return response;
    };
    const sendBatch = async (batchInput) => {
      const response = await attemptRequest(sInfo, batchInput);
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
        );
      }
      return await response.json();
    };
    const batchResults = [];
    for (const { batch, offset } of batches) {
      const result = await sendBatch(batch);
      batchResults.push({ result, offset });
    }
    return mergeEmbedResponses(
      sInfo.model_id,
      batchResults
    );
  }
  /**
   * Check if a tool is supported by the model
   * Currently read from GGUF chat_template
   * @param modelId
   * @returns
   */
  async isToolSupported(modelId) {
    const janDataFolderPath = await getJanDataFolderPath2();
    const modelConfigPath = await joinPath4([
      this.providerPath,
      "models",
      modelId,
      "model.yml"
    ]);
    const modelConfig = await fs4.readYaml(modelConfigPath);
    const modelPath = await joinPath4([
      janDataFolderPath,
      modelConfig.model_path
    ]);
    return (await readGgufMetadata(modelPath)).metadata?.["tokenizer.chat_template"]?.includes("tools");
  }
  /**
   * Check the support status of a model by its path (local/remote)
   *
   * Returns:
   * - "RED"    → weights don't fit in total memory
   * - "YELLOW" → weights fit in VRAM but need system RAM, or KV cache doesn't fit
   * - "GREEN"  → both weights + KV cache fit in VRAM
   */
  async isModelSupported(path, ctxSize) {
    try {
      const result = await isModelSupported(path, Number(ctxSize));
      return result;
    } catch (e) {
      throw new Error(String(e));
    }
  }
  /**
   * Validate GGUF file and check for unsupported architectures like CLIP
   */
  async validateGgufFile(filePath) {
    try {
      logger4.info(`Validating GGUF file: ${filePath}`);
      const metadata = await readGgufMetadata(filePath);
      const architecture = metadata.metadata?.["general.architecture"];
      logger4.info(`Model architecture: ${architecture}`);
      if (architecture === "clip") {
        const errorMessage = "This model has CLIP architecture and cannot be imported as a text generation model. CLIP models are designed for vision tasks and require different handling.";
        logger4.error("CLIP architecture detected:", architecture);
        return {
          isValid: false,
          error: errorMessage,
          metadata
        };
      }
      logger4.info("Model validation passed. Architecture:", architecture);
      return {
        isValid: true,
        metadata
      };
    } catch (error) {
      logger4.error("Failed to validate GGUF file:", error);
      return {
        isValid: false,
        error: `Failed to read model metadata: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  async getTokensCount(opts) {
    let imageTokens = 0;
    const hasImages = opts.messages.some(
      (msg) => Array.isArray(msg.content) && msg.content.some((content) => content.type === "image_url")
    );
    if (hasImages) {
      try {
        const janDataFolderPath = await getJanDataFolderPath2();
        const modelConfigPath = await joinPath4([
          this.providerPath,
          "models",
          opts.model,
          "model.yml"
        ]);
        const modelConfig = await fs4.readYaml(modelConfigPath);
        if (modelConfig.mmproj_path) {
          const mmprojPath = await joinPath4([
            janDataFolderPath,
            modelConfig.mmproj_path
          ]);
          const metadata = await readGgufMetadata(mmprojPath);
          imageTokens = await this.calculateImageTokens(
            opts.messages,
            metadata.metadata
          );
        }
      } catch (error) {
        logger4.warn("Failed to calculate image tokens:", error);
        imageTokens = this.estimateImageTokensFallback(opts.messages);
      }
    }
    let textChars = 0;
    for (const msg of opts.messages) {
      if (typeof msg.content === "string") {
        textChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && typeof part.text === "string") {
            textChars += part.text.length;
          }
        }
      }
    }
    const textTokens = Math.ceil(textChars / 4);
    return textTokens + imageTokens;
  }
  async calculateImageTokens(messages, metadata) {
    const projectionDim = Math.floor(Number(metadata["clip.vision.projection_dim"]) / 10) || 256;
    let imageCount = 0;
    for (const message of messages) {
      if (Array.isArray(message.content)) {
        imageCount += message.content.filter(
          (content) => content.type === "image_url"
        ).length;
      }
    }
    logger4.info(
      `Calculated ${projectionDim} tokens per image, ${imageCount} images total`
    );
    return projectionDim * imageCount - imageCount;
  }
  estimateImageTokensFallback(messages) {
    const estimatedTokensPerImage = 256;
    let imageCount = 0;
    for (const message of messages) {
      if (Array.isArray(message.content)) {
        imageCount += message.content.filter(
          (content) => content.type === "image_url"
        ).length;
      }
    }
    logger4.warn(
      `Fallback estimation: ${estimatedTokensPerImage} tokens per image, ${imageCount} images total`
    );
    return imageCount * estimatedTokensPerImage - imageCount;
  }
};
export {
  LlamacppEngine,
  settings_default as settingsSchema
};
