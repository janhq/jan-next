/**
 * Facts read from a GGUF header: whether the file is a chat model the worker can serve, its
 * trained context, and the dimensions its KV cache grows with; or whether a projector encodes images.
 */
import { GGMLFileQuantizationType, gguf, type MetadataValue } from '@huggingface/gguf'

/** What the plugin records about one installed model. */
export interface ModelFacts {
  /** `general.architecture`, e.g. `qwen3`. */
  architecture: string
  /** `<arch>.context_length`, the context the model was trained with; absent when undeclared. */
  contextLength?: number
  /** Whether the file embeds `tokenizer.chat_template`; without one llama.cpp falls back to a generic template. */
  hasChatTemplate: boolean
  /**
   * Whether the chat template renders the request's `tools` list, which is what lets the worker
   * (`--jinja`) declare tools to the model and parse its calls. False without a template, or with
   * one that never reads `tools`; absent in records written before this fact was read.
   */
  toolCalls?: boolean
  /** `<arch>.expert_count`; 0 for a dense model. */
  expertCount: number
  /** `general.file_type` name, e.g. `Q4_K_M`; absent when undeclared or unknown. */
  fileType?: string
  /** KV cache elements per token over all layers, K and V together; absent when the header lacks the dimensions. */
  kvElementsPerToken?: number
  /** `<arch>.attention.sliding_window`; present for models with sliding-window attention. */
  slidingWindow?: number
}

/** A readable GGUF file the worker cannot serve as a chat model. */
export class UnsupportedModelError extends Error {}

/** Architectures llama.cpp loads only as embedding models. */
const EMBEDDING_ARCHITECTURES: ReadonlySet<string> = new Set([
  'bert', 'nomic-bert', 'nomic-bert-moe', 'jina-bert-v2', 'jina-bert-v3', 'xlm-roberta', 'mpnet', 't5encoder',
])

/** Element sizes of the KV cache types; `q8_0` packs 32 values into 34 bytes. */
const KV_BYTES_PER_ELEMENT = { f16: 2, q8_0: 34 / 32 } as const

/** KV cache element type, as `cache-type-k` and `cache-type-v` take it. */
export type KvCacheType = keyof typeof KV_BYTES_PER_ELEMENT

/** A positive integer metadata value; per-layer arrays count their largest entry. */
function positive(value: MetadataValue | undefined): number | undefined {
  const scalar = Array.isArray(value)
    ? Math.max(...value.map(item => typeof item === 'number' || typeof item === 'bigint' ? Number(item) : 0))
    : typeof value === 'number' || typeof value === 'bigint' ? Number(value) : undefined
  return scalar !== undefined && Number.isFinite(scalar) && scalar > 0 ? Math.floor(scalar) : undefined
}

/** A chat template that reads the request's tool list names the `tools` variable. */
const TEMPLATE_TOOLS = /\btools\b/

/**
 * Derive the recorded facts from parsed metadata.
 * @param metadata - GGUF key/value metadata.
 * @returns the facts.
 * @throws {@link UnsupportedModelError} for a projector (`clip`) or embedding-only model, or no architecture.
 */
