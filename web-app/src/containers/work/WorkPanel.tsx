/**
 * The work panel beside a chat: the agent's checklist, the files it changed
 * (with diffs) and created, and a preview of one file. Everything but the
 * preview is derived from the thread's messages; the preview reads the file
 * from the thread's folder.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconCircle,
  IconCircleCheckFilled,
  IconCircleDot,
  IconExternalLink,
  IconFile,
  IconFolderSearch,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import type { BundledLanguage } from 'shiki'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { DiffView } from '@/components/DiffView'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { buildSrcDoc } from '@/lib/htmlSandbox'
import type { TodoItem } from '@/lib/dsh-protocol'
import { diffText, threadActivity, type FileChange } from '@/lib/threadActivity'
import { resolveThreadFolder, threadWorkOf } from '@/lib/threadWork'
import { cn } from '@/lib/utils'
import type { WorkspaceFile } from '@/services/dsh/types'
import { useOpenThreadMessages } from '@/stores/thread-ui-messages-store'
import { useWorkPanel, WORK_PANEL_DEFAULT_W } from '@/stores/work-panel-store'

const PANEL_MIN_W = 240
/** The panel may grow with the window but never crush the transcript. */
const clampWidth = (w: number) =>
  Math.min(Math.max(PANEL_MIN_W, Math.round(window.innerWidth * 0.7)), Math.max(PANEL_MIN_W, Math.round(w)))

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export function WorkPanel({ threadId }: { threadId: string }) {
  const { t } = useTranslation()
  const tab = useWorkPanel((s) => s.tab)
  const close = useWorkPanel((s) => s.close)
  const previewPath = useWorkPanel((s) => s.previewPath)
  const messages = useOpenThreadMessages(threadId)
  const activity = useMemo(() => threadActivity(messages), [messages])
  const todos = activity.todos ?? []
  const done = todos.filter((todo) => todo.status === 'completed').length
  const preview = usePreviewFile(threadId, tab === 'preview' ? previewPath : null)

  // One view at a time, opened from the composer chips or a slash command;
  // the header names it, like a Cowork side rail.
  const view =
    tab === 'preview' && previewPath
      ? {
          title: (
            <span className="font-mono text-xs" title={previewPath}>
              {baseName(previewPath)}
            </span>
          ),
          summary: <PreviewActions state={preview} />,
          body: <PreviewTab path={previewPath} state={preview} />,
        }
      : tab === 'changes'
        ? {
            title: t('work:panel.changes'),
            summary: activity.changes.length > 0 && (
              <span className="shrink-0 font-mono text-xs tabular-nums">
                <span className="text-green-600 dark:text-green-500">+{activity.added}</span>{' '}
                <span className="text-destructive">−{activity.removed}</span>
              </span>
            ),
            body: <ChangesTab changes={activity.changes} />,
          }
        : tab === 'files' || tab === 'preview'
          ? {
              title: t('work:panel.files'),
              summary: activity.artifacts.length > 0 && (
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {activity.artifacts.length}
                </span>
              ),
              body: <FilesTab files={activity.artifacts} />,
            }
          : {
              title: t('work:panel.progress'),
              summary: todos.length > 0 && (
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {done}/{todos.length}
                </span>
              ),
              body: <ProgressTab todos={activity.todos} />,
            }

  return (
    <SidePanel title={view.title} summary={view.summary} onClose={close} closeLabel={t('work:panel.close')}>
      {view.body}
    </SidePanel>
  )
}

