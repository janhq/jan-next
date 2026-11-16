export interface DshLaunch {
  /** The deepseek-harness checkout. */
  root: string
  /** OpenAI-compatible base URL ending in `/v1`. */
  baseUrl: string
  apiKey: string
  /** The runtime serves one model; a different one means a restart. */
  model: string
  /** Agent workspace; empty means a private folder in the app's data. */
  cwd: string
}

/** What the DSH shell takes over from the Jan UI on each start. */
export interface DshShellSetup {
  /** OpenAI-compatible endpoints; keys are read from the keyring by name. */
  providers: { name: string; baseUrl: string; models: string[] }[]
  /** `[provider name, model id]` of the Jan UI's selected model. */
  defaultModel: [string, string] | null
  look: { primary: string; sidebar: { light: string; dark: string } } | null
  theme: 'light' | 'dark' | 'system'
}

export interface DshStatus {
  running: boolean
  launch: DshLaunch | null
}

/** One entry of the composed DSH plugin set. */
export interface DshPluginEntry {
  id: string
  /** Module specifier the Loader imports. */
  name: string
  /** `base` ships with the app, `user` is from plugins.yml, `mcp` from MCP settings. */
  source: 'base' | 'user' | 'mcp'
  enabled: boolean
  /** YAML text of the entry's config. */
  config: string
  /** npm package a user entry was installed from. */
  package: string | null
}

/** One file of a thread's folder, read for the work panel preview. */
export interface WorkspaceFile {
  /** Absolute path, for Open and Show in folder. */
  path: string
  /** UTF-8 text, or null for a binary file (then `base64` is set). */
  text: string | null
  base64: string | null
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
  /** Base + user + MCP entries; edits apply on the next restart. */
  pluginsList(): Promise<DshPluginEntry[]>
  pluginSetEnabled(id: string, enabled: boolean): Promise<void>
  /** `config` is YAML or JSON; empty clears it. */
  pluginSetConfig(id: string, config: string): Promise<void>
  /** Installs an npm package and adds an entry for it. */
  pluginInstall(pkg: string): Promise<void>
  pluginRemove(id: string): Promise<void>
  /** Restarts the running runtime so plugin changes apply; no-op when stopped. */
  restart(): Promise<void>
  /** A thread's private workspace folder, created on first use. */
  threadWorkspace(threadId: string): Promise<string>
  /** Reads `path` (relative or absolute) inside `folder`; refuses one outside it. */
  readWorkspaceFile(folder: string, path: string): Promise<WorkspaceFile>
  /**
   * Starts DSH's own web host (every screen a DSH UI plugin) with `setup`
   * and moves the main window onto it. Restarts it when `setup` changed.
   */
  webStart(setup: DshShellSetup): Promise<void>
  /** One parsed JSON-RPC frame from the runtime's stdout. */
  onFrame(cb: (frame: Record<string, unknown>) => void): Promise<() => void>
  /** The runtime exited; `stderr` is its last lines. */
  onExit(cb: (stderr: string) => void): Promise<() => void>
}
