import type {} from '@janhq/jan-client-ui-settings/client'
import type { PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import css from './AgentLoopSection.module.css'

type AgentLoopSectionProps = PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.agentLoop.item'>

/** Render the Agent loop settings in slot order. */
export function AgentLoopSection({ renderSlot }: AgentLoopSectionProps) {
  return <div className={css.section}>{renderSlot('settings.agentLoop.item', {})}</div>
}
