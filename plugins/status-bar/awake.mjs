// Keep the computer awake: always, only while an agent is working, or never.
// Each system's own sleep blocker runs as a child process that also watches
// the Host's process id, so a crashed Host never leaves the machine awake.

/** @typedef {'on' | 'agent' | 'off'} AwakeMode */
/** @typedef {{ mode: AwakeMode, active: boolean, working: number, error: string | null }} AwakeState */
/** @typedef {(command: string, args: string[], signal: AbortSignal, window: 'hidden') => Promise<unknown>} Runner */

/** Modes in the order the picker lists them. */
export const AWAKE_MODES = /** @type {const} */ (['on', 'agent', 'off'])

/**
 * The command that holds a sleep blocker until it is stopped or `pid` exits.
 * @param {NodeJS.Platform} platform - Host system.
 * @param {number} pid - Host process id the blocker follows.
 * @returns {{ command: string, args: string[] } | null} null on a system without a supported blocker.
 */
export function blockerCommand(platform, pid) {
  if (platform === 'darwin') return { command: 'caffeinate', args: ['-i', '-w', String(pid)] }
  if (platform === 'linux') {
    return {
      command: 'systemd-inhibit',
      args: ['--what=idle:sleep', '--who=Jan', '--why=Keep computer awake is on', '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'],
    }
  }
  if (platform === 'win32') {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED; Windows drops the request when this process exits.
    const script = "$k=Add-Type -Name Power -Namespace Jan -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';"
      + ` [void]$k::SetThreadExecutionState([uint32]'0x80000001'); Wait-Process -Id ${pid}`
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
  }
  return null
}

/**
 * Track the chosen mode and working agents, and hold the blocker exactly while it is needed.
 * @param {{ run: Runner, platform?: NodeJS.Platform, pid?: number, onChange?: (state: AwakeState) => void, logger?: { warn(message: string): void } }} options - system boundary.
 * @returns {{ state(): AwakeState, setMode(mode: AwakeMode): void, setWorking(agentId: string, working: boolean): void, dispose(): void }} the controller.
 */
export function createAwakeController({ run, platform = process.platform, pid = process.pid, onChange = () => {}, logger }) {
  /** @type {AwakeMode} */
  let mode = 'off'
  const working = new Set()
  let error = null
  let holder

  const wanted = () => mode === 'on' || (mode === 'agent' && working.size > 0)
  const state = () => ({ mode, active: holder !== undefined, working: working.size, error })

  function start() {
    const command = blockerCommand(platform, pid)
    if (command === null) {
      error = 'unsupported'
      return
    }
    const controller = new AbortController()
    holder = controller
    error = null
    run(command.command, command.args, controller.signal, 'hidden').then(
      () => exited(controller, 'exited'),
      reason => exited(controller, reason?.code === 'ENOENT' ? 'missing' : 'failed', reason),
    )
  }

  function exited(controller, kind, reason) {
    if (controller.signal.aborted || holder !== controller) return
    holder = undefined
    error = kind
    logger?.warn(`Keep awake: the sleep blocker stopped (${kind})${reason ? `: ${reason.message ?? reason}` : ''}`)
    onChange(state())
  }

  function sync() {
    const before = JSON.stringify(state())
    if (wanted() && holder === undefined && error === null) start()
    if (!wanted() && holder !== undefined) {
      holder.abort()
      holder = undefined
    }
    if (!wanted()) error = null
    if (JSON.stringify(state()) !== before) onChange(state())
  }

  return {
    state,
    setMode(next) {
      if (!AWAKE_MODES.includes(next)) throw new Error('Choose on, agent or off.')
      // Choosing a mode again retries a blocker that failed.
      if (next !== mode || error !== null) error = null
      mode = next
      sync()
    },
    setWorking(agentId, isWorking) {
      if (isWorking) working.add(agentId)
      else working.delete(agentId)
      sync()
    },
    dispose() {
      holder?.abort()
      holder = undefined
    },
  }
}
