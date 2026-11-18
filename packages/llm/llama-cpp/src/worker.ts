/**
 * Protocol of the bundled `jan-llama-worker`: the stdout handshake line, the `--list-devices`
 * output, exit codes, and the lifecycle HTTP calls a supervisor makes. See `native/llama-worker/README.md`.
 */
import type { Readable } from 'node:stream'
import type { LlamaCppDevice, LocalModelStatus } from './types.ts'

/** One offload device the worker initialised. */
export interface WorkerDevice {
  id: string
  name: string
}

/** The single JSON line the worker prints once its listener is bound. */
export interface WorkerHandshake {
  /** Loopback port the worker listens on. */
  port: number
  pid: number
  /** Preset model section names, sorted. */
  models: string[]
  /** Alias section name to the model section it serves. */
  aliases: Record<string, string>
  /** Devices the worker initialised; null when they could not be read. */
  devices: WorkerDevice[] | null
}

/** A handshake line or worker response that does not follow the worker protocol. */
export class WorkerProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string')
}

function isDevice(value: unknown): value is WorkerDevice {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

/**
 * Parse and validate the handshake line.
 * @param line - first stdout line, without its newline.
 * @returns the handshake.
 * @throws {@link WorkerProtocolError} for anything else.
 */
export function parseHandshake(line: string): WorkerHandshake {
  let raw: unknown
  try { raw = JSON.parse(line) }
  catch { throw new WorkerProtocolError(`the local model worker printed an unreadable handshake: ${line.slice(0, 200)}`) }
  if (!isRecord(raw) || !Number.isInteger(raw.port) || typeof raw.port !== 'number' || raw.port < 1 || raw.port > 65_535
    || !Number.isInteger(raw.pid) || typeof raw.pid !== 'number'
    || !Array.isArray(raw.models) || !raw.models.every(model => typeof model === 'string')
    || !isStringRecord(raw.aliases)
    || !(raw.devices === null || (Array.isArray(raw.devices) && raw.devices.every(isDevice)))) {
    throw new WorkerProtocolError(`the local model worker printed an invalid handshake: ${line.slice(0, 200)}`)
  }
  return { port: raw.port, pid: raw.pid, models: raw.models, aliases: raw.aliases, devices: raw.devices }
}

/**
 * Parse the JSON array `--list-devices` prints: `{ id, name, mem, free }` per device, memory in MiB.
 * @param text - the command's stdout.
 * @returns the devices.
 * @throws {@link WorkerProtocolError} for anything else.
 */
export function parseDeviceList(text: string): LlamaCppDevice[] {
  let raw: unknown
  try { raw = JSON.parse(text.trim()) }
  catch { throw new WorkerProtocolError(`the local model worker listed its devices unreadably: ${text.slice(0, 200)}`) }
  if (!Array.isArray(raw) || !raw.every(isListedDevice)) {
    throw new WorkerProtocolError(`the local model worker listed invalid devices: ${text.slice(0, 200)}`)
  }
  return raw.map(device => ({ id: device.id, name: device.name, totalMiB: device.mem, freeMiB: device.free }))
}

function isListedDevice(value: unknown): value is WorkerDevice & { mem: number; free: number } {
  return isDevice(value) && isRecord(value) && typeof value.mem === 'number' && value.mem >= 0
    && typeof value.free === 'number' && value.free >= 0
}

const EXIT_MEANINGS: Readonly<Record<number, string>> = {
  2: 'it was started with invalid arguments',
  3: 'it links a llama.cpp build other than the pinned one',
  4: 'it could not read its preset',
  5: 'it could not bind its loopback listener',
  7: 'it could not create its KV cache directory',
}

/**
 * Describe how the worker ended.
 * @param exitCode - exit code, or null when a signal ended it.
 * @param signal - terminating signal.
 * @returns a sentence fragment such as `exited with code 4: it could not read its preset`.
 */
export function describeExit(exitCode: number | null, signal: NodeJS.Signals | null): string {
  if (exitCode === null) return `was ended by ${signal ?? 'a signal'}`
  const meaning = EXIT_MEANINGS[exitCode]
  return `exited with code ${String(exitCode)}${meaning === undefined ? '' : `: ${meaning}`}`
}

/**
 * Read the first line of a stream, then keep draining the stream so the child never blocks on a
 * full pipe.
 * @param stream - the worker's stdout.
 * @param maxBytes - longest line accepted.
 * @returns the line without its newline, or undefined when the stream ended first.
 * @throws {@link WorkerProtocolError} when no newline arrives within `maxBytes`.
 */
export function readFirstLine(stream: Readable, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const finish = (): void => {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onEnd)
      stream.on('data', discard)
    }
    const onData = (chunk: Buffer | string): void => {
      buffered += chunk.toString()
      const newline = buffered.indexOf('\n')
      if (newline >= 0) { finish(); resolve(buffered.slice(0, newline).trimEnd()); return }
      if (buffered.length > maxBytes) { finish(); reject(new WorkerProtocolError('the local model worker printed no handshake line')) }
    }
    const onEnd = (): void => { finish(); resolve(undefined) }
    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('error', onEnd)
  })
}

