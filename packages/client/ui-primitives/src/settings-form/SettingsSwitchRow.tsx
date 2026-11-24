/** One Settings row whose switch saves immediately and reports a refused or failed write in place. */
import { useState } from 'react'
import { Switch } from '../Switch.tsx'
import css from './SettingsSwitchRow.module.css'

/** Copy, accepted value and writer for {@link SettingsSwitchRow}. */
export interface SettingsSwitchRowProps {
  /** Row title, also the switch and group label. */
  readonly title: string
  /** One sentence under the title. */
  readonly description: string
  /** Alert shown after a refused or failed write. */
  readonly error: string
  /** Settings search anchor for this row. */
  readonly searchId: string
  /** Accepted value. */
  readonly checked: boolean
  /**
   * Write the new value.
   * @param next - the value the user picked.
   * @returns false when the owner refused it; a rejection also counts as failed.
   */
  readonly save: (next: boolean) => Promise<boolean>
}

/**
 * Render the row, disabling the switch while a write is in flight.
 * @param props - copy, accepted value and writer.
 * @returns the Settings row.
 */
export function SettingsSwitchRow({ title, description, error, searchId, checked, save }: SettingsSwitchRowProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row} role="group" aria-label={title} data-settings-search-row={searchId} tabIndex={-1}>
    <div>
      <div className={css.title}>{title}</div>
      <div className={css.description}>{description}</div>
      {failed && <div role="alert">{error}</div>}
    </div>
    <Switch checked={checked} disabled={busy} label={title}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void save(next).then((accepted) => { if (!accepted) setFailed(true) }, () => { setFailed(true) })
          .finally(() => { setBusy(false) })
      }} />
  </div>
}