export function modelFacts(metadata: Readonly<Record<string, MetadataValue>>): ModelFacts {
  const architecture = metadata['general.architecture']
  if (typeof architecture !== 'string' || architecture === '') {
    throw new UnsupportedModelError('the file declares no model architecture')
  }
  if (architecture === 'clip') {
    throw new UnsupportedModelError('it is a vision projector (CLIP), not a chat model')
  }
  const key = (name: string): MetadataValue | undefined => metadata[`${architecture}.${name}`]
  if (EMBEDDING_ARCHITECTURES.has(architecture) || architecture.toLowerCase().includes('embed') || positive(key('pooling_type')) !== undefined) {
    throw new UnsupportedModelError('it is an embedding model, not a chat model')
  }
  const layers = positive(key('block_count'))
  const heads = positive(key('attention.head_count'))
  const kvHeads = positive(key('attention.head_count_kv')) ?? heads
  let keyLength = positive(key('attention.key_length'))
  let valueLength = positive(key('attention.value_length'))
  const embedding = positive(key('embedding_length'))
  if ((keyLength === undefined || valueLength === undefined) && embedding !== undefined && heads !== undefined) {
    keyLength = valueLength = Math.floor(embedding / heads)
  }
  const kvElementsPerToken = layers !== undefined && kvHeads !== undefined && keyLength !== undefined && valueLength !== undefined
    ? layers * kvHeads * (keyLength + valueLength)
    : undefined
  const contextLength = positive(key('context_length'))
  const slidingWindow = positive(key('attention.sliding_window'))
  const fileTypeId = metadata['general.file_type']
  const fileType = typeof fileTypeId === 'number' ? GGMLFileQuantizationType[fileTypeId] : undefined
  const template = metadata['tokenizer.chat_template']
  return {
    architecture,
    ...contextLength === undefined ? {} : { contextLength },
    hasChatTemplate: typeof template === 'string' && template.trim() !== '',
    toolCalls: typeof template === 'string' && TEMPLATE_TOOLS.test(template),
    expertCount: positive(key('expert_count')) ?? 0,
    ...fileType === undefined ? {} : { fileType },
    ...kvElementsPerToken === undefined ? {} : { kvElementsPerToken },
    ...slidingWindow === undefined ? {} : { slidingWindow },
  }
}

/**
 * Read a local GGUF file's header and derive its facts.
 * @param path - absolute path of the file.
 * @returns the facts.
 * @throws {@link UnsupportedModelError} for a file the worker cannot serve as a chat model, or Error when it is not a readable GGUF file.
 */
export async function readModelFacts(path: string): Promise<ModelFacts> {
  return modelFacts(await readMetadata(path))
}

async function readMetadata(path: string): Promise<Record<string, MetadataValue>> {
  const { metadata } = await gguf(path, { allowLocalFile: true })
  // The library types metadata per known architecture; facts are read for any architecture.
  return Object.fromEntries(Object.entries(metadata))
}

/** What the plugin records about one multimodal projector (`mmproj`) file. */
export interface ProjectorFacts {
  /** Whether it encodes images; an audio-only projector does not. */
  vision: boolean
}

/** A readable GGUF file that is not a multimodal projector. */
export class NotAProjectorError extends Error {}

/**
 * Derive projector facts from parsed metadata. A projector declaring neither encoder flag is taken
 * as a vision projector, as Jan does.
 * @param metadata - GGUF key/value metadata.
 * @returns the facts.
 * @throws {@link NotAProjectorError} when `general.architecture` is not `clip`.
 */
export function projectorFacts(metadata: Readonly<Record<string, MetadataValue>>): ProjectorFacts {
  const architecture = metadata['general.architecture']
  if (architecture !== 'clip') {
    const named = typeof architecture === 'string' && architecture !== '' ? `"${architecture}"` : 'no'
    throw new NotAProjectorError(`it has ${named} architecture, not a vision projector (clip)`)
  }
  const vision = metadata['clip.has_vision_encoder']
  if (typeof vision === 'boolean') return { vision }
  return { vision: metadata['clip.has_audio_encoder'] !== true }
}

/**
 * Read a local GGUF file's header and derive its projector facts.
 * @param path - absolute path of the file.
 * @returns the facts.
 * @throws {@link NotAProjectorError} for a GGUF file that is not a projector, or Error when it is not a readable GGUF file.
 */
export async function readProjectorFacts(path: string): Promise<ProjectorFacts> {
  return projectorFacts(await readMetadata(path))
}

/**
 * Estimate a model's KV cache size. With sliding-window attention the estimate is the midpoint of
 * a full cache and a window-sized one, as layers of both kinds are common.
 * @param facts - the model's facts.
 * @param context - context size the worker runs with; capped at the trained context.
 * @param cacheType - KV cache element type.
 * @returns bytes, or undefined when the header lacks the dimensions.
 */
export function estimateKvBytes(facts: ModelFacts, context: number, cacheType: KvCacheType): number | undefined {
  if (facts.kvElementsPerToken === undefined) return undefined
  const perToken = facts.kvElementsPerToken * KV_BYTES_PER_ELEMENT[cacheType]
  const full = Math.min(context, facts.contextLength ?? context) * perToken
  return Math.ceil(facts.slidingWindow === undefined ? full : (full + facts.slidingWindow * perToken) / 2)
}
