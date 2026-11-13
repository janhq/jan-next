import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { dshRequest } from '@/lib/dsh-chat-transport'
import { cn } from '@/lib/utils'
import type { DshPluginEntry } from '@/services/dsh/types'
import type { SpeechStatus } from '@/services/speech/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.plugins as any)({
  component: PluginManager,
})

/** Live fiber phase per entry id; null when the runtime is not running. */
type Phases = Record<string, string | null>

type Status = 'running' | 'starting' | 'stopping' | 'failed' | 'idle' | 'on' | 'off'

const STATUS_DOT: Record<Status, string> = {
  running: 'bg-green-500',
  starting: 'bg-amber-500',
  stopping: 'bg-amber-500',
  failed: 'bg-destructive',
  idle: 'bg-muted-foreground/40',
  // On but not loaded yet: the runtime is stopped, so no live phase.
  on: 'bg-primary',
  off: 'bg-muted-foreground/40',
}

function statusOf(entry: DshPluginEntry, phase: string | null): Status {
  if (!entry.enabled) return 'off'
  switch (phase) {
    case 'active':
      return 'running'
    case 'pending':
    case 'loading':
      return 'starting'
    case 'unloading':
      return 'stopping'
    case 'failed':
      return 'failed'
    default:
      return 'idle'
  }
}

/** What a person recognises the entry by; the id stays visible as a subtitle. */
function displayName(entry: DshPluginEntry): string {
  if (entry.source === 'mcp') return entry.id.replace(/^mcp-/, '')
  return entry.id
}

/** A row's second line: the package, never the shared MCP client path. */
function origin(entry: DshPluginEntry): string | null {
  if (entry.source === 'mcp') return null
  if (entry.package) return entry.package
  return entry.name.startsWith('.') || entry.name.startsWith('file:') ? null : entry.name
}

type Engine = {
  id: 'llamacpp' | 'audiocpp'
  status: Status | 'notInstalled' | null
  detail?: string
  to: string
  params?: Record<string, string>
}

/**
 * The native engines sit beside the agent runtime, not inside it: llama.cpp
 * serves local models and audio.cpp serves voice. They run as their own
 * processes, so they are listed with their live state and managed in their
 * own settings rather than switched here.
 */
function useEngines(): Engine[] {
  const serviceHub = useServiceHub()
  const { t } = useTranslation()
  const [llama, setLlama] = useState<string[] | null>(null)
  const [speech, setSpeech] = useState<SpeechStatus | null>(null)

  useEffect(() => {
    let live = true
    void serviceHub
      .models()
      .getActiveModels('llamacpp')
      .then((ids) => live && setLlama(ids))
      .catch(() => live && setLlama(null))
    void serviceHub
      .speech()
      .status()
      .then((s) => live && setSpeech(s))
      .catch(() => live && setSpeech(null))
    return () => {
      live = false
    }
  }, [serviceHub])

  return [
    {
      id: 'llamacpp',
      status: llama === null ? null : llama.length > 0 ? 'running' : 'idle',
      detail:
        llama && llama.length > 0
          ? t('settings:plugins.engines.loaded', { count: llama.length })
          : undefined,
      to: route.settings.providers,
      params: { providerName: 'llamacpp' },
    },
    {
      id: 'audiocpp',
      status:
        speech === null
          ? null
          : speech.installing
            ? 'starting'
            : !speech.installed
              ? 'notInstalled'
              : speech.running
                ? 'running'
                : 'idle',
      to: route.settings.voice,
    },
  ]
}

