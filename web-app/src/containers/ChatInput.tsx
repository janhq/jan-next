import TextareaAutosize from 'react-textarea-autosize'
import { cn, formatBytes } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { MicButton } from '@/containers/MicButton'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useRef, useState, memo } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArrowRight, PlusIcon } from 'lucide-react'
import { IconPlayerStopFilled, IconX, IconDots } from '@tabler/icons-react'
import { generateId } from 'ai'
import { useMessageQueue } from '@/stores/message-queue-store'
import { QueuedMessageChip } from '@/containers/QueuedMessageBubble'
import { SamplerPopover } from '@/containers/SamplerPopover'
import { ActivitySummary, WorkControls } from '@/containers/work/WorkControls'
import { runWorkCommand } from '@/lib/workCommands'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { MovingBorder } from './MovingBorder'
import type { ChatStatus } from 'ai'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_KEY,
  SESSION_STORAGE_PREFIX,
} from '@/constants/chat'
import { useAssistant } from '@/hooks/useAssistant'
import { AssistantSwitcher } from '@/containers/AssistantSwitcher'
import { useServiceHub } from '@/hooks/useServiceHub'
import { TokenCounter } from '@/components/TokenCounter'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { useImageAttachmentConfig } from '@/hooks/useImageAttachmentConfig'
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import { shouldShowTokenCounter } from '@/lib/tokenCounterVisibility'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'
import { Attachment, createImageAttachment } from '@/types/attachment'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useElementWidth } from '@/hooks/useElementWidth'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
  projectAssistantId?: string
  onSubmit?: (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => void | Promise<void>
  onStop?: () => void
  chatStatus?: ChatStatus
  highlightedPrefix?: string | null
}

// Below this control-row width the toolbar wraps into several rows, so it
// collapses behind a single overflow button instead.
const CONTROL_ROW_COLLAPSE_WIDTH = 480

// The only image formats DSH accepts.
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}
const ALLOWED_IMAGE_TYPES = Object.values(IMAGE_MIME_BY_EXT)

const getFileTypeFromExtension = (fileName: string): string =>
  IMAGE_MIME_BY_EXT[fileName.toLowerCase().split('.').pop() ?? ''] ?? ''

