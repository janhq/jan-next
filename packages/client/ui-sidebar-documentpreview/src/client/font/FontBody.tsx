/** A font file drawn as a type specimen through a document-scoped FontFace. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import { pathPartsOf } from '@janhq/jan-util-workspace-path'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { hostFileOf } from '../rpc.ts'
import type {} from './locales.ts'
import css from './FontBody.module.css'

/** Standard document props plus the font dictionary. */
export type FontBodyProps = DocumentPreviewProps & PropsLocale<'sidebarFont'>

const SIZES = [48, 32, 20, 14] as const
const GLYPHS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?&@#%()'] as const
let nextFamily = 0

/**
 * Load the complete font bytes as a temporary family and show a specimen.
 * @param props - complete bytes, resource identity, and locale.
 * @returns the specimen, a failure line, or nothing while the face loads.
 */
export function FontBody({ content, resourceAddress, t }: FontBodyProps): ReactNode {
  const data = content.kind === 'bytes' ? content.data : undefined
  const name = useMemo(() => pathPartsOf(hostFileOf(resourceAddress).path).name, [resourceAddress])
  const [state, setState] = useState<{ data: Uint8Array; family?: string }>()
  useEffect(() => {
    if (data === undefined || typeof FontFace === 'undefined') return
    const family = `jan-preview-${++nextFamily}`
    const face = new FontFace(family, data)
    let live = true
    face.load().then(() => {
      if (!live) return
      document.fonts.add(face)
      setState({ data, family })
    }, () => { if (live) setState({ data }) })
    return () => { live = false; document.fonts.delete(face) }
  }, [data])
  if (data === undefined || state?.data !== data) return null
  if (state.family === undefined) return <p className={css.failed} role="alert">{t('failed')}</p>
  const family = { fontFamily: `"${state.family}"` }
  return (
    <div className={css.specimen} data-font-family={state.family}>
      <p className={css.name}>{name}</p>
      {SIZES.map(size => <p key={size} className={css.sample} style={{ ...family, fontSize: size, lineHeight: 1.25 }}>{t('sample')}</p>)}
      <div className={css.glyphs} style={family}>
        {GLYPHS.map(line => <p key={line}>{line}</p>)}
      </div>
    </div>
  )
}
