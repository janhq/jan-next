/** Back / Forward icon button shared by the sidebar shell and the hidden-sidebar seat. */
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, Tooltip } from '@janhq/jan-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@janhq/jan-client-shortcuts/client'

/** Props of one navigation button. */
export interface NavigationButtonProps {
  readonly direction: 'back' | 'forward'
  /** Localized name, used as the tooltip text and the accessible name. */
  readonly label: string
  /** Shortcut row of the matching command, when it has one. */
  readonly shortcut: ShortcutCatalogEntry | undefined
  /** True while the history has no entry in this direction. */
  readonly disabled: boolean
  readonly onClick: () => void
  /** The caller's icon-button class(es), carrying the placement the surface needs. */
  readonly className: string | undefined
  readonly size: number
  readonly tooltipSide?: 'right' | 'bottom'
  /** Render the bubble under document.body, past a clipping drawer. */
  readonly portal?: boolean
}

/**
 * One chevron button. A history with nowhere to go dims it with `aria-disabled`
 * instead of `disabled`, so it keeps its tooltip and its place in the tab order.
 * @param props - direction, localized label and shortcut row, availability, and the surface's styling.
 * @returns the button wrapped in its tooltip.
 */
export function NavigationButton({
  direction, label, shortcut, disabled, onClick, className, size, tooltipSide = 'bottom', portal = false,
}: NavigationButtonProps) {
  const Icon = direction === 'back' ? IconChevronLeftOutlineRegular : IconChevronRightOutlineRegular
  return (
    <Tooltip label={label} shortcutKeys={shortcut?.keys} delayMs={500} side={tooltipSide} portal={portal}>
      <button
        type="button"
        className={className}
        data-navigation={direction}
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={disabled ? undefined : shortcut?.aria}
        onClick={() => { if (!disabled) onClick() }}
      >
        <Icon size={size} />
      </button>
    </Tooltip>
  )
}
