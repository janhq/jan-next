/** Lazily open preview and artifact links for the change request's displayed head. */

import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconChevronRightOutlineRegular, IconFolderCloseRegular, IconRightUpOutlineRegular, Menu, StateDot, type MenuEntry } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { ChangeRequestAssets as Assets, ChangeRequestSnapshot } from '@janhq/jan-experimental-forge/types'
import type { ChangeRequestActions } from './ChangeRequestCard.tsx'
import type { NS } from './locales.ts'
import css from './ForgeTab.module.css'

interface AssetLink {
  readonly url: string
  readonly label: string
  readonly detail?: string
  readonly disabled?: boolean
}

type Translate = PropsLocale<typeof NS>['t']

function AssetRow({ label, links, openLink, icon, t }: {
  readonly label: string
  readonly links: readonly AssetLink[]
  readonly openLink: ChangeRequestActions['openLink']
  readonly icon: ReactNode
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  const first = links[0]
  if (first === undefined) return null
  const items: MenuEntry[] = open ? links.map(link => ({ id: link.url, disabled: link.disabled ?? false,
    icon: <IconRightUpOutlineRegular size={14} />,
    label: <span className={css.assetItem}>
      <span className={css.ellipsis} title={link.label}>{link.label}</span>
      {link.detail !== undefined && <span className={css.assetDetail}>{link.detail}</span>}
    </span>,
  })) : []
  return (
    <Menu open={open} onClose={() => { setOpen(false) }} portal dense autoFocus
      className={css.checksAnchor} listClassName={css.checksList} items={items}
      onSelect={(url) => { setOpen(false); openLink(url) }}
      anchor={(
        <button type="button" className={clsx(css.row, css.rowButton)} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open) }}>
          <span className={css.rowIcon}>{icon}</span>
          <span className={css.rowLabel}>{label}</span>
          <span className={css.rowValue}>
            <span className={css.ellipsis} title={first.label}>{first.label}</span>
            {links.length > 1 && <span className={css.assetCount}>{t('change.assets.more', { count: links.length - 1 })}</span>}
          </span>
          <IconChevronRightOutlineRegular size={12} className={css.rowChevron} />
        </button>
      )}
    />
  )
}

type Load = { readonly kind: 'loading' } | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly assets: Assets }

/**
 * Read assets only while the card is expanded, retaining partial results on errors.
 * @param props - displayed snapshot, provider callbacks, and localized formatting.
 * @returns preview and artifact rows, or inline loading and recovery.
 */
export function ChangeRequestAssets({ snapshot, readAssets, openLink, locale, t }: {
  readonly snapshot: ChangeRequestSnapshot
  readonly readAssets: NonNullable<ChangeRequestActions['readAssets']>
  readonly openLink: ChangeRequestActions['openLink']
  readonly locale: string
  readonly t: Translate
}): ReactNode {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const { url, headSha } = snapshot
  useEffect(() => {
    const controller = new AbortController()
    void readAssets(url, headSha, controller.signal).then(
      (assets) => { if (!controller.signal.aborted) setLoad({ kind: 'ready', assets }) },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { controller.abort() }
  }, [url, headSha, readAssets, attempt])
  const retry = (): void => { setLoad({ kind: 'loading' }); setAttempt(value => value + 1) }
  if (load.kind === 'loading') return <div className={css.detailStatus} role="status"><StateDot state="ongoing" size={14} />{t('change.assets.loading')}</div>
  const failure = load.kind === 'error' ? load.message : load.assets.failures.map(error => error.message).filter((value, index, all) => all.indexOf(value) === index).join('\n')
  const files = load.kind === 'ready' ? load.assets.artifacts.map((artifact): AssetLink => {
    const scale = artifact.sizeBytes >= 1_000_000 ? 1_000_000 : artifact.sizeBytes >= 1_000 ? 1_000 : 1
    const unit = scale === 1_000_000 ? 'megabyte' : scale === 1_000 ? 'kilobyte' : 'byte'
    const size = new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(artifact.sizeBytes / scale)
    const expired = artifact.expired || Date.parse(artifact.expiresAt) <= Date.now()
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(artifact.expiresAt))
    const expiry = t(expired ? 'change.assets.expired' : 'change.assets.expires', { date })
    return { url: artifact.url, label: artifact.name, detail: `${size} · ${expiry}`, disabled: expired }
  }) : []
  return (
    <>
      <AssetRow label={t('change.assets.previews')} links={load.kind === 'ready' ? load.assets.previews : []} openLink={openLink} icon={<IconRightUpOutlineRegular size={16} />} t={t} />
      <AssetRow label={t('change.assets.artifacts')} links={files} openLink={openLink} icon={<IconFolderCloseRegular size={16} />} t={t} />
      {load.kind === 'ready' && load.assets.truncated && <p className={css.detailStatus}>{t('change.assets.truncated')}</p>}
      {failure !== '' && (
        <div className={css.detailStatus} role="status">
          <span title={failure}>{t('change.assets.failed')}</span>
          <Button size="sm" variant="outline" onClick={retry}>{t('retry')}</Button>
        </div>
      )}
    </>
  )
}
