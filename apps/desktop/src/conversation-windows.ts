/**
 * Secondary conversation windows: a chat tab dragged out of a window, or moved
 * from its tab menu, opens in a new native window that runs the same app page.
 * Each window has a desktop-owned id that scopes its renderer state (tab layout
 * and selection), so windows open at quit come back on the next launch.
 */
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { SCHEME } from './ipc.ts'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const WINDOW_ID = /^[A-Za-z0-9-]{1,64}$/u
const FILE = 'conversation-windows.json'

/**
 * Validate a move request before any window opens: it must come from the top
 * frame of an owned app window and name one well-formed Session.
 * @param owns - whether a WebContents id belongs to an open product window.
 * @param open - opens the new window on the Session.
 * @returns the IPC handler.
 */
export function conversationWindowMoveHandler(
  owns: (webContentsId: number) => boolean,
  open: (sessionId: string) => Promise<void>,
): (event: IpcMainInvokeEvent, sessionId: unknown) => Promise<void> {
  return async (event, sessionId) => {
    const frame = event.senderFrame
    if (frame === null || frame !== event.sender.mainFrame || !frame.url.startsWith(`${SCHEME}://app/`) || !owns(event.sender.id)) {
      throw new Error('jan desktop: rejected window move from an unowned renderer')
    }
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('jan desktop: invalid Session id')
    await open(sessionId)
  }
}

/**
 * Read the secondary windows open at the last quit.
 * @param userData - Electron user data directory.
 * @returns their ids; a missing or damaged file is no windows.
 */
export function readConversationWindowIds(userData: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(join(userData, FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || !Array.isArray((value as { windows?: unknown }).windows)) return []
    return (value as { windows: unknown[] }).windows
      .filter((id): id is string => typeof id === 'string' && WINDOW_ID.test(id))
  } catch {
    return []
  }
}

/**
 * Replace the saved list of open secondary windows; writes run in call order.
 * @param userData - Electron user data directory.
 * @returns a writer that persists the latest list.
 */
export function conversationWindowStore(userData: string): (ids: readonly string[]) => Promise<void> {
  let pending = Promise.resolve()
  return (ids) => {
    const path = join(userData, FILE)
    const text = `${JSON.stringify({ windows: ids })}\n`
    pending = pending.then(async () => {
      const temp = `${path}.tmp`
      await writeFile(temp, text)
      await rename(temp, path)
    }).catch((error: unknown) => { console.error('desktop windows: could not save open windows', error) })
    return pending
  }
}