const hashBase64 = async (base64: string): Promise<string> => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Renders the composer's control cluster inline, or behind a single overflow
// button whose popover holds the same controls, when the surface is too narrow.
function CollapsibleControls({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean
  label: string
  children: ReactNode
}) {
  if (!collapsed) return <>{children}</>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon-sm"
          className="rounded-full mb-1"
          aria-label={label}
        >
          <IconDots size={18} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-auto max-w-[min(20rem,80vw)] p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Keep the overflow popover open while the user drives a nested
          // dropdown/popover/menu that portals its content elsewhere.
          const target = e.target as HTMLElement | null
          if (
            target?.closest(
              '[data-radix-popper-content-wrapper],[role="menu"],[role="dialog"],[role="listbox"]'
            )
          ) {
            e.preventDefault()
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-1">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

const ChatInput = memo(function ChatInput({
  className,
  initialMessage,
  projectId,
  projectAssistantId,
  onSubmit,
  onStop,
  chatStatus,
  highlightedPrefix,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  // Collapse the composer's control row into a single overflow button when the
  // surface is too narrow to lay the controls out on one line. Gated on a positive measured width so layout-less test
  // environments (width 0) keep the controls inline.
  const [controlRowRef, controlRowWidth] = useElementWidth<HTMLDivElement>()
  const collapseControls =
    controlRowWidth != null &&
    controlRowWidth > 0 &&
    controlRowWidth < CONTROL_ROW_COLLAPSE_WIDTH
  const serviceHub = useServiceHub()
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const addToHistory = usePrompt((state) => state.addToHistory)
  const navigateHistory = usePrompt((state) => state.navigateHistory)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const currentThread = useThreads((state) => state.getCurrentThread())
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const { loading, currentAssistant, setCurrentAssistant, assistants } =
    useAssistant()

  const threadMessages = useMessages(
    useShallow((state) =>
      currentThreadId ? state.messages[currentThreadId] : []
    )
  )

  const maxRows = 10

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const [message, setMessage] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  const tokenCounterVisible = shouldShowTokenCounter({
    hasSelectedModel: !!selectedModel,
    isInitialMessage: !!initialMessage,
    hasMessages: (threadMessages?.length ?? 0) > 0,
    hasPromptText: prompt.trim().length > 0,
  })
  const [selectedAssistantId, setSelectedAssistantId] = useState<
    string | undefined
  >(loading ? undefined : projectAssistantId || currentAssistant?.id || '')

  useEffect(() => {
    setSelectedAssistantId(projectAssistantId || currentAssistant?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projectAssistantId])

  const maxImageSizeMB = useImageAttachmentConfig((s) => s.maxImageSizeMB)

  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const transferAttachments = useChatAttachments(
    (state) => state.transferAttachments
  )

  const hasSendableMedia = attachments.some(
    (a) => a.type === 'image' && !!a.dataUrl
  )

  // Queued messages for this thread (shown as chips in the input area)
  const queueId = currentThreadId ?? ''
  const queuedMessages = useMessageQueue(
    useShallow((s) => s.getQueue(queueId))
  )
  const queueLength = queuedMessages.length

  const removeQueuedMessage = useCallback(
    (id: string) => {
      useMessageQueue.getState().removeMessage(queueId, id)
    },
    [queueId]
  )

  const lastTransferredThreadId = useRef<string | null>(null)

  useEffect(() => {
    // The draft composes under the "new thread" key until the thread exists.
    if (
      currentThreadId &&
      lastTransferredThreadId.current !== currentThreadId
    ) {
      transferAttachments(NEW_THREAD_ATTACHMENT_KEY, currentThreadId)
      lastTransferredThreadId.current = currentThreadId
    }
  }, [currentThreadId, transferAttachments])

  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

  const handleSendMessage = async (prompt: string) => {
    // Work commands never reach the model, so they need no model either; only
    // an open chat has a work setup to act on.
    if (onSubmit && attachments.length === 0 && runWorkCommand(currentThreadId, prompt)) {
      setPrompt('')
      return
    }

    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }

    if (!prompt.trim() && !hasSendableMedia) {
      return
    }

    setMessage('')
    addToHistory(prompt)

    // Use onSubmit prop if available, otherwise create thread and navigate
    if (onSubmit) {
      // While the model is still streaming, queue the message for later.
      if (isStreaming && queueId) {
        useMessageQueue.getState().enqueue(queueId, {
          id: generateId(),
          text: prompt,
          createdAt: Date.now(),
        })
        setPrompt('')
        return
      }

      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file' as const,
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      void onSubmit(prompt, files.length > 0 ? files : undefined)
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    } else {
      // No onSubmit provided - create a new thread and navigate to it.
      // Images are NOT serialized into sessionStorage — their base64 data URLs
      // can blow past the ~5MB quota. They live in the in-memory attachments
      // store and are transferred to the new thread's key on the detail page
      // (see the transferAttachments effect).
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      const messagePayload = {
        text: prompt,
        files: [] as Array<{ type: string; mediaType: string; url: string }>,
      }

      if (isTemporaryChat) {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
          JSON.stringify(messagePayload)
        )
        sessionStorage.setItem('temp-chat-nav', 'true')
        router.navigate({
          to: route.threadsDetail,
          params: { threadId: TEMPORARY_CHAT_ID },
        })
      } else {
        // Get project metadata and assistant if projectId is provided
        let projectMetadata:
          | { id: string; name: string; updated_at: number }
          | undefined
        let projectAssistantId: string | undefined

        if (projectId) {
          try {
            const project = await serviceHub
              .projects()
              .getProjectById(projectId)
            if (project) {
              projectMetadata = {
                id: project.id,
                name: project.name,
                updated_at: project.updated_at,
              }
              projectAssistantId = project.assistantId
            }
          } catch (e) {
            console.warn('Failed to fetch project metadata:', e)
          }
        }

        // Only use assistant when chatting via project with an assigned assistant
        // When no projectId, use the selected assistant from dropdown (if any)
        const assistant = projectAssistantId
          ? assistants.find((a) => a.id === projectAssistantId)
          : assistants.find((a) => a.id === selectedAssistantId)

        setCurrentAssistant(assistant)

        const newThread = await createThread(
          {
            id: selectedModel?.id ?? '',
            provider: selectedProvider,
          },
          prompt, // Use prompt as thread title
          assistant,
          projectMetadata
        )

        sessionStorage.setItem(
          `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
          JSON.stringify(messagePayload)
        )

        router.navigate({
          to: route.threadsDetail,
          params: { threadId: newThread.id },
        })
      }

      setPrompt('')
      // Don't clear attachments here — images stored under
      // NEW_THREAD_ATTACHMENT_KEY must survive until the thread detail page
      // transfers and sends them; it clears them itself.
    }
  }

  useEffect(() => {
    const handleFocusIn = () => {
      if (document.activeElement === textareaRef.current) {
        setIsFocused(true)
      }
    }

    const handleFocusOut = () => {
      if (document.activeElement !== textareaRef.current) {
        setIsFocused(false)
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  // Focus when mounting and when the thread changes
  useEffect(() => {
    textareaRef.current?.focus()
  }, [currentThreadId])

  // Focus when streaming content finishes
  useEffect(() => {
    if (chatStatus !== 'submitted' && textareaRef.current) {
      // Small delay to ensure UI has updated
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 10)
    }
  }, [chatStatus])


  const handleRemoveAttachment = (indexToRemove: number) => {
    setAttachmentsForThread(attachmentsKey, (prev) =>
      prev.filter((_, index) => index !== indexToRemove)
    )
  }

  const processImageFiles = useCallback(
    async (files: File[]) => {
      const maxSize = maxImageSizeMB * 1024 * 1024
      const oversizedFiles: string[] = []
      const invalidTypeFiles: string[] = []
      const validFiles: Array<{ file: File; type: string }> = []

      for (const file of files) {
        if (file.size > maxSize) {
          oversizedFiles.push(file.name)
          continue
        }
        // Extension wins over a possibly wrong MIME type.
        const actualType = getFileTypeFromExtension(file.name) || file.type
        if (!ALLOWED_IMAGE_TYPES.includes(actualType)) {
          invalidTypeFiles.push(file.name)
          continue
        }
        validFiles.push({ file, type: actualType })
      }

      const preparedFiles: Attachment[] = []
      for (const { file, type } of validFiles) {
        const reader = new FileReader()
        // Executor form: the project's TS lib predates Promise.withResolvers.
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            const result = reader.result
            if (typeof result === 'string') {
              preparedFiles.push(
                createImageAttachment({
                  name: file.name,
                  size: file.size,
                  mimeType: type,
                  base64: result.split(',')[1],
                  dataUrl: result,
                })
              )
            }
            resolve()
          }
          reader.readAsDataURL(file)
        })
      }

      // Content hashes allow different images with the same filename.
      for (const att of preparedFiles) {
        if (att.base64) att.contentHash = await hashBase64(att.base64)
      }

      const duplicates: string[] = []
      const newFiles: Attachment[] = []

      const currentAttachments = useChatAttachments
        .getState()
        .getAttachments(attachmentsKey)

      const existingImageHashes = new Set<string>()
      const existingImageNames = new Set<string>()
      for (const a of currentAttachments) {
        if (a.type !== 'image') continue
        if (a.contentHash) {
          existingImageHashes.add(a.contentHash)
        } else if (a.base64) {
          existingImageHashes.add(await hashBase64(a.base64))
        } else {
          existingImageNames.add(a.name)
        }
      }

      const seenHashesInBatch = new Set<string>()
      for (const att of preparedFiles) {
        const hash = att.contentHash
        const isDuplicate =
          (hash &&
            (existingImageHashes.has(hash) || seenHashesInBatch.has(hash))) ||
          existingImageNames.has(att.name)
        if (isDuplicate) {
          duplicates.push(att.name)
          continue
        }
        if (hash) seenHashesInBatch.add(hash)
        newFiles.push(att)
      }

      setAttachmentsForThread(attachmentsKey, (prev) =>
        newFiles.length > 0 ? [...prev, ...newFiles] : prev
      )

      if (duplicates.length > 0) {
        toast.warning('Some images already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

      const errors: string[] = []
      if (oversizedFiles.length > 0) {
        errors.push(
          `File${oversizedFiles.length > 1 ? 's' : ''} too large (max ${maxImageSizeMB}MB): ${oversizedFiles.join(', ')}`
        )
      }
      if (invalidTypeFiles.length > 0) {
        errors.push(
          `Invalid file type${invalidTypeFiles.length > 1 ? 's' : ''} (only PNG, JPEG, WebP, GIF allowed): ${invalidTypeFiles.join(', ')}`
        )
      }

      if (errors.length > 0) {
        setMessage(errors.join(' | '))
        // Reset file input to allow re-uploading
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setMessage('')
      }
    },
    [attachmentsKey, setAttachmentsForThread, maxImageSizeMB]
  )

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files

    if (files && files.length > 0) {
      void processImageFiles(Array.from(files))

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    textareaRef.current?.focus()
  }

  const openImagePicker = useCallback(async () => {
    if (!isPlatformTauri()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const selected = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: Object.keys(IMAGE_MIME_BY_EXT),
          },
        ],
      })

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected]
        const files: File[] = []

        for (const path of paths) {
          try {
            // Tauri-only module: absent on the web build, so it can't be a static import.
            const { convertFileSrc } = await import('@tauri-apps/api/core')
            const response = await fetch(convertFileSrc(path))
            if (!response.ok) {
              throw new Error(`Failed to fetch file: ${response.statusText}`)
            }
            const blob = await response.blob()
            const fileName =
              path.split(/[\\/]/).filter(Boolean).pop() || 'image'
            files.push(
              new File([blob], fileName, {
                type: getFileTypeFromExtension(fileName) || 'image/jpeg',
              })
            )
          } catch (error) {
            console.error('Failed to read file:', error)
            toast.error('Failed to read file', {
              description:
                error instanceof Error ? error.message : String(error),
            })
          }
        }

        if (files.length > 0) {
          await processImageFiles(files)
        }
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error)
    }

    textareaRef.current?.focus()
  }, [serviceHub, processImageFiles])

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragOver to false if we're leaving the drop zone entirely
    // In Tauri, relatedTarget can be null, so we need to handle that case
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const dropped = Array.from(e.dataTransfer?.files ?? [])
    if (dropped.length > 0) void processImageFiles(dropped)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardItems = e.clipboardData?.items

    // Try clipboardData.items first (traditional method)
    if (clipboardItems && clipboardItems.length > 0) {
      const files = Array.from(clipboardItems)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f)

      if (files.length > 0) {
        e.preventDefault()
        void processImageFiles(files)
        return
      }
    }

    // Modern Clipboard API fallback (for Linux, images copied from web, etc.)
    if (navigator.clipboard && 'read' in navigator.clipboard) {
      try {
        const clipboardContents = await navigator.clipboard.read()
        const files: File[] = []

        for (const item of clipboardContents) {
          for (const type of item.types.filter((t) => t.startsWith('image/'))) {
            try {
              const blob = await item.getType(type)
              const extension = type.split('/')[1] || 'png'
              files.push(
                new File([blob], `pasted-image-${Date.now()}.${extension}`, {
                  type,
                })
              )
            } catch (error) {
              console.error('Error reading clipboard item:', error)
            }
          }
        }

        if (files.length > 0) {
          e.preventDefault()
          void processImageFiles(files)
        }
      } catch (error) {
        console.error('Clipboard API access failed:', error)
      }
    }
    // No image found: normal text pasting continues.
  }

  return (
    <div className="relative">
      <div className="relative">
        <div className={cn('relative overflow-hidden p-0.5 rounded-3xl')}>
          {isStreaming && (
            <div className="absolute inset-0">
              <MovingBorder rx="10%" ry="10%">
                <div
                  className={cn(
                    'h-100 w-100 bg-[radial-gradient(var(--app-primary),transparent_60%)]'
                  )}
                />
              </MovingBorder>
            </div>
          )}

          <div
            className={cn(
              'relative z-20 px-0 border rounded-3xl border-input bg-white dark:bg-input/30 transition-[border-color,box-shadow] duration-200 ease-out',
              // Focus brightens the single 1px border instead of adding a
              // ring outside it, which doubled the edge to a heavy 2px.
              // Full strength in light, where the resting border is already
              // pale; softened in dark so it doesn't glare.
              isFocused && 'border-ring dark:border-ring/60',
              isDragOver && 'ring-2 ring-ring/50 border-primary'
            )}
            data-drop-zone="true"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 p-2 pb-0">
                <div className="flex gap-3 items-center">
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.type}-${idx}-${att.name}`}
                      className="relative"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'relative border rounded-xl size-14 overflow-hidden',
                              'flex items-center justify-center'
                            )}
                          >
                            {att.dataUrl && (
                              <img
                                className="object-cover w-full h-full"
                                src={att.dataUrl}
                                alt={`${att.name}`}
                              />
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            <div
                              className="font-medium truncate max-w-52"
                              title={att.name}
                            >
                              {att.name}
                            </div>
                            <div className="opacity-70">
                              {att.mimeType || 'image'}
                              {att.size
                                ? ` · ${formatBytes(att.size, {
                                    decimals: (_, unit) =>
                                      unit === 'B' ? 0 : 1,
                                  })}`
                                : ''}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>

                      <div
                        className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                        onClick={() => handleRemoveAttachment(idx)}
                      >
                        <IconX className="text-neutral-200" size={14} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {queuedMessages.length > 0 && (
              <div className="flex flex-col gap-1 px-3 pt-2 pb-0">
                {queuedMessages.map((msg) => (
                  <QueuedMessageChip
                    key={msg.id}
                    message={msg}
                    onEdit={(queued) => {
                      // Put the text back in the input for editing, remove from queue
                      setPrompt(queued.text)
                      removeQueuedMessage(queued.id)
                      textareaRef.current?.focus()
                    }}
                    onRemove={removeQueuedMessage}
                  />
                ))}
              </div>
            )}
            <div className="relative">
              {highlightedPrefix && prompt.startsWith(highlightedPrefix) && (
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-4 text-transparent', className)}
                  style={{ overflowWrap: 'break-word' }}
                >
                  <mark className="rounded-sm bg-primary/20 text-transparent">{highlightedPrefix}</mark>
                  {prompt.slice(highlightedPrefix.length)}
                </div>
              )}
              <TextareaAutosize
                dir="auto"
                ref={textareaRef}
                minRows={2}
                rows={1}
                maxRows={10}
                value={prompt}
                data-testid={'chat-input'}
                onScroll={(event) => {
                  if (highlightRef.current) {
                    highlightRef.current.scrollTop = event.currentTarget.scrollTop
                    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
                  }
                }}
                onChange={(e) => {
                  const value = e.target.value
                  setPrompt(value)
                  // Count the number of newlines to estimate rows
                  const newRows = (value.match(/\n/g) || []).length + 1
                  setRows(Math.min(newRows, maxRows))
                }}
                onKeyDown={(e) => {
                  // e.keyCode 229 is for IME input with Safari
                  const isComposing =
                    e.nativeEvent.isComposing || e.keyCode === 229
                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                    e.preventDefault()
                    // If streaming, handleSendMessage will queue the message automatically.
                    if (prompt.trim() || hasSendableMedia) {
                      handleSendMessage(prompt)
                    }
                  }
                  // Navigate prompt history with Up/Down arrow keys
                  if (e.key === 'ArrowUp' && !isComposing) {
                    const textarea = e.currentTarget
                    const cursorAtStart =
                      textarea.selectionStart === 0 &&
                      textarea.selectionEnd === 0
                    if (cursorAtStart || !prompt) {
                      e.preventDefault()
                      navigateHistory('up')
                    }
                  }
                  if (e.key === 'ArrowDown' && !isComposing) {
                    const textarea = e.currentTarget
                    const cursorAtEnd =
                      textarea.selectionStart === prompt.length &&
                      textarea.selectionEnd === prompt.length
                    if (cursorAtEnd) {
                      e.preventDefault()
                      navigateHistory('down')
                    }
                  }
                }}
                onPaste={handlePaste}
                placeholder={t('common:placeholder.chatInput')}
                autoFocus
                spellCheck={spellCheckChatInput}
                data-gramm={spellCheckChatInput}
                data-gramm_editor={spellCheckChatInput}
                data-gramm_grammarly={spellCheckChatInput}
                className={cn(
                  'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4',
                  rows < maxRows && 'scrollbar-hide',
                  className
                )}
              />
            </div>

            <div className="relative z-20 w-full p-2">
              <div
                ref={controlRowRef}
                className="flex items-end justify-between gap-2 w-full"
              >
                <div className="px-1 flex flex-wrap items-center gap-1 flex-1 min-w-0">
                  <CollapsibleControls
                    collapsed={collapseControls}
                    label={t('common:moreControls')}
                  >
                    <div
                      className={cn(
                        'px-1 flex flex-wrap items-center gap-1',
                        isStreaming && 'opacity-50 pointer-events-none'
                      )}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            className="rounded-full mr-2 mb-1"
                            aria-label={t('common:addImages')}
                            onClick={() => void openImagePicker()}
                          >
                            <PlusIcon size={18} className="text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('common:addImages')}</p>
                        </TooltipContent>
                      </Tooltip>
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleFileChange}
                      />
                      <AssistantSwitcher
                        assistants={assistants}
                        currentThread={currentThread}
                        selectedAssistantId={selectedAssistantId}
                        setSelectedAssistantId={setSelectedAssistantId}
                        updateCurrentThreadAssistant={updateCurrentThreadAssistant}
                      />
                      <WorkControls threadId={currentThreadId} />
                      <SamplerPopover
                        providerId={selectedProvider}
                        assistantSwitcher={{
                          assistants,
                          currentThread,
                          selectedAssistantId,
                          setSelectedAssistantId,
                          updateCurrentThreadAssistant,
                        }}
                      />
                    </div>
                  </CollapsibleControls>
                  {currentThreadId && <ActivitySummary threadId={currentThreadId} />}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {tokenCounterVisible && tokenCounterCompact && (
                    <div className="flex-1 flex justify-center">
                      <TokenCounter
                        messages={threadMessages || []}
                        compact={true}
                      />
                    </div>
                  )}

                  {!isStreaming && (
                    <MicButton
                      onText={(text) => {
                        setPrompt(prompt.trim() ? `${prompt.trimEnd()} ${text}` : text)
                        textareaRef.current?.focus()
                      }}
                    />
                  )}
                  {isStreaming ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          data-testid="stop-message-button"
                          className="rounded-full mr-1 mb-1"
                          onClick={() => {
                            // Stopping with messages queued clears the queue —
                            // there is nothing to interrupt yet.
                            if (queueId) {
                              const queue = useMessageQueue
                                .getState()
                                .getQueue(queueId)
                              if (queue.length > 0) {
                                useMessageQueue.getState().clearQueue(queueId)
                                return
                              }
                            }
                            onStop?.()
                          }}
                        >
                          <IconPlayerStopFilled />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{queueLength > 0 ? `Clear ${queueLength} queued message(s)` : 'Stop generating'}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="default"
                      size="icon-sm"
                      disabled={!prompt.trim() && !hasSendableMedia}
                      data-test-id="send-message-button"
                      data-testid="send-message-button"
                      onClick={() => handleSendMessage(prompt)}
                      className="rounded-full mr-1 mb-1"
                    >
                      <ArrowRight className="text-primary-fg" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-muted-foreground cursor-pointer"
              onClick={() => {
                setMessage('')
                // Reset file input to allow re-uploading the same file
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}
            />
          </div>
        </div>
      )}

      {tokenCounterVisible && !tokenCounterCompact && (
        <div className="flex-1 w-full flex justify-start px-2">
          <TokenCounter messages={threadMessages || []} />
        </div>
      )}
    </div>
  )
})

export default ChatInput
