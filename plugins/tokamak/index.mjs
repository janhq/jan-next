import { HarnessError } from '@janhq/jan-llm'
import { registerApi } from '@janhq/jan-plugin-api'
import { createTokamakApi } from './api.mjs'
import {
  DEFAULT_JEV_MODEL, DEFAULT_REALTIME_MODEL, DEFAULT_TRANSCRIPTION_MODEL, MAX_SPEECH_CHARS, MAX_TRANSCRIPTION_BYTES, VOICES,
  clientSecretBody, decodeTranscription, speechBody, systemOneBody, transcriptionForm, wavSeconds,
} from './audio.mjs'
import { BACKGROUNDS, DEFAULT_MODEL, MAX_IMAGES, QUALITIES, SIZES, decodeReply, editForm, generationBody, imageOptions } from './images.mjs'
import { defaultPath, outputPaths, readInside, sessionWorkspace, writeInside } from './session-files.mjs'

/** Cordis identity for Jan's Tokamak capabilities. */
export const name = 'jan-tokamak'
/** Tool registration, the Session filesystem, and its working directory. */
export const inject = ['tools', 'fs', 'agents', 'workingDirectory']

/** @typedef {import('@janhq/cordis').Context} Context */
/** @typedef {import('@janhq/jan-tools').ToolDefinition} ToolDefinition */
/** @typedef {import('@janhq/jan-tools').ToolExecution} ToolExecution */
/** @typedef {import('@janhq/jan-attachment').ImageAttachmentRef} ImageAttachmentRef */
/** @typedef {import('./images.mjs').ImageReply} ImageReply */
/** @typedef {import('./session-files.mjs').SessionWorkspace} SessionWorkspace */
/** @typedef {import('@janhq/jan-experimental-speech-to-text').default} SpeechToText Brings `ctx.speechToText` into the Context type. */
/**
 * @typedef {{ apiBaseURL: string, model: string, timeoutMs: number, transcriptionModel: string, realtimeModel: string,
 *   jevModel: string, speechProvider: boolean }} Config
 */

/** Largest source image or mask an edit reads. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** Media types an edit accepts as a source, by extension. */
const SOURCE_TYPES = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })

/** Recordings the transcription endpoint reads, by extension. */
const AUDIO_TYPES = ['.wav', '.mp3', '.m4a', '.mp4', '.flac', '.ogg', '.opus', '.webm']

/** Language hints offered for dictation; `auto` lets the model detect it. */
const SPEECH_LANGUAGES = ['auto', 'en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'vi', 'ko', 'it', 'id', 'th', 'hi', 'ar']

/** What a spoken conversation is told when the client sends no instructions. */
const VOICE_INSTRUCTIONS = 'You are Jan, a helpful assistant, talking with the user by voice. Answer briefly and naturally, in the language the user speaks.'

/**
 * The JSON Schema object a model provider accepts for one tool's parameters. `ctx.tools.register`
 * sends `parameters` as written, and Anthropic refuses a schema without `type: 'object'`.
 * @param {Record<string, Record<string, unknown> & { required?: boolean }>} properties - each parameter, `required: true` when the model must send it.
 * @returns {{ type: 'object', properties: Record<string, Record<string, unknown>>, required: string[] }} the schema.
 */
function parameterSchema(properties) {
  const required = Object.keys(properties).filter(name => properties[name]?.required === true)
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(properties).map(([name, { required: _required, ...schema }]) => [name, schema])),
    required,
  }
}

