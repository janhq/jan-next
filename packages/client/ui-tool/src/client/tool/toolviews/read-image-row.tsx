/** File-read metadata for the read_image row. The call tree owns its inline thumbnails. */

import { toolFileInject } from '../file-menu.ts'
import type { Context } from '@janhq/cordis'
import { imageCardModel } from '../models/image-card-model.ts'
import { readFamilyRow, type ReadFamilyRowProps } from './read-family-row.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Render the read_image status, path and expandable read metadata. */
export function ReadImageRow(props: ReadFamilyRowProps) {
  const { block } = props
  const { getTriggerProps } = props.useContextMenu()
  return readFamilyRow(props, {
    image: imageCardModel(block),
  }, getTriggerProps)
}

/** Register the read_image row in the keyed tool view slot. */
export const readImageToolview = {
  name: 'read-image-toolview',
  inject: ['slots', 'sessions'],
  /**
   * Register the read_image row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'read_image',
        locale: NS,
        inject: toolFileInject(ctx),
      }, ReadImageRow))
  },
}
