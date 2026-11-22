/** A zip file's entry names and sizes, read from its central directory without inflating anything. */
import { useMemo, type ReactNode } from 'react'
// The explicit browser entry: the client build would otherwise take fflate's `node` export condition.
import { unzipSync } from 'fflate/browser'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import css from './ArchiveBody.module.css'

/** Standard document props plus the archive dictionary. */
export type ArchiveBodyProps = DocumentPreviewProps & PropsLocale<'sidebarArchive'>

/** Rows drawn before the listing is cut short. */
export const ARCHIVE_ROW_LIMIT = 2000

interface ArchiveEntry { readonly name: string; readonly size: number }

/**
 * List a zip's files, directories omitted, sorted by name.
 * @param data - complete zip bytes.
 * @returns the entries, or undefined when the bytes are not a readable zip.
 */
export function archiveEntries(data: Uint8Array): ArchiveEntry[] | undefined {
  const entries: ArchiveEntry[] = []
  try {
    unzipSync(data, { filter: (file) => { if (!file.name.endsWith('/')) entries.push({ name: file.name, size: file.originalSize }); return false } })
  } catch { return undefined }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

function formatSize(bytes: number, locale: string | undefined): string {
  const megabytes = bytes >= 1024 * 1024
  return new Intl.NumberFormat(locale, { style: 'unit', unit: megabytes ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 })
    .format(bytes / (megabytes ? 1024 * 1024 : 1024))
}

/**
 * Show the archive's file list with sizes.
 * @param props - complete bytes and locale.
 * @returns the listing, a failure line, or nothing before the bytes arrive.
 */
export function ArchiveBody({ content, t }: ArchiveBodyProps): ReactNode {
  const data = content.kind === 'bytes' ? content.data : undefined
  const entries = useMemo(() => data === undefined ? undefined : archiveEntries(data), [data])
  const locale = typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined
  if (data === undefined) return null
  if (entries === undefined) return <p className={css.failed} role="alert">{t('failed')}</p>
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  const shown = entries.slice(0, ARCHIVE_ROW_LIMIT)
  return (
    <div className={css.archive}>
      <p className={css.summary}>{t('summary', { count: entries.length, size: formatSize(total, locale) })}</p>
      <ul className={css.list} aria-label={t('title')}>
        {shown.map(entry => (
          <li key={entry.name} className={css.row}>
            <span className={css.entryName} title={entry.name}><bdi>{entry.name}</bdi></span>
            <span className={css.size}>{formatSize(entry.size, locale)}</span>
          </li>
        ))}
      </ul>
      {entries.length > shown.length ? <p className={css.summary}>{t('more', { count: entries.length - shown.length })}</p> : null}
    </div>
  )
}