const IMAGE_PARAMETERS = {
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
 * Register the Tokamak tools (images, speech, transcription, System One), the Tokamak dictation provider when the
 * speech service is mounted, and the `/jan-api/tokamak` route the browser half reads aloud and talks through.
 * Every call uses the signed-in Tokamak account's key, then the TOKAMAK_API_KEY credential.
 * @param {Context} ctx - tools, filesystem, working directory; `tokamakAccount`, `credentials`, `attachments`, `llm`,
 *   `speechToText`, `webServer` and `connection` are used when mounted.
 * @param {Partial<Config>} [config] - endpoint, models and limits.
 */
export function apply(ctx, config = {}) {
  const api = createTokamakApi(ctx, config.apiBaseURL)
  const imageModel = config.model || DEFAULT_MODEL
  const imageTimeoutMs = config.timeoutMs ?? 180_000
  const transcriptionModel = config.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL
  const realtimeModel = config.realtimeModel || DEFAULT_REALTIME_MODEL
  const jevModel = config.jevModel || DEFAULT_JEV_MODEL

  /**
   * Send one Images API request and decode the images.
   * @param {'generations' | 'edits'} endpoint - API path under /images.
   * @param {BodyInit | object} body - multipart form, or the JSON body.
   * @param {AbortSignal} signal - the tool call's signal.
   * @returns {Promise<ImageReply>} the decoded reply.
   */
  async function imageRequest(endpoint, body, signal) {
    const reply = await api.request(`/images/${endpoint}`, 'image', {
      ...body instanceof FormData ? { body } : { json: body }, signal, timeoutMs: imageTimeoutMs,
    })
    let parsed
    try { parsed = await reply.json() } catch { throw new HarnessError('Tokamak returned an image reply that is not JSON.', 'TOKAMAK_REQUEST_FAILED') }
    return decodeReply(parsed, reply.headers.get('x-tokamak-execution-id'))
  }

  /**
   * Read text aloud.
   * @param {Record<string, unknown>} args - text, voice, instructions, speed.
   * @param {AbortSignal} [signal] - the caller's signal.
   * @returns {Promise<Uint8Array>} a 24 kHz 16-bit mono WAV file.
   */
  async function speak(args, signal) {
    let body
    try { body = speechBody(args) } catch (error) { throw new HarnessError(/** @type {Error} */(error).message, 'TOKAMAK_INVALID_ARGS') }
    const reply = await api.request('/audio/speech', 'speech', { json: body, signal, timeoutMs: 120_000 })
    return new Uint8Array(await reply.arrayBuffer())
  }

  /**
   * Transcribe one recording.
   * @param {Uint8Array} audio - the recording.
   * @param {string} fileName - name whose extension names its container.
   * @param {string | undefined} language - language hint or `auto`.
   * @param {AbortSignal} [signal] - the caller's signal.
   */
  async function transcribe(audio, fileName, language, signal) {
    let form
    try { form = transcriptionForm(transcriptionModel, audio, fileName, language) } catch (error) { throw new HarnessError(/** @type {Error} */(error).message, 'TOKAMAK_INVALID_ARGS') }
    const reply = await api.request('/audio/transcriptions', 'transcription', { body: form, signal, timeoutMs: 120_000 })
    return decodeTranscription(await reply.json())
  }

  /**
   * Durable image references the calling model can see, when it reads images.
   * @param {SessionWorkspace} at - the Session workspace.
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
   * @param {(at: SessionWorkspace, options: import('./images.mjs').ImageOptions) => Promise<{ reply: ImageReply, fallback: string }>} call - the API request.
   */
  async function runImage(exec, args, call) {
    let options
    try { options = imageOptions(args) } catch (error) { throw new HarnessError(/** @type {Error} */(error).message, 'TOKAMAK_INVALID_ARGS') }
    const at = await sessionWorkspace(ctx, exec)
    const started = Date.now()
    const { reply, fallback } = await call(at, options)
    exec.signal.throwIfAborted()
    const extension = `.${reply.images[0]?.mediaType.slice('image/'.length) ?? 'png'}`
    const paths = await outputPaths(ctx, at, typeof args.path === 'string' ? args.path : undefined, fallback, extension, reply.images.length, exec.signal)
    const files = []
    for (const [index, path] of paths.entries()) files.push(await writeInside(ctx, at, path, /** @type {ImageReply['images'][number]} */(reply.images[index]).data, exec.signal))
    const images = await attachmentsFor(at, reply, exec.signal)
    return {
      files,
      model: imageModel,
      ...reply.size === undefined ? {} : { size: reply.size },
      ...reply.quality === undefined ? {} : { quality: reply.quality },
      seconds: Math.round((Date.now() - started) / 100) / 10,
      ...reply.executionId === undefined ? {} : { executionId: reply.executionId },
      images,
    }
  }

  /** @type {ToolDefinition['output']} */
  const imageOutput = {
    schema: {},
    render(_args, value) {
      const result = /** @type {{ files: string[], size?: string, quality?: string, seconds: number, images: ImageAttachmentRef[] }} */ (/** @type {unknown} */ (value))
      const detail = [result.size, result.quality && `${result.quality} quality`, `${result.seconds} s`].filter(Boolean).join(', ')
      const text = `Saved ${result.files.length === 1 ? 'image' : `${result.files.length} images`} (${detail}):\n${result.files.join('\n')}\nCall present with the file to show it to the user.`
      return [{ type: 'text', text }, ...result.images.map(attachment => (/** @type {const} */ ({ type: 'image', attachment: /** @type {any} */ (attachment) })))]
    },
  }

  /** @type {ToolDefinition['output']} */
  const textOutput = { schema: {}, render: (_args, value) => [{ type: 'text', text: String(value) }] }

  /**
   * Read one source image through the Session filesystem.
   * @param {SessionWorkspace} at - the Session workspace.
   * @param {string} path - file path relative to the working directory.
   * @param {AbortSignal} signal - the tool call's signal.
   */
  async function readImage(at, path, signal) {
    const extension = path.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
    const mediaType = SOURCE_TYPES[extension]
    if (mediaType === undefined) throw new HarnessError(`Cannot edit ${path}: use a PNG, JPEG or WebP file.`, 'TOKAMAK_INVALID_ARGS')
    const data = await readInside(ctx, at, path, MAX_SOURCE_BYTES, signal)
    return { data, mediaType, name: path.split(/[\\/]/).pop() ?? 'image' }
  }

  ctx.effect(function*() {
    yield ctx.tools.register(/** @type {ToolDefinition} */({
      name: 'generate_image',
      description: `Create a new image from a text description with ${imageModel} and save it as a file. ${AFTER_SAVE}`,
      parameters: parameterSchema({
        prompt: { type: 'string', required: true, description: 'What the image shows: subject, style, composition, text to render, colors.' },
        ...IMAGE_PARAMETERS,
      }),
      output: imageOutput,
      execute: (args, exec) => runImage(exec, /** @type {Record<string, unknown>} */(args), async (_at, options) => ({
        reply: await imageRequest('generations', generationBody(imageModel, options), exec.signal),
        fallback: defaultPath('images', options.prompt, '.png'),
      })),
    }))

    yield ctx.tools.register(/** @type {ToolDefinition} */({
      name: 'edit_image',
      description: `Change existing image files with ${imageModel}: restyle, add or remove things, combine several images into one, or edit only the transparent area of a mask. Saves the result as a new file and leaves the sources unchanged unless path names one. ${AFTER_SAVE}`,
      parameters: parameterSchema({
        prompt: { type: 'string', required: true, description: 'The change to make, or how to combine the images.' },
        images: {
          type: 'array', required: true, minItems: 1, maxItems: MAX_IMAGES,
          items: { type: 'string' },
          description: 'PNG, JPEG or WebP files to edit, relative to the working directory. The first is the main image.',
        },
        mask: { type: 'string', description: 'Optional PNG the same size as the first image; its transparent pixels mark the area to change.' },
        ...IMAGE_PARAMETERS,
      }),
      output: imageOutput,
      execute: (args, exec) => runImage(exec, /** @type {Record<string, unknown>} */(args), async (at, options) => {
        const input = /** @type {Record<string, unknown>} */ (args)
        const paths = Array.isArray(input.images) ? input.images.filter(/** @param {unknown} path */ path => typeof path === 'string' && path.trim().length > 0) : []
        if (paths.length === 0 || paths.length > MAX_IMAGES) throw new HarnessError(`images needs 1 to ${MAX_IMAGES} file paths.`, 'TOKAMAK_INVALID_ARGS')
        const sources = await Promise.all(paths.map(/** @param {string} path */ path => readImage(at, path, exec.signal)))
        const mask = typeof input.mask === 'string' && input.mask.trim() ? await readImage(at, input.mask, exec.signal) : undefined
        if (mask !== undefined && mask.mediaType !== 'image/png') throw new HarnessError('mask must be a PNG with transparency.', 'TOKAMAK_INVALID_ARGS')
        const first = /** @type {string} */ (paths[0]).replace(/\.[A-Za-z0-9]+$/, '')
        return { reply: await imageRequest('edits', editForm(imageModel, options, sources, mask), exec.signal), fallback: `${first}-edited.png` }
      }),
    }))

    yield ctx.tools.register(/** @type {ToolDefinition} */({
      name: 'text_to_speech',
      output: textOutput,
      description: 'Read text aloud with a natural voice and save it as a WAV file, for a voice-over, a spoken summary or an audio version of a document. '
        + `Up to ${MAX_SPEECH_CHARS} characters per call; split longer text into several files. It is read word for word, never answered or rewritten. `
        + 'Call present with the file so the user can play it.',
      parameters: parameterSchema({
        text: { type: 'string', required: true, description: 'The exact words to read.' },
        path: { type: 'string', description: 'Where to save it, relative to the working directory, ending in .wav. Defaults to audio/<first words>.wav.' },
        voice: { type: 'string', enum: VOICES, description: 'Voice. Default marin.' },
        instructions: { type: 'string', description: 'Tone and pace only, such as "warm and slow". Never changes the words.' },
        speed: { type: 'number', minimum: 0.25, maximum: 1.5, description: 'Speaking speed, 0.25 to 1.5. Default 1.' },
      }),
      execute: async (args, exec) => {
        const input = /** @type {Record<string, unknown>} */ (args)
        const at = await sessionWorkspace(ctx, exec)
        const started = Date.now()
        const audio = await speak(input, exec.signal)
        const [path] = await outputPaths(ctx, at, typeof input.path === 'string' ? input.path : undefined,
          defaultPath('audio', String(input.text), '.wav'), '.wav', 1, exec.signal)
        const file = await writeInside(ctx, at, /** @type {string} */(path), audio, exec.signal)
        const seconds = wavSeconds(audio)
        return `Saved ${seconds === undefined ? 'audio' : `${seconds.toFixed(1)} s of audio`} in ${((Date.now() - started) / 1000).toFixed(1)} s:\n${file}\nCall present with the file so the user can play it.`
      },
    }))

    yield ctx.tools.register(/** @type {ToolDefinition} */({
      name: 'transcribe_audio',
      output: textOutput,
      description: `Turn speech in an audio or video file of the working directory into text with ${transcriptionModel}: meetings, voice notes, interviews. `
        + `WAV, MP3, M4A, MP4, FLAC, Ogg or WebM up to 25 MB. Billed per second of audio.`,
      parameters: parameterSchema({
        path: { type: 'string', required: true, description: 'The recording, relative to the working directory.' },
        language: { type: 'string', description: 'ISO-639-1 code of the spoken language, such as en or vi. Omit to detect it.' },
      }),
      execute: async (args, exec) => {
        const input = /** @type {Record<string, unknown>} */ (args)
        const path = typeof input.path === 'string' ? input.path.trim() : ''
        const extension = path.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
        if (!AUDIO_TYPES.includes(extension)) throw new HarnessError(`Cannot transcribe ${path || 'that file'}: use ${AUDIO_TYPES.join(', ')}.`, 'TOKAMAK_INVALID_ARGS')
        const at = await sessionWorkspace(ctx, exec)
        const audio = await readInside(ctx, at, path, MAX_TRANSCRIPTION_BYTES, exec.signal)
        const result = await transcribe(audio, path.split(/[\\/]/).pop() ?? `audio${extension}`, typeof input.language === 'string' ? input.language : undefined, exec.signal)
        return result.text === '' ? `No speech was recognized in ${path}.` : result.text
      },
    }))

    yield ctx.tools.register(/** @type {ToolDefinition} */({
      name: 'classify',
      output: textOutput,
      description: 'Get calibrated answers about a piece of text from a classifier (TypeSafe Jev): yes/no probabilities, which of several options, or where on a scale. '
        + 'Use it for triage, routing, scoring and checks where a number is better than an opinion; it answers every question in one fast, cheap call and writes no prose.',
      parameters: parameterSchema({
        state: { oneOf: [{ type: 'string' }, { type: 'object' }], description: 'The text to evaluate, or a JSON object of text values.', required: true },
        questions: {
          type: 'object', required: true,
          description: 'Map of an id you choose to a question. Each is { type: "noul", instructions } for yes/no; '
            + '{ type: "choice", instructions, criteria: { option: description } } for one of several options; '
            + 'or { type: "score", instructions, criteria: ["lowest level", ..., "highest level"] } with 2 to 10 levels.',
        },
      }),
      execute: async (args, exec) => {
        let body
        try { body = systemOneBody(jevModel, /** @type {Record<string, unknown>} */(args)) } catch (error) { throw new HarnessError(/** @type {Error} */(error).message, 'TOKAMAK_INVALID_ARGS') }
        const reply = await api.request('/systemone', 'classification', { json: body, signal: exec.signal })
        const result = /** @type {{ answers?: unknown }} */ (await reply.json())
        return JSON.stringify(result.answers ?? result, null, 2)
      },
    }))
  }, 'jan-tokamak.tools')

  // Dictation through Tokamak in the composer's microphone, beside any local recognizer.
  if (config.speechProvider !== false) {
    ctx.inject(['speechToText'], (scope) => {
      scope.effect(() => {
        const dispose = scope.speechToText.register({
          info: { id: /** @type {any} */ ('tokamak'), name: 'Tokamak', location: 'cloud', languages: SPEECH_LANGUAGES },
          transcribe: async (/** @type {import('@janhq/jan-experimental-speech-to-text').SpeechInput} */ input, /** @type {AbortSignal} */ signal) => {
            const started = Date.now()
            const result = await transcribe(input.audio, 'speech.wav', input.language, signal)
            return { text: result.text, audioSeconds: result.seconds ?? wavSeconds(input.audio) ?? 0, inferenceSeconds: (Date.now() - started) / 1000 }
          },
        })
        return () => { void dispose() }
      }, 'jan-tokamak: speech provider')
    })
  }

  // Read aloud and voice conversations from the browser half; the key never leaves the Host.
  ctx.inject(['webServer', 'connection'], (scope) => {
    scope.effect(() => registerApi(scope, 'tokamak', {
      /** @param {{ text?: unknown, voice?: unknown }} params */
      async speak(params) {
        const audio = await speak({ text: params.text, voice: params.voice })
        return { audio: Buffer.from(audio).toString('base64'), seconds: wavSeconds(audio) ?? null }
      },
      /** @param {{ instructions?: unknown, voice?: unknown }} params */
      async voiceSession(params) {
        const voice = typeof params.voice === 'string' && VOICES.includes(params.voice) ? params.voice : 'marin'
        const instructions = typeof params.instructions === 'string' && params.instructions.trim() ? params.instructions.trim() : VOICE_INSTRUCTIONS
        const reply = await api.request('/realtime/client_secrets', 'voice', { json: clientSecretBody(realtimeModel, instructions, voice, transcriptionModel) })
        const secret = /** @type {{ value?: unknown }} */ (await reply.json())
        if (typeof secret.value !== 'string') throw new Error('Tokamak returned no voice session token.')
        return { token: secret.value, callsUrl: `${api.root}/realtime/calls?model=${encodeURIComponent(realtimeModel)}` }
      },
    }), 'jan-tokamak: browser API')
  })
}
