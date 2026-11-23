import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconCheckCircleOutlineRegular, IconCloseOutlineRegular } from './icons/index.tsx'
import { NotificationPortal } from './NotificationLayer.tsx'
import { TOAST_CLOSE_LABELS } from './locales/toast.ts'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none. */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000

/** The close button's name in the `<html lang>` locale, which the locale runtime keeps current; English otherwise. */
function documentCloseLabel(): string {
  const language = document.documentElement.lang.toLowerCase().split('-')[0] ?? ''
  return TOAST_CLOSE_LABELS[language] ?? TOAST_CLOSE_LABELS.en
}

/**
 * Transient notice in the shared bottom-right notification stack: slides in,
 * holds at full opacity, fades out, then reports done so the owner can
 * unmount it. Re-showing the same text restarts the cycle when the owner
 * remounts the component (key it by a per-show sequence). Notices that
 * overlap in time pile up diagonally instead of covering each other.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Completion calls the latest onDone handler; fully faded actions receive no input.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon); ignored
 * under `tone="success"`, which brings its own glyph.
 * @param props.tone - 'success' renders the design's circled green check as
 * the leading glyph; omitted, the icon seat keeps its warning tint.
 * @param props.actions - optional inline actions continuing the sentence:
 * each renders its plain-text `prefix` (a connective like 或) followed by its
 * localized `label` as blue clickable text, flowing after `text` as one
 * sentence. Each press is the owner's to handle (e.g. undo the reported
 * change, then unmount the toast). The banner surface stays click-through —
 * only the action text takes the pointer.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3000.
 * @param props.closeLabel - accessible name of the close button; defaults to
 * the document language's word for Dismiss.
 * @param props.onDone - called once the fade completes, or at once when the
 * user presses the close button; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, tone, holdMs = HOLD_MS, actions, closeLabel, onDone }: {
  text: string
  icon?: ReactNode
  tone?: 'success'
  holdMs?: number
  actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
  closeLabel?: string
  onDone: () => void
}) {
  const latestOnDone = useRef(onDone)
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  // Closing early and the timed fade both end the notice; only the first reports done.
  const finished = useRef(false)
  const finish = useRef(() => {
    if (finished.current) return
    finished.current = true
    latestOnDone.current()
  }).current
  useEffect(() => {
    const timer = setTimeout(finish, holdMs + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [holdMs, finish])
  return (
    <NotificationPortal>
      <div
        className={css.toast}
        role="alert"
        style={{ '--jan-toast-hold': `${String(holdMs)}ms` } as CSSProperties}
      >
        {tone === 'success'
          ? <span className={`${css.icon} ${css.success}`} aria-hidden><IconCheckCircleOutlineRegular /></span>
          : icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
        <span className={css.text}>
          {text}
          {actions?.map(action => (
            <Fragment key={action.label}>
              {action.prefix}
              <button type="button" className={css.action} onClick={action.onClick}>
                {action.label}
              </button>
            </Fragment>
          ))}
        </span>
        <button type="button" className={css.close} aria-label={closeLabel ?? documentCloseLabel()}
          onClick={finish}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
    </NotificationPortal>
  )
}