function discard(): void {}

/** One `/models/sse` transition. */
export interface WorkerModelEvent {
  /** Model section name; never an alias. */
  model: string
  status: LocalModelStatus
  /** Present on `unloaded`: 0 for an unload or eviction, nonzero for a failed load. */
  exitCode?: number
}

function isModelStatus(value: unknown): value is LocalModelStatus {
  return value === 'loading' || value === 'loaded' || value === 'unloaded'
}

/**
 * Parse one `/models/sse` data payload.
 * @param data - text after `data: `.
 * @returns the transition, or undefined for a payload that is not a model status change.
 */
export function parseModelEvent(data: string): WorkerModelEvent | undefined {
  let raw: unknown
  try { raw = JSON.parse(data) }
  catch { return undefined }
  if (!isRecord(raw) || typeof raw.model !== 'string' || raw.event !== 'status_change' || !isRecord(raw.data)) return undefined
  const { status, exit_code: exitCode } = raw.data
  if (!isModelStatus(status)) return undefined
  return {
    model: raw.model, status,
    ...typeof exitCode === 'number' ? { exitCode } : {},
  }
}

/**
 * Parse a `GET /models` body: `{ data: [{ id, status: { value } }] }`.
 * @param text - the response body.
 * @returns model section name to its status.
 * @throws {@link WorkerProtocolError} for anything else.
 */
export function parseModelList(text: string): Map<string, LocalModelStatus> {
  let raw: unknown
  try { raw = JSON.parse(text) }
  catch { throw new WorkerProtocolError(`the local model worker listed its models unreadably: ${text.slice(0, 200)}`) }
  const data = isRecord(raw) ? raw.data : undefined
  if (!Array.isArray(data)) throw new WorkerProtocolError(`the local model worker listed invalid models: ${text.slice(0, 200)}`)
  const models = new Map<string, LocalModelStatus>()
  for (const entry of data) {
    const status = isRecord(entry) && isRecord(entry.status) ? entry.status.value : undefined
    if (!isRecord(entry) || typeof entry.id !== 'string' || !isModelStatus(status)) {
      throw new WorkerProtocolError(`the local model worker listed invalid models: ${text.slice(0, 200)}`)
    }
    models.set(entry.id, status)
  }
  return models
}

/** Yield the model transitions of an SSE body; comment lines such as `: keepalive` carry no data and are skipped. */
async function* modelEvents(body: ReadableStream<Uint8Array>): AsyncIterable<WorkerModelEvent> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true })
    let end = buffered.indexOf('\n\n')
    while (end >= 0) {
      const data = buffered.slice(0, end).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      buffered = buffered.slice(end + 2)
      end = buffered.indexOf('\n\n')
      const event = parseModelEvent(data)
      if (event !== undefined) yield event
    }
  }
}

/** Authenticated lifecycle calls on one running worker. */
export class WorkerClient {
  /**
   * @param origin - `http://127.0.0.1:<port>`.
   * @param key - bearer key the worker requires.
   */
  constructor(readonly origin: string, private readonly key: string) {}

