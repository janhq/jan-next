/** Dismissible, non-modal guidance attached to a caller-owned anchor. */
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Button } from './Button.tsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import type { TooltipSide } from './tooltip-placement.ts'
import css from './Coachmark.module.css'

/** Controlled open state and localized contents of an anchored coachmark. */
export interface CoachmarkProps {
  anchor: RefObject<HTMLElement>
  open: boolean
  title: string
  body: ReactNode
  /** One-based step position and its localized accessible label. */
  step?: { index: number; total: number; label: string }
  /** Optional action; the caller decides whether to close or advance. */
  primary?: { label: string; onSelect: () => void }
  dismissLabel: string
  /** Invoked by Escape or the dismiss button; the caller must set open to false to close. */
  onDismiss: () => void
  side?: TooltipSide
  /** Move focus to the dismiss button on open. Off by default. */
  focusOnOpen?: boolean
}

/**
 * Show an anchored coachmark without blocking interaction with the page.
 * @param props - trigger ref, controlled visibility, localized copy and actions.
 * @returns a native manual popover; no card is opened until the caller opens it with a mounted anchor.
 */
export function Coachmark({ anchor, open, title, body, step, primary, dismissLabel, onDismiss,
  side = 'bottom', focusOnOpen = false }: CoachmarkProps) {
  const titleId = useId()
  const bodyId = useId()
  const card = useRef<HTMLDivElement>(null)
  const dismiss = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const source = anchor.current
    const popover = card.current
    if (!open || !source || !popover) return
    const highlight = css.highlight
    if (highlight) source.classList.add(highlight)
    popover.showPopover({ source })
    if (focusOnOpen) dismiss.current?.focus({ preventScroll: true })
    return () => {
      popover.hidePopover()
      if (highlight) source.classList.remove(highlight)
    }
  }, [anchor, open, focusOnOpen])

  useLayoutEffect(() => {
    const source = anchor.current
    if (!open || !source) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onDismiss()
    }
    source.ownerDocument.addEventListener('keydown', onKeyDown)
    return () => { source.ownerDocument.removeEventListener('keydown', onKeyDown) }
  }, [anchor, open, onDismiss])

  return <div ref={card} popover="manual" role="dialog" aria-labelledby={titleId} aria-describedby={bodyId}
    className={css.card} data-side={side}>
    <div className={css.heading}>
      <h2 className={css.title} id={titleId}>{title}</h2>
      <Button ref={dismiss} size="sm" className={css.dismiss} aria-label={dismissLabel}
        icon={<IconCloseOutlineRegular />} onClick={onDismiss} />
    </div>
    <div className={css.body} id={bodyId}>{body}</div>
    {(step || primary) && <div className={css.footer}>
      {step && <span className={css.step} role="progressbar" aria-label={step.label} aria-valuemin={1}
        aria-valuemax={step.total} aria-valuenow={step.index}>{step.label}</span>}
      {primary && <Button size="sm" variant="primary" className={css.primary} onClick={primary.onSelect}>{primary.label}</Button>}
    </div>}
  </div>
}
