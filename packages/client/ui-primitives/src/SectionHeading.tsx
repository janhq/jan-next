// SectionHeading: the small muted label over a group of rows, such as the
// sidebar's "Chats". Page and dialog titles keep their own heading styles.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './SectionHeading.module.css'

/** Props of {@link SectionHeading}. */
export interface SectionHeadingProps {
  /** Element to render; `span` when an enclosing landmark already names the group. */
  as?: 'h2' | 'h3' | 'span' | undefined
  /** Id for `aria-labelledby` on the group it names. */
  id?: string | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
  children: ReactNode
}

/**
 * Render a group heading at 13px medium in the secondary label colour.
 * @param props - element, optional id and class, and the heading text.
 * @returns the heading element.
 */
export function SectionHeading({ as: Tag = 'h2', id, className, children }: SectionHeadingProps) {
  return <Tag id={id} className={clsx(css.heading, className)}>{children}</Tag>
}
