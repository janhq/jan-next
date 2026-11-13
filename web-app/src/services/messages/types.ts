/**
 * Messages Service Types
 */

import { ThreadMessage } from '@janhq/core'
import type { Event } from '@/lib/emitter'

export interface MessagesService {
  /** Fires once per message the backend persisted through `createMessage`. */
  readonly onDidCreateMessage: Event<ThreadMessage>
  fetchMessages(threadId: string): Promise<ThreadMessage[]>
  createMessage(message: ThreadMessage): Promise<ThreadMessage>
  modifyMessage(message: ThreadMessage): Promise<ThreadMessage>
  deleteMessage(threadId: string, messageId: string): Promise<void>
}
