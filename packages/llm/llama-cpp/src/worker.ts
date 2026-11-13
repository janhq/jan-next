/**
 * Protocol of the bundled `jan-llama-worker`: the stdout handshake line, the `--list-devices`
 * output, exit codes, and the lifecycle HTTP calls a supervisor makes. See `native/llama-worker/README.md`.
 */
import type { Readable } from 'node:stream'
import type { LlamaCppDevice } from './types.ts'

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
  /** Preset section names, sorted. */
  models: string[]
  /** Devices the worker initialised; null when they could not be read. */
  devices: WorkerDevice[] | null
}

/** A handshake line or worker response that does not follow the worker protocol. */
export class WorkerProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    || !(raw.devices === null || (Array.isArray(raw.devices) && raw.devices.every(isDevice)))) {
    throw new WorkerProtocolError(`the local model worker printed an invalid handshake: ${line.slice(0, 200)}`)
  }
  return { port: raw.port, pid: raw.pid, models: raw.models, devices: raw.devices }
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
   * Re-read the preset; only sections whose options changed are reloaded.
   * @param presetPath - absolute preset path.
   * @param modelsMax - resident model bound.
   * @param signal - cancellation.
   */
  async reload(presetPath: string, modelsMax: number, signal: AbortSignal): Promise<void> {
    await this.post('/models/reload', { preset_path: presetPath, models_max: modelsMax }, signal)
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

  private async post(path: string, body: object, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${this.origin}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal })
    if (response.ok) { await response.body?.cancel(); return }
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
