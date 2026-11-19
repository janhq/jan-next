/** A lone delivered image or HTML page, shown in the chat above its card. */
import { useEffect, useState } from 'react'
import type { RemoteResult } from '@janhq/jan-api-remotes/client'
import { fileExtension } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
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
 * on click; a page runs in an opaque, script-only sandbox with no access to the
 * app, as the sidebar HTML preview does. Nothing shows until the bytes arrive,
 * and a failed read leaves only the card.
 * @param props - the delivered file, its Session, the byte reader, the sidebar opener, and copy.
 * @returns the preview, or null while loading, on failure, and for other types.
 */
export function PresentedInlinePreview({ file, sessionId, readPresented, onPreview, t }: {
  file: PresentedPath
  sessionId: SessionId
  readPresented: ReadPresented
  onPreview: () => void
} & PropsLocale<typeof NS>) {
  const type = inlinePreviewType(file.path)
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (type === undefined) return
    const controller = new AbortController()
    let created: string | undefined
    void readPresented(sessionId, file.path, controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return
      created = URL.createObjectURL(new Blob([result.value.data as Uint8Array<ArrayBuffer>], { type }))
      setUrl(created)
    }, () => undefined)
    return () => {
      controller.abort()
      if (created !== undefined) URL.revokeObjectURL(created)
      setUrl(undefined)
    }
  }, [type, readPresented, sessionId, file.path])
  if (type === undefined || url === undefined) return null
  const name = basename(file.path)
  return type !== 'text/html'
    ? <button type="button" className={css.inlinePreview} data-presented-inline="image"
      aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview}>
      <img className={css.inlineImage} src={url} alt={t('presented.inline', { name })} />
    </button>
    : <iframe className={`${css.inlinePreview} ${css.inlineFrame}`} data-presented-inline="html"
      src={url} sandbox="allow-scripts" title={t('presented.inline', { name })} />
}
