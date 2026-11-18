/** Contextual help using Chromium's native interest and popover behavior. */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { IconQuestionOutlineRegular } from './icons/index.tsx'
import type { TooltipSide } from './tooltip-placement.ts'
import css from './Toggletip.module.css'

/** Localized, non-interactive help for a dedicated information button. */
export interface ToggletipProps {
  /** Accessible name of the button. */
  label: string
  /** Hint content; do not include links or other focusable controls. */
  children: ReactNode
  /** Preferred placement. The browser tries the opposite side if it does not fit. */
  side?: TooltipSide
}

/**
 * Show the hint on hover, focus, click, or tap. The browser owns dismissal and does not move focus to the hint.
 * @param props - localized trigger and hint content, with optional preferred placement.
 * @returns an information button and its associated native hint popover.
 */
export function Toggletip({ label, children, side = 'top' }: ToggletipProps) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const hint = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trigger = button.current
    const popover = hint.current
    if (!trigger || !popover) return
    const syncExpanded = (event: ToggleEvent) => {
      trigger.setAttribute('aria-expanded', String(event.newState === 'open'))
    }
    popover.addEventListener('toggle', syncExpanded, true)
    return () => { popover.removeEventListener('toggle', syncExpanded, true) }
  }, [])

  return <>
    <Button ref={button} size="sm" className={css.trigger} aria-label={label}
      interestfor={id} popovertarget={id} popovertargetaction="show"
      aria-expanded="false" aria-describedby={id} icon={<IconQuestionOutlineRegular />} />
    <div ref={hint} id={id} role="tooltip" popover="hint" className={css.hint} data-side={side}>{children}</div>
  </>
}
