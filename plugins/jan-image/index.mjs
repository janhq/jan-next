import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { credentialRef } from '@janhq/jan-credentials'
import { launchEnvironmentOf } from '@janhq/jan-launch-environment'
import { HarnessError } from '@janhq/jan-llm'
import {
  BACKGROUNDS, DEFAULT_MODEL, MAX_IMAGES, QUALITIES, SIZES, decodeReply, defaultPath, editForm, generationBody, imageOptions,
  numberedPaths, replyError,
} from './images.mjs'

/** Cordis identity for Jan's image generation and editing tools. */
export const name = 'jan-image'
/** Tool registration, the Session filesystem, and its working directory. */
export const inject = ['tools', 'fs', 'agents', 'workingDirectory']

/** @typedef {import('@janhq/cordis').Context} Context */
/** @typedef {import('@janhq/jan-tools').ToolDefinition} ToolDefinition */
/** @typedef {import('@janhq/jan-tools').ToolExecution} ToolExecution */
/** @typedef {import('@janhq/jan-attachment').ImageAttachmentRef} ImageAttachmentRef */
/** @typedef {import('./images.mjs').ImageReply} ImageReply */
/** @typedef {import('@janhq/jan-fs').FsTarget} FsTarget */
/** @typedef {import('@janhq/jan-working-directory').WorkingDirectoryService} WorkingDirectoryService */
/** @typedef {{ apiBaseURL: string, model: string, timeoutMs: number }} Config */

/** Largest source image or mask an edit reads. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** Media types an edit accepts as a source, by extension. */
const SOURCE_TYPES = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })

/** The environment variable and credential the Tokamak model route reads. */
const KEY_REF = 'TOKAMAK_API_KEY'

const SHARED_PARAMETERS = {
  path: {
    type: 'string',
    description: 'Where to save the image, relative to the working directory, ending in .png. Defaults to images/<prompt words>.png. More than one image adds -2, -3 before the extension.',
  },
  size: { type: 'string', enum: SIZES, description: 'Width x height in pixels. Default auto.' },
  quality: { type: 'string', enum: QUALITIES, description: 'Higher quality is slower and costs more. Default auto.' },
  background: { type: 'string', enum: BACKGROUNDS, description: 'transparent for a cut-out PNG. Default auto.' },
  n: { type: 'integer', minimum: 1, maximum: MAX_IMAGES, description: 'Number of images. Default 1.' },
}

const AFTER_SAVE = 'Each image costs money and takes 20 to 60 seconds, so ask for one unless the user wants options. '
  + 'The images are saved as files; call present with the file to show it under your reply.'

/**
 * Register `generate_image` and `edit_image`, which call the Tokamak Images API with the signed-in account's key
 * (or the TOKAMAK_API_KEY credential) and save each image in the Session's working directory.
 * @param {Context} ctx - tools, filesystem, working directory; `tokamakAccount`, `credentials`, `attachments` and `llm` are used when mounted.
 * @param {Partial<Config>} [config] - endpoint, model and per-request time limit.
 */
