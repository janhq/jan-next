/**
 * Composer dock entry that stays above the composer while the draft holds an
 * image the selected model cannot read. It clears itself when the image is
 * removed or the model changes, and offers a one-click switch to a model that
 * reads images.
 */
import { useState, useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { ModelSelection } from '@janhq/jan-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { imageRefusalOf } from './image-check.ts'
import css from './ImageNotice.module.css'

/** What one session's notice reads and does. */
export interface ImageNoticeInjected {
  /** The session's model directory store. */
  directory: ObservableSnapshot<ModelDirectoryState>
  /** Whether the session's draft holds an image attachment. */
  draftHasImage: ObservableSnapshot<boolean>
  /** Switch the session's model; resolves false when the switch failed. */
  select: (selection: ModelSelection) => Promise<boolean>
}

/** Full props of the dock entry. */
export type ImageNoticeProps = ImageNoticeInjected & PropsRuntime<'conversation.input.dock'> & PropsLocale<'model'>

/** Renders the refusal while it applies, nothing otherwise. */
export function ImageNotice({ directory, draftHasImage, select, t }: ImageNoticeProps) {
  const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot())
  const hasImage = useSyncExternalStore(fn => draftHasImage.subscribe(fn), () => draftHasImage.getSnapshot())
  const [switching, setSwitching] = useState(false)
  const refusal = imageRefusalOf(state, hasImage)
  if (refusal === undefined) return null
  const alternative = refusal.alternative
  return (
    <div className={css.notice} role="alert">
      <span>{t(alternative === undefined ? 'image.unreadableNone' : 'image.unreadable', { model: refusal.model })}</span>
      {alternative !== undefined && (
        <button
          type="button"
          className={css.action}
          disabled={switching}
          onClick={() => {
            setSwitching(true)
            void select(alternative.selection).finally(() => { setSwitching(false) })
          }}
        >
          {t('image.useModel', { model: alternative.name })}
        </button>
      )}
    </div>
  )
}
