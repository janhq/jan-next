/**
 * Request and reply shapes of Tokamak's voice and System One endpoints: `POST /audio/speech` (text read aloud by a
 * Realtime model), `POST /audio/transcriptions` (`openai/gpt-transcribe`, per second), `POST /realtime/client_secrets`
 * (a one-time browser token) and `POST /systemone` (Jev's calibrated answers).
 * @module @janhq/jan-tokamak/audio
 */

/** Voices the speech endpoint reads with. */
export const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

/** Longest text one speech request reads. */
export const MAX_SPEECH_CHARS = 4096

/** Largest recording the transcription endpoint accepts. */
export const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024

/** Transcription model used when the plugin config names none. */
export const DEFAULT_TRANSCRIPTION_MODEL = 'openai/gpt-transcribe'

/** Realtime model a voice conversation uses when the plugin config names none. */
export const DEFAULT_REALTIME_MODEL = 'openai/gpt-realtime-2.1-mini'

/** Jev model System One answers with when the plugin config names none. */
export const DEFAULT_JEV_MODEL = 'jev/jev-latest'

/**
 * The JSON body of a speech request, validated before it is sent.
 * @param {Record<string, unknown>} args - text, voice, instructions and speed.
 * @returns {{ input: string, voice: string, response_format: 'wav', instructions?: string, speed?: number }} the body.
 */
export function speechBody(args) {
  const input = typeof args.text === 'string' ? args.text.trim() : ''
  if (input === '') throw new Error('text is required.')
  if (input.length > MAX_SPEECH_CHARS) throw new Error(`text is ${input.length} characters; one request reads up to ${MAX_SPEECH_CHARS}.`)
  const voice = args.voice === undefined ? 'marin' : String(args.voice)
  if (!VOICES.includes(voice)) throw new Error(`voice must be one of ${VOICES.join(', ')}.`)
  const speed = args.speed === undefined ? undefined : Number(args.speed)
  if (speed !== undefined && !(speed >= 0.25 && speed <= 1.5)) throw new Error('speed must be 0.25 to 1.5.')
  const instructions = typeof args.instructions === 'string' && args.instructions.trim() ? args.instructions.trim() : undefined
  return { input, voice, response_format: 'wav', ...instructions ? { instructions } : {}, ...speed === undefined ? {} : { speed } }
}

/**
 * Seconds of audio in a 16-bit PCM WAV file, read from its header; undefined when it is not one.
 * @param {Uint8Array} wav - file bytes.
 * @returns {number | undefined} the duration.
 */
export function wavSeconds(wav) {
  if (wav.byteLength < 44) return undefined
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (/** @type {number} */ at) => String.fromCharCode(...wav.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return undefined
  const byteRate = view.getUint32(28, true)
  if (byteRate === 0) return undefined
  // Walk the chunks to the data chunk; streamed WAVs may carry an unknown (0 or 0xffffffff) data size.
  for (let at = 12; at + 8 <= wav.byteLength;) {
    const size = view.getUint32(at + 4, true)
    if (tag(at) === 'data') {
      const bytes = size === 0 || size === 0xffffffff ? wav.byteLength - at - 8 : Math.min(size, wav.byteLength - at - 8)
      return bytes / byteRate
    }
    at += 8 + size + (size % 2)
  }
  return undefined
}

/**
 * The multipart body of a transcription request.
 * @param {string} model - transcription model id.
 * @param {Uint8Array} audio - the recording.
 * @param {string} name - file name, whose extension names the container.
 * @param {string | undefined} language - ISO-639-1 hint, omitted for automatic detection.
 * @returns {FormData} the form.
 */
export function transcriptionForm(model, audio, name, language) {
  if (audio.byteLength > MAX_TRANSCRIPTION_BYTES) throw new Error('Recordings up to 25 MB can be transcribed.')
  const form = new FormData()
  form.set('model', model)
  form.set('file', new File([/** @type {Uint8Array<ArrayBuffer>} */ (audio)], name))
  if (language && language !== 'auto') form.set('language', language)
  return form
}

/**
 * The transcript text of a reply.
 * @param {unknown} body - parsed JSON reply.
 * @returns {{ text: string, seconds?: number }} text, empty when nothing was said, and the billed seconds.
 */
export function decodeTranscription(body) {
  const reply = /** @type {{ text?: unknown, usage?: { seconds?: unknown } }} */ (body)
  if (typeof reply?.text !== 'string') throw new Error('Tokamak returned a transcription without text.')
  return { text: reply.text.trim(), ...typeof reply.usage?.seconds === 'number' ? { seconds: reply.usage.seconds } : {} }
}

/** Question types System One answers. */
const QUESTION_TYPES = ['noul', 'choice', 'score']

/**
 * The JSON body of a System One request, validated so the model gets a plain reason instead of a provider 422.
 * @param {string} model - Jev model id.
 * @param {Record<string, unknown>} args - `state` and `questions`.
 * @returns {{ model: string, state: unknown, questions: Record<string, object> }} the body.
 */
export function systemOneBody(model, args) {
  const state = args.state
  if (!(typeof state === 'string' ? state.trim() : state !== null && typeof state === 'object')) throw new Error('state is required: the text, or a JSON object of text values, to evaluate.')
  const questions = args.questions
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions) || Object.keys(questions).length === 0) {
    throw new Error('questions needs at least one question, keyed by an id you choose.')
  }
  for (const [id, question] of Object.entries(/** @type {Record<string, any>} */ (questions))) {
    if (!QUESTION_TYPES.includes(question?.type)) throw new Error(`questions.${id}.type must be one of ${QUESTION_TYPES.join(', ')}.`)
    if (question.instructions === undefined) throw new Error(`questions.${id}.instructions is required.`)
    if (question.type === 'choice' && (question.criteria === null || typeof question.criteria !== 'object' || Array.isArray(question.criteria))) {
      throw new Error(`questions.${id}.criteria must map each option to its description for a choice question.`)
    }
    if (question.type === 'score' && !(Array.isArray(question.criteria) && question.criteria.length >= 2 && question.criteria.length <= 10)) {
      throw new Error(`questions.${id}.criteria must list 2 to 10 levels, lowest first, for a score question.`)
    }
  }
  return { model, state, questions: /** @type {Record<string, object>} */ (questions) }
}

/**
 * The client-secret request for one browser voice conversation.
 * @param {string} model - Realtime model id.
 * @param {string} instructions - the assistant's instructions for the conversation.
 * @param {string} voice - the voice it answers with.
 * @param {string} transcriptionModel - model that transcribes what the user says.
 * @returns {object} the JSON body.
 */
export function clientSecretBody(model, instructions, voice, transcriptionModel) {
  return {
    session: {
      type: 'realtime', model, instructions,
      audio: { input: { transcription: { model: transcriptionModel } }, output: { voice } },
    },
  }
}
