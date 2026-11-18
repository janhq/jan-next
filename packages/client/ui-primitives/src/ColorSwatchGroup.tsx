// ColorSwatchGroup: a named row of round colour buttons with one pressed
// choice, such as the accent colour in Appearance settings.

import clsx from 'clsx'
import css from './ColorSwatchGroup.module.css'

/** One colour choice. */
export interface ColorSwatch {
  /** Stable value reported to `onChange`. */
  id: string
  /** Accessible name and tooltip. */
  label: string
  /** Any CSS colour, including a `var(...)` token. */
  color: string
}

/** Props of {@link ColorSwatchGroup}. */
export interface ColorSwatchGroupProps {
  /** Accessible name of the group. */
  label: string
  swatches: readonly ColorSwatch[]
  /** Id of the pressed swatch. */
  value: string
  onChange: (id: string) => void
  disabled?: boolean | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * Render a group of colour swatch buttons; the selected one is `aria-pressed` and ringed in the accent colour.
 * @param props - group label, swatches, selected id, change handler, and disabled state.
 * @returns the swatch group.
 */
export function ColorSwatchGroup({ label, swatches, value, onChange, disabled = false, className }: ColorSwatchGroupProps) {
  return (
    <div className={clsx(css.group, className)} role="group" aria-label={label}>
      {swatches.map(swatch => (
        <button
          key={swatch.id}
          type="button"
          className={css.swatch}
          disabled={disabled}
          title={swatch.label}
          aria-label={swatch.label}
          aria-pressed={value === swatch.id}
          style={{ backgroundColor: swatch.color }}
          onClick={() => { onChange(swatch.id) }}
        />
      ))}
    </div>
  )
}
