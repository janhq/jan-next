import { ServiceHub } from '@/services'
import { Attachment } from '@/types/attachment'
import { toast } from 'sonner'

type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'

export type AttachmentIngestProgress = {
  completed: number
  total: number
}

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
  serviceHub: ServiceHub
  updateAttachmentProcessing?: (
    name: string,
    status: AttachmentProcessingStatus,
    updatedAttachment?: Partial<Attachment>
  ) => void
  /** Fired when attachment ingestion advances (multi-file uploads). */
  onIngestProgress?: (state: AttachmentIngestProgress) => void
}

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
}

const formatAttachmentError = (err: unknown): string => {
  if (!err) return 'Unknown error'
  if (err instanceof Error) return err.message || err.toString()
  if (typeof err === 'string') return err
  if (Array.isArray(err)) {
    const parts = err.map((e) => formatAttachmentError(e)).filter(Boolean)
    return parts.length
      ? Array.from(new Set(parts)).join('; ')
      : 'Unknown error'
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const candidates = [obj.message, obj.reason, obj.detail]
    for (const val of candidates) {
      if (typeof val === 'string' && val.trim().length > 0) {
        return val
      }
    }
    const nestedSources = [obj.error, obj.cause]
    for (const nested of nestedSources) {
      if (nested && typeof nested === 'object') {
        const nestedMsg = formatAttachmentError(nested)
        if (nestedMsg && nestedMsg !== 'Unknown error') {
          return nestedMsg
        }
      } else if (typeof nested === 'string' && nested.trim().length > 0) {
        return nested
      }
    }
    if (typeof obj.code === 'string' && obj.code.trim().length > 0) {
      return obj.code
    }
    try {
      return JSON.stringify(obj)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    threadId,
    serviceHub,
    updateAttachmentProcessing,
    onIngestProgress,
  } = options

  const processedAttachments: Attachment[] = []

  const imagesToProcess = attachments.filter(
    (img) => img.type === 'image' && !(img.processed && img.id)
  )
  const ingestTotal = imagesToProcess.length
  let ingestCompleted = 0
  const bumpIngest = () => {
    if (!onIngestProgress || ingestTotal <= 0) return
    ingestCompleted += 1
    onIngestProgress({
      completed: Math.min(ingestCompleted, ingestTotal),
      total: ingestTotal,
    })
  }
  if (onIngestProgress && ingestTotal > 0) {
    onIngestProgress({ completed: 0, total: ingestTotal })
  }
  const notifyUpdate = (
    ...args: Parameters<
      NonNullable<AttachmentProcessingOptions['updateAttachmentProcessing']>
    >
  ) => updateAttachmentProcessing?.(...args)

  // Images: ingest before sending
  const images = attachments.filter((a) => a.type === 'image')
  if (images.length > 0) {
    for (const img of images) {
      try {
        if (img.processed && img.id) {
          processedAttachments.push(img)
          continue
        }

        notifyUpdate(img.name, 'processing')

        const res = await serviceHub.uploads().ingestImage(threadId, img)
        processedAttachments.push({
          ...img,
          id: res.id,
          processed: true,
          processing: false,
        })
        notifyUpdate(img.name, 'done', {
          id: res.id,
          processed: true,
          processing: false,
        })
        bumpIngest()
      } catch (err) {
        console.error(`Failed to ingest image ${img.name}:`, err)
        notifyUpdate(img.name, 'error')
        const desc = formatAttachmentError(err)
        toast.error('Failed to ingest image attachment', { description: desc })
        throw err instanceof Error ? err : new Error(desc)
      }
    }
  }

  const audios = attachments.filter((a) => a.type === 'audio')
  for (const aud of audios) {
    processedAttachments.push({
      ...aud,
      processed: true,
      processing: false,
    })
  }

  const videos = attachments.filter((a) => a.type === 'video')
  for (const vid of videos) {
    processedAttachments.push({
      ...vid,
      processed: true,
      processing: false,
    })
  }

  return { processedAttachments }
}
