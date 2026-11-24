/** The sidebar's Artifacts entry icon; the sidebar owns the button, label, and selected state around it. */
import type { ReactNode } from 'react'
import { IconLayersOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { PropsRuntime } from '@janhq/jan-client-ui-slots'
import type {} from '@janhq/jan-client-ui-sidebar/client'

/**
 * Render the layers glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function ArtifactsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLayersOutlineRegular size={size} />
}
