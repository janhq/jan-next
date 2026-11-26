import type { Context } from '@janhq/cordis'
import type { FactoryComponentPropsOf, RenderFactorySlot } from '@janhq/jan-client-ui-slots'
import type { SessionId } from '@janhq/jan-session/types'
import type { AgentPresetModeAction } from './index.ts'
import { presetDisplayText, requiresCodingTools, type AgentPresetSettingsKey } from './locales.ts'
import type { AgentPresetOption } from './settings-store.ts'
import css from './AgentPresetSeat.module.css'
import { PresetIcon } from './PresetIcon.tsx'
import type {} from './slot-contract.ts'

const actionId = (id: string): string => `action:${id}`

/** Filter the menu without hiding the mode label on an existing Session.
 * @param options Healthy presets in Host roster order.
 * @param developerTools Whether to also offer the gated built-in presets.
 * @returns The presets to offer in either mode picker.
 */
export function modePickerOptions(options: readonly AgentPresetOption[], developerTools: boolean): AgentPresetOption[] {
  return options.filter(option => option.showInModePicker !== false && (developerTools || !requiresCodingTools(option)))
}

function ModeDecoration({ id, selected, renderSlot }: FactoryComponentPropsOf<'mode.picker.rowDecoration'>) {
  return renderSlot('mode.picker.decoration', { id, selected }, { entryKey: id })
}

/** Declare the trailing keyed slot shared by both mode pickers.
 * @param ctx - The mode picker plugin context.
 * @returns A disposer for the factory and the registrations in its child slot.
 */
export function registerModeDecoration(ctx: Context): () => void {
  return ctx.slots.registerFactory({
    name: 'mode.picker.rowDecoration', scope: 'root',
    children: { 'mode.picker.decoration': { kind: 'keyed', scope: 'root', inline: true } },
  }, ModeDecoration)
}

/** Merge Host preset order with client workflow actions using their declared positions.
 * @param options Presets to display, in Host roster order.
 * @param actions Workflow actions contributed by client plugins.
 * @param t Locale lookup for built-in preset copy.
 * @param selectedId The current picker selection.
 * @param renderFactorySlot The picker entry's factory renderer.
 * @returns Menu rows in ascending order, with unranked rows last.
 */
export function modeMenuItems(
  options: readonly AgentPresetOption[],
  actions: readonly AgentPresetModeAction[],
  t: (key: AgentPresetSettingsKey) => string,
  selectedId: string,
  renderFactorySlot: RenderFactorySlot,
) {
  return [...options, ...actions]
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    .map((option) => {
      const action = 'run' in option
      const text = action ? { name: option.name(), description: option.description() } : presetDisplayText(option, t)
      const highlight = !action && option.id === 'cordis'
      const id = action ? actionId(option.id) : option.id
      return {
        id,
        icon: <PresetIcon icon={option.icon} size={14} />,
        label: (
          <span className={css.itemRow}>
            <span className={css.item}>
              <span className={highlight ? `${css.itemName} ${css.creatorName}` : css.itemName}>{text.name}</span>
              <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
            </span>
            <span className={css.itemDecoration} aria-hidden="true">
              {renderFactorySlot('mode.picker.rowDecoration', { id, selected: id === selectedId })}
            </span>
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
