// WindowControls: minimize, maximize or restore, and close for a frameless
// window that draws its own caption (Windows and Linux). macOS keeps its
// native traffic lights, so the owner does not render this there.

import clsx from 'clsx'
import css from './WindowControls.module.css'

/** Localized names of the three caption buttons. */
export interface WindowControlsLabels {
  minimize: string
  maximize: string
  restore: string
  close: string
}

/** Props of {@link WindowControls}. */
export interface WindowControlsProps {
  /** Whether the window fills the screen; switches the middle button to Restore. */
  maximized: boolean
  labels: WindowControlsLabels
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  /** Extra class for layout placement. */
  className?: string | undefined
}

const glyph = (shape: 'minimize' | 'maximize' | 'restore' | 'close') => (
  <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true">
    {shape === 'minimize' && <path d="M0 5h10" />}
    {shape === 'maximize' && <rect x={0.5} y={0.5} width={9} height={9} />}
    {shape === 'restore' && <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />}
    {shape === 'close' && <path d="M0 0l10 10M10 0L0 10" />}
  </svg>
)

/**
 * Render the three caption buttons; Close turns red on hover as the platform does.
 * @param props - maximized state, localized labels, and the window actions.
 * @returns the caption button row.
 */
export function WindowControls({ maximized, labels, onMinimize, onToggleMaximize, onClose, className }: WindowControlsProps) {
  return (
    <div className={clsx(css.controls, className)}>
      <button type="button" className={css.button} aria-label={labels.minimize} onClick={onMinimize}>{glyph('minimize')}</button>
      <button type="button" className={css.button} aria-label={maximized ? labels.restore : labels.maximize} onClick={onToggleMaximize}>
        {glyph(maximized ? 'restore' : 'maximize')}
      </button>
      <button type="button" className={clsx(css.button, css.close)} aria-label={labels.close} onClick={onClose}>{glyph('close')}</button>
    </div>
  )
}
