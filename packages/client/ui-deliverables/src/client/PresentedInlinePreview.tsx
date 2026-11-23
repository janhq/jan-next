/** A lone delivered image or HTML page, shown in the chat above its card. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@janhq/jan-api-remotes/client'
import { createBasicHtmlDocument, fileExtension } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@janhq/jan-client-ui-slots'
import type { SessionId } from '@janhq/jan-session/types'
import { basename, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

/** Read one delivered file's complete bytes; the Host's full-file cap applies. */
export type ReadPresented = (
  sessionId: SessionId, path: string, signal: AbortSignal,
) => Promise<RemoteResult<{ readonly data: Uint8Array }>>

const MEDIA_TYPES: Readonly<Partial<Record<string, string>>> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  html: 'text/html', htm: 'text/html',
}

/**
 * The media type of a delivered file with an inline preview.
 * @param path - delivered file path.
 * @returns an image or HTML media type, or undefined for every other type.
 */
export function inlinePreviewType(path: string): string | undefined {
  return MEDIA_TYPES[fileExtension(basename(path)).toLowerCase()]
}

/**
 * Render a lone delivery's content in place. An image opens the sidebar preview
 * on click; an HTML page uses the same static, network-free policy as the
 * sidebar's static preview. Nothing shows until the bytes arrive, and a
 * failed read leaves only the card.
 * @param props - the delivered file, its Session, the byte reader, the sidebar opener, and copy.
 * @returns the preview, or null while loading, on failure, and for other types.
 */
export function PresentedInlinePreview({ file, sessionId, readPresented, onPreview, renderSlot, t }: {
  file: PresentedPath
  sessionId: SessionId
  readPresented: ReadPresented
  onPreview: () => void
} & PropsLocale<typeof NS> & Pick<PropsRenderSlots<'deliverables.preview.actions'>, 'renderSlot'>) {
  const type = inlinePreviewType(file.path)
  const [preview, setPreview] = useState<{ kind: 'image'; url: string } | { kind: 'html'; document: string }>()
  const image = useRef<HTMLImageElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const getSurface = useCallback(() => image.current ?? frame.current, [])
  useEffect(() => {
    if (type === undefined) return
    const controller = new AbortController()
    let created: string | undefined
    void readPresented(sessionId, file.path, controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return
      const data = result.value.data
      if (type === 'text/html') {
        try {
          setPreview({ kind: 'html', document: createBasicHtmlDocument(data) })
        } catch {
          // Invalid UTF-8 leaves the delivery card available without a preview.
        }
        return
      }
      created = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }))
      setPreview({ kind: 'image', url: created })
    }, () => undefined)
    return () => {
      controller.abort()
      if (created !== undefined) URL.revokeObjectURL(created)
      setPreview(undefined)
    }
  }, [type, readPresented, sessionId, file.path])
  if (preview === undefined) return null
  const name = basename(file.path)
  return <>
    {preview.kind === 'image'
      ? <button type="button" className={css.inlinePreview} data-presented-inline="image"
        aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview}>
        <img ref={image} className={css.inlineImage} src={preview.url} alt={t('presented.inline', { name })} />
      </button>
      : <iframe ref={frame} className={`${css.inlinePreview} ${css.inlineFrame}`} data-presented-inline="html"
        srcDoc={preview.document} sandbox="" title={t('presented.inline', { name })} />}
    {renderSlot('deliverables.preview.actions', { getSurface })}
  </>
}
