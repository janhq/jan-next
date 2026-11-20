/**
 * Tokamak Images API calls: `POST /images/generations` (JSON) and `POST /images/edits` (multipart), in the
 * OpenAI Images request and reply shape. Tokamak swaps only `model` for the provider's id and relays the reply.
 * @module @janhq/jan-image/images
 */

/** Image model used when the plugin config names none. */
export const DEFAULT_MODEL = 'openai/gpt-image-2'

/** Sizes the image model accepts. */
export const SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536']

/** Quality levels the image model accepts. */
export const QUALITIES = ['auto', 'low', 'medium', 'high']

/** Background modes the image model accepts. */
export const BACKGROUNDS = ['auto', 'transparent', 'opaque']

/** Most images one call may produce or read. */
export const MAX_IMAGES = 4

/** Longest error text quoted from a Tokamak reply. */
const ERROR_EXCERPT_CHARS = 400

/**
 * @typedef {{ prompt: string, size?: string, quality?: string, background?: string, n?: number }} ImageOptions
 * @typedef {{ data: Uint8Array, mediaType: 'image/png' | 'image/jpeg' | 'image/webp' }} ImageBytes
 * @typedef {{ images: ImageBytes[], size?: string, quality?: string, generationIds: string[], executionId?: string }} ImageReply
 */

/**
 * Validate the shared options a model sent and drop the unset ones.
 * @param {Record<string, unknown>} args - tool arguments.
 * @returns {ImageOptions} the options to send.
 */
export function imageOptions(args) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length === 0) throw new Error('Describe the image in prompt.')
  /** @type {ImageOptions} */
  const options = { prompt }
  for (const [key, allowed] of /** @type {const} */ ([['size', SIZES], ['quality', QUALITIES], ['background', BACKGROUNDS]])) {
    const value = args[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${key} must be one of ${allowed.join(', ')}.`)
    options[key] = value
  }
  if (args.n !== undefined) {
    if (!Number.isInteger(args.n) || /** @type {number} */ (args.n) < 1 || /** @type {number} */ (args.n) > MAX_IMAGES) throw new Error(`n must be 1 to ${MAX_IMAGES}.`)
    options.n = /** @type {number} */ (args.n)
  }
  return options
}

/**
 * The JSON body of a generation request.
 * @param {string} model - image model id.
 * @param {ImageOptions} options - validated options.
 * @returns {Record<string, unknown>} the request body.
 */
export function generationBody(model, options) {
  return { model, ...options }
}

/**
 * The multipart body of an edit request; every source image goes in `image[]`, as the Images API expects.
 * @param {string} model - image model id.
 * @param {ImageOptions} options - validated options.
 * @param {{ data: Uint8Array, mediaType: string, name: string }[]} sources - images to edit, in order.
 * @param {{ data: Uint8Array, mediaType: string, name: string }} [mask] - optional PNG mask; transparent pixels are edited.
 * @returns {FormData} the request body.
 */
export function editForm(model, options, sources, mask) {
  const form = new FormData()
  form.set('model', model)
  for (const [key, value] of Object.entries(options)) form.set(key, String(value))
  for (const source of sources) form.append('image[]', new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (source.data)], { type: source.mediaType }), source.name)
  if (mask !== undefined) form.set('mask', new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (mask.data)], { type: mask.mediaType }), mask.name)
  return form
}

/**
 * The message of a failed reply: `{ error: { message } }`, `{ error: string }`, or the raw text.
 * @param {number} status - HTTP status.
 * @param {string} text - reply body.
 * @returns {string} a one-line reason.
 */
export function replyError(status, text) {
  let message = text.trim()
  try {
    const body = JSON.parse(text)
    const error = body?.error
    message = (typeof error === 'string' ? error : error?.message ?? body?.message ?? message) || message
  } catch { /* not JSON: keep the text */ }
  const excerpt = message.length > ERROR_EXCERPT_CHARS ? `${message.slice(0, ERROR_EXCERPT_CHARS)}...` : message
  return `Tokamak image request failed (HTTP ${status})${excerpt ? `: ${excerpt}` : ''}`
}

/**
 * Decode a successful reply.
 * @param {unknown} body - parsed JSON reply.
 * @param {string | null} executionId - the `X-Tokamak-Execution-Id` header.
 * @returns {ImageReply} the decoded images and what the provider settled on.
 */
export function decodeReply(body, executionId) {
  const reply = /** @type {{ data?: { b64_json?: unknown, generation_id?: unknown }[], output_format?: unknown, size?: unknown, quality?: unknown }} */ (body)
  const format = reply?.output_format === 'jpeg' || reply?.output_format === 'webp' ? reply.output_format : 'png'
  const mediaType = /** @type {ImageBytes['mediaType']} */ (`image/${format}`)
  const items = Array.isArray(reply?.data) ? reply.data : []
  const images = items.flatMap(item => typeof item?.b64_json === 'string' ? [{ data: new Uint8Array(Buffer.from(item.b64_json, 'base64')), mediaType }] : [])
  if (images.length === 0) throw new Error('Tokamak returned no image.')
  return {
    images,
    ...typeof reply.size === 'string' ? { size: reply.size } : {},
    ...typeof reply.quality === 'string' ? { quality: reply.quality } : {},
    generationIds: items.flatMap(item => typeof item?.generation_id === 'string' ? [item.generation_id] : []),
    ...executionId ? { executionId } : {},
  }
}

/**
 * Output file names for `count` images: the requested path, then `-2`, `-3`, ... before its extension.
 * @param {string} path - requested path ending in the image's extension.
 * @param {number} count - number of images.
 * @returns {string[]} one path per image.
 */
export function numberedPaths(path, count) {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const [stem, extension] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  return Array.from({ length: count }, (_, index) => index === 0 ? path : `${stem}-${index + 1}${extension}`)
}

/**
 * A default relative file name from the prompt, under `images/`.
 * @param {string} prompt - image description.
 * @param {string} extension - `.png`, `.jpeg` or `.webp`.
 * @returns {string} a slash-separated relative path.
 */
export function defaultPath(prompt, extension) {
  const slug = prompt.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `images/${slug || 'image'}${extension}`
}
