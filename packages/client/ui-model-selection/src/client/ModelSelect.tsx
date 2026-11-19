/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * The trigger shows the model name with its reasoning effort in the caption
 * tone. Opening it shows the provider-grouped model list straight away, with
 * search above catalogs of more than four models; below the list sit the
 * Effort row (label and current value), the session options and Manage
 * models. The Effort row opens its levels in a flyout card beside the menu
 * on click, hover, Enter or Right; Left, Escape and Shift+Tab return to the
 * row. Search retains focus while Up/Down cycle the highlighted result; Enter
 * and Tab accept it, and Down past the last result enters the rows below the
 * list. Smaller catalogs move focus between rows. Escape and Shift+Tab
 * otherwise close back to the trigger. Opening focuses search, or the checked
 * row when the catalog has no search; mobile devices keep focus on the
 * trigger until explicit input. Provider headings paint their background only
 * while pinned by scrolling. Model names match the typed text as one
 * case-insensitive run. Selecting restores trigger focus without a ring until
 * the trigger loses focus or the menu reopens. Data and submission ride the
 * same per-session ModelDirectory as the /model popup; exact-model reasoning
 * metadata and the selected effort come from the Host rather than a
 * client-owned vocabulary. A rejected selection announces through the shared
 * transient Toast anchored to the composer card; the in-menu strip with Retry
 * remains the catalog-load surface. While the directory's pending selection
 * is unsettled, the trigger shows a spinner in place of its chevron, and each
 * row whose value that selection carries shows one in place of its check mark.
 */
import { MenuGroup, MenuSurface, observeStickyMenuGroups } from '@janhq/jan-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type FocusEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@janhq/jan-api-remotes/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular,
  IconDataOutlineRegular, IconLayersOutlineRegular, IconSearchOutlineRegular, IconWarningOutlineRegular,
  Input, isMobileDevice, StateDot, Tag, Toast,
} from '@janhq/jan-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import type { ModelLabelOwner, ModelOptionsOwner, ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Where focus lands after the menu or its effort flyout changes. */
type FocusIntent = 'list' | 'effort' | 'effortRow'

/** Focusable rows inside the menu card or the effort flyout. */
const ROW_SELECTOR = 'button[role="menuitem"]:not([disabled]), button[role="menuitemradio"]:not([disabled]), button[role="switch"]:not([disabled])'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the model menu and its effort flyout.
 */
