/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows. A pending group keeps showing the items it already had (the reducer
 * retains them across a query refinement) and falls back to two skeleton
 * rows only while it has none; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox). A full-width row reads title, then the
 * command-name alias when the title is not the name in another letter case
 * (a localized title), then the description right-aligned. Command, skill and
 * subagent menus are compact instead: a narrow list of titles whose highlighted
 * description opens in a bubble beside the list. Both fade at a scrolled edge.
 * A source publishing crumbs gets a breadcrumb
 * header pinned above the scrolling list.
 */
import { MenuSurface } from '@janhq/jan-client-ui-primitives'
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconChevronRightOutlineRegular, ReferenceIconRegular, useAnchoredMaxHeight } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import css from './MenuView.module.css'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'

/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Height cap that fits the two headings and eight built-in command rows. */
const MAX_HEIGHT = 400

/**
 * Viewport top margin: the conversation header's 76px block (title row plus
 * view tabs, ui-conversation) plus 8px of air, so a tall list stops below the
 * header instead of sliding under it.
 */
const TOP_MARGIN = 84

/**
 * Sources whose rows are short names (commands, skills, subagents). Their menu is a narrow
 * list of names; the highlighted row's description opens in a bubble beside it instead of
 * being squeezed onto the row. Path sources (file mentions) keep the full-width rows.
 */
const COMPACT_SOURCES: ReadonlySet<string> = new Set(['command', 'skill', 'subagent'])

/** Gap between the compact menu and its description bubble. */
const TIP_GAP = 6

/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source: string, index: number): string {
  return `jan-slash-option-${source}-${index}`
}

/** Description bubble placement, in the overlay anchor's coordinates. */
interface TipPlace {
  readonly left: number
  readonly top: number
  readonly bottom: number
  readonly text: string
}

