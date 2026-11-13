import { useAppState } from '@/hooks/useAppState'
import { Loader } from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

export function PromptProgress({
  hideIdle = false,
}: {
  hideIdle?: boolean
}) {
  const params = useParams({ strict: false })
  const threadId = (params as { threadId?: string })?.threadId
  // A chat surface reads useAppState's thread slot, falling back to the
  // global slot for an off-thread load.
  const loadingModel = useAppState((state) =>
    (threadId ? state.loadingModels[threadId] : undefined) ?? state.loadingModel
  )
  const loadProgress = useAppState((state) =>
    (threadId ? state.modelLoadProgressByThread[threadId] : undefined) ??
    state.modelLoadProgress
  )

  // Callers driving their own activity label (e.g. tool-call traces) pass
  // hideIdle to suppress the redundant generic "Working…" fallback.
  if (hideIdle && !loadingModel) {
    return null
  }

  const loadPercentage =
    loadingModel && loadProgress ? Math.round(loadProgress.value * 100) : undefined

  // Only worth naming the stage when the load actually has more than one
  // (multimodal encoder and/or speculative-decoding draft model on top of the
  // main weights) - a plain text-only load is always a single "text_model"
  // stage for its entire duration, so calling that out would be noise.
  const stageLabel =
    loadingModel && loadProgress && (loadProgress.stages?.length ?? 0) > 1
      ? describeLoadStage(loadProgress.stage)
      : undefined

  const label = loadingModel
    ? loadPercentage !== undefined
      ? `Loading ${stageLabel ?? 'model'}: ${loadPercentage}%`
      : 'Loading model…'
    : 'Working…'

  // The floor keeps the box from resizing as the percentage changes; a bare
  // "Working…" shrink-wraps instead of sitting in a mostly-empty rectangle.
  return (
    <div
      className={cn(
        'inline-flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2',
        loadingModel && 'min-w-56'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Loader className="animate-spin w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-medium text-foreground">{label}</span>
      </div>
    </div>
  )
}

function describeLoadStage(stage: string | undefined): string | undefined {
  switch (stage) {
    case 'text_model':
      return 'text model'
    case 'mmproj_model':
      return 'encoder'
    case 'spec_model':
      return 'draft model'
    default:
      return undefined
  }
}
