/**
 * Remote computers the new-project menu offers beside this Host's folders. A
 * plugin that knows other computers (saved Hosts) registers one source
 * through `uiWorkspace.registerRemoteMachines`; the latest registration wins
 * and disposing it restores the previous one. With no source the menu has no
 * Remote row.
 */

/** One remote computer as the menu lists it. */
export interface RemoteMachine {
  readonly id: string
  readonly name: string
  /** Address or URL shown as secondary text while the computer is reachable. */
  readonly detail?: string | undefined
  /** `ready`: signed in and reachable; `connecting`: a connection is in flight; `idle`: not connected. */
  readonly state: 'ready' | 'idle' | 'connecting'
}

/** The registering plugin's side of the Remote submenu. */
export interface RemoteMachineSource {
  /**
   * Read the current computers; called each time the menu opens.
   * @param signal - aborted when the menu closes before the answer arrives.
   */
  list(signal: AbortSignal): Promise<readonly RemoteMachine[]>
  /**
   * Connect the computer if it is not connected yet; opens no page or window.
   * @param id - a listed computer.
   */
  connect(id: string): Promise<void>
  /** Show the place where computers are added and managed. */
  manage(): void
}
