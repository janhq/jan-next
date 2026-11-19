// Pager: previous and next buttons around a live page label, for stepping
// through pages or spreads of a preview. The owner holds the page and words
// the label ("Page 2 of 7", "Pages 2-3 of 7").

import clsx from 'clsx'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from './icons/index.tsx'
import css from './Pager.module.css'

/** Props of {@link Pager}. */
export interface PagerProps {
  /** Current position, announced politely when it changes. */
  label: string
  previousLabel: string
  nextLabel: string
  onPrevious: () => void
  onNext: () => void
  previousDisabled?: boolean | undefined
  nextDisabled?: boolean | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * Render a previous/next pager with a live position label.
 * @param props - position label, button labels and handlers, and per-button disabled state.
 * @returns the pager row.
 */
export function Pager({
  label, previousLabel, nextLabel, onPrevious, onNext, previousDisabled = false, nextDisabled = false, className,
}: PagerProps) {
  return (
    <div className={clsx(css.pager, className)}>
      <button type="button" className={css.step} disabled={previousDisabled} aria-label={previousLabel} title={previousLabel} onClick={onPrevious}>
        <IconChevronLeftOutlineRegular size={16} />
      </button>
      <span className={css.label} role="status" aria-live="polite">{label}</span>
      <button type="button" className={css.step} disabled={nextDisabled} aria-label={nextLabel} title={nextLabel} onClick={onNext}>
        <IconChevronRightOutlineRegular size={16} />
      </button>
    </div>
  )
}