  /**
   * Load a model and leave it resident; the worker answers once loading finished.
   * @param model - preset section name.
   * @param signal - cancellation.
   * @throws Error carrying the worker's message when loading failed.
   */
  async load(model: string, signal: AbortSignal): Promise<void> {
    await this.post('/models/load', { model }, signal)
  }

  /**
   * Unload a resident model; the worker refuses while it has requests in flight.
   * @param model - preset section name or alias.
   * @param signal - cancellation.
   * @throws Error carrying the worker's message when it refused.
   */
  async unload(model: string, signal: AbortSignal): Promise<void> {
    await this.post('/models/unload', { model }, signal)
  }

  /**
   * Subscribe to model load, unload and eviction transitions. Resolves once the worker accepted the
   * subscription, so a load requested afterwards cannot be missed.
   * @param signal - ends the subscription.
   * @returns the transitions, in the order the worker made them, until it exits or `signal` aborts.
   * @throws Error when the worker refuses the subscription.
   */
  async events(signal: AbortSignal): Promise<AsyncIterable<WorkerModelEvent>> {
    const response = await fetch(`${this.origin}/models/sse`, { headers: this.headers(), signal })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new Error(`the local model worker refused its event feed: HTTP ${String(response.status)}`)
    }
    return modelEvents(response.body)
  }

  /**
   * Read the status of every preset model; aliases are not listed.
   * @param signal - cancellation.
   * @returns model section name to its status, as `GET /models` reports it.
   * @throws Error when the worker refuses; {@link WorkerProtocolError} for a list that does not follow the protocol.
   */
  async models(signal: AbortSignal): Promise<Map<string, LocalModelStatus>> {
    const response = await fetch(`${this.origin}/models`, { headers: this.headers(), signal })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`the local model worker refused its model list: HTTP ${String(response.status)}`)
    }
    return parseModelList(await response.text())
  }

  /**
   * Re-read the preset; only sections whose options changed are reloaded.
   * @param presetPath - absolute preset path.
   * @param modelsMax - resident model bound.
   * @param signal - cancellation.
   * @param removal - replacement preset and model that must not be resident when applied.
   */
  async reload(presetPath: string, modelsMax: number, signal: AbortSignal, removal?: { id: string; preset: string }): Promise<void> {
    await this.post('/models/reload', { preset_path: presetPath, models_max: modelsMax,
      ...removal === undefined ? {} : { remove_if_unloaded: removal.id, replacement_preset_path: removal.preset },
    }, signal, removal?.id)
  }

  /**
   * Read the context a loaded model settled on.
   * @param model - preset section name.
   * @param signal - cancellation.
   * @returns the per-slot context size, if the worker reports one.
   */
  async contextSize(model: string, signal: AbortSignal): Promise<number | undefined> {
    const response = await fetch(`${this.origin}/props?model=${encodeURIComponent(model)}`, { headers: this.headers(), signal })
    if (!response.ok) { await response.body?.cancel(); return undefined }
    const props: unknown = await response.json()
    const settings = isRecord(props) ? props.default_generation_settings : undefined
    const value = isRecord(settings) ? settings.n_ctx : undefined
    return typeof value === 'number' && value > 0 ? value : undefined
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' }
  }

  private async post(path: string, body: object, signal: AbortSignal, unloadedModel?: string): Promise<void> {
    const response = await fetch(`${this.origin}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal })
    if (response.ok) {
      if (unloadedModel === undefined) await response.body?.cancel()
      else {
        const result: unknown = await response.json()
        if (!isRecord(result) || result.guarded_removal !== unloadedModel) {
          throw new Error('Stop the local model worker before deleting this model.')
        }
      }
      return
    }
    const text = await response.text()
    let message = text.trim() || `HTTP ${String(response.status)}`
    try {
      const parsed: unknown = JSON.parse(text)
      const error = isRecord(parsed) ? parsed.error : undefined
      if (isRecord(error) && typeof error.message === 'string') message = error.message
    } catch (_notJson) { /* A non-JSON body is reported as written. */ }
    throw new Error(message)
  }
}
