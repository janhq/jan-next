/** Audio and video played from the authenticated file route, which serves byte ranges for streaming and seeking. */
import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { FileTypeIcon, classifyFileType } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import { fileMediaUrl, pathPartsOf } from '@janhq/jan-util-workspace-path'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import css from './MediaBody.module.css'

/** The media element this registration draws. */
export interface MediaBodyInjected {
  readonly kind: 'video' | 'audio'
}

/** Standard document props plus the media dictionary and kind. */
export type MediaBodyProps = DocumentPreviewProps & PropsLocale<'sidebarMedia'> & MediaBodyInjected

// HTMLMediaElement MEDIA_ERR_SRC_NOT_SUPPORTED: the source or its codec cannot be decoded here.
const SOURCE_NOT_SUPPORTED = 4

/**
 * Stream one audio or video file with native controls.
 * @param props - renderer content callbacks, resource identity, locale, and kind.
 * @returns the media element, or a status line until the file location is known.
 */
export function MediaBody({ kind, content, resourceAddress, useResource, t }: MediaBodyProps): ReactNode {
  const file = useResource<'file'>(resourceAddress).value
  const [failure, setFailure] = useState<{ src: string; codec: boolean }>()
  const base = typeof document === 'undefined' ? undefined : document.baseURI
  const url = file === undefined || base === undefined ? undefined : fileMediaUrl(base, file.absolutePath)
  // The version keeps the URL off the redirect and changes it when the file changes.
  const src = url === undefined || file === undefined ? undefined : `${url}&v=${encodeURIComponent(file.version)}`
  if (src === undefined || file === undefined) return <p className={css.status} role="status">{t('waiting')}</p>
  const revision = content.kind === 'renderer' ? content.revision : 0
  const loaded = (): void => { if (content.kind === 'renderer') content.loaded(file.version) }
  const failed = (event: SyntheticEvent<HTMLMediaElement>): void => {
    setFailure({ src, codec: event.currentTarget.error?.code === SOURCE_NOT_SUPPORTED })
    if (content.kind === 'renderer') content.failed()
  }
  const shownFailure = failure?.src === src ? failure : undefined
  const status = shownFailure === undefined ? null : (
    <div className={css.failure} role="alert">
      <p>{t('failed')}</p>
      {shownFailure.codec ? <p className={css.hint}>{t('unsupportedCodec')}</p> : null}
    </div>
  )
  const key = `${src}:${revision}`
  if (kind === 'video') {
    return (
      <div className={css.video} data-media-kind="video">
        {status ?? <video key={key} className={css.player} src={src} controls preload="metadata" playsInline
          onLoadedMetadata={loaded} onError={failed} />}
      </div>
    )
  }
  const { name } = pathPartsOf(file.absolutePath)
  return (
    <div className={css.audio} data-media-kind="audio">
      <FileTypeIcon kind={classifyFileType(name)} size={36} className={css.glyph} />
      <p className={css.name} title={file.absolutePath}>{name}</p>
      {status ?? <audio key={key} className={css.audioPlayer} src={src} controls preload="metadata"
        onLoadedMetadata={loaded} onError={failed} />}
    </div>
  )
}
