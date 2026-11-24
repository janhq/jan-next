/** Menu reservations contributed by the product's shortcut reference integration. */
import type { Shortcuts, ShortcutFixedCommand, ShortcutCommandId } from '@janhq/jan-client-shortcuts/client'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'

/**
 * Describe shared menu actions for display and conflict checking.
 * @param t - shortcut dictionary.
 * @returns read-only actions and each physical combination they occupy.
 */
export function fixedCommands(t: PropsLocale<'shortcuts'>['t']): readonly ShortcutFixedCommand[] {
  const rows = [
    { id: 'move', keys: ['↑', '↓'], bindings: [{ code: 'ArrowUp', modifiers: [] }, { code: 'ArrowDown', modifiers: [] }], group: 'menus' },
    { id: 'select', keys: ['Enter'], bindings: [{ code: 'Enter', modifiers: [] }], group: 'menus' },
    { id: 'dismiss', keys: ['Esc'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'menus' },
  ] as const
  return rows.map(row => ({ ...row, id: `fixed.${row.id}` as ShortcutCommandId, label: () => t(row.id) }))
}

/**
 * Describe the desktop View menu's zoom keys. The native menu performs them on the
 * whole window; the rows only show them in the reference and keep them unassignable.
 * @param t - shortcut dictionary.
 * @param describe - keyboard service binding presenter for the current platform.
 * @returns read-only zoom actions in menu order.
 */
export function zoomCommands(t: PropsLocale<'shortcuts'>['t'], describe: Shortcuts['describeBinding']): readonly ShortcutFixedCommand[] {
  const rows = [
    { id: 'zoomIn', bindings: [{ code: 'Equal', modifiers: ['primary'] }, { code: 'Equal', modifiers: ['primary', 'shift'] }] },
    { id: 'zoomOut', bindings: [{ code: 'Minus', modifiers: ['primary'] }] },
    { id: 'actualSize', bindings: [{ code: 'Digit0', modifiers: ['primary'] }] },
  ] as const
  return rows.map(row => ({ id: `view.${row.id}` as ShortcutCommandId, label: () => t(row.id),
    keys: describe(row.bindings[0]).keys, bindings: row.bindings, group: 'application' as const }))
}
