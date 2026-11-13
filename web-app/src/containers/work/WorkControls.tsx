/**
 * The composer's work row: where the chat's tools run, whether changes ask
 * first, plan mode, and, once the agent has done something, a summary that
 * opens the work panel. A new chat (no thread yet) shows only what it will
 * start with; the choices are saved once the thread exists.
 */
import { useMemo } from 'react'
import {
  IconChecklist,
  IconChevronDown,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconListCheck,
  IconShieldCheck,
  IconShieldOff,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useDshSettings } from '@/hooks/useDshSettings'
import { cn } from '@/lib/utils'
import { effectivePolicy, setThreadWork, threadWorkOf, type EditPolicy } from '@/lib/threadWork'
import { setThreadPlanMode, setThreadPolicy } from '@/lib/dsh-chat-transport'
import { threadActivity } from '@/lib/threadActivity'
import { useWorkPanel, type WorkTab } from '@/stores/work-panel-store'
import { useOpenThreadMessages } from '@/stores/thread-ui-messages-store'

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

const chip = 'h-7 gap-1 px-2 min-w-0 rounded-full text-muted-foreground hover:text-foreground'

export function WorkControls({ threadId }: { threadId: string | undefined }) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const thread = useThreads((s) => (threadId ? s.threads[threadId] : undefined))
  const defaultFolder = useDshSettings((s) => s.workspace.trim())
  const work = threadWorkOf(thread)
  const policy = effectivePolicy(work, defaultFolder)
  const folder = work.folder ?? (defaultFolder || undefined)
  // The work row only acts on a saved thread: the new-chat composer has none.
  const disabled = !thread

  const pickFolder = async () => {
    if (!threadId) return
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked === 'string') setThreadWork(threadId, { folder: picked })
  }

  const openFolder = async () => {
    const path = folder ?? (threadId ? await serviceHub.dsh().threadWorkspace(threadId) : undefined)
    if (path) await serviceHub.opener().openPath(path)
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={chip} disabled={disabled}>
                <IconFolder size={14} aria-hidden />
                <span className="truncate max-w-32 text-xs">
                  {folder ? baseName(folder) : t('work:folder.private')}
                </span>
                <IconChevronDown size={12} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-64 break-all">{folder ?? t('work:folder.privateHint')}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => void pickFolder()}>
            <IconFolderOpen size={14} aria-hidden />
            {t('work:folder.attach')}
          </DropdownMenuItem>
          {work.folder && threadId && (
            <DropdownMenuItem onSelect={() => setThreadWork(threadId, { folder: undefined })}>
              <IconFolder size={14} aria-hidden />
              {t('work:folder.detach')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void openFolder()}>
            <IconFiles size={14} aria-hidden />
            {t('work:folder.open')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* A session keeps the folder it started in; DSH has no cwd switch. */}
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t('work:folder.appliesNext')}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(chip, policy === 'auto' && 'text-foreground')}
                disabled={disabled}
                aria-label={t('work:policy.label')}
              >
                {policy === 'ask' ? (
                  <IconShieldCheck size={14} aria-hidden />
                ) : (
                  <IconShieldOff size={14} aria-hidden />
                )}
                <span className="text-xs">{t(`work:policy.${policy}`)}</span>
                <IconChevronDown size={12} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-64">{t(`work:policy.${policy}Hint`)}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={policy}
            onValueChange={(value) => threadId && setThreadPolicy(threadId, value as EditPolicy)}
          >
            {(['ask', 'auto'] as const).map((value) => (
              <DropdownMenuRadioItem key={value} value={value} className="items-start">
                <div className="flex flex-col">
                  <span>{t(`work:policy.${value}`)}</span>
                  <span className="text-xs text-muted-foreground text-pretty">
                    {t(`work:policy.${value}Hint`)}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(chip, work.planMode && 'bg-accent text-foreground')}
            aria-pressed={!!work.planMode}
            disabled={disabled}
            onClick={() => threadId && setThreadPlanMode(threadId, !work.planMode)}
          >
            <IconListCheck size={14} aria-hidden />
            <span className="text-xs">{t('work:plan.label')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-64">{t(work.planMode ? 'work:plan.on' : 'work:plan.off')}</p>
        </TooltipContent>
      </Tooltip>

    </div>
  )
}

/**
 * Shown once there is something to look at, outside the collapsible controls
 * because they are how the side panel switches views. Each one toggles its view.
 */
export function ActivitySummary({ threadId }: { threadId: string }) {
  const { t } = useTranslation()
  const messages = useOpenThreadMessages(threadId)
  const open = useWorkPanel((s) => s.open)
  const tab = useWorkPanel((s) => s.tab)
  const showTab = useWorkPanel((s) => s.show)
  const close = useWorkPanel((s) => s.close)
  const isOpen = (id: WorkTab) => open && (tab === id || (id === 'files' && tab === 'preview'))
  const show = (id: WorkTab) => (isOpen(id) ? close() : showTab(id))
  const chipFor = (id: WorkTab) => cn(chip, isOpen(id) && 'bg-accent text-foreground')
  const activity = useMemo(() => threadActivity(messages), [messages])
  const todos = activity.todos ?? []
  const done = todos.filter((todo) => todo.status === 'completed').length
  if (todos.length === 0 && activity.changes.length === 0 && activity.artifacts.length === 0)
    return null

  return (
    <>
      {todos.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={chipFor('progress')}
          aria-pressed={isOpen('progress')}
          onClick={() => show('progress')}
          aria-label={t('work:panel.progress')}
        >
          <IconChecklist size={14} aria-hidden />
          <span className="text-xs tabular-nums">
            {done}/{todos.length}
          </span>
        </Button>
      )}
      {activity.changes.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={chipFor('changes')}
          aria-pressed={isOpen('changes')}
          onClick={() => show('changes')}
          aria-label={t('work:panel.changes')}
        >
          <span className="text-xs tabular-nums">
            <span className="text-green-600 dark:text-green-500">+{activity.added}</span>{' '}
            <span className="text-destructive">−{activity.removed}</span>
          </span>
        </Button>
      )}
      {activity.artifacts.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={chipFor('files')}
          aria-pressed={isOpen('files')}
          onClick={() => show('files')}
          aria-label={t('work:panel.files')}
        >
          <IconFiles size={14} aria-hidden />
          <span className="text-xs tabular-nums">{activity.artifacts.length}</span>
        </Button>
      )}
    </>
  )
}
