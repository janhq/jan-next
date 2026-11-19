/** Cross-session retained reminders with local search and selection. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconClockOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular,
  IconEllipsisOutlineRegular, IconPlusOutlineRegular, IconScheduledTaskOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular,
  Input, Menu, MenuItemButton, Modal, ReferenceIconRegular, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { } from '@janhq/jan-client-ui-layout/client'
import type { ScheduleId, ScheduleCatalogEntry, ScheduleCreateRequest } from '@janhq/jan-schedule/client'
import type { TaskCreateOutcome } from './TaskDetail.tsx'
import type { TaskEditorStoreProps } from './editor-store.ts'
import { taskNextRunAt, taskSessionId } from './task-record.ts'
import type { CatalogSnapshot } from './catalog-source.ts'
import { CatalogFeedback } from './CatalogFeedback.tsx'
import { TaskDetail, useTaskDetail, type TaskDetailInjected } from './TaskDetail.tsx'
import { useRelativeClock } from './relative-clock.ts'
import { formatScheduleAgo, formatScheduleFrequency, nextRunParts, taskName, zoneLabel } from './schedule-format.ts'
import type { FrequencyZone } from './schedule-format.ts'
import type { TaskEditorDraft } from './TaskEditorFields.tsx'
import { TASK_TEMPLATES, templateDraft, templateSchedule, type TaskTemplate, type TaskTemplateId } from './task-templates.ts'
import { workspaceDisplayTitle } from '@janhq/jan-api-workspace-controller/default-workspace'
import css from './TaskManagerPage.module.css'

/** The detail's share of the page, in percent: bounds, default, and the key that keeps it between visits. */
const DETAIL_MIN = 30
const DETAIL_MAX = 70
const DETAIL_DEFAULT = 47
const DETAIL_WIDTH_KEY = 'jan.schedule.detailWidth'
const clampDetailWidth = (width: number): number => Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, width))
function readDetailWidth(): number {
  if (typeof localStorage === 'undefined') return DETAIL_DEFAULT
  const stored = Number(localStorage.getItem(DETAIL_WIDTH_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampDetailWidth(stored) : DETAIL_DEFAULT
}
function saveDetailWidth(width: number): number {
  const next = clampDetailWidth(width)
  if (typeof localStorage !== 'undefined') localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.round(next * 10) / 10))
  return next
}

/** Injected catalog and task actions for the management page. */
export interface TaskManagerInjected extends TaskDetailInjected {
  /** Host task catalog with its query and deletion state. */
  readonly hooks: { readonly catalog: HostObservable<CatalogSnapshot<ScheduleCatalogEntry>> }
  /**
   * Start a new Session, where a reminder is created by asking the model to
   * schedule it, using the existing new-conversation action.
   */
  readonly onNewTask: () => void
  /**
   * Remove every ended Host task, after this page has confirmed the action.
   *
   * The call requests no task ids, so the Host's ended set is the one removed;
   * the page's rows are only a snapshot that a delivery can have moved. It
   * resolves once the settled outcome has been reported through the app-wide
   * notice, which is the only place the result is stated.
   * @returns resolution after the outcome is reported.
   */
  readonly onClearEnded: () => Promise<void>
  /** Create a task directly through the Host, without a model request. */
  readonly onCreateTask: (request: ScheduleCreateRequest) => Promise<TaskCreateOutcome>
}

/** Root-scoped task catalog props derived from the framework and injected actions. */
export type TaskManagerPageProps = PropsRuntime<'main'>
  & InjectFace<TaskManagerInjected>
  & TaskEditorStoreProps
  & PropsLocale<'schedule.manager'>

type StatusFilter = 'all' | ScheduleCatalogEntry['status']

/**
 * Render retained tasks with manual creation, inline editing, and authoritative deletion.
 * @param props - framework catalog snapshot, localized copy, and action callbacks.
 * @returns the searchable task list beside the selected task's detail.
 */
