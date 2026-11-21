/** Shared project avatar for the sidebar, picker, and identity preview. */
import { IconCodeOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconGlobeOutlineRegular, IconGoalOutlineRegular, IconImageOutlineRegular, IconLayersOutlineRegular, IconSparkleRegular, IconStarOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { WorkspaceAvatar, WorkspaceColor, WorkspaceIcon } from '@janhq/jan-api-workspace-controller/client'
import css from './ProjectIdentity.module.css'

/** Glyph components for the curated set accepted by the Host. */
export const projectIcons = {
  folder: IconFolderCloseRegular,
  star: IconStarOutlineRegular,
  globe: IconGlobeOutlineRegular,
  code: IconCodeOutlineRegular,
  sparkle: IconSparkleRegular,
  target: IconGoalOutlineRegular,
  layers: IconLayersOutlineRegular,
  image: IconImageOutlineRegular,
} satisfies Record<WorkspaceIcon, typeof IconFolderCloseRegular>

/**
 * @param props - optional saved identity, display size, and default folder expansion.
 * @returns the decorative avatar; the surrounding control supplies the accessible name.
 */
export function ProjectAvatar({ avatar, color, expanded, size = 16 }: {
  avatar?: WorkspaceAvatar | undefined
  color?: WorkspaceColor | undefined
  expanded?: boolean | undefined
  size?: 16 | 24
}) {
  const Icon = avatar?.kind === 'icon' ? projectIcons[avatar.name]
    : expanded ? IconFolderOpenRegular : IconFolderCloseRegular
  return (
    <span aria-hidden="true" className={css.avatar} data-color={color} data-size={size} data-emoji={avatar?.kind === 'emoji' || undefined}>
      {avatar?.kind === 'emoji' ? avatar.value : <Icon size={size === 24 ? 18 : 16} />}
    </span>
  )
}
