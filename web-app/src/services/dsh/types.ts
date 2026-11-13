export interface DshLaunch {
  /** The deepseek-harness checkout. */
  root: string
  /** OpenAI-compatible base URL ending in `/v1`. */
  baseUrl: string
  apiKey: string
  /** The runtime serves one model; a different one means a restart. */
  model: string
  /** Persona for every session; empty keeps the composition's default. */
  systemPrompt: string
  /** Agent workspace; empty means a private folder in the app's data. */
  cwd: string
}

export interface DshStatus {
  running: boolean
  launch: DshLaunch | null
}

export interface DshService {
  /** Starts the runtime, restarting it when `launch` differs. */
  start(launch: DshLaunch): Promise<void>
  /** Writes one JSON-RPC frame to the runtime. */
  send(frame: unknown): Promise<void>
  stop(): Promise<void>
  status(): Promise<DshStatus>
  /** Rejects with the reason a folder is not a usable checkout. */
  checkRoot(root: string): Promise<void>
  /** One parsed JSON-RPC frame from the runtime's stdout. */
  onFrame(cb: (frame: Record<string, unknown>) => void): Promise<() => void>
  /** The runtime exited; `stderr` is its last lines. */
  onExit(cb: (stderr: string) => void): Promise<() => void>
}
