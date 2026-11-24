/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * The trigger shows the model name with its reasoning effort in the caption
 * tone. Opening it shows the provider-grouped model list straight away, in
 * name order, with search above catalogs of more than four models; a lone
 * provider heading is hidden. Below the list sit the session options and
 * Manage models. Beside the menu a details card follows the highlighted
 * model (hover, arrows, or the search highlight): its catalog facts, its own
 * reasoning levels, and `conversation.input.model.details` contributions.
 * Picking a level selects that model at that level. Right enters the card
 * from a model row (or from search with the caret at the end); Left, Escape
 * and Shift+Tab return. Search retains focus while Up/Down cycle the
 * highlighted result; Enter and Tab accept it, and Down past the last result
 * enters the rows below the list. Smaller catalogs move focus between rows.
 * Escape and Shift+Tab otherwise close back to the trigger. Opening focuses
 * search, or the checked row when the catalog has no search; mobile devices
 * keep focus on the trigger until explicit input. Model names match the typed
 * text as one case-insensitive run. Selecting restores trigger focus without
 * a ring until the trigger loses focus or the menu reopens. Data and
 * submission ride the same per-session ModelDirectory as the /model popup;
 * exact-model reasoning metadata and the selected effort come from the Host
 * rather than a client-owned vocabulary. A rejected selection announces
 * through the shared transient Toast in the notification stack; the
 * in-menu strip with Retry remains the catalog-load surface. While the
 * directory's pending selection is unsettled, the trigger shows a spinner in
 * place of its chevron, and each row whose value that selection carries
 * shows one in place of its check mark.
 */
import { MenuGroup, MenuSurface, observeStickyMenuGroups } from '@janhq/jan-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type FocusEvent, type ReactNode, type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import type { ModelCatalogModel } from '@janhq/jan-api-session-controller/types'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@janhq/jan-api-remotes/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular,
  IconDataOutlineRegular, IconDatabaseOutlineRegular, IconImageOutlineRegular,
  IconSearchOutlineRegular, IconStarFillRegular, IconStarOutlineRegular, IconTextOutlineRegular, IconThinkOutlineRegular,
  IconWarningOutlineRegular, Input, isMobileDevice, StateDot, Tag, Toast,
} from '@janhq/jan-client-ui-primitives'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { ModelDetailsOwner, ModelLabelOwner, ModelOptionsOwner, ModelSelectInjected } from './slots.ts'
import { compareModelNames } from './model-order.ts'
import css from './ModelSelect.module.css'

/** Where focus lands after the menu opens. */
type FocusIntent = 'list'

