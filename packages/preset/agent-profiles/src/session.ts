/**
 * The session-log record of which agent profile a chat runs. Selecting a profile changes the system prompt and
 * the tools later turns see, so the choice is logged; replay, resume and fork read it from the `agentProfile`
 * Session projection.
 * @module @janhq/jan-agent-profiles/session
 */
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import { z } from 'zod'

declare module '@janhq/jan-session/types' {
  interface SessionEventMap {
    /**
     * The chat's agent profile was chosen, or cleared with `null`, at a turn boundary. Log-only: later turns add
     * that profile's instructions and tool limits; nothing above the event is rewritten.
     */
    'agent-profile/selected': { agentProfile: string | null }
  }
}

const agentProfileSchema = z.union([z.string(), z.null()])

/** Current profile id of a Session, advanced by selection events. */
export const agentProfileProjectionDefinition = {
  key: 'agentProfile',
  stateSchema: agentProfileSchema,
  init: () => null,
  apply: (state, event) => event.type === 'agent-profile/selected' ? event.data.agentProfile : state,
  wire: { viewSchema: agentProfileSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentProfile', string | null>
