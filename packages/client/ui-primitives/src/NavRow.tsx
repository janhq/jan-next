// NavRow: one sidebar destination row (New chat, Search, Projects...). The
// rail form keeps only the glyph and its accessible name; the wide form adds
// the label and an optional shortcut hint. A row with something to create
// carries a hover "+" as a sibling button, since a button cannot nest inside
// the row's own button.

import type { MouseEvent, ReactNode, Ref } from 'react'
import clsx from 'clsx'
import { IconPlusOutlineRegular } from './icons/index.tsx'
import { ShortcutKeys } from './ShortcutKeys.tsx'
import css from './NavRow.module.css'

/** Hover action beside a row, such as "New project" next to Projects. */
export interface NavRowQuickAction {
  /** Accessible name and tooltip of the "+" button. */
  label: string
  /** Runs without also activating the row. */
  onClick: () => void
}

/** Props of {@link NavRow}. */
export interface NavRowProps {
  /** Leading glyph; drawn in the secondary label colour on wide rows. */
  icon: ReactNode
  /** Visible label on wide rows; the accessible name and tooltip on the rail. */
  label: string
  /** Rendered keycaps of the row's shortcut, shown at the trailing edge of wide rows. */
  shortcutKeys?: readonly string[] | undefined
  /** `aria-keyshortcuts` value of the same shortcut. */
  shortcutAria?: string | undefined
  /** Icon-only rail form. */
  rail?: boolean | undefined
  /** The row is the open page: tinted and exposed through `aria-current="page"`. */
  current?: boolean | undefined
  /** Ref to the row's native button, for anchoring popovers. */
  buttonRef?: Ref<HTMLButtonElement> | undefined
  /** Activates the destination. */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  /** Hover "+" beside a wide row; ignored on the rail. */
  quick?: NavRowQuickAction | undefined
  /** Extra class on the row button. */
  className?: string | undefined
}

/**
 * Render a sidebar navigation row.
 * @param props - glyph, label, optional shortcut, rail and current state, click handler, and optional quick action.
 * @returns the row button, wrapped with its quick action when one is given on a wide row.
 */
export function NavRow({
  icon, label, shortcutKeys, shortcutAria, rail = false, current = false, buttonRef, onClick, quick, className,
}: NavRowProps) {
  const row = (
    <button
      type="button"
      ref={buttonRef}
      className={clsx(css.row, rail && css.rail, current && css.current, className)}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      title={rail ? label : undefined}
      aria-keyshortcuts={shortcutAria}
      onClick={onClick}
    >
      {icon}
      {!rail && <span className={css.label}>{label}</span>}
      {!rail && shortcutKeys !== undefined && shortcutKeys.length > 0
        && <ShortcutKeys keys={shortcutKeys} className={css.shortcut} />}
    </button>
  )
  if (rail || quick === undefined) return row
  return (
    <div className={css.item}>
      {row}
      <button
        type="button"
        className={css.quick}
        aria-label={quick.label}
        title={quick.label}
        onClick={(event) => {
          event.stopPropagation()
          quick.onClick()
        }}
      >
        <IconPlusOutlineRegular size={14} />
      </button>
    </div>
  )
}
