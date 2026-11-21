import type { SessionId } from '@janhq/jan-session/types'
import type { AgentPresetModeAction } from './index.ts'
import css from './AgentPresetSeat.module.css'

const actionId = (id: string): string => `action:${id}`

/** Render workflow modes alongside selectable capabilities. */
export function modeActionItems(actions: readonly AgentPresetModeAction[]) {
  return actions.map(action => ({
    id: actionId(action.id),
    label: (
      <span className={css.item}>
        <span className={css.itemName}>{action.name()}</span>
        <span className={css.itemDesc}>{action.description()}</span>
      </span>
    ),
  }))
}

/** Return whether a contributed workflow handled this pick. */
export function runModeAction(actions: readonly AgentPresetModeAction[], id: string, sessionId: SessionId | undefined): boolean {
  const action = actions.find(value => actionId(value.id) === id)
  if (action === undefined) return false
  action.run(sessionId)
  return true
}
