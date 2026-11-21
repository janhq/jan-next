/** Media capture request, transport coordinates, and tool outcome. */
import type { Agent } from '@janhq/jan-agent'
import type { FileAttachmentRef, ImageAttachmentRef } from '@janhq/jan-attachment/types'
import type { ToolCallId } from '@janhq/jan-llm/brand'

/** The device and capture format requested by the model. */
export type CaptureMode = 'photo' | 'video' | 'audio'

/** Pending request, owned by an exact Agent and tool call. */
export interface CaptureRequest {
  readonly agent: Agent
  readonly callId: ToolCallId
  readonly mode: CaptureMode
  readonly reason: string
}

/** Stored references use JSON ids until the output renderer rebrands them. */
type ReferenceValue<T> = Omit<T, 'attachmentId'> & { attachmentId: string }

/** Explicit refusal or the immutable attachment shared by the user. */
export type CaptureResult =
  | { status: 'declined' }
  | { status: 'captured'; mode: 'photo'; image: ReferenceValue<ImageAttachmentRef> }
  | { status: 'captured'; mode: 'video' | 'audio'; file: ReferenceValue<FileAttachmentRef>; path: string; note: string }

/** Interactive Host rendezvous used by a per-Agent tool registration. */
export interface CaptureRequester {
  /**
   * Wait for a browser to share or decline one capture.
   * @param request - Request owner, call identity, mode, and displayed reason.
   * @param signal - Tool execution cancellation.
   * @returns The result to persist through the ordinary tool lifecycle.
   */
  request(request: CaptureRequest, signal: AbortSignal): Promise<CaptureResult>
}

declare module '@janhq/cordis' {
  interface Context {
    /** Active browser-mediated capture service, when the Web Host mounts it. */
    mediaCapture: CaptureRequester
  }
}
