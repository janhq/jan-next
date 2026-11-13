/**
 * Composer commands that act on the chat's work setup instead of reaching the
 * model. Exact matches only: a message that merely starts with `/plan ...` is
 * a message, and stays one.
 */
import { setThreadPlanMode } from '@/lib/dsh-chat-transport'
import { threadWorkOf } from '@/lib/threadWork'
import { useThreads } from '@/hooks/useThreads'
import { useWorkPanel, type WorkTab } from '@/stores/work-panel-store'

export const WORK_COMMANDS = ['/plan', '/todo', '/changes', '/files'] as const

const PANEL_TAB: Record<string, WorkTab> = {
  '/todo': 'progress',
  '/changes': 'changes',
  '/files': 'files',
}

/** Runs `text` as a work command; false when it is an ordinary message. */
export function runWorkCommand(threadId: string | undefined, text: string): boolean {
  const command = text.trim().toLowerCase()
  if (!(WORK_COMMANDS as readonly string[]).includes(command)) return false
  if (command === '/plan') {
    if (!threadId) return false
    const thread = useThreads.getState().threads[threadId]
    setThreadPlanMode(threadId, !threadWorkOf(thread).planMode)
    return true
  }
  useWorkPanel.getState().show(PANEL_TAB[command])
  return true
}
