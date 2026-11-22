/** Local navigation preferences are shared only by reloads of the same native window. */
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { SessionId } from '@janhq/jan-session/types'
import type { SubagentAddress } from '@janhq/jan-subagent/client'

/** Desktop window identity; the main window has no id and keeps the unscoped keys. */
interface ConversationWindowSeed {
  readonly id?: string | undefined
  readonly sessionId?: SessionId | undefined
}

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

/**
 * @param window - Desktop-supplied window identity and its first Session, if moved from another window.
 * @returns the persisted main selection; the seed is used only for a new window.
 */
export function createMainSelection(window = (globalThis as { janConversationWindow?: ConversationWindowSeed }).janConversationWindow) {
  const key = window?.id === undefined ? 'jan.sessions.current' : `jan.sessions.current.${window.id}`
  return createSnapshotStore<MainSelection>(window?.sessionId === undefined ? {} : { sessionId: window.sessionId },
    { persist: { name: key } })
}
