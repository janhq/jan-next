// ViewToggle: the grid/list switch for a page of cards. Two icon segments in
// one track, each named by a tooltip; the owner holds the mode and lays the
// collection out with it. `useViewMode` remembers the choice per page across
// visits, so the switch is a preference rather than a transient filter.

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { IconGridViewOutlineRegular, IconListViewOutlineRegular } from './icons/index.tsx'
import { Tooltip } from './Tooltip.tsx'
import css from './ViewToggle.module.css'

/** How a collection page lays out its items. */
export type ViewMode = 'grid' | 'list'

const isViewMode = (value: unknown): value is ViewMode => value === 'grid' || value === 'list'

/**
 * Remember a page's view mode in local storage.
 * @param key - stable page key; stored as `jan:view:<key>`.
 * @param fallback - mode before the user has chosen one.
 * @returns the mode and its setter, which also persists it.
 */
export function useViewMode(key: string, fallback: ViewMode = 'grid'): [ViewMode, (mode: ViewMode) => void] {
  const storageKey = `jan:view:${key}`
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const stored = globalThis.localStorage.getItem(storageKey)
      return isViewMode(stored) ? stored : fallback
    } catch {
      // Storage can be unavailable (sandboxed or disabled); the page still switches for this visit.
      return fallback
    }
  })
  const choose = useCallback((next: ViewMode) => {
    setMode(next)
    try { globalThis.localStorage.setItem(storageKey, next) } catch {
      // Unavailable storage only loses the preference, not the switch.
    }
  }, [storageKey])
  return [mode, choose]
}

/**
 * Render the grid/list switch.
 * @param props.value - the current mode; the toggle is fully controlled.
 * @param props.onChange - called with the mode a click or an arrow key asks for.
 * @param props.labels - localized names: `grid` and `list` for each segment, `group` for the whole switch.
 * @param props.className - extra class for toolbar placement.
 * @returns the radio group element.
 */
export function ViewToggle({ value, onChange, labels, className }: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  labels: { readonly grid: string; readonly list: string; readonly group: string }
  className?: string | undefined
}) {
  const modes = [
    { mode: 'grid' as const, Icon: IconGridViewOutlineRegular },
    { mode: 'list' as const, Icon: IconListViewOutlineRegular },
  ]
  return (
    <div role="radiogroup" aria-label={labels.group} className={clsx(css.toggle, className)} data-mode={value}>
      <span aria-hidden="true" className={css.indicator} />
      {modes.map(({ mode, Icon }) => {
        const active = mode === value
        return (
          <Tooltip key={mode} label={labels[mode]} side="bottom" delayMs={400}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={labels[mode]}
              tabIndex={active ? 0 : -1}
              className={css.segment}
              onClick={() => { if (!active) onChange(mode) }}
              onKeyDown={(event) => {
                // Arrow keys move between the two segments, as in any radio group.
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const next = value === 'grid' ? 'list' : 'grid'
                onChange(next)
                const group = event.currentTarget.parentElement
                requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
              }}
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
