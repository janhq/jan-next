/**
 * Curated models the manager offers before any search, each pinned to a Hugging Face commit and
 * its LFS digest so a re-upload cannot change what installs. All are instruction models whose
 * chat templates support tool calls under `--jinja`.
 */
import type { Artifact } from './artifacts.ts'

/** One curated, pinned model. */
export interface CatalogModel extends Artifact {
  /** Route model id (`--alias`); also the directory under `models/`. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Hugging Face repository the file comes from. */
  readonly repo: string
  /** Shown first and labelled recommended. */
  readonly recommended: boolean
}

const hf = (repo: string, revision: string, file: string): string => `https://huggingface.co/${repo}/resolve/${revision}/${file}`

/** Catalog id of the model the first-run offer installs. */
export const DEFAULT_MODEL_ID = 'jan-v3.5-4b'

/** Catalog id of the 429 MB model for quick manual tests (`model: small`). */
export const SMALL_MODEL_ID = 'qwen3-0.6b'

/** Curated models, in display order. */
export const CATALOG: readonly CatalogModel[] = [
  {
    // The model Jan's own setup screen offers first (Apache-2.0).
    id: DEFAULT_MODEL_ID, name: 'Jan v3.5 4B', repo: 'janhq/Jan-v3.5-4B-gguf', recommended: true,
    url: hf('janhq/Jan-v3.5-4B-gguf', '2b0fcab0066198e78f7c004a0815179fbce13985', 'Jan-v3.5-4B-Q4_K_M.gguf'),
    sha256: '2f5305d93100ad9105eeb47c45ef1af99ba6d568c734fc267b0628b3be41c07a', bytes: 2_716_066_656,
  },
  {
    id: 'qwen3-4b-instruct-2507', name: 'Qwen3 4B Instruct 2507', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', recommended: false,
    url: hf('unsloth/Qwen3-4B-Instruct-2507-GGUF', 'a06e946bb6b655725eafa393f4a9745d460374c9', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'),
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', bytes: 2_497_281_120,
  },
  {
    id: 'llama-3.2-3b-instruct', name: 'Llama 3.2 3B Instruct', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', recommended: false,
    url: hf('bartowski/Llama-3.2-3B-Instruct-GGUF', '5ab33fa94d1d04e903623ae72c95d1696f09f9e8', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff', bytes: 2_019_377_696,
  },
  {
    id: 'qwen3-8b', name: 'Qwen3 8B', repo: 'unsloth/Qwen3-8B-GGUF', recommended: false,
    url: hf('unsloth/Qwen3-8B-GGUF', 'a6adef130ffb23ddaf1a62fec9dced968c9bc482', 'Qwen3-8B-Q4_K_M.gguf'),
    sha256: '120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4', bytes: 5_027_784_512,
  },
  {
    id: SMALL_MODEL_ID, name: 'Qwen3 0.6B', repo: 'ggml-org/Qwen3-0.6B-GGUF', recommended: false,
    url: hf('ggml-org/Qwen3-0.6B-GGUF', '13ac06624948e4d8589cb4b6f90100837342fcb8', 'Qwen3-0.6B-Q4_0.gguf'),
    sha256: 'da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4', bytes: 428_970_080,
  },
]

/**
 * Find a curated model.
 * @param id - catalog id.
 * @returns the entry, or undefined.
 */
export function catalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find(entry => entry.id === id)
}
