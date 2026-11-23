import { useState, type ReactElement, type ReactNode } from 'react'
import clsx from 'clsx'
import { Menu } from './Menu.tsx'
import { IconChevronDownOutlineRegular, IconLoadingOutlineRegular } from './icons/index.tsx'
import css from './SelectMenu.module.css'

/** One choice; `id` is the value reported to `onChange`. */
export interface SelectMenuOption<T extends string> {
  id: T
  label: ReactNode
  disabled?: boolean
}

/**
 * Settings choice control: a pill button showing the current option that opens a
 * menu of the options. Replaces native `<select>` so every Settings choice looks
 * and behaves the same.
 * @param props.value - the selected option id, or undefined when none is known.
 * @param props.options - ordered choices.
 * @param props.onChange - called with the picked id; not called for the current one.
 * @param props.label - localized accessible name for the button.
 * @param props.placeholder - shown when `value` matches no option.
 * @param props.disabled - blocks opening.
 * @param props.busy - shows a spinner and blocks opening while a change applies.
 * @param props.align - menu edge aligned to the button (default `end`).
 * @param props.className - extra class for the button.
 * @returns the button and its menu.
 */
export function SelectMenu<T extends string>({ value, options, onChange, label, placeholder, disabled = false, busy = false, align = 'end', className }: {
  value: T | undefined
  options: readonly SelectMenuOption<T>[]
  onChange: (id: T) => void
  label: string
  placeholder?: ReactNode
  disabled?: boolean | undefined
  busy?: boolean | undefined
  align?: 'start' | 'end'
  className?: string | undefined
}): ReactElement {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.id === value)
  const blocked = disabled || busy
  return <Menu open={open && !blocked} onClose={() => { setOpen(false) }} portal align={align}
    selectedId={value}
    items={options.map(option => ({ id: option.id, label: option.label, ...option.disabled === true ? { disabled: true } : {} }))}
    onSelect={(id) => {
      setOpen(false)
      if (id !== value) onChange(id as T)
    }}
    anchor={<button type="button" className={clsx(css.selector, className)} disabled={blocked}
      aria-busy={busy} aria-label={label} aria-haspopup="menu" aria-expanded={open && !blocked}
      onClick={() => { setOpen(!open) }}>
      <span className={css.value}>{current?.label ?? placeholder}</span>
      {busy ? <IconLoadingOutlineRegular className={css.spinner} /> : <IconChevronDownOutlineRegular className={css.chevron} />}
    </button>} />
}
