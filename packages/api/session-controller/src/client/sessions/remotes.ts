/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @janhq/jan-api-session-controller/client/sessions/remotes
 */

import type { ClientRemote } from '@janhq/jan-api-gateway/client'
import type { CommandSubmitAttachment } from '@janhq/jan-commands/types'
import type { SessionId } from '@janhq/jan-session/types'
import type {
  SubagentInterruptReceipt, SubagentPromptReceipt, SubagentPromptRequest,
} from '@janhq/jan-subagent/client'
import type { RemoteResult } from '@janhq/jan-typert-protocol'
import type { SessionRemote } from '../transport.ts'

/** Narrow Commands namespace consumed by a Client Session. */
export interface SessionCommandsRemote {
  execute(
    agentId: SessionId,
    line: string,
    attachments: readonly CommandSubmitAttachment[],
    signal?: AbortSignal,
  ): Promise<RemoteResult<object | undefined>>
}

/** Narrow subagent namespace consumed by a Client Session and its manager. */
export interface SessionSubagentsRemote {
  prompt(
    request: SubagentPromptRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SubagentPromptReceipt>>
  interruptByUser(
    childSessionId: SessionId,
  ): Promise<RemoteResult<SubagentInterruptReceipt>>
}

/** Generated Remote namespaces consumed by the Client Session object layer. */
export interface SessionRemotes {
  readonly $stream: ClientRemote['$stream']
  readonly commands: SessionCommandsRemote
  readonly session: SessionRemote
  readonly subagents: SessionSubagentsRemote
}