export function apply(ctx, config = {}) {
  const base = (config.apiBaseURL || process.env.TOKAMAK_BASE_URL || 'https://api.tokamak.sh/v1').trim().replace(/\/+$/, '').replace(/^(https?:\/\/[^/]+)$/, '$1/v1')
  const model = config.model || DEFAULT_MODEL
  const timeoutMs = config.timeoutMs ?? 180_000

  /**
   * The key for one request: the signed-in Tokamak account first, then the TOKAMAK_API_KEY credential.
   * @param {string} url - endpoint the key is released for.
   * @returns {Promise<{ token: string, fromAccount: boolean }>} the key and where it came from.
   */
  async function keyFor(url) {
    const account = ctx.get('tokamakAccount')
    const signedIn = await account?.resolveToken(url)
    if (signedIn) return { token: signedIn, fromAccount: true }
    const credentials = ctx.get('credentials')
    const ref = credentialRef(KEY_REF)
    const value = (credentials === undefined ? launchEnvironmentOf(ctx).get(ref)?.value : (await credentials.resolve(ref))?.value)?.trim()
    if (value) return { token: value, fromAccount: false }
    throw new HarnessError('Image generation needs a Tokamak account. Sign in to Tokamak in Settings > Account.', 'IMAGE_NO_KEY')
  }

  /**
   * Send one Images API request and decode the images.
   * @param {'generations' | 'edits'} endpoint - API path under /images.
   * @param {() => BodyInit} body - request body, rebuilt per attempt.
   * @param {boolean} json - whether the body is JSON.
   * @param {AbortSignal} signal - the tool call's signal.
   * @returns {Promise<ImageReply>} the decoded reply.
   */
  async function request(endpoint, body, json, signal) {
    const url = `${base}/images/${endpoint}`
    const { token, fromAccount } = await keyFor(url)
    const reply = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...json ? { 'content-type': 'application/json' } : {} },
      body: body(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    const text = await reply.text()
    if (reply.status === 401 && fromAccount) {
      await ctx.get('tokamakAccount')?.rejectToken(token)
      throw new HarnessError('Tokamak rejected the signed-in account (HTTP 401). Sign in to Tokamak again.', 'IMAGE_UNAUTHORIZED')
    }
    if (!reply.ok) throw new HarnessError(replyError(reply.status, text), 'IMAGE_REQUEST_FAILED')
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new HarnessError('Tokamak returned an image reply that is not JSON.', 'IMAGE_REQUEST_FAILED') }
    return decodeReply(parsed, reply.headers.get('x-tokamak-execution-id'))
  }

  /**
   * The working directory of the calling Session and its filesystem target.
   * @param {ToolExecution} exec - the tool call.
   */
  async function workspace(exec) {
    const agent = exec.agent
    if (agent === undefined || ctx.agents.get(agent.id) !== agent) throw new HarnessError('Image tools require a live Jan Session.', 'IMAGE_NO_SESSION')
    const cwd = await ctx.workingDirectory.ensure(agent, exec.signal)
    return { agent, cwd, root: await ctx.fs.resolve(cwd, { signal: exec.signal }) }
  }

  /**
   * Save each image inside the working directory. An explicit path is overwritten; a default one gets a free name.
   * @param {Awaited<ReturnType<typeof workspace>>} at - the Session workspace.
   * @param {string | undefined} requested - the model's path, if any.
   * @param {string} fallback - default relative path.
   * @param {ImageReply} reply - decoded images.
   * @param {AbortSignal} signal - the tool call's signal.
   * @returns {Promise<string[]>} the saved files as the Session sees them.
   */
  async function save(at, requested, fallback, reply, signal) {
    const extension = `.${reply.images[0]?.mediaType.slice('image/'.length) ?? 'png'}`
    let candidate = requested?.trim() || fallback
    if (!requested?.trim()) {
      for (let attempt = 2; await exists(at, numberedPaths(candidate, reply.images.length), signal); attempt += 1) {
        candidate = fallback.replace(/(\.[a-z]+)$/, `-v${attempt}$1`)
      }
    } else if (!candidate.toLowerCase().endsWith(extension) && !(extension === '.jpeg' && candidate.toLowerCase().endsWith('.jpg'))) {
      candidate = `${candidate.replace(/\.[A-Za-z0-9]+$/, '')}${extension}`
    }
    const saved = []
    for (const [index, path] of numberedPaths(candidate, reply.images.length).entries()) {
      const target = await ctx.fs.resolve(path, { cwd: at.cwd, signal })
      if (!ctx.fs.contains(at.root, target)) throw new HarnessError(`Save images inside the working directory, not at ${path}.`, 'IMAGE_PATH_OUTSIDE')
      const hostPath = ctx.fs.processPath(target)
      await mkdir(dirname(hostPath), { recursive: true })
      await writeFile(hostPath, /** @type {NonNullable<ImageReply['images'][number]>} */ (reply.images[index]).data, { signal })
      saved.push(hostPath)
    }
    return saved
  }

  /**
   * Whether any of the paths already exists.
   * @param {Awaited<ReturnType<typeof workspace>>} at - the Session workspace.
   * @param {string[]} paths - relative paths.
   * @param {AbortSignal} signal - the tool call's signal.
   */
  async function exists(at, paths, signal) {
    for (const path of paths) {
      if (await ctx.fs.stat(await ctx.fs.resolve(path, { cwd: at.cwd, signal }), signal) !== undefined) return true
    }
    return false
  }

  /**
   * Durable image references the calling model can see, when it reads images.
   * @param {Awaited<ReturnType<typeof workspace>>} at - the Session workspace.
   * @param {ImageReply} reply - decoded images.
   * @param {AbortSignal} signal - the tool call's signal.
   * @returns {Promise<ImageAttachmentRef[]>} references, or none when the model or host cannot take them.
   */
  async function attachmentsFor(at, reply, signal) {
    const attachments = ctx.get('attachments')
    const llm = ctx.get('llm')
    if (attachments === undefined || llm === undefined) return []
    const routed = at.agent.session.requestHeader()?.config
    const provider = routed?.provider ?? at.agent.options.provider
    const modelId = routed?.model ?? at.agent.options.model
    if (provider === undefined || modelId === undefined) return []
    const info = await llm.resolveModelInfo(provider, modelId, signal).catch(() => undefined)
    if (!info?.inputModalities?.includes('image')) return []
    return Promise.all(reply.images.map((image, index) => attachments.saveImage({ ...image, name: `image-${index + 1}.${image.mediaType.slice(6)}` })))
  }

  /**
   * Run one image call and shape its result.
   * @param {ToolExecution} exec - the tool call.
   * @param {Record<string, unknown>} args - tool arguments.
   * @param {(at: Awaited<ReturnType<typeof workspace>>, options: import('./images.mjs').ImageOptions) => Promise<{ reply: ImageReply, fallback: string }>} call - the API request.
   */
  async function run(exec, args, call) {
    const options = imageOptions(args)
    const at = await workspace(exec)
    const started = Date.now()
    const { reply, fallback } = await call(at, options)
    exec.signal.throwIfAborted()
    const files = await save(at, typeof args.path === 'string' ? args.path : undefined, fallback, reply, exec.signal)
    const images = await attachmentsFor(at, reply, exec.signal)
    return {
      files,
      model,
      ...reply.size === undefined ? {} : { size: reply.size },
      ...reply.quality === undefined ? {} : { quality: reply.quality },
      seconds: Math.round((Date.now() - started) / 100) / 10,
      ...reply.executionId === undefined ? {} : { executionId: reply.executionId },
      images,
    }
  }

  /** @type {ToolDefinition['output']} */
  const output = {
    schema: {},
    render(_args, value) {
      const result = /** @type {{ files: string[], size?: string, quality?: string, seconds: number, images: ImageAttachmentRef[] }} */ (/** @type {unknown} */ (value))
      const detail = [result.size, result.quality && `${result.quality} quality`, `${result.seconds} s`].filter(Boolean).join(', ')
      const text = `Saved ${result.files.length === 1 ? 'image' : `${result.files.length} images`} (${detail}):\n${result.files.join('\n')}\nCall present with the file to show it to the user.`
      return [{ type: 'text', text }, ...result.images.map(attachment => (/** @type {const} */ ({ type: 'image', attachment: /** @type {any} */ (attachment) })))]
    },
  }

  ctx.effect(function* () {
    yield ctx.tools.register(/** @type {ToolDefinition} */ ({
      name: 'generate_image',
      description: `Create a new image from a text description with ${model} and save it as a file. ${AFTER_SAVE}`,
      parameters: {
        prompt: { type: 'string', required: true, description: 'What the image shows: subject, style, composition, text to render, colors.' },
        ...SHARED_PARAMETERS,
      },
      output,
      execute: (args, exec) => run(exec, /** @type {Record<string, unknown>} */ (args), async (_at, options) => ({
        reply: await request('generations', () => JSON.stringify(generationBody(model, options)), true, exec.signal),
        fallback: defaultPath(options.prompt, '.png'),
      })),
    }))

    yield ctx.tools.register(/** @type {ToolDefinition} */ ({
      name: 'edit_image',
      description: `Change existing image files with ${model}: restyle, add or remove things, combine several images into one, or edit only the transparent area of a mask. Saves the result as a new file and leaves the sources unchanged unless path names one. ${AFTER_SAVE}`,
      parameters: {
        prompt: { type: 'string', required: true, description: 'The change to make, or how to combine the images.' },
        images: {
          type: 'array', required: true, minItems: 1, maxItems: MAX_IMAGES,
          items: { type: 'string' },
          description: 'PNG, JPEG or WebP files to edit, relative to the working directory. The first is the main image.',
        },
        mask: { type: 'string', description: 'Optional PNG the same size as the first image; its transparent pixels mark the area to change.' },
        ...SHARED_PARAMETERS,
      },
      output,
      execute: (args, exec) => run(exec, /** @type {Record<string, unknown>} */ (args), async (at, options) => {
        const input = /** @type {Record<string, unknown>} */ (args)
        const paths = Array.isArray(input.images) ? input.images.filter(/** @param {unknown} path */ path => typeof path === 'string' && path.trim().length > 0) : []
        if (paths.length === 0 || paths.length > MAX_IMAGES) throw new HarnessError(`images needs 1 to ${MAX_IMAGES} file paths.`, 'IMAGE_INVALID_ARGS')
        const sources = await Promise.all(paths.map(/** @param {string} path */ path => readSource(at, path, exec.signal)))
        const mask = typeof input.mask === 'string' && input.mask.trim() ? await readSource(at, input.mask, exec.signal) : undefined
        if (mask !== undefined && mask.mediaType !== 'image/png') throw new HarnessError('mask must be a PNG with transparency.', 'IMAGE_INVALID_ARGS')
        const first = /** @type {string} */ (paths[0]).replace(/\.[A-Za-z0-9]+$/, '')
        return {
          reply: await request('edits', () => editForm(model, options, sources, mask), false, exec.signal),
          fallback: `${first}-edited.png`,
        }
      }),
    }))
  }, 'jan-image.tools')

  /**
   * Read one source image through the Session filesystem.
   * @param {Awaited<ReturnType<typeof workspace>>} at - the Session workspace.
   * @param {string} path - file path relative to the working directory.
   * @param {AbortSignal} signal - the tool call's signal.
   */
  async function readSource(at, path, signal) {
    const extension = path.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
    const mediaType = SOURCE_TYPES[extension]
    if (mediaType === undefined) throw new HarnessError(`Cannot edit ${path}: use a PNG, JPEG or WebP file.`, 'IMAGE_INVALID_ARGS')
    const target = await ctx.fs.resolve(path, { cwd: at.cwd, signal })
    const info = await ctx.fs.stat(target, signal)
    if (info === undefined || info.type !== 'file') throw new HarnessError(`Cannot edit ${path}: file not found.`, 'IMAGE_INVALID_ARGS')
    const data = await ctx.fs.readBytes(target, signal, MAX_SOURCE_BYTES)
    return { data, mediaType, name: path.split(/[\\/]/).pop() ?? 'image' }
  }
}
