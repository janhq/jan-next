/**
 * Hugging Face repository lookup for the model manager: list a repository's single-file GGUF
 * models and its vision projector with the LFS digest and size a verified download needs, pinned to
 * the current commit.
 */

/** One downloadable GGUF file of a repository. */
export interface HuggingFaceFile {
  /** File name inside the repository. */
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  /** Download URL pinned to the looked-up commit. */
  readonly url: string
  /** Quantization read from the file name (`Q4_K_M`, `IQ4_XS`, `F16`), when present. */
  readonly quant?: string
  /** A quantization that balances size and quality for most machines. */
  readonly recommended: boolean
}

/** A looked-up repository. */
export interface HuggingFaceRepo {
  /** `owner/name`. */
  readonly repo: string
  /** Commit the file URLs are pinned to. */
  readonly revision: string
  /** Downloadable files, smallest first. */
  readonly files: readonly HuggingFaceFile[]
  /**
   * Vision projector downloaded beside any of {@link files}: the one named `mmproj-f16` (any case),
   * else the first in the repository's listing; absent when the repository has none.
   */
  readonly projector?: HuggingFaceFile
}

/** Why a lookup failed, phrased for the person who typed the repository. */
export class HuggingFaceLookupError extends Error {
  constructor(readonly reason: 'invalid' | 'not-found' | 'unavailable', message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/
const SPLIT = /-\d{5}-of-\d{5}\.gguf$/i
/** Companion files that are not chat models: importance matrices and speculative-decoding drafts. */
const COMPANION = /(?:^|\/)(?:imatrix[^/]*|dflash-[^/]*|[^/]*-draft[^/]*)\.gguf$/i
const QUANT = /(?:^|[-_.])((?:I?Q\d(?:_[A-Z0-9]+)*)|BF16|F16|F32)(?=[-_.]|\.gguf$)/i
const RECOMMENDED = /^(?:Q4_K_M|IQ4_XS)$/i

/**
 * Read a repository id from what a person typed: `owner/name`, or a Hugging Face URL of the
 * repository or one of its pages.
 * @param input - typed text.
 * @param origin - Hugging Face origin URLs must use.
 * @returns `owner/name`.
 * @throws {@link HuggingFaceLookupError} `invalid` for anything else.
 */
export function parseRepo(input: string, origin: string): string {
  const text = input.trim()
  if (REPO.test(text)) return text
  if (URL.canParse(text)) {
    const url = new URL(text)
    const expected = new URL(origin)
    const hosts = new Set([expected.host, expected.host.startsWith('www.') ? expected.host.slice(4) : `www.${expected.host}`])
    if (url.protocol === expected.protocol && hosts.has(url.host)) {
      const [owner, name] = url.pathname.split('/').filter(Boolean)
      const repo = owner !== undefined && name !== undefined ? `${owner}/${name}` : ''
      if (REPO.test(repo)) return repo
    }
  }
  throw new HuggingFaceLookupError('invalid', 'Enter a Hugging Face repository such as unsloth/Qwen3-8B-GGUF, or its huggingface.co link')
}

interface ApiSibling {
  readonly rfilename?: unknown
  readonly size?: unknown
  readonly lfs?: { readonly sha256?: unknown; readonly size?: unknown } | null
}

/**
 * Look up a repository's downloadable GGUF files and its projector. Importance matrices,
 * speculative-decoding drafts and split multi-part files are left out; files without an LFS digest
 * cannot be verified and are left out too. Projector (`mmproj`) files are not offered as models.
 * @param origin - Hugging Face origin, e.g. `https://huggingface.co`.
 * @param input - repository id or URL as typed.
 * @param signal - cancellation.
 * @returns the repository's files.
 * @throws {@link HuggingFaceLookupError} for bad input, a missing or gated repository, or an unreachable API.
 */
export async function lookupRepo(origin: string, input: string, signal?: AbortSignal): Promise<HuggingFaceRepo> {
  const repo = parseRepo(input, origin)
  let response: Response
  try {
    response = await fetch(`${origin}/api/models/${repo}?blobs=true`, {
      headers: { accept: 'application/json' }, redirect: 'follow', ...signal === undefined ? {} : { signal },
    })
  } catch (error) {
    throw new HuggingFaceLookupError('unavailable', 'Could not reach Hugging Face; check the connection and try again', { cause: error })
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new HuggingFaceLookupError('not-found', `No public repository ${repo} on Hugging Face`)
  }
  if (!response.ok) throw new HuggingFaceLookupError('unavailable', `Hugging Face answered HTTP ${String(response.status)}; try again later`)
  let body: { sha?: unknown; siblings?: unknown }
  try { body = await response.json() as { sha?: unknown; siblings?: unknown } }
  catch (error) { throw new HuggingFaceLookupError('unavailable', 'Hugging Face returned an unreadable response', { cause: error }) }
  if (typeof body.sha !== 'string' || !Array.isArray(body.siblings)) {
    throw new HuggingFaceLookupError('unavailable', 'Hugging Face returned an unexpected response')
  }
  const revision = body.sha
  const files: HuggingFaceFile[] = []
  const projectors: HuggingFaceFile[] = []
  for (const sibling of body.siblings as ApiSibling[]) {
    const file = sibling.rfilename
    if (typeof file !== 'string' || !file.toLowerCase().endsWith('.gguf') || SPLIT.test(file) || COMPANION.test(file)) continue
    const sha256 = sibling.lfs?.sha256
    const bytes = sibling.lfs?.size ?? sibling.size
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || typeof bytes !== 'number' || bytes <= 0) continue
    const name = file.split('/').at(-1) ?? file
    const quant = QUANT.exec(name)?.[1]?.toUpperCase()
    const entry: HuggingFaceFile = {
      file, bytes, sha256,
      url: `${origin}/${repo}/resolve/${revision}/${file.split('/').map(encodeURIComponent).join('/')}`,
      ...quant === undefined ? {} : { quant },
      recommended: quant !== undefined && RECOMMENDED.test(quant),
    }
    if (/mmproj/i.test(file)) projectors.push(entry)
    else files.push(entry)
  }
  files.sort((a, b) => a.bytes - b.bytes)
  const projector = projectors.find(entry => /^mmproj-f16\.gguf$/i.test(entry.file.split('/').at(-1) ?? entry.file)) ?? projectors[0]
  return { repo, revision, files, ...projector === undefined ? {} : { projector } }
}
