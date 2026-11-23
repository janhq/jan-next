/** Search field and listbox sharing DOM focus through aria-activedescendant. */
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { IconCloseOutlineRegular, IconSearchOutlineRegular, Input, MenuSurface, Tooltip } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import { filterSettings, type SettingsSearchTarget } from './settings-search.ts'
import css from './SettingsRoot.module.css'

interface Props extends PropsLocale<'settings'> {
  targets: readonly SettingsSearchTarget[]
  query: string
  setQuery: (query: string) => void
  inputRef: RefObject<HTMLInputElement>
  isComposing: (event: globalThis.KeyboardEvent) => boolean
  shortcut: string
  onSelect: (target: SettingsSearchTarget) => void
}

/**
 * Render the search field and the list replacing the nav while a query is entered.
 * @param props - live titled targets, local input ownership and selection callback.
 * @returns the search control and its inline results.
 */
export function SettingsSearch({ targets, query, setQuery, inputRef, isComposing, shortcut, onSelect, t }: Props) {
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<SettingsSearchTarget>()
  const searching = query.trim() !== ''
  const results = useMemo(() => searching ? filterSettings(targets, query) : [], [searching, targets, query])
  const index = active === undefined ? -1 : results.indexOf(active)
  const activeId = index < 0 ? undefined : `${listId}-${index}`
  const expanded = results.length > 0

  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!expanded || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter')
      || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey
      || isComposing(event.nativeEvent)) return
    event.preventDefault()
    if (event.key === 'Enter') {
      const target = results[Math.max(0, index)]
      if (target !== undefined && !event.repeat) onSelect(target)
      return
    }
    const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? results.length - 1 : index - 1
    setActive(results[(next + results.length) % results.length])
  }

  return <>
    <div className={css.searchField}>
      <Input ref={inputRef} className={css.searchInput ?? ''} icon={<IconSearchOutlineRegular size={16} />}
        data-settings-search="" type="text" role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-label={t('search.label')} placeholder={t('search.label')} aria-keyshortcuts={shortcut}
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={activeId}
        value={query} onKeyDown={onKeyDown} onChange={(event) => { setActive(undefined); setQuery(event.target.value) }} />
      {query !== '' && <Tooltip label={t('search.clear')} side="bottom">
        <button type="button" className={css.searchClear} aria-label={t('search.clear')}
          onClick={() => { setActive(undefined); setQuery(''); inputRef.current?.focus() }}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </Tooltip>}
    </div>
    {expanded && <MenuSurface compact id={listId} ref={list} role="listbox" aria-label={t('search.results')} className={css.searchResults}>
      {results.map((target, position) => <div id={`${listId}-${position}`}
        key={JSON.stringify([target.sectionId, target.destination])} role="option"
        aria-labelledby={`${listId}-${position}-title`}
        aria-describedby={target.destination.kind === 'row' ? `${listId}-${position}-section` : undefined}
        aria-selected={position === index} className={css.searchOption}
        onMouseDown={(event) => { event.preventDefault() }} onClick={() => { onSelect(target) }}>
        <span id={`${listId}-${position}-title`}>{target.title}</span>
        {target.destination.kind === 'row' && <span id={`${listId}-${position}-section`} className={css.searchSection}>{target.sectionTitle}</span>}
      </div>)}
    </MenuSurface>}
    {searching && !expanded && <div role="status" className={css.searchMessage}>{t('search.empty')}</div>}
  </>
}
