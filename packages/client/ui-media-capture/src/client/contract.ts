/** Browser capture card inputs and per-request settlement callbacks. */
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import type { CaptureMode } from '@janhq/jan-tool-capture-media/types'
import type {} from './locales.ts'

export type { CaptureMode } from '@janhq/jan-tool-capture-media/types'

/** One active inline request; its card owns the local preview and recording lifecycle. */
export interface CapturePending {
  /** Kind of device and output requested. Video recording does not request audio. */
  readonly mode: CaptureMode
  /** The model's short reason, rendered as plain text. */
  readonly reason: string
  /**
   * Verify that the Host is still waiting before calling getUserMedia.
   * @param signal - Optional card lifetime signal.
   * @returns Whether this tool call is still accepting a capture.
   */
  readonly confirmActive: (signal?: AbortSignal) => Promise<boolean>
  /**
   * Tell the model the user chose not to share; no media is sent.
   * @param signal - Optional card lifetime signal.
   */
  readonly decline: (signal?: AbortSignal) => Promise<void>
  /**
   * Submit the reviewed media to the waiting call. No bytes are sent before this action.
   * @param blob - JPEG photo, or a browser-supported WebM, MP4, or audio Ogg recording with its MIME type.
   * @param note - Optional user note, up to 1000 UTF-16 code units (recordings only).
   * @param signal - Optional card lifetime signal, also cancels an in-flight upload.
   */
  readonly send: (blob: Blob, note?: string, signal?: AbortSignal) => Promise<void>
}

/** Props for the inline capture card. */
export type CaptureCardProps = CapturePending & PropsLocale<'mediaCapture'>
