/** Extension positions owned by the mode pickers and their settings section. */

import type {} from '@janhq/jan-client-ui-slots'

declare module '@janhq/jan-client-ui-slots' {
  interface SlotFactoryMap {
    /** Let both pickers render the same keyed row decoration. */
    'mode.picker.rowDecoration': {
      scope: 'root'
      props: ModePickerDecorationOwnerProps
      children: { 'mode.picker.decoration': { kind: 'keyed'; scope: 'root'; inline: true } }
    }
  }
  interface SlotMap {
    /** One settings contribution below the preset roster (the editor supplies its own copy and controls). */
    'settings.agentPresets.custom': { kind: 'single'; scope: 'root' }
    /** Decorative trailing content for an existing mode picker row. The picker owns selection and accessibility. */
    'mode.picker.decoration': { kind: 'keyed'; scope: 'root'; owner: ModePickerDecorationOwnerProps }
  }
}

/** Values shared by a mode row and its decoration. */
export interface ModePickerDecorationOwnerProps {
  /** Row id and dispatch key: a Host preset id, or `action:<id>` for a workflow. */
  readonly id: string
  /** Whether the picker marks this row as the current mode. */
  readonly selected: boolean
}
