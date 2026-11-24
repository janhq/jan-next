import type { SessionId } from '@janhq/jan-session/types'
import type { AgentPresetModeAction } from './index.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import { requiresCodingTools, type AgentPresetOption } from './settings-store.ts'
import css from './AgentPresetSeat.module.css'
import { PresetIcon } from './PresetIcon.tsx'

const actionId = (id: string): string => `action:${id}`

/** Filter the menu without hiding the mode label on an existing Session.
 * @param options Healthy presets in Host roster order.
 * @param developerTools Whether to also offer the gated built-in presets.
 * @returns The presets to offer in either mode picker.
 */
export function modePickerOptions(options: readonly AgentPresetOption[], developerTools: boolean): AgentPresetOption[] {
  return options.filter(option => option.showInModePicker !== false && (developerTools || !requiresCodingTools(option)))
}

/** Merge Host preset order with client workflow actions using their declared positions.
 * @param options Presets to display, in Host roster order.
 * @param actions Workflow actions contributed by client plugins.
 * @param t Locale lookup for built-in preset copy.
 * @returns Menu rows in ascending order, with unranked rows last.
 */
export function modeMenuItems(
  options: readonly AgentPresetOption[],
  actions: readonly AgentPresetModeAction[],
  t: (key: AgentPresetSettingsKey) => string,
) {
  return [...options, ...actions]
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    .map((option) => {
      const action = 'run' in option
      const text = action ? { name: option.name(), description: option.description() } : presetDisplayText(option, t)
      const highlight = !action && option.id === 'cordis'
      return {
        id: action ? actionId(option.id) : option.id,
        icon: <PresetIcon icon={option.icon} size={14} />,
        label: (
          <span className={css.item}>
            <span className={highlight ? `${css.itemName} ${css.creatorName}` : css.itemName}>{text.name}</span>
            <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
          </span>
        ),
      }
    })
}

/** Return whether a contributed workflow handled this pick. */
export function runModeAction(actions: readonly AgentPresetModeAction[], id: string, sessionId: SessionId | undefined): boolean {
  const action = actions.find(value => actionId(value.id) === id)
  if (action === undefined) return false
  action.run(sessionId)
  return true
}
