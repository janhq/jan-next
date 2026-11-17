/**
 * Agent-preset settings extension slot — the seat a plugin distributed outside
 * this repository uses to add its own preset authoring to the settings section
 * without editing it.
 *
 * The section renders the seat below the built-in and custom roster, so the
 * contribution reads as a Custom-group editor rather than a separate page.
 * Without a registrant the area renders nothing.
 *
 * TYPE HOME RATIONALE: the Agent presets section declares this slot at runtime,
 * and a plugin registering an extension already depends on this package for the
 * declaration. The type therefore lives with its declarer.
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One settings contribution below the preset roster (the editor supplies its own copy and controls). */
    'settings.agentPresets.custom': { kind: 'single'; scope: 'root' }
  }
}
