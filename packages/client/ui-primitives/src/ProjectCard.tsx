// ProjectCard: one project folder in a grid. The path keeps its tail visible
// when clipped, since the folder name is at the end.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconFolderCloseRegular } from './icons/index.tsx'
import css from './ProjectCard.module.css'

/** Props of {@link ProjectCard}. */
export interface ProjectCardProps {
  title: string
  /** Full folder path; also the card's tooltip. */
  path: string
  /** Footer line, such as "3 chats · updated 2h". */
  meta?: ReactNode
  /** Leading glyph; a closed folder when omitted. */
  icon?: ReactNode
  onClick: () => void
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * Render a clickable project card with title, path, and meta line.
 * @param props - title, path, optional meta and icon, and click handler.
 * @returns the card button.
 */
export function ProjectCard({ title, path, meta, icon, onClick, className }: ProjectCardProps) {
  return (
    <button type="button" className={clsx(css.card, className)} title={path} onClick={onClick}>
      <span className={css.title}>{icon ?? <IconFolderCloseRegular size={16} />}{title}</span>
      <span className={css.path}>{path}</span>
      {meta !== undefined && <span className={css.meta}>{meta}</span>}
    </button>
  )
}
