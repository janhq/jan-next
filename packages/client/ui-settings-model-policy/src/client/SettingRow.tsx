/** One Settings row: title and description on the left, an optional control on the right. */
import type { ReactNode } from 'react'
import css from './PolicyCard.module.css'

export function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return <div className={css.row}>
    <div className={css.rowText}>
      <div className={css.title}>{title}</div>
      {description !== undefined && <div className={css.description}>{description}</div>}
    </div>
    {children}
  </div>
}
