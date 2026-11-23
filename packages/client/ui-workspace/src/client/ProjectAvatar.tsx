/** Shared project avatar for the sidebar, picker, identity preview, and project page title. */
import { useState } from 'react'
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
 * The picture an avatar loads: an uploaded image, a site's favicon, or, with no saved avatar,
 * the GitHub owner's picture, which GitHub serves for every account.
 * @param avatar - saved avatar, undefined for the automatic one.
 * @param githubOwner - owner of the folder's GitHub `origin`, if any.
 * @returns the image URL, or undefined when the avatar is a glyph or emoji.
 */
export function projectAvatarImage(avatar: WorkspaceAvatar | undefined, githubOwner: string | undefined): string | undefined {
  if (avatar?.kind === 'image') return avatar.url
  // DuckDuckGo's icon service finds the icon a page declares, not only `/favicon.ico`.
  if (avatar?.kind === 'favicon') return `https://icons.duckduckgo.com/ip3/${avatar.domain}.ico`
  if (avatar === undefined && githubOwner !== undefined) return `https://github.com/${encodeURIComponent(githubOwner)}.png?size=64`
  return undefined
}

/**
 * @param props - optional saved identity, GitHub owner, display size, and default folder expansion.
 * @returns the decorative avatar; the surrounding control supplies the accessible name.
 */
export function ProjectAvatar({ avatar, githubOwner, color, expanded, size = 16 }: {
  avatar?: WorkspaceAvatar | undefined
  githubOwner?: string | undefined
  color?: WorkspaceColor | undefined
  expanded?: boolean | undefined
  size?: 16 | 24 | 32
}) {
  const image = projectAvatarImage(avatar, githubOwner)
  // A picture that fails to load (offline, unknown site) falls back to the glyph it stands in for.
  const [failedImage, setFailedImage] = useState<string | undefined>(undefined)
  if (image !== undefined && image !== failedImage) {
    return (
      <span aria-hidden="true" className={css.avatar} data-size={size} data-image>
        <img src={image} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => { setFailedImage(image) }} />
      </span>
    )
  }
  const Icon = avatar?.kind === 'icon' && avatar.name !== 'folder' ? projectIcons[avatar.name]
    : avatar?.kind === 'favicon' ? IconGlobeOutlineRegular
      : expanded ? IconFolderOpenRegular : IconFolderCloseRegular
  return (
    <span aria-hidden="true" className={css.avatar} data-color={color} data-size={size} data-emoji={avatar?.kind === 'emoji' || undefined}>
      {avatar?.kind === 'emoji' ? avatar.value : <Icon size={size === 32 ? 22 : size === 24 ? 18 : 16} />}
    </span>
  )
}