/** Focusable rows inside the menu card or the details card. */
const ROW_SELECTOR = 'button[role="menuitem"]:not([disabled]), button[role="menuitemradio"]:not([disabled]), button[role="radio"]:not([disabled]), button[role="switch"]:not([disabled])'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/** Short token count for the details card: 32768 -> 33K, 1048576 -> 1M. */
function formatTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(1))}M` : `${Math.round(tokens / 1000)}K`
}

/**
 * Display names for one provider's models: a router name such as
 * `anthropic/claude-opus-5-5` drops its vendor prefix unless that would make
 * two rows read the same.
 */
function displayNames(models: readonly ModelCatalogModel[]): Map<string, string> {
  const short = (name: string): string => name.slice(name.lastIndexOf('/') + 1) || name
  const counts = new Map<string, number>()
  for (const model of models) counts.set(short(model.name), (counts.get(short(model.name)) ?? 0) + 1)
  return new Map(models.map(model => [model.id, counts.get(short(model.name)) === 1 ? short(model.name) : model.name]))
}

/**
 * Starred models, as `provider/model` keys in the order they were starred. Shared
 * by every seat and kept across restarts; a starred model that leaves the
 * catalog stays starred and returns to Favorites when it comes back.
 */
const favoriteStore = createSnapshotStore<readonly string[]>([], { persist: { name: 'jan.models.favorites' } })
const favoriteKey = (provider: string, model: string): string => `${provider}/${model}`

function toggleFavorite(key: string): void {
  const keys = favoriteStore.getSnapshot()
  favoriteStore.set(keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key])
}

/** Lowercase, with `-`, `_`, `.`, `/` and whitespace runs folded to one space. */
function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/[\s\-_./]+/g, ' ').trim()
}

function searchWords(query: string): string[] {
  const normalized = normalizeSearch(query)
  return normalized === '' ? [] : normalized.split(' ')
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the model menu and the highlighted model's details card.
 */
export function ModelSelect(
  {
    locked, available, directory, load, settingsAvailability, openModelsSettings, select, resolveText, t,
    renderLabel, renderOptions, renderDetails,
  }:
    ModelSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & PropsLocale<'model'> & {
      renderLabel: (owner: ModelLabelOwner, fallback: ReactNode) => ReactNode
      /** Session options appended to the root menu; absent where the seat has none. */
      renderOptions?: (owner: ModelOptionsOwner) => ReactNode
      /** Provider-owned controls appended to the details card; absent where the seat has none. */
      renderDetails?: (owner: ModelDetailsOwner) => ReactNode
    },
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const canOpenModelsSettings = useSyncExternalStore(
    fn => settingsAvailability.subscribe(fn),
    () => settingsAvailability.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [selectionFocus, setSelectionFocus] = useState(false)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const footerRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const anchorId = id.replaceAll(':', '')
  const menuAnchor = `--jan-model-menu-${anchorId}` as const
  const rowAnchor = `--jan-model-row-${anchorId}` as const
  const anchorStyle: CSSProperties & Record<'--jan-model-anchor' | '--jan-model-row-anchor', string> = {
    '--jan-model-anchor': `--jan-model-${anchorId}`,
    '--jan-model-row-anchor': rowAnchor,
  }
  // The card sits beside the menu and level with the highlighted row.
  const flyoutStyle: CSSProperties & Record<'--jan-model-menu-anchor' | '--jan-model-row-anchor', string> = {
    '--jan-model-menu-anchor': menuAnchor,
    '--jan-model-row-anchor': rowAnchor,
  }

  // Router listings arrive in no useful order; rows group by the name a person
  // reads, newest version of each family first.
  const groups = useMemo(() => state.groups.map((group) => {
    const names = displayNames(group.models)
    const label = (model: ModelCatalogModel): string => names.get(model.id) ?? model.name
    return {
      ...group,
      provider: { id: group.id, name: group.name },
      label,
      models: [...group.models].sort((a, b) => compareModelNames(label(a), label(b))),
    }
  }), [state.groups])
  const choices = useMemo(() => groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [groups])
  const showSearch = choices.length > 4
  const favorites = useSyncExternalStore(fn => favoriteStore.subscribe(fn), () => favoriteStore.getSnapshot())
  // A model name matches when it contains every typed word, each as one run:
  // "opus 5" finds claude-opus-5, "lam" finds Llama but not cLAude-opus[1M].
  // Scattered-letter matching suits short command names, not model names.
  // Starred models move out of their provider into Favorites at the top.
  const sections = useMemo(() => {
    const words = showSearch ? searchWords(query) : []
    type Group = (typeof groups)[number]
    const matches = (group: Group, model: ModelCatalogModel): boolean => {
      if (words.length === 0) return true
      const haystack = `${normalizeSearch(model.name)} ${normalizeSearch(group.label(model))}`
      return words.every(word => haystack.includes(word))
    }
    const starred = new Set(favorites)
    const favoriteRows = favorites.flatMap(key => groups.flatMap(group => group.models
      .filter(model => favoriteKey(group.id, model.id) === key && matches(group, model))
      .map(model => ({ group, model }))))
    return [
      ...favoriteRows.length === 0 ? [] : [{ key: '\u0000favorites', name: t('menu.favorites'), rows: favoriteRows }],
      ...groups.map(group => ({
        key: group.id,
        name: group.name,
        rows: group.models.filter(model => !starred.has(favoriteKey(group.id, model.id)) && matches(group, model))
          .map(model => ({ group, model })),
      })).filter(section => section.rows.length > 0),
    ]
  }, [groups, query, showSearch, favorites, t])
  const visibleChoices = useMemo(() => sections.flatMap(section => section.rows), [sections])
  const visibleModels = useMemo(() => visibleChoices.map(({ group, model }) => ({
    provider: group.id, model: model.id,
  })), [visibleChoices])
  const currentVisibleIndex = visibleModels.findIndex(model =>
    model.provider === state.current?.provider && model.model === state.current.model)
  const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1)
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = currentChoice === undefined
    ? undefined
    : reasoning === undefined
      ? state.retainedEffort
      : effectiveEffort === undefined
        ? t('effort.providerDefault')
        : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoicesFor = (levels: ModelCatalogModel['reasoning']): readonly EffortChoice[] => levels === undefined
    ? []
    : [
      ...levels.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...levels.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ]
  const { pending } = state
  const busy = pending !== null

  // Starring moves a row between sections; the highlight follows the model, not its old index.
  const followRef = useRef<string | null>(null)
  const star = (provider: string, model: string): void => {
    followRef.current = favoriteKey(provider, model)
    toggleFavorite(followRef.current)
  }
  useLayoutEffect(() => {
    const key = followRef.current
    if (key === null) return
    followRef.current = null
    const index = visibleModels.findIndex(choice => favoriteKey(choice.provider, choice.model) === key)
    if (index >= 0) setHighlightedIndex(index)
  }, [visibleModels])

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      // The portaled card is outside the trigger subtree; check both.
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      if (flyoutRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useLayoutEffect(() => {
    if (!showSearch) {
      setQuery('')
      setHighlightedIndex(null)
    }
  }, [showSearch])

  // Opening the menu moves focus to the row the keyboard continues from.
  const focusIntent = useRef<FocusIntent | null>(null)
  const previousShowSearch = useRef(showSearch)
  useEffect(() => {
    const changedSearchMode = previousShowSearch.current !== showSearch
    previousShowSearch.current = showSearch
    const intent = focusIntent.current ?? (changedSearchMode ? 'list' : null)
    focusIntent.current = null
    if (!open || intent === null) return
    if (showSearch) {
      if (!isMobileDevice()) searchRef.current?.focus()
      return
    }
    // The checked row is the value in use; a list without one opens on its
    // first row. Rows a selection in flight disabled cannot take the
    // keyboard; the trigger does, so the card's keys still reach the menu.
    const scope = groupsRef.current
    const checked = scope?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
    const target = checked ?? scope?.querySelector<HTMLElement>(ROW_SELECTOR)
    ;(target ?? triggerRef.current)?.focus()
  }, [open, showSearch])

  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [available, open, sections])

  useLayoutEffect(() => {
    if (open && activeModelIndex >= 0) {
      itemRefs.current[activeModelIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, activeModelIndex, visibleModels])

  if (!available) return null

  const show = (): void => {
    setSelectionFocus(false)
    triggerRef.current?.focus()
    setQuery('')
    setHighlightedIndex(null)
    focusIntent.current = 'list'
    setOpen(true)
    reload()
  }

  const changeQuery = (next: string): void => {
    setQuery(next)
    setHighlightedIndex(0)
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const closeAfterSelection = (): void => {
    setSelectionFocus(true)
    close(true)
  }

  /** Move the keyboard into the details card, onto its checked level. */
  const openDetails = (): boolean => {
    const card = flyoutRef.current
    const target = card?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not([disabled])')
      ?? rowsIn(card)[0]
    if (target === undefined) return false
    target.focus()
    return true
  }

  /** Hand the keyboard back from the details card to the list it describes. */
  const closeDetails = (): void => {
    if (showSearch) searchRef.current?.focus()
    else itemRefs.current[activeModelIndex]?.focus()
  }

  const rowsIn = (scope: HTMLElement | null): HTMLButtonElement[] =>
    Array.from(scope?.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR) ?? [])

  const moveFocus = (scope: HTMLElement | null, offset: number): void => {
    const items = rowsIn(scope)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    // Focus outside the rows (the trigger, which keeps it while the menu
    // opens) enters at the end the step comes from: the first row forward,
    // the last row backward.
    const next = active === -1
      ? (offset > 0 ? 0 : items.length - 1)
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    const inFlyout = event.target instanceof Node && flyoutRef.current?.contains(event.target) === true
    const leave = (): void => {
      if (inFlyout) closeDetails()
      else close(true)
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      leave()
      return
    }
    if (!open) return
    if (event.key === 'ArrowLeft' && inFlyout) {
      event.preventDefault()
      closeDetails()
      return
    }
    if (event.key === 'ArrowRight' && !inFlyout) {
      const onRow = event.target instanceof HTMLElement && groupsRef.current?.contains(event.target) === true
      const search = searchRef.current
      const atEnd = search !== null && event.target === search && search.selectionStart === search.value.length
      if ((onRow || atEnd) && openDetails()) event.preventDefault()
      return
    }
    const onSearch = event.target === searchRef.current || event.target === triggerRef.current
    if (showSearch && !inFlyout && onSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (busy) return
      const footer = rowsIn(footerRef.current)
      // Down past the last result continues into the rows below the list.
      if (event.key === 'ArrowDown' && footer.length > 0
        && (visibleModels.length === 0 || activeModelIndex === visibleModels.length - 1)) {
        footer[0]?.focus()
        return
      }
      if (visibleModels.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlightedIndex((activeModelIndex + direction + visibleModels.length) % visibleModels.length)
        searchRef.current?.focus()
      }
      return
    }
    if (showSearch && event.target === searchRef.current
      && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
      if (event.key === 'Tab' && visibleModels.length === 0) return
      event.preventDefault()
      const highlighted = visibleModels[activeModelIndex]
      if (!busy && highlighted !== undefined) choose(highlighted)
      return
    }
    // Tab settles like Enter and Shift+Tab leaves like Escape, so the menu's
    // keys mean what they mean in the composer. Both are consumed: the card
    // keeps the browser's focus traversal out while it is open.
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        leave()
        return
      }
      // Settling activates the row the keyboard is on; with focus still on the
      // trigger, Tab enters the menu at the value in use instead. Any other
      // control inside the card (a retry button) keeps the browser's traversal,
      // so the keystroke stays unconsumed there.
      const focused = document.activeElement
      const rows = [...rowsIn(menuRef.current), ...rowsIn(flyoutRef.current)]
      if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
        event.preventDefault()
        focused.click()
        return
      }
      if (focused !== triggerRef.current) return
      event.preventDefault()
      if (showSearch) {
        setHighlightedIndex(null)
        searchRef.current?.focus()
        return
      }
      const checked = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
      ;(checked ?? rows[0])?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      if (inFlyout) {
        moveFocus(flyoutRef.current, offset)
        return
      }
      if (showSearch) {
        // Results stay on the search field's highlight; the arrows walk the
        // rows below the list and hand back to search at either end.
        const footer = rowsIn(footerRef.current)
        const at = footer.findIndex(item => item === document.activeElement)
        const next = at + offset
        if (at === -1 || next < 0 || next >= footer.length) {
          setHighlightedIndex(offset < 0 ? visibleModels.length - 1 : 0)
          searchRef.current?.focus()
        } else {
          footer[next]?.focus()
        }
        return
      }
      moveFocus(menuRef.current, offset)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && (
      rootRef.current?.contains(event.relatedTarget) === true
      || menuRef.current?.contains(event.relatedTarget) === true
      || flyoutRef.current?.contains(event.relatedTarget) === true
    )) return
    close()
  }

  const settleSelection = (result: Awaited<ReturnType<ModelSelectInjected['select']>>): void => {
    if (result === undefined) return
    if (result.ok) {
      if (rootRef.current !== null) closeAfterSelection()
      return
    }
    const { error } = result
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error.code}: ${error.message}` }),
    })
  }

  const submit = (selection: ModelSelection): void => {
    lastActionRef.current = 'select'
    // Disabled option rows cannot retain focus while a selection is pending.
    setSelectionFocus(true)
    triggerRef.current?.focus()
    void select(selection).then(settleSelection)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      closeAfterSelection()
      return
    }
    submit(selection)
  }

  const chooseEffort = (
    choice: { group: { id: string }; model: ModelCatalogModel }, selected: boolean, effort: string | undefined,
  ): void => {
    if (selected && effectiveEffort === effort) {
      closeAfterSelection()
      return
    }
    submit({
      provider: choice.group.id,
      model: choice.model.id,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const waiting = currentChoice === undefined && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : (currentChoice === undefined ? undefined : currentChoice.group.label(currentChoice.model))
      ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : currentChoice === undefined
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  const renderModelLabel = (
    provider: ModelLabelOwner['provider'], model: ModelLabelOwner['model'], name: string,
    placement: ModelLabelOwner['placement'], selected: boolean,
  ) => (
    <span data-provider-id={provider.id} data-model-id={model.id}>
      {renderLabel({
        provider, model, placement, selected,
      }, model.badge === undefined ? name : (
        <span className={css.badgedName}>
          {placement === 'trigger' ? <><Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag>{' '}</> : null}
          <span className={css.badgedNameText}>{name}</span>
          {placement === 'trigger' ? null : <>{' '}<Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag></>}
        </span>
      ))}
    </span>
  )
  let modelIndex = 0
  const activeChoice = open ? visibleChoices[activeModelIndex] : undefined

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
      onMouseDown={(event) => {
        // WebKit blurs a focused row before click unless the button's mousedown keeps focus.
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        style={anchorStyle}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        aria-busy={busy}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => {
          if (open) {
            close(true)
          } else {
            show()
          }
        }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        <span className={css.triggerLabel}>
          {currentChoice === undefined ? modelLabel : renderModelLabel(currentChoice.group.provider, currentChoice.model, modelLabel, 'trigger', true)}
        </span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>

      {/* Portaled to body (Menu primitive's portal mode) so the sidebar and
          column overflow clips cannot crop the card; synthetic events still
          bubble through this React subtree, keeping onKeyDown/onBlur live. */}
      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={anchorStyle}
          anchorName={menuAnchor}
          role="group"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {showSearch && <div className={css.searchRow}>
            <Input
              ref={searchRef}
              className={clsx(css.search, query !== '' && css.searchWithQuery)}
              icon={<IconSearchOutlineRegular />}
              type="text"
              role="searchbox"
              aria-label={t('search.placeholder')}
              aria-controls={`${id}-models`}
              aria-activedescendant={activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`}
              placeholder={t('search.placeholder')}
              value={query}
              readOnly={busy}
              onChange={(event) => { changeQuery(event.target.value) }}
            />
            {query !== '' && (
              <button
                type="button"
                className={css.searchClear}
                aria-label={t('search.clear')}
                disabled={busy}
                onClick={() => {
                  changeQuery('')
                  searchRef.current?.focus()
                }}
              >
                <IconCloseFillRegular />
              </button>
            )}
          </div>}
          {state.status === 'loading' && (
            <div className={css.status}>{t('status.loading')}</div>
          )}
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          )}
          {state.failures.map(failure => failure.code === 'MISSING_CREDENTIAL' ? null : (
            <div className={css.warning} key={failure.id}>
              <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          ))}
          <div
            ref={groupsRef}
            id={`${id}-models`}
            className={clsx(css.groups, 'scrollable')}
            role="menu"
            aria-label={t('menu.model')}
            hidden={sections.length === 0}
          >
            {sections.map((section) => {
              return (
                <MenuGroup key={section.key} label={section.name}>
                  {section.rows.map(({ group, model }) => {
                    const index = modelIndex++
                    const selected = state.current?.provider === group.id && state.current.model === model.id
                    const starred = favorites.includes(favoriteKey(group.id, model.id))
                    return (
                      <button
                        ref={(node) => { itemRefs.current[index] = node }}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        id={`${id}-model-${index}`}
                        tabIndex={showSearch ? -1 : 0}
                        onFocus={() => { setHighlightedIndex(index) }}
                        data-highlighted={index === activeModelIndex ? '' : undefined}
                        className={clsx(
                          css.option, css.modelOption, selected && css.selected, index === activeModelIndex && css.optionActive,
                        )}
                        onMouseMove={busy || index === activeModelIndex ? undefined : () => {
                          if (showSearch) setHighlightedIndex(index)
                          else itemRefs.current[index]?.focus()
                        }}
                        key={`${group.id}/${model.id}`}
                        title={group.label(model)}
                        disabled={busy}
                        onClick={() => { choose({ provider: group.id, model: model.id }) }}
                      >
                        {/* Pointer shortcut for the details card's Add to favorites; the keyboard uses the card. */}
                        <span
                          aria-hidden="true"
                          className={clsx(css.star, starred && css.starOn)}
                          onClick={(event) => {
                            event.stopPropagation()
                            star(group.id, model.id)
                          }}
                        >
                          {starred ? <IconStarFillRegular size={14} /> : <IconStarOutlineRegular size={14} />}
                        </span>
                        <span className={css.optionCopy}>
                          <span className={css.modelName}>{renderModelLabel(group.provider, model, group.label(model), 'option', selected)}</span>
                        </span>
                        {/* Visual echo only: the trigger and the card's Effort group announce it. */}
                        {selected && effortLabel !== undefined && <span aria-hidden="true" className={css.rowEffort}>{effortLabel}</span>}
                        <span className={css.check}>
                          {/* An effort change keeps the model: only its effort row spins. */}
                          {!selected && pending?.provider === group.id && pending.model === model.id
                            ? <StateDot state="ongoing" />
                            : selected ? <IconCheckOutlineRegular /> : null}
                        </span>
                        <IconChevronRightOutlineRegular className={css.rowChevron} />
                      </button>
                    )
                  })}
                </MenuGroup>
              )
            })}
          </div>
          {state.status === 'ready' && sections.length === 0 && (choices.length === 0
            ? <div className={css.empty}>
              <span role="status">{t('empty.models')}</span>
              {canOpenModelsSettings && <button type="button" className={css.emptyAction} onClick={() => { close(); openModelsSettings() }}>
                {t('empty.openModels')}
              </button>}
            </div>
            : <div className={css.empty} role="status">{t('search.empty')}</div>
          )}
          <div ref={footerRef} className={css.footer} role="menu" aria-label={t('menu.options')}>
            {/* Reasoning levels live on each model's details card beside the menu. */}
            {renderOptions?.({
              locked: locked || busy,
              dismiss: () => {
                close()
                triggerRef.current?.focus()
              },
              reportFailure: (message) => { setToast({ seq: ++toastSeq.current, text: message }) },
            })}
            {canOpenModelsSettings && choices.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className={clsx(css.cell, css.manage)}
                onClick={() => { close(); openModelsSettings() }}
              >
                {/* Settings draws its Models section with this glyph; layers belongs to Artifacts. */}
                <IconDataOutlineRegular className={css.manageIcon} />
                <span className={css.cellLabel}>{t('menu.manage')}</span>
              </button>
            )}
          </div>
        </MenuSurface>,
        document.body,
      )}
      {activeChoice !== undefined && createPortal(
        <ModelDetails
          cardRef={flyoutRef}
          id={`${id}-details`}
          style={flyoutStyle}
          name={activeChoice.group.label(activeChoice.model)}
          providerName={activeChoice.group.name}
          model={activeChoice.model}
          levels={effortChoicesFor(activeChoice.model.reasoning)}
          checkedEffort={state.current?.provider === activeChoice.group.id && state.current.model === activeChoice.model.id
            ? effectiveEffort
            : activeChoice.model.reasoning?.defaultEffort}
          pendingEffort={pending !== null && pending.provider === activeChoice.group.id && pending.model === activeChoice.model.id
            ? { effort: pending.reasoningEffort }
            : undefined}
          busy={busy}
          starred={favorites.includes(favoriteKey(activeChoice.group.id, activeChoice.model.id))}
          onToggleStar={() => { star(activeChoice.group.id, activeChoice.model.id) }}
          t={t}
          onPick={(effort) => {
            const selected = state.current?.provider === activeChoice.group.id && state.current.model === activeChoice.model.id
            chooseEffort(activeChoice, selected, effort)
          }}
          extra={renderDetails?.({
            provider: activeChoice.group.provider,
            model: activeChoice.model,
            selected: state.current?.provider === activeChoice.group.id && state.current.model === activeChoice.model.id,
            locked: locked || busy,
          })}
        />,
        document.body,
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}

/**
 * The highlighted model's card: catalog facts, its own reasoning levels, and
 * provider-owned controls. Every line comes from the model's catalog entry or a
 * contribution, so a model without a fact simply shows less.
 */
function ModelDetails({
  cardRef, id, style, name, providerName, model, levels, checkedEffort, pendingEffort, busy, starred, onToggleStar, t, onPick, extra,
}: {
  /** React 18 drops `ref` from function-component props, so the card ref travels by name. */
  cardRef: Ref<HTMLDivElement>
  id: string
  style: CSSProperties
  name: string
  providerName: string
  model: ModelCatalogModel
  levels: readonly EffortChoice[]
  checkedEffort: string | undefined
  /** The level a selection in flight carries for this model. */
  pendingEffort: { effort: string | undefined } | undefined
  busy: boolean
  starred: boolean
  onToggleStar: () => void
  t: PropsLocale<'model'>['t']
  onPick: (effort: string | undefined) => void
  extra: ReactNode
}) {
  // Icon chips, each with its full sentence as tooltip and accessible name: the
  // row reads at a glance and still says "reads images" to a screen reader.
  const facts = [
    { key: 'text', Icon: IconTextOutlineRegular, label: t('details.text'), hint: t('details.text') },
    ...model.imageInput === true ? [{ key: 'image', Icon: IconImageOutlineRegular, label: t('details.image'), hint: t('details.images') }] : [],
    ...model.reasoning === undefined ? [] : [{ key: 'reasoning', Icon: IconThinkOutlineRegular, label: t('details.reasoning'), hint: t('details.reasoningHint') }],
    ...model.contextWindow === undefined ? [] : [{
      key: 'context', Icon: IconDatabaseOutlineRegular, label: formatTokens(model.contextWindow),
      hint: t('details.context', { tokens: formatTokens(model.contextWindow) }),
    }],
  ]
  const known = model.imageInput !== undefined || model.reasoning !== undefined || model.contextWindow !== undefined
  return (
    <MenuSurface ref={cardRef} id={id} className={css.flyout} style={style} role="group" aria-label={t('details.aria', { model: name })}>
      <div className={css.detailsHead}>
        <span className={css.detailsName}>{name}</span>
        <span className={css.detailsProvider}>{providerName}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={starred}
        className={clsx(css.favorite, starred && css.starOn)}
        onClick={onToggleStar}
      >
        {starred ? <IconStarFillRegular size={14} /> : <IconStarOutlineRegular size={14} />}
        {t('details.favorite')}
      </button>
      {known && (
        <ul className={css.facts} aria-label={t('details.modalities')}>
          {facts.map(({ key, Icon, label, hint }) => (
            <li key={key} className={css.fact} title={hint} aria-label={hint}>
              <Icon size={12} />
              <span aria-hidden="true">{label}</span>
            </li>
          ))}
        </ul>
      )}
      {model.description !== undefined && model.description !== '' && <p className={css.detailsDescription}>{model.description}</p>}
      {levels.length > 0 && (
        <div className={css.detailsSection}>
          <div className={css.detailsLabel}>{t('menu.effort')}</div>
          <div className={css.levels} role="radiogroup" aria-label={t('menu.effort')}>
            {levels.map(level => (
              <button
                type="button"
                role="radio"
                aria-checked={checkedEffort === level.effort}
                className={clsx(css.level, checkedEffort === level.effort && css.levelChecked)}
                key={level.key}
                disabled={busy}
                onClick={() => { onPick(level.effort) }}
              >
                {pendingEffort !== undefined && pendingEffort.effort === level.effort ? <StateDot state="ongoing" /> : null}
                {level.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {extra}
    </MenuSurface>
  )
}