export function TaskManagerPage(props: TaskManagerPageProps) {
  const { useCatalog, onNewTask, onClearEnded, onRetry, onCreateTask, t } = props
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [view, setView] = useState<'yours' | 'templates'>('yours')
  // A chosen template seeds the create form; a new choice remounts it.
  const [template, setTemplate] = useState<{ readonly id: TaskTemplateId; readonly draft: TaskEditorDraft } | null>(null)
  const workspaces = props.useWorkspaces(snapshot => snapshot.items)
  const sessions = props.useSessions(snapshot => snapshot.byId)
  const catalog = useCatalog(snapshot => snapshot)
  const { records, status } = catalog
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [selectedId, setSelectedId] = useState<ScheduleId | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearMenu, setClearMenu] = useState(false)
  const [clearing, setClearing] = useState(false)
  // The rows state how long remains, so they read the shared ticking clock
  // rather than a value sampled at mount: a catalog refresh can move the target
  // this text describes.
  const now = useRelativeClock()
  const detail = useTaskDetail(props, catalog, selectedId ?? undefined)
  const { record: catalogRecord, task: selected,
    props: { id: detailId, confirmId, onConfirm: setConfirmId, onTabChange: setTab } } = detail
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null)
  // Set when the confirmation opens: its settled removal can hide the trigger
  // before the Modal returns focus, and so can another client's cleanup.
  const clearFocusPending = useRef(false)
  // Set when the removal settles: a readback superseded by `schedule/changed`
  // can publish its rows after the dialog closed, removing the trigger then.
  const clearSettled = useRef(false)
  const confirming = records.find(record => record.id === confirmId)
  // The bulk action's target and count come from the complete catalog, not from
  // the filtered rows: it removes every ended task, whatever the view shows.
  const endedCount = useMemo(
    () => records.filter(record => record.status === 'ended').length,
    [records],
  )
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return records.filter(record => (
      (statusFilter === 'all' || record.status === statusFilter)
      && (record.prompt.toLowerCase().includes(query)
        || (taskSessionId(record) ?? '').toLowerCase().includes(query)
        || taskName(record).toLowerCase().includes(query))
    )).toSorted((left, right) =>
      Date.parse(taskNextRunAt(left)) - Date.parse(taskNextRunAt(right)))
  }, [records, search, statusFilter])

  const emptyTitle = search.trim() !== '' ? 'list.noMatches'
    : statusFilter === 'paused' ? 'list.emptyPaused'
      : statusFilter === 'ended' ? 'list.emptyInactive'
        : statusFilter === 'active' ? 'list.emptyActive' : 'list.empty'
  // The list's frequency line omits a rule zone equal to the host's and otherwise names it.
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const frequencyZone: FrequencyZone = { system: systemZone, label: zone => zoneLabel(zone, t) }

  useEffect(() => {
    // The detail focuses its own panel; with nothing selected, focus returns
    // to the control that opened it, or to the page heading once that control is gone.
    // An open confirmation owns the focus until it closes, even when a refresh
    // drops the selected task behind it.
    if (selectedId !== null || manualOpen || clearConfirm) return
    if (rowRef.current !== null) {
      const target = rowRef.current.isConnected ? rowRef.current : headingRef.current
      target?.focus()
      rowRef.current = null
    }
  }, [selectedId, manualOpen, clearConfirm])

  useEffect(() => {
    if (status !== 'ready') return
    if (selectedId !== null && selected === undefined) setSelectedId(null)
    if (confirmId !== null && confirming === undefined) setConfirmId(null)
  }, [status, selectedId, selected, confirmId, confirming])

  const closeDetails = (): void => {
    setSelectedId(null)
    setManualOpen(false)
  }
  const createManually = (trigger: HTMLButtonElement | null, from: TaskTemplate | null = null): void => {
    rowRef.current = trigger
    // The create form keeps an unsaved draft under one key; a template starts it over.
    if (from !== null) props.actions.clearDraft('new')
    setTemplate(from === null ? null : { id: from.id, draft: templateDraft(from, t) })
    setSelectedId(null); setManualOpen(true); setTab('rule')
  }

  // The Modal restores focus to the element it captured when it opened; the
  // trigger can be removed or rebuilt while the confirmation is open, so the
  // page points focus at the current control, or the heading when it is gone.
  // A settled removal whose readback lands later unmounts the trigger after the
  // dialog closed, which drops focus to the document body; that handoff is
  // caught by the same effect watching the ended count.
  useEffect(() => {
    if (clearConfirm) return
    if (clearFocusPending.current) {
      clearFocusPending.current = false
      const trigger = clearTriggerRef.current
      if (trigger?.isConnected === true) {
        trigger.focus()
        return
      }
      clearSettled.current = false
      headingRef.current?.focus()
      return
    }
    if (!clearSettled.current || endedCount > 0 || document.activeElement !== document.body) return
    clearSettled.current = false
    headingRef.current?.focus()
  }, [clearConfirm, endedCount])

  const pageRef = useRef<HTMLElement>(null)
  const [detailWidth, setDetailWidth] = useState(readDetailWidth)
  // Dragging the detail's left border sets its share of the page; the last width is kept for the next visit.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const page = pageRef.current
    if (page === null || event.button !== 0) return
    event.preventDefault()
    const bounds = page.getBoundingClientRect()
    const widthAt = (x: number): number => clampDetailWidth((bounds.right - x) / bounds.width * 100)
    // Window listeners keep the drag alive when the pointer leaves the 8px strip.
    const move = (moved: PointerEvent): void => { setDetailWidth(widthAt(moved.clientX)) }
    const end = (ended: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.style.removeProperty('cursor')
      setDetailWidth(saveDetailWidth(widthAt(ended.clientX)))
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const confirmClearEnded = (): void => {
    // The confirmation button stays focusable while the removal runs, so a
    // second press has to be ignored here instead of by `disabled`.
    if (clearing) return
    setClearing(true)
    void onClearEnded().finally(() => {
      clearSettled.current = true
      setClearing(false)
      setClearConfirm(false)
    })
  }

  const detailOpen = selected !== undefined || manualOpen
  return (
    <section
      ref={pageRef}
      className={clsx(css.page, detailOpen && css.hasDetails)}
      style={{ '--task-detail-width': `${detailWidth}%` } as CSSProperties}
      aria-label={t('title')}
      data-testid="task-manager-page"
      onKeyDown={(event) => {
        // An Escape that closed a dropdown is already consumed by the Menu's
        // document capture listener. A confirmation's own Escape reaches the
        // Modal's document bubble listener, which runs after this React handler,
        // so the `clearConfirm` guard is what keeps this page from also closing
        // the detail while the dialog closes.
        if (event.key !== 'Escape' || event.defaultPrevented || confirmId !== null || clearConfirm
          || selectedId === null && !manualOpen) return
        event.preventDefault()
        event.stopPropagation()
        closeDetails()
      }}
    >
      <div className={css.listPane}>
        <div className={css.pageScroll}>
          <div className={css.pageContent}>
            <div className={css.pageHeading}>
              <h1 ref={headingRef} tabIndex={-1}>{t('title')}</h1>
              <div className={css.creationActions}>
                <span className={css.createGroup} role="group" aria-label={t('host.create')}>
                  <Button variant="primary" size="sm" className={clsx(css.headerAction, css.createPrimary)} icon={<IconPlusOutlineRegular size={13} />}
                    onClick={onNewTask}>{t('new.action')}</Button>
                  <Menu open={createMenuOpen} onClose={() => { setCreateMenuOpen(false) }} align="end" portal autoFocus
                    listClassName={css.createMenu}
                    anchor={<Button ref={createTriggerRef} variant="primary" size="sm" className={css.createMore} aria-label={t('host.createMethod')}
                      aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => { setCreateMenuOpen(value => !value) }}>
                      <IconChevronDownOutlineRegular size={12} />
                    </Button>}>
                    <MenuItemButton icon={<ReferenceIconRegular kind="session" size={14} />}
                      onSelect={() => { setCreateMenuOpen(false); onNewTask() }}>{t('host.chatCreate')}</MenuItemButton>
                    <MenuItemButton icon={<IconEditOutlineRegular size={14} />}
                      onSelect={() => { setCreateMenuOpen(false); createManually(createTriggerRef.current) }}>
                      {t('host.manualCreate')}
                    </MenuItemButton>
                  </Menu>
                </span>
              </div>
            </div>
            <div className={css.viewTabs} role="tablist" aria-label={t('view.label')}>
              {(['yours', 'templates'] as const).map(value => (
                <button key={value} type="button" role="tab" aria-selected={view === value}
                  className={clsx(css.filterTab, view === value && css.filterTabActive)}
                  onClick={() => { setView(value) }}>
                  {t(`view.${value}`)}
                </button>
              ))}
            </div>
            {view === 'templates' ? <ul className={css.templateGrid} aria-label={t('view.templates')}>
              {TASK_TEMPLATES.map(item => (
                <li key={item.id}>
                  <button type="button" className={css.templateCard}
                    onClick={(event) => { createManually(event.currentTarget, item) }}>
                    <span className={css.templateGlyph} aria-hidden>{item.icon()}</span>
                    <span className={css.rowContent}>
                      <span className={css.rowTitle}>{t(`template.${item.id}.title`)}</span>
                      <span className={css.templateDescription}>{t(`template.${item.id}.description`)}</span>
                      <span className={css.templateSchedule}>
                        <IconClockOutlineRegular size={14} />{templateSchedule(item, t)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul> : <>
              <div className={css.filters}>
                <div className={css.filterTabs} role="group" aria-label={t('statusFilter.label')}>
                  {(['active', 'paused', 'ended', 'all'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      className={clsx(css.filterTab, statusFilter === value && css.filterTabActive)}
                      aria-pressed={statusFilter === value}
                      onClick={() => { setStatusFilter(value) }}
                    >
                      {t(value === 'all' ? 'statusFilter.all' : `status.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={css.searchTools}>
                <div className={css.searchField}>
                  <Input
                    type="search"
                    icon={<IconSearchOutlineRegular />}
                    aria-label={t('search.label')}
                    placeholder={t('search.placeholder')}
                    value={search}
                    onChange={(event) => { setSearch(event.target.value) }}
                  />
                  {search !== '' && <Button size="sm" className={css.searchClear} aria-label={t('search.clear')} onClick={() => { setSearch('') }}>
                    <IconCloseOutlineRegular />
                  </Button>}
                </div>
                {statusFilter !== 'active' && endedCount > 0 && <Menu
                  open={clearMenu}
                  onClose={() => { setClearMenu(false) }}
                  align="end"
                  portal
                  items={[{
                    id: 'clear-inactive', label: t(clearing ? 'clear.pending' : 'clear.action'),
                    icon: <IconTrashOutlineRegular />, danger: true,
                    disabled: clearing || status !== 'ready',
                  }]}
                  onSelect={() => {
                    setClearMenu(false)
                    clearFocusPending.current = true
                    setClearConfirm(true)
                  }}
                  anchor={<Tooltip label={t('list.more')} side="bottom" portal disabled={clearMenu}>
                    <Button
                      ref={clearTriggerRef}
                      variant="outline"
                      className={css.catalogMore}
                      aria-label={t('list.more')}
                      aria-haspopup="menu"
                      aria-expanded={clearMenu}
                      aria-busy={clearing}
                      onClick={() => { setClearMenu(value => !value) }}
                    >
                      <IconEllipsisOutlineRegular />
                    </Button>
                  </Tooltip>}
                />}
              </div>
              <div className={css.list}>
                {selected === undefined && <CatalogFeedback status={status} populated={rows.length > 0} onRetry={onRetry} t={t} />}
                {status === 'ready' && rows.length === 0 && <div className={css.empty} role="status">
                  <IconScheduledTaskOutlineRegular size={48} className={css.emptyGlyph} />
                  <h2>{t(emptyTitle)}</h2>
                  <Button variant="outline" className={css.emptyAction} onClick={(event) => { createManually(event.currentTarget) }}>
                    {t('empty.action')}
                  </Button>
                </div>}
                <ul className={css.listRows} aria-label={t('list.label')} aria-busy={status === 'loading'}>
                  {rows.map((record) => {
                    // One pair per row: the same absolute stamp and distance reach
                    // both halves, from one formatting call.
                    const nextRunAt = taskNextRunAt(record)
                    const nextRun = nextRunParts(nextRunAt, t('time.locale'), now, t)
                    const cwd = record.target.kind === 'session' ? sessions[record.target.sessionId]?.cwd : record.target.create.cwd
                    const workspace = cwd === undefined ? t('host.defaultProject')
                      : workspaces.find(item => item.path === cwd)?.title ?? cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
                    const lastRun = record.lastDelivery
                    const lastSession = lastRun === undefined ? undefined : sessions[lastRun.targetSessionId]
                    // A run's Session ends its turn in an error the conversation can continue; that is the failed state shown here.
                    const lastFailed = lastRun !== undefined
                      && typeof lastSession?.projectionValues?.conversationContinuation === 'number'
                    return (
                      <li key={record.id}>
                        <Button
                          className={clsx(css.row, selectedId === record.id && css.selectedRow,
                            record.status !== 'active' && css.endedRow)}
                          aria-label={taskName(record)}
                          aria-describedby={`${detailId}-metadata-${record.id}`}
                          aria-expanded={selectedId === record.id}
                          aria-controls={selectedId === record.id ? detailId : undefined}
                          onClick={(event) => {
                            rowRef.current = event.currentTarget
                            setManualOpen(false)
                            setSelectedId(record.id)
                            setTab('rule')
                          }}
                        >
                          <IconClockOutlineRegular className={css.rowGlyph} />
                          <span className={css.rowContent}>
                            <span className={css.rowTitle}>{taskName(record)}</span>
                            <span className={css.rowSummary} id={`${detailId}-metadata-${record.id}`}>
                              {record.status !== 'active'
                                && <span className={css.metadata}>{t(`status.${record.status}`)}</span>}
                              <span className={css.metadata}>{formatScheduleFrequency(record, t, frequencyZone)}</span>
                              {record.status === 'active' && <span className={css.metadata}>
                                {t('list.nextPrefix')}<time dateTime={nextRunAt}>
                                  {nextRun.absolute}
                                </time>
                                {' '}<span className={css.nextRunRelative}>{nextRun.relative}</span>
                              </span>}
                            </span>
                            <span className={css.rowSummary}>
                              <span className={css.metadata}>{workspaceDisplayTitle(workspace, t('host.defaultProject'))}</span>
                              <span className={clsx(css.metadata, lastFailed && css.lastRunFailed)}>
                                {lastRun === undefined ? t('list.neverRun') : t(lastFailed ? 'list.lastRunFailed' : 'list.lastRun', {
                                  time: formatScheduleAgo(lastRun.deliveredAt, now, t('time.locale')),
                                })}
                              </span>
                            </span>
                          </span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>}
          </div>
        </div>
        {detailOpen && <div className={css.detailHandle} role="separator" aria-orientation="vertical" tabIndex={0}
          aria-label={t('detail.resize')} aria-valuemin={DETAIL_MIN} aria-valuemax={DETAIL_MAX} aria-valuenow={Math.round(detailWidth)}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowLeft' ? 2 : event.key === 'ArrowRight' ? -2 : 0
            if (step === 0) return
            event.preventDefault()
            setDetailWidth(width => saveDetailWidth(width + step))
          }} />}
      </div>
      {manualOpen ? <TaskDetail key={template?.id ?? 'blank'} {...detail.props} template={template?.draft}
        onCreateTask={onCreateTask} onClose={closeDetails} onDeleted={closeDetails}
        onCreated={(task) => {
          setManualOpen(false); setSearch(''); setStatusFilter('all'); setSelectedId(task.id); setTab('rule')
        }} /> : selected !== undefined && <TaskDetail
          {...detail.props}
          task={selected}
          authoritative={catalogRecord !== undefined}
          onDeleted={closeDetails}
          onClose={closeDetails}
        />}
      <Modal
        className={css.confirmDialog as string}
        contentClassName={css.confirmContent as string}
        open={clearConfirm}
        title={t('clear.title', { count: endedCount })}
        description={t('clear.description')}
        closeLabel={t('clear.close')}
        // Dismissal waits for the settled removal: the confirmation is the only
        // place that states the operation is still running.
        onClose={() => { if (!clearing) setClearConfirm(false) }}
        footer={<div className={css.confirmActions}>
          <Button variant="outline" disabled={clearing} onClick={() => { setClearConfirm(false) }}>
            {t('delete.cancel')}
          </Button>
          <Button
            variant="outline"
            className={css.deleteButton}
            aria-disabled={clearing}
            onClick={confirmClearEnded}
          >
            {t(clearing ? 'clear.pending' : 'clear.confirm')}
          </Button>
        </div>}
      />

    </section>
  )
}