/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export function MenuView({ menu, headers, onPick, onCrumb, onHover, onDismiss, t }: MenuViewProps) {
  const state = useSyncExternalStore(
    fn => menu.subscribe(fn),
    () => menu.getSnapshot(),
  )
  const crumbs = useSyncExternalStore(
    fn => headers.subscribe(fn),
    () => headers.getSnapshot(),
  )
  const listRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<{ above: boolean; below: boolean }>({ above: false, below: false })
  const [tip, setTip] = useState<TipPlace | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // The list is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update (the anchor moves
  // when the composer grows).
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state, TOP_MARGIN)
  const highlight = state.open ? state.highlight : null
  const compact = state.open && state.hit?.arguments !== true
    && state.groups.length > 0 && state.groups.every(group => COMPACT_SOURCES.has(group.source))
  const description = highlight === null || !state.open
    ? undefined
    : state.groups.find(group => group.source === highlight.source)?.items[highlight.index]?.description
  // Read the scroll edges for the fades, and seat the bubble beside the highlighted row.
  const measure = useCallback(() => {
    const viewport = viewportRef.current
    const above = viewport !== null && viewport.scrollTop > 1
    const below = viewport !== null && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
    setOverflow(prev => prev.above === above && prev.below === below ? prev : { above, below })
    const menuEl = listRef.current
    const parent = menuEl?.offsetParent
    const row = highlight === null ? null : document.getElementById(optionId(highlight.source, highlight.index))
    if (!compact || description === undefined || menuEl == null || row === null || !(parent instanceof HTMLElement)) {
      setTip(null)
      return
    }
    const p = parent.getBoundingClientRect(), m = menuEl.getBoundingClientRect(), r = row.getBoundingClientRect()
    // A row scrolled partly out of the list pins the bubble to the list's visible edge.
    setTip({
      left: m.right - p.left + TIP_GAP,
      top: Math.min(Math.max(r.top, m.top), m.bottom - r.height) - p.top,
      bottom: m.bottom - p.top,
      text: description,
    })
  }, [compact, description, highlight])
  // Focus stays in the textarea (combobox pattern), so the browser never
  // scrolls the active option into view on keyboard moves; do it here,
  // before the bubble measures the row.
  useLayoutEffect(() => {
    if (highlight === null) return
    document.getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  useLayoutEffect(() => {
    measure()
  }, [state, maxHeight, measure])
  // A long description grows downward from its row; lift it so it never hangs below the list.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (el === null || tip === null) return
    // The list sits above the overlay anchor, so these coordinates are negative; no floor at 0.
    el.style.top = `${String(Math.min(tip.top, tip.bottom - el.offsetHeight))}px`
  }, [tip])
  // Dismiss on pointer outside the menu AND outside the composer card
  // (clicking the textarea or bottom bar must not close the menu).
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (listRef.current?.contains(ev.target)) return
      const composerCard = listRef.current?.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, onDismiss])
  if (!state.open) return null
  return (
    <>
      {/* The listbox role sits on the scrolling viewport, not this shell: a
        breadcrumb header is not an option, and a listbox may not carry one. */}
      <MenuSurface
        ref={listRef}
        className={css.menu}
        style={{ maxHeight }}
        data-trigger-menu=""
        data-compact={compact || undefined}
        data-overflow-above={overflow.above || undefined}
        data-overflow-below={overflow.below || undefined}
      >
        {state.groups.map((group) => {
          const trail = crumbs.get(group.source)
          return trail === undefined ? null : (
            <nav key={group.source} className={css.crumbs} aria-label={t('crumbs.aria')}>
              {trail.map((crumb, index) => (
                <Fragment key={`${String(index)}-${crumb.value}`}>
                  {index > 0 && <span className={css.crumbSeparator} aria-hidden><IconChevronRightOutlineRegular /></span>}
                  <button
                    type="button"
                    className={clsx(css.crumb, crumb.current === true && css.crumbCurrent)}
                    aria-current={crumb.current === true ? 'location' : undefined}
                    disabled={crumb.current === true}
                    // mousedown, not click: the composer keeps focus, same as a row.
                    onMouseDown={(ev) => {
                      ev.preventDefault()
                      onCrumb(group.source, index)
                    }}
                  >
                    {crumb.label}
                  </button>
                </Fragment>
              ))}
            </nav>
          )
        })}
        <div
          ref={viewportRef}
          className={css.viewport}
          role="listbox"
          aria-label={t('suggestions.aria')}
          aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : undefined}
          onScroll={measure}
        >
          {state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
            ? null
            : (
              <Fragment key={group.source}>
                {/* Source names key the dictionary open-endedly: the lookup chain
                  returns an unknown key verbatim, so an unregistered source
                  shows its raw name — hence the cast past the typed key union. */}
                {group.showGroupTitle === false || group.items.some(item => item.section !== undefined)
                  ? null
                  : <div className={css.groupTitle} role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>}
                {group.status === 'pending' && group.items.length === 0
                  ? (
                    <div role="status" aria-label={t('loading')} data-source={group.source}>
                      <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '32%' }} /></div>
                      <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '48%' }} /></div>
                    </div>
                  )
                  : group.items.map((item, index) => {
                    const active = highlight !== null && highlight.source === group.source && highlight.index === index
                    return (
                      <Fragment key={optionId(group.source, index)}>
                        {item.section !== undefined && item.section !== group.items[index - 1]?.section
                          ? <div className={css.sectionTitle} role="presentation">{item.section}</div>
                          : null}
                        <button
                          id={optionId(group.source, index)}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={clsx(css.item, active && css.active)}
                          // mousedown, not click: the textarea keeps focus (combobox
                          // pattern) — preventing default stops the focus steal, and the
                          // pick runs before any blur-driven teardown.
                          onMouseDown={(ev) => {
                            ev.preventDefault()
                            onPick(group.source, index)
                          }}
                          // mousemove, not mouseenter: real pointer motion moves the
                          // shared highlight; keyboard scrolling rows under a resting
                          // pointer must not steal it back.
                          onMouseMove={active ? undefined : () => { onHover(group.source, index) }}
                        >
                          {item.icon !== undefined && (
                            <span className={css.itemIcon} aria-hidden>
                              {typeof item.icon === 'string'
                                ? <ReferenceIconRegular kind={item.icon} size={14} />
                                : <item.icon size={14} />}
                            </span>
                          )}
                          <span className={css.itemName}>{item.label ?? item.name}</span>
                          {compact && item.description !== undefined && <span className={css.srOnly}>{item.description}</span>}
                          {!compact && item.label !== undefined && item.label.toLowerCase() !== item.name.toLowerCase() && (
                            <span className={css.itemAlias}>{item.name}</span>
                          )}
                          {!compact && item.description !== undefined && <span className={css.itemDescription}>{item.description}</span>}
                          {item.drill === true && (
                            <span className={css.trailing}>
                              {/* Visual hint only: Tab drills the highlighted row (the
                                keyboard twin of the chevron, which owns the aria label). */}
                              <span className={css.drillHintText} aria-hidden>{t('drill.hint')}</span>
                              <kbd className={css.drillHint} aria-hidden>{t('drill.key')}</kbd>
                              <span
                                role="button"
                                aria-label={t('drill.aria')}
                                className={css.drill}
                                // mousedown so the composer keeps focus, same as the row;
                                // stopPropagation keeps the row's settling pick out of it.
                                onMouseDown={(ev) => {
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  onPick(group.source, index, 'drill')
                                }}
                              >
                                <IconChevronRightOutlineRegular size={12} />
                              </span>
                            </span>
                          )}
                        </button>
                      </Fragment>
                    )
                  })}
              </Fragment>
            ))}
        </div>
      </MenuSurface>
      {tip !== null && (
      // Visual twin of the row's description; screen readers already reach it through the
      // option, so the bubble stays out of the accessibility tree.
        <div ref={tipRef} className={css.tip} style={{ left: tip.left, top: tip.top }} aria-hidden>
          {tip.text}
        </div>
      )}
    </>
  )
}
