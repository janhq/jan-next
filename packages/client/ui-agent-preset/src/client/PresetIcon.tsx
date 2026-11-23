/**
 * A preset's declared icon: a product glyph name resolves to the shared icon
 * sprite, so a theme that replaces the artwork restyles it too; any other
 * value (a user's emoji) renders as text. No icon falls back to the generic
 * preset glyph, so every row keeps the same leading column.
 */
import { ICON_SYMBOLS, IconAgentPresetOutlineRegular } from '@janhq/jan-client-ui-primitives'
import css from './AgentPresetSeat.module.css'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** One user-perceived character, so a joined emoji (family, flag) stays whole. */
function firstGrapheme(value: string): string {
  for (const { segment } of graphemes.segment(value)) return segment
  return value
}

/** Props of {@link PresetIcon}. */
export interface PresetIconProps {
  /** The preset's declared icon, absent when it declares none. */
  icon?: string | undefined
  /** Rendered size in CSS pixels. */
  size?: number
  className?: string | undefined
}

/**
 * Render one preset's icon.
 * @param props - declared icon, size and class.
 * @returns the glyph, the emoji, or the generic preset glyph.
 */
export function PresetIcon({ icon, size = 16, className }: PresetIconProps) {
  const value = icon?.trim()
  if (value === undefined || value === '') return <IconAgentPresetOutlineRegular size={size} className={className} />
  const symbol = `dsw-icon-${value}-regular`
  if (Object.hasOwn(ICON_SYMBOLS, symbol)) {
    return (
      <svg width={size} height={size} className={className} data-icon={symbol} aria-hidden="true">
        <use href={`#${symbol}`} />
      </svg>
    )
  }
  return (
    <span className={className === undefined ? css.emoji : `${css.emoji} ${className}`} style={{ fontSize: size - 2, width: size, height: size }} aria-hidden="true">
      {firstGrapheme(value)}
    </span>
  )
}