export function ModelSelect(
  { locked, available, directory, load, settingsAvailability, openModelsSettings, select, resolveText, t, renderLabel, renderOptions, placement = 'composer' }:
    ModelSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & PropsLocale<'model'> & {
      /** The composer seat toasts over the composer card; the dock seat (the row under the card) over its trigger. */
      placement?: 'composer' | 'dock'
      renderLabel: (owner: ModelLabelOwner, fallback: ReactNode) => ReactNode
      /** Session options appended to the root menu; absent where the seat has none. */
      renderOptions?: (owner: ModelOptionsOwner) => ReactNode
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
  const [effortOpen, setEffortOpen] = useState(false)
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
  const effortRowRef = useRef<HTMLButtonElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const anchorStyle: CSSProperties & Record<'--jan-model-anchor' | '--jan-model-menu-anchor', string> = {
    '--jan-model-anchor': `--jan-model-${id.replaceAll(':', '')}`,
    '--jan-model-menu-anchor': `--jan-model-menu-${id.replaceAll(':', '')}`,
  }

  const groups = useMemo(() => state.groups.map(group => ({
    ...group,
    provider: { id: group.id, name: group.name },
  })), [state.groups])
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
  // A model name matches when it contains the typed text: "lam" finds Llama, not
  // cLAude-opus[1M]. Scattered-letter matching suits short command names, not model names.
  const filteredGroups = useMemo(() => {
    const needle = showSearch ? query.trim().toLowerCase() : ''
    return groups.map(group => ({
      ...group, models: needle === '' ? group.models : group.models.filter(model => model.name.toLowerCase().includes(needle)),
    })).filter(group => group.models.length > 0)
  }, [groups, query, showSearch])
  const visibleModels = useMemo(() => filteredGroups.flatMap(group => group.models.map(model => ({
    provider: group.id, model: model.id,
  }))), [filteredGroups])
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
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, t])
  const { pending } = state
  const busy = pending !== null

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
      setEffortOpen(false)
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

  // Opening the menu or the flyout, and closing the flyout, move focus to
  // the row the keyboard continues from.
  const focusIntent = useRef<FocusIntent | null>(null)
  const previousShowSearch = useRef(showSearch)
  useEffect(() => {
    const changedSearchMode = previousShowSearch.current !== showSearch
    previousShowSearch.current = showSearch
    const intent = focusIntent.current ?? (changedSearchMode && !effortOpen ? 'list' : null)
    focusIntent.current = null
    if (!open || intent === null) return
    if (intent === 'effortRow') {
      const row = effortRowRef.current
      ;(row !== null && !row.disabled ? row : triggerRef.current)?.focus()
      return
    }
    if (intent === 'list' && showSearch) {
      if (!isMobileDevice()) searchRef.current?.focus()
      return
    }
    // The checked row is the value in use; a list without one opens on its
    // first row. Rows a selection in flight disabled cannot take the
    // keyboard; the trigger does, so the card's keys still reach the menu.
    const scope = intent === 'effort' ? flyoutRef.current : groupsRef.current
    const checked = scope?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
    const target = checked ?? scope?.querySelector<HTMLElement>(ROW_SELECTOR)
    ;(target ?? triggerRef.current)?.focus()
  }, [open, effortOpen, showSearch])

  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [available, open, filteredGroups])

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
    setEffortOpen(false)
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
    setEffortOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const closeAfterSelection = (): void => {
    setSelectionFocus(true)
    close(true)
  }

  const openEffort = (focus: boolean): void => {
    if (focus) focusIntent.current = 'effort'
    setEffortOpen(true)
  }

  /** Close the flyout, handing the keyboard back to the Effort row. */
  const closeEffort = (): void => {
    focusIntent.current = 'effortRow'
    setEffortOpen(false)
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
      if (effortOpen) closeEffort()
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
      closeEffort()
      return
    }
    if (event.key === 'ArrowRight' && event.target === effortRowRef.current) {
      event.preventDefault()
      openEffort(true)
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

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      closeAfterSelection()
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    submit(selection)
  }

  const waiting = currentChoice === undefined && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
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
    provider: ModelLabelOwner['provider'], model: ModelLabelOwner['model'],
    placement: ModelLabelOwner['placement'], selected: boolean,
  ) => (
    <span data-provider-id={provider.id} data-model-id={model.id}>
      {renderLabel({
        provider, model, placement, selected,
      }, model.badge === undefined ? model.name : (
        <span className={css.badgedName}>
          {placement === 'trigger' ? <><Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag>{' '}</> : null}
          <span className={css.badgedNameText}>{model.name}</span>
          {placement === 'trigger' ? null : <>{' '}<Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag></>}
        </span>
      ))}
    </span>
  )
  let modelIndex = 0

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
          {currentChoice === undefined ? modelLabel : renderModelLabel(currentChoice.group.provider, currentChoice.model, 'trigger', true)}
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
          role="group"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
          onMouseOver={(event) => {
            // Moving from the Effort row to another menu row folds the flyout away.
            if (effortOpen && event.target instanceof Element && event.target.closest('[data-effort-row]') === null) setEffortOpen(false)
          }}
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
          {state.failures.map(failure => (
            <div className={css.warning} key={failure.id}>
              <span>
                {failure.code === 'MISSING_CREDENTIAL'
                  ? t('warning.groupSignedOut', { name: failure.name })
                  : t('warning.groupLoad', { name: failure.name, message: failure.message })}
              </span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          ))}
          <div
            ref={groupsRef}
            id={`${id}-models`}
            className={clsx(css.groups, 'scrollable')}
            role="menu"
            aria-label={t('menu.model')}
            hidden={filteredGroups.length === 0}
          >
            {filteredGroups.map((group) => {
              return (
                <MenuGroup key={group.id} label={group.provider.name}>
                  {group.models.map((model) => {
                    const index = modelIndex++
                    const selected = state.current?.provider === group.id && state.current.model === model.id
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
                        key={model.id}
                        title={model.name}
                        disabled={busy}
                        onClick={() => { choose({ provider: group.id, model: model.id }) }}
                      >
                        <span className={css.optionCopy}>
                          <span className={css.modelName}>{renderModelLabel(group.provider, model, 'option', selected)}</span>
                        </span>
                        <span className={css.check}>
                          {/* An effort change keeps the model: only its effort row spins. */}
                          {!selected && pending?.provider === group.id && pending.model === model.id
                            ? <StateDot state="ongoing" />
                            : selected ? <IconCheckOutlineRegular /> : null}
                        </span>
                      </button>
                    )
                  })}
                </MenuGroup>
              )
            })}
          </div>
          {state.status === 'ready' && filteredGroups.length === 0 && (choices.length === 0
            ? <div className={css.empty}>
              <span role="status">{t('empty.models')}</span>
              {canOpenModelsSettings && <button type="button" className={css.emptyAction} onClick={() => { close(); openModelsSettings() }}>
                {t('empty.openModels')}
              </button>}
            </div>
            : <div className={css.empty} role="status">{t('search.empty')}</div>
          )}
          <div ref={footerRef} className={css.footer} role="menu" aria-label={t('menu.options')}>
            {reasoning !== undefined && (
              <button
                ref={effortRowRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={effortOpen}
                aria-controls={effortOpen ? `${id}-effort` : undefined}
                data-effort-row=""
                className={clsx(css.cell, effortOpen && css.cellOpen)}
                onMouseEnter={() => { if (!busy) openEffort(false) }}
                onClick={() => { if (effortOpen) closeEffort(); else openEffort(true) }}
              >
                <span className={css.cellLabel}>{t('menu.effort')}</span>
                <span className={css.cellValue}>{effortLabel}</span>
                <IconChevronRightOutlineRegular className={css.cellChevron} />
              </button>
            )}
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
                <IconLayersOutlineRegular className={css.manageIcon} />
                <span className={css.cellLabel}>{t('menu.manage')}</span>
              </button>
            )}
          </div>
        </MenuSurface>,
        document.body,
      )}
      {open && effortOpen && reasoning !== undefined && createPortal(
        <MenuSurface
          ref={flyoutRef}
          id={`${id}-effort`}
          className={css.flyout}
          style={anchorStyle}
          role="menu"
          aria-label={t('menu.effort')}
          aria-busy={busy}
          onMouseLeave={(event) => {
            if (event.relatedTarget instanceof Node && menuRef.current?.contains(event.relatedTarget) === true
              && effortRowRef.current?.contains(event.relatedTarget) !== true) setEffortOpen(false)
          }}
        >
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
            </div>
          )}
          {effortChoices.length === 0
            ? <div className={css.empty}>{t('empty.efforts')}</div>
            : effortChoices.map(level => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={effectiveEffort === level.effort}
                className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                key={level.key}
                disabled={busy}
                onClick={() => { chooseEffort(level.effort) }}
              >
                <span className={css.optionCopy}>
                  <span className={css.modelName}>{level.label}</span>
                </span>
                <span className={css.check}>
                  {pending !== null && pending.provider === state.current?.provider
                    && pending.model === state.current.model && pending.reasoningEffort === level.effort
                    ? <StateDot state="ongoing" />
                    : effectiveEffort === level.effort ? <IconCheckOutlineRegular /> : null}
                </span>
              </button>
            ))}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={placement === 'composer' ? rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null : triggerRef.current}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