function EnginesSection({ engines, query }: { engines: Engine[]; query: string }) {
  const { t } = useTranslation()
  const q = query.trim().toLowerCase()
  const rows = engines.filter(
    (e) => !q || e.id.includes(q) || t(`settings:plugins.engines.${e.id}.name`).toLowerCase().includes(q)
  )
  if (rows.length === 0) return null
  return (
    <section className="rounded-lg bg-card p-4" aria-labelledby="plugins-engines">
      <h2 id="plugins-engines" className="mb-3 font-studio text-base font-medium text-foreground text-balance">
        {t('settings:plugins.engines.title')}
      </h2>
      <ul className="divide-y divide-border/40">
        {rows.map((e) => (
          <li key={e.id} data-testid={`engine-${e.id}`} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {t(`settings:plugins.engines.${e.id}.name`)}
                </span>
                {e.status && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        e.status === 'notInstalled' ? STATUS_DOT.off : STATUS_DOT[e.status]
                      )}
                      aria-hidden
                    />
                    {e.status === 'notInstalled'
                      ? t('settings:plugins.engines.notInstalled')
                      : t(`settings:plugins.status.${e.status}`)}
                    {e.detail && <span className="tabular-nums">· {e.detail}</span>}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                {t(`settings:plugins.engines.${e.id}.desc`)}
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Link to={e.to as any} params={e.params as any}>
                {t('settings:plugins.engines.manage')}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground text-pretty">{t('settings:plugins.engines.note')}</p>
    </section>
  )
}

function PluginManager() {
  const { t } = useTranslation()
  const dsh = useServiceHub().dsh()
  const [entries, setEntries] = useState<DshPluginEntry[]>([])
  const [phases, setPhases] = useState<Phases | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pkg, setPkg] = useState('')
  const [installing, setInstalling] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<DshPluginEntry | null>(null)
  const engines = useEngines()

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e))

  const refresh = useCallback(async () => {
    try {
      setEntries(await dsh.pluginsList())
    } catch (e) {
      fail(e)
    }
    // Live phases come from the running runtime; absent when it is stopped.
    try {
      const res = (await dshRequest('plugins/list')) as {
        entries: { id: string; phase: string | null }[]
      }
      setPhases(Object.fromEntries(res.entries.map((x) => [x.id, x.phase])))
    } catch {
      setPhases(null)
    }
  }, [dsh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (job: () => Promise<void>) => {
    try {
      await job()
      setDirty(true)
      await refresh()
    } catch (e) {
      fail(e)
    }
  }

  const restart = async () => {
    setRestarting(true)
    try {
      await dsh.restart()
      setDirty(false)
      toast.success(t('settings:plugins.restarted'))
      // The new process needs a moment before it answers plugins/list.
      setTimeout(() => void refresh(), 1500)
    } catch (e) {
      fail(e)
    } finally {
      setRestarting(false)
    }
  }

  const install = async () => {
    setInstalling(true)
    try {
      await dsh.pluginInstall(pkg.trim())
      setPkg('')
      setDirty(true)
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setInstalling(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    )
  }, [entries, query])

  const failedCount = phases
    ? entries.filter((e) => statusOf(e, phases[e.id] ?? null) === 'failed').length
    : 0

  const row = (e: DshPluginEntry) => {
    const status: Status = phases ? statusOf(e, phases[e.id] ?? null) : e.enabled ? 'on' : 'off'
    const from = origin(e)
    const editable = e.source === 'user'
    return (
      <li key={e.id} data-testid={`plugin-${e.id}`} className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{displayName(e)}</span>
              {/* Plain on/off beside a switch only repeats it; a live state or a
                  switchless MCP row is worth the words. */}
              {(phases !== null || e.source === 'mcp') && (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
                  {t(`settings:plugins.status.${status}`)}
                </span>
              )}
            </div>
            {from && (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={from}>
                {from}
              </p>
            )}
          </div>
          {editable && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={editing === e.id}
                onClick={() => {
                  setEditing(editing === e.id ? null : e.id)
                  setDraft(e.config)
                }}
              >
                {t('settings:plugins.editConfig')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setRemoving(e)}
              >
                {t('settings:plugins.remove')}
              </Button>
            </div>
          )}
          {/* MCP servers are switched in MCP settings; a dead switch here read as broken. */}
          {e.source !== 'mcp' && (
            <Switch
              aria-label={t('settings:plugins.toggle', { name: displayName(e) })}
              checked={e.enabled}
              onCheckedChange={(on) => run(() => dsh.pluginSetEnabled(e.id, on))}
            />
          )}
        </div>
        {editing === e.id && (
          <div className="mt-3 flex flex-col gap-2">
            <Textarea
              aria-label={t('settings:plugins.config')}
              className="min-h-40 font-mono text-xs"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {t('settings:plugins.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  run(async () => {
                    await dsh.pluginSetConfig(e.id, draft)
                    setEditing(null)
                    toast.success(t('settings:plugins.saved'))
                  })
                }
              >
                {t('settings:plugins.save')}
              </Button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const section = (
    source: DshPluginEntry['source'],
    extra?: { action?: React.ReactNode; note?: string; leading?: React.ReactNode }
  ) => {
    const rows = filtered.filter((e) => e.source === source)
    const total = entries.filter((e) => e.source === source).length
    if (total === 0 && !extra?.leading) return null
    const on = entries.filter((e) => e.source === source && e.enabled).length
    return (
      <section className="rounded-lg bg-card p-4" aria-labelledby={`plugins-${source}`}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id={`plugins-${source}`} className="font-studio text-base font-medium text-foreground text-balance">
            {t(`settings:plugins.${source}`)}
            {total > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {t('settings:plugins.countOn', { on, total })}
              </span>
            )}
          </h2>
          {extra?.action}
        </div>
        {extra?.leading}
        {rows.length > 0 ? (
          <ul className="divide-y divide-border/40">{rows.map(row)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            {total > 0 ? t('settings:plugins.noMatch') : t(`settings:plugins.empty.${source}`)}
          </p>
        )}
        {extra?.note && rows.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground text-pretty">{extra.note}</p>
        )}
      </section>
    )
  }

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage>
        <div className="flex w-full items-center justify-between gap-2 pr-2">
          <span className="font-studio text-base font-medium">{t('settings:plugins.title')}</span>
          <Button
            size="sm"
            variant={dirty ? 'default' : 'outline'}
            data-testid="plugins-restart"
            disabled={restarting}
            onClick={restart}
          >
            <IconRefresh className={cn('size-4', restarting && 'animate-spin motion-reduce:animate-none')} aria-hidden />
            {dirty ? t('settings:plugins.restartPending') : t('settings:plugins.restart')}
          </Button>
        </div>
      </HeaderPage>
      <div className="h-[calc(100%-60px)] overflow-y-auto p-4 pt-0">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex-1 text-sm text-muted-foreground text-pretty">
              {phases === null
                ? t('settings:plugins.runtimeStopped')
                : failedCount > 0
                  ? t('settings:plugins.failedSummary', { count: failedCount })
                  : t('settings:plugins.desc')}
            </p>
            <div className="relative w-56">
              <IconSearch
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label={t('settings:plugins.filter')}
                placeholder={t('settings:plugins.filter')}
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <EnginesSection engines={engines} query={query} />

          {section('user', {
            leading: (
              <form
                className="mb-3 flex items-center gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  if (pkg.trim() && !installing) void install()
                }}
              >
                <Input
                  aria-label={t('settings:plugins.installTitle')}
                  className="flex-1 font-mono text-sm"
                  value={pkg}
                  placeholder={t('settings:plugins.installPlaceholder')}
                  onChange={(e) => setPkg(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={!pkg.trim() || installing}>
                  {installing ? t('settings:plugins.installing') : t('settings:plugins.install')}
                </Button>
              </form>
            ),
          })}

          {section('mcp', {
            action: (
              <Button variant="ghost" size="sm" asChild>
                <Link to={route.settings.mcp_servers}>{t('settings:plugins.manageMcp')}</Link>
              </Button>
            ),
            note: t('settings:plugins.mcpNote'),
          })}

          {section('base', { note: t('settings:plugins.baseNote') })}
        </div>
      </div>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('settings:plugins.removeTitle', { name: removing ? displayName(removing) : '' })}
            </DialogTitle>
            <DialogDescription>{t('settings:plugins.removeDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t('settings:plugins.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removing
                setRemoving(null)
                if (target) void run(() => dsh.pluginRemove(target.id))
              }}
            >
              {t('settings:plugins.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