/** Docked beside the chat: drag the left edge to resize, double-click it to reset. */
function SidePanel({
  title,
  summary,
  children,
  onClose,
  closeLabel,
}: {
  title: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
  closeLabel: string
}) {
  const { t } = useTranslation()
  const width = useWorkPanel((s) => s.width)
  const setWidth = useWorkPanel((s) => s.setWidth)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  // Pointer capture keeps the drag alive while the pointer crosses the
  // preview iframe, which would otherwise swallow the move events.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      const pointerId = e.pointerId
      const startX = e.clientX
      const startW = asideRef.current?.getBoundingClientRect().width ?? width
      let next = startW
      setExpanded(false)
      setLiveWidth(startW)
      handle.setPointerCapture(pointerId)
      const onMove = (ev: PointerEvent) => {
        next = clampWidth(startW + (startX - ev.clientX))
        setLiveWidth(next)
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        setLiveWidth(null)
        setWidth(next)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [width, setWidth]
  )

  const resizing = liveWidth !== null
  return (
    <aside
      ref={asideRef}
      aria-label={t('work:panel.open')}
      className="relative flex h-full max-w-[70%] shrink-0 flex-col border-l bg-background"
      style={{ width: expanded ? '70%' : `${liveWidth ?? clampWidth(width)}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          setExpanded(false)
          setWidth(WORK_PANEL_DEFAULT_W)
        }}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-foreground/20"
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {summary}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={expanded ? t('common:collapse') : t('common:expand')}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <IconMinimize aria-hidden /> : <IconMaximize aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={closeLabel} onClick={onClose}>
          <IconX aria-hidden />
        </Button>
      </div>
      {/* An iframe under the pointer steals the drag on WebKit even with
          pointer capture, so the body goes inert while resizing. */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto', resizing && 'pointer-events-none select-none')}>
        {children}
      </div>
    </aside>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground text-pretty">{text}</p>
}

function ProgressTab({ todos }: { todos: TodoItem[] | null }) {
  const { t } = useTranslation()
  if (!todos || todos.length === 0) return <Empty text={t('work:panel.noTodos')} />
  const done = todos.filter((todo) => todo.status === 'completed').length
  return (
    <div className="space-y-3 p-4">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('work:panel.todoCount', { done, total: todos.length })}
        </p>
        <Progress value={(done / todos.length) * 100} className="h-1.5" />
      </div>
      <ul className="space-y-1">
        {todos.map((todo) => (
          <li key={todo.content} className="flex items-start gap-2 text-sm">
            {todo.status === 'completed' ? (
              <IconCircleCheckFilled size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            ) : todo.status === 'in_progress' ? (
              <IconCircleDot size={16} className="mt-0.5 shrink-0 text-foreground" aria-hidden />
            ) : (
              <IconCircle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span
              className={cn(
                'text-pretty',
                todo.status === 'completed' && 'text-muted-foreground line-through',
                todo.status === 'in_progress' && 'font-medium'
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChangesTab({ changes }: { changes: FileChange[] }) {
  const { t } = useTranslation()
  const preview = useWorkPanel((s) => s.preview)
  if (changes.length === 0) return <Empty text={t('work:panel.noChanges')} />
  return (
    <ul className="divide-y">
      {changes.map((change) => (
        <li key={change.path}>
          <Collapsible>
            <div className="flex items-center gap-2 px-3 py-2">
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline">
                <IconFile size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-xs" title={change.path}>
                  {baseName(change.path)}
                </span>
                {change.created && (
                  <span className="shrink-0 rounded bg-accent px-1 text-[10px] text-muted-foreground">
                    {t('work:panel.created')}
                  </span>
                )}
              </CollapsibleTrigger>
              <span className="shrink-0 text-xs tabular-nums">
                <span className="text-green-600 dark:text-green-500">+{change.added}</span>{' '}
                <span className="text-destructive">−{change.removed}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('work:artifact.open', { name: baseName(change.path) })}
                onClick={() => preview(change.path)}
              >
                <IconExternalLink aria-hidden />
              </Button>
            </div>
            <CollapsibleContent className="px-3 pb-3">
              {change.diffs.length > 0 && <DiffView diff={diffText(change)} className="max-h-96" />}
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ul>
  )
}

function FilesTab({ files }: { files: string[] }) {
  const { t } = useTranslation()
  const preview = useWorkPanel((s) => s.preview)
  if (files.length === 0) return <Empty text={t('work:panel.noFiles')} />
  return (
    <ul className="space-y-1 p-2">
      {files.map((path) => (
        <li key={path}>
          <button
            type="button"
            onClick={() => preview(path)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
          >
            <IconFile size={16} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm">{baseName(path)}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{path}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const extOf = (path: string) => path.toLowerCase().split('.').pop() ?? ''

type PreviewState = { file: WorkspaceFile } | { error: string } | null

/** Reads the previewed file from the thread's folder; Reload reads it again. */
function usePreviewFile(threadId: string, path: string | null): PreviewState {
  const serviceHub = useServiceHub()
  const nonce = useWorkPanel((s) => s.previewNonce)
  const thread = useThreads((s) => s.threads[threadId])
  const [state, setState] = useState<PreviewState>(null)

  // A file read is an external sync, which is what an effect is for.
  useEffect(() => {
    if (!path) return
    let live = true
    setState(null)
    void (async () => {
      try {
        const folder = await resolveThreadFolder(threadId, threadWorkOf(thread))
        const file = await serviceHub.dsh().readWorkspaceFile(folder, path)
        if (live) setState({ file })
      } catch (e) {
        if (live) setState({ error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      live = false
    }
  }, [threadId, thread, path, nonce, serviceHub])
  return state
}

function PreviewActions({ state }: { state: PreviewState }) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const reload = useWorkPanel((s) => s.reload)
  const file = state && 'file' in state ? state.file : undefined
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button variant="ghost" size="icon-xs" aria-label={t('work:panel.reload')} onClick={reload}>
        <IconRefresh aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('work:panel.openFile')}
        disabled={!file}
        onClick={() => file && void serviceHub.opener().openPath(file.path)}
      >
        <IconExternalLink aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('work:panel.reveal')}
        disabled={!file}
        onClick={() => file && void serviceHub.opener().revealItemInDir(file.path)}
      >
        <IconFolderSearch aria-hidden />
      </Button>
    </div>
  )
}

function PreviewTab({ path, state }: { path: string; state: PreviewState }) {
  const { t } = useTranslation()
  const file = state && 'file' in state ? state.file : undefined
  const ext = extOf(path)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {state && 'error' in state ? (
          <p className="p-4 text-sm text-destructive text-pretty">
            {t('work:panel.previewFailed')}: {state.error}
          </p>
        ) : !file ? null : ext === 'html' || ext === 'htm' ? (
          // Opaque-origin sandbox, strict CSP, no network: model HTML only.
          <iframe
            title={baseName(path)}
            className="size-full border-0 bg-white"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={buildSrcDoc(file.text ?? '', false, true)}
          />
        ) : IMAGE_TYPES[ext] && (file.base64 || file.text) ? (
          <img
            alt={baseName(path)}
            className="mx-auto max-w-full p-4"
            src={
              file.base64
                ? `data:${IMAGE_TYPES[ext]};base64,${file.base64}`
                : `data:${IMAGE_TYPES[ext]};utf8,${encodeURIComponent(file.text ?? '')}`
            }
          />
        ) : file.text !== null ? (
          <CodeBlock
            code={file.text}
            language={(ext === 'md' ? 'markdown' : ext || 'text') as BundledLanguage}
            className="rounded-none border-0"
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t('work:panel.previewBinary')}</p>
        )}
      </div>
    </div>
  )
}
