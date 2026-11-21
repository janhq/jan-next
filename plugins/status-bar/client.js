// Browser half of the status bar, hand-written for the client module loader.
// The bar occupies `shell.bottom` and declares two list slots, `statusbar.left`
// and `statusbar.right`, that any plugin can register items into. Every item
// gets the shared `StatusItem` component and the `useSystemLoad` / `useKeepAwake`
// hooks from the slot itself, so an outside item looks and behaves like Jan's own.
window.__ModuleLoader__.load({
  id: '@janhq/jan-status-bar',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef, useCallback } = React
    const { Menu, Switch, Tooltip } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-status-bar'
    const API = '/jan-api/status-bar'
    const SLOTS = { left: 'statusbar.left', right: 'statusbar.right' }
    const SETTINGS_SLOT = 'plugins.item'
    const ACTIONS_SLOT = 'plugins.detail.actions'
    const AWAKE_POLL_MS = 5000
    const DRAG_TYPE = 'application/x-jan-status-item'
    const EMPTY = {}

    const CSS = `
/* No fill, no rule: the bar sits on the window ground. Under the Jan theme it shares the chat column
   with the conversation and its bottom edge lines up with the floating sidebar card's. */
.jsb-bar { display: flex; align-items: stretch; justify-content: space-between; gap: 8px; height: 20px; padding: 0 var(--jt-sidebar-gap, 6px);
  margin-bottom: var(--jt-sidebar-gap, 0px); box-sizing: border-box; background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 14px; user-select: none; overflow: hidden; }
.jsb-side { display: flex; align-items: stretch; min-width: 0; }
.jsb-side[data-side='right'] { justify-content: flex-end; }
.jsb-slot { display: flex; align-items: stretch; min-width: 0; }
.jsb-slot[data-drop='before'] { box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary); }
.jsb-slot[data-drop='after'] { box-shadow: inset -2px 0 0 var(--dsw-alias-state-business-primary); }
.jsb-slot[data-dragging] { opacity: 0.4; }
.jsb-item { display: inline-flex; align-items: center; gap: 4px; height: 100%; padding: 0 6px; border: 0; border-radius: 6px; background: transparent;
  color: inherit; font: inherit; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: default; }
button.jsb-item { cursor: pointer; }
button.jsb-item:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
button.jsb-item:active { background: var(--dsw-alias-interactive-bg-active); }
.jsb-item:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.jsb-icon { display: inline-flex; flex: none; width: 12px; height: 12px; }
.jsb-icon svg { width: 12px; height: 12px; }
.jsb-icon[data-on] { color: var(--dsw-alias-state-success-primary); }
.jsb-icon[data-error] { color: var(--dsw-alias-state-error-primary); }
/* Load readings hold one width as they tick between one and two digits. */
.jsb-text[data-level] { min-width: 3ch; text-align: right; }
.jsb-text[data-level='warn'] { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); }
.jsb-text[data-level='critical'] { color: var(--dsw-alias-state-error-primary); }
.jsb-meter { position: relative; flex: none; width: 18px; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l3); overflow: hidden; }
.jsb-meter > span { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--dsw-alias-state-success-primary);
  transition: width 300ms var(--ds-ease-out, ease-out), background-color 300ms var(--ds-ease-out, ease-out); }
.jsb-meter[data-level='warn'] > span { background: var(--dsw-alias-state-warn-primary); }
.jsb-meter[data-level='critical'] > span { background: var(--dsw-alias-state-error-primary); }
.jsb-choice { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
.jsb-choice-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
@media (prefers-reduced-motion: reduce) { .jsb-meter > span { transition: none; } }
`

    // Lucide-style glyphs at 14px; stroke follows the item's text colour.
    const GLYPHS = {
      cpu: 'M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9 9h6v6H9z',
      memory: 'M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9M2 15h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8z',
      gpu: 'M2 21V3M2 5h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2M7 17v3a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-3M16 8.5a2.5 2.5 0 1 0 0 3M8 8.5a2.5 2.5 0 1 0 0 3',
      coffee: 'M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2',
      activity: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
      link: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
      clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
    }
    const glyph = name => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: GLYPHS[name] }))

    async function api(method) {
      const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: {} }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `Status bar request failed (${response.status}).`)
      return body.result
    }

    /** A snapshot source that starts `poll` while anyone subscribes and the window is visible. */
    function createPolledSource(initial, poll, delay) {
      let value = initial
      let timer
      let running = false
      const listeners = new Set()
      const set = next => { value = next; for (const listener of listeners) listener() }
      async function tick() {
        timer = undefined
        if (!running || document.visibilityState === 'hidden') return
        await poll(value, set)
        if (running && timer === undefined) timer = setTimeout(tick, delay())
      }
      const onVisible = () => { if (document.visibilityState === 'visible' && timer === undefined && running) void tick() }
      return {
        getSnapshot: () => value,
        set,
        refresh: () => { if (running) { clearTimeout(timer); timer = undefined; void tick() } },
        subscribe(listener) {
          listeners.add(listener)
          if (!running) {
            running = true
            document.addEventListener('visibilitychange', onVisible)
            void tick()
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size > 0) return
            running = false
            clearTimeout(timer)
            timer = undefined
            document.removeEventListener('visibilitychange', onVisible)
          }
        },
      }
    }

    // ---- Shared item component ----

    /**
     * One status bar item. Pass `onClick` to make it a button; omit it for a plain readout.
     * `percent` draws a small meter coloured by `level`; `level` also colours the text.
     */
    function StatusItem({ icon, iconState, text, tooltip, level, percent, onClick, ariaLabel, compact, children, buttonRef, ...rest }) {
      const content = [
        icon ? h('span', { className: 'jsb-icon', key: 'icon', 'data-on': iconState === 'on' || undefined, 'data-error': iconState === 'error' || undefined },
          typeof icon === 'string' && GLYPHS[icon] ? glyph(icon) : icon) : null,
        typeof percent === 'number' ? h('span', { className: 'jsb-meter', 'data-level': level, key: 'meter' }, h('span', { style: { width: `${Math.max(4, percent)}%` } })) : null,
        text !== undefined && text !== null && !compact ? h('span', { className: 'jsb-text', 'data-level': level, key: 'text' }, text) : null,
        children ?? null,
      ]
      const label = ariaLabel ?? (typeof tooltip === 'string' ? tooltip : undefined)
      const element = onClick
        ? h('button', { ...rest, ref: buttonRef, type: 'button', className: 'jsb-item', 'aria-label': label, onClick }, ...content)
        : h('span', { ...rest, ref: buttonRef, className: 'jsb-item', role: 'status', 'aria-label': label, tabIndex: tooltip ? 0 : undefined }, ...content)
      return tooltip ? h(Tooltip, { label: tooltip, side: 'top', delayMs: 300 }, element) : element
    }

    // ---- Built-in items ----

    function useLoadLevel(useStatusBarSettings, layout, percent) {
      const warnAt = useStatusBarSettings(s => s.value?.warnAt ?? 60)
      const criticalAt = useStatusBarSettings(s => s.value?.criticalAt ?? 85)
      return layout.levelOf(percent, warnAt, criticalAt)
    }

    function loadTip(t, load, ready) {
      if (load.status === 'failed') return t('load.failed')
      return load.status === 'ready' ? ready(load.value) : t('load.waiting')
    }

    const percentText = percent => (typeof percent === 'number' ? `${Math.round(percent)}%` : '-')

    function CpuItem({ t, compact, StatusItem: Item, useSystemLoad, useStatusBarSettings, layout }) {
      const load = useSystemLoad(s => s)
      const percent = load.value?.cpu ?? undefined
      const level = useLoadLevel(useStatusBarSettings, layout, percent)
      return h(Item, { icon: 'cpu', text: percentText(percent), level, compact,
        tooltip: loadTip(t, load, value => t('cpu.tip', { percent: Math.round(value.cpu ?? 0) })) })
    }

    function MemoryItem({ t, compact, StatusItem: Item, useSystemLoad, useStatusBarSettings, layout }) {
      const load = useSystemLoad(s => s)
      const memory = load.value?.memory
      const percent = memory?.percent
      const level = useLoadLevel(useStatusBarSettings, layout, percent)
      // The percentage keeps the readings one width; used and total GB are in the tooltip.
      return h(Item, { icon: 'memory', text: percentText(percent), level, compact,
        tooltip: loadTip(t, load, value => value.memory
          ? t('memory.tip', { used: layout.formatBytes(value.memory.used), total: layout.formatBytes(value.memory.total), percent: Math.round(value.memory.percent), app: layout.formatBytes(value.process) })
          : t('load.failed')) })
    }

    function GpuItem({ t, compact, StatusItem: Item, useSystemLoad, useStatusBarSettings, layout }) {
      const load = useSystemLoad(s => s)
      const gpu = load.value?.gpu
      const percent = gpu?.percent
      const level = useLoadLevel(useStatusBarSettings, layout, percent)
      return h(Item, { icon: 'gpu', text: percentText(percent), level, compact,
        tooltip: loadTip(t, load, value => value.gpu ? t('gpu.tip', { percent: Math.round(value.gpu.percent) }) : t('gpu.none')) })
    }

    function AwakeItem({ t, compact, StatusItem: Item, useKeepAwake, useStatusBarSettings, setAwake }) {
      const mode = useStatusBarSettings(s => s.value?.awake ?? 'off')
      const writable = useStatusBarSettings(s => s.status === 'ready' && s.writable)
      const host = useKeepAwake(s => s)
      const [open, setOpen] = useState(false)
      const anchor = useRef(null)
      const failed = host.error !== null && host.error !== undefined && host.mode === mode
      const state = failed ? (host.error === 'unsupported' ? t('awake.unsupported') : t('awake.failed'))
        : mode === 'off' ? t('awake.offHint') : host.active ? t('awake.active') : t('awake.idle')
      const choice = id => h('span', { className: 'jsb-choice' }, t(`awake.${id}`), h('span', { className: 'jsb-choice-hint' }, t(`awake.${id}Hint`)))
      const header = `${t('awake.title')} - ${t(`awake.${mode}`)}${mode === 'off' ? '' : ` - ${host.active ? t('awake.active') : t('awake.idle')}`}`
      return h(Menu, {
        open, anchorRef: anchor, side: 'top', align: 'start', portal: true, selection: 'check', selectedId: mode, returnFocus: () => anchor.current,
        items: [{ type: 'label', id: 'header', text: header }, ...['on', 'agent', 'off'].map(id => ({ id, label: choice(id), disabled: !writable }))],
        onSelect: id => { setOpen(false); void setAwake(id) },
        onClose: () => setOpen(false),
        // The cup turns green while the blocker holds the machine awake, red if it failed.
        anchor: h(Item, { buttonRef: anchor, icon: 'coffee', iconState: failed ? 'error' : host.active ? 'on' : undefined,
          text: t(`awake.${mode}`), compact, tooltip: `${t('awake.title')}: ${state}`,
          'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(value => !value) }),
      })
    }

    function ActivityItem({ t, compact, StatusItem: Item, useSessionStatus, layout, openSession }) {
      const statuses = useSessionStatus(s => s)
      const { working, waiting, next } = layout.attention(statuses)
      const parts = [working ? t('activity.working', { count: working }) : null, waiting ? t('activity.waiting', { count: waiting }) : null].filter(Boolean)
      const text = parts.length ? parts.join(' - ') : t('activity.idle')
      return h(Item, { icon: 'activity', text, compact, level: waiting ? 'warn' : undefined,
        tooltip: next ? `${text}. ${t('activity.open')}` : text, onClick: next ? () => openSession(next) : undefined })
    }

    function ConnectionItem({ t, compact, StatusItem: Item, useConnectionState, reconnect }) {
      const state = useConnectionState(s => s) ?? 'connecting'
      return h(Item, { icon: 'link', text: t(`connection.${state}`), compact, level: state === 'disconnected' ? 'critical' : undefined,
        tooltip: t(`connection.${state}`), onClick: state === 'disconnected' ? reconnect : undefined })
    }

    function ClockItem({ compact, StatusItem: Item }) {
      const [now, setNow] = useState(() => new Date())
      React.useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 15_000)
        return () => clearInterval(id)
      }, [])
      const text = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      return h(Item, { icon: 'clock', text, compact, tooltip: now.toLocaleString() })
    }

    // ---- The bar ----

    function StatusBar(props) {
      const { t, renderSlot, useStatusBarSettings, useItemEntries, layout, saveItems, setPreference, openSettings } = props
      const settings = useStatusBarSettings(s => s)
      const entries = useItemEntries(s => s)
      const placements = settings.value?.items ?? EMPTY
      const items = layout.arrange(entries, placements)
      const compact = settings.value?.compact === true
      const writable = settings.status === 'ready' && settings.writable
      const [menu, setMenu] = useState(null)
      const [drag, setDrag] = useState(null)
      const barRef = useRef(null)

      const onContextMenu = useCallback(event => {
        event.preventDefault()
        const slot = event.target.closest?.('[data-item-id]')
        setMenu({ x: event.clientX, y: event.clientY, id: slot?.dataset.itemId })
      }, [])

      if (settings.status !== 'ready' || settings.value?.visible === false) return null

      const nameOf = item => entries.labels[item.id] ?? item.id
      const target = menu?.id ? items.find(item => item.id === menu.id) : undefined
      const menuItems = [
        ...target ? [
          { id: 'hide-item', label: t('menu.hideItem', { name: nameOf(target) }) },
          target.side === 'left' ? { id: 'move-right', label: t('menu.moveRight') } : { id: 'move-left', label: t('menu.moveLeft') },
          { type: 'separator', id: 'item-separator' },
        ] : [],
        { type: 'label', id: 'items-label', text: t('menu.items') },
        ...items.map(item => ({ id: `toggle:${item.id}`, label: nameOf(item), disabled: !writable })),
        { type: 'separator', id: 'bar-separator' },
        { id: 'compact', label: t('menu.compact'), disabled: !writable },
        { id: 'hide-bar', label: t('menu.hideBar'), disabled: !writable },
        { id: 'settings', label: t('menu.settings') },
      ]
      const selectedIds = [...items.filter(item => !item.hidden).map(item => `toggle:${item.id}`), ...compact ? ['compact'] : []]
      const select = id => {
        setMenu(null)
        if (id === 'settings') openSettings()
        else if (id === 'hide-bar') void setPreference('visible', false)
        else if (id === 'compact') void setPreference('compact', !compact)
        else if (id === 'hide-item' && target) void saveItems([{ op: 'set', path: ['items', target.id, 'hidden'], value: true }])
        else if ((id === 'move-left' || id === 'move-right') && target) {
          const side = id === 'move-left' ? 'left' : 'right'
          void saveItems(layout.placeAt(items, target.id, side, side === 'left' ? Infinity : 0))
        } else if (id.startsWith('toggle:')) {
          const item = items.find(entry => `toggle:${entry.id}` === id)
          if (item) void saveItems([{ op: 'set', path: ['items', item.id, 'hidden'], value: !item.hidden }])
        }
      }

      const dropAt = (event, side, index) => {
        event.preventDefault()
        const id = drag?.id ?? event.dataTransfer.getData(DRAG_TYPE)
        setDrag(null)
        if (!id || !writable) return
        void saveItems(layout.placeAt(items, id, side, index))
      }

      const renderSide = side => {
        const row = items.filter(item => item.side === side && !item.hidden)
        return h('div', {
          className: 'jsb-side', 'data-side': side,
          onDragOver: event => { if (drag) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } },
          onDrop: event => dropAt(event, side, row.filter(item => item.id !== drag?.id).length),
        }, row.map(item => {
          const index = row.filter(other => other.id !== drag?.id).indexOf(item)
          const hint = drag?.over === item.id ? drag.where : undefined
          return h('div', {
            key: item.id, className: 'jsb-slot', 'data-item-id': item.id, draggable: writable,
            'data-drop': hint, 'data-dragging': drag?.id === item.id || undefined,
            onDragStart: event => { event.dataTransfer.setData(DRAG_TYPE, item.id); event.dataTransfer.effectAllowed = 'move'; setDrag({ id: item.id }) },
            onDragEnd: () => setDrag(null),
            onDragOver: event => {
              if (!drag || drag.id === item.id) return
              event.preventDefault()
              event.stopPropagation()
              const box = event.currentTarget.getBoundingClientRect()
              const where = event.clientX < box.left + box.width / 2 ? 'before' : 'after'
              if (drag.over !== item.id || drag.where !== where) setDrag({ ...drag, over: item.id, where })
            },
            onDrop: event => {
              event.stopPropagation()
              const position = index < 0 ? row.length : index + (drag?.where === 'after' ? 1 : 0)
              dropAt(event, side, position)
            },
          }, renderSlot(SLOTS[item.slot], { compact, side }, { only: item.id }))
        }))
      }

      return h('footer', { ref: barRef, className: 'jsb-bar', role: 'toolbar', 'aria-label': t('aria'), onContextMenu },
        renderSide('left'), renderSide('right'),
        menu && h(Menu, {
          open: true, anchor: null, portal: true, contextual: true, autoFocus: true, anchorPoint: { x: menu.x, y: menu.y },
          selection: 'check', selectedIds, items: menuItems, onSelect: select, onClose: () => setMenu(null), returnFocus: () => barRef.current,
        }))
    }

    // The settings page is its own chunk: nothing of it loads until Settings opens it.
    function SettingsItem({ view, loadSettingsPage, ...props }) {
      const [Page, setPage] = useState(() => loadSettingsPage.loaded)
      React.useEffect(() => {
        if (view === 'summary' || Page) return
        let active = true
        void loadSettingsPage().then(loaded => { if (active) setPage(() => loaded) })
        return () => { active = false }
      }, [view, Page, loadSettingsPage])
      if (view === 'summary') return props.t('summary')
      return Page ? h(Page, props) : null
    }

    function MasterAction({ subject, t, useStatusBarSettings, setPreference }) {
      const snapshot = useStatusBarSettings(s => s)
      if (subject.kind !== 'item' || subject.id !== NS) return null
      return h(Switch, { label: t('settings.master'), checked: snapshot.value?.visible !== false,
        disabled: snapshot.status !== 'ready' || !snapshot.writable, onChange: next => { void setPreference('visible', next) } })
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'configForms', 'shortcuts'],
      apply(ctx) {
        let live = true
        ctx.effect(() => () => { live = false })
        const logger = ctx.logger(NS)
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@janhq/jan-status-bar'
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        })

        void Promise.all([require.async('./client.locale.js'), require.async('./client.layout.js')]).then(([{ dictionaries }, layout]) => {
          if (live) start(layout, dictionaries)
        }, error => { logger.error(error) })

        function start(layout, dictionaries) {
          ctx.effect(() => ctx.locale.register(NS, dictionaries))
          const t = ctx.locale.bind(NS)
          const form = ctx.configForms.get(NS)
          const connection = ctx.get('connection')
          const settingsValue = () => form.getSnapshot().value

          const systemLoad = createPolledSource({ status: 'waiting', value: undefined }, async (previous, set) => {
            try { set({ status: 'ready', value: await api('resources') }) }
            catch { set({ status: 'failed', value: previous.value }) }
          }, () => 1000 * (settingsValue()?.interval ?? 2))
          const keepAwake = createPolledSource({ mode: 'off', active: false, working: 0, error: null }, async (_previous, set) => {
            try { set(await api('awake')) } catch { /* The next tick retries; the item keeps its last state. */ }
          }, () => AWAKE_POLL_MS)

          // Items and their labels, as one snapshot that changes only when a slot or the locale changes.
          let entriesKey = ''
          let entries = { left: [], right: [], labels: {} }
          const readEntries = () => {
            const key = `${ctx.slots.getVersion(SLOTS.left)}:${ctx.slots.getVersion(SLOTS.right)}:${ctx.locale.getSnapshot().revision}`
            if (key === entriesKey) return entries
            entriesKey = key
            const left = ctx.slots.entries(SLOTS.left)
            const right = ctx.slots.entries(SLOTS.right)
            const labels = {}
            for (const entry of [...left, ...right]) {
              const { id, label } = entry.options
              if (id) labels[id] = typeof label === 'function' ? label() : label ?? id
            }
            entries = { left, right, labels }
            return entries
          }
          const itemEntries = {
            getSnapshot: readEntries,
            subscribe(listener) {
              const offs = [ctx.slots.subscribe(SLOTS.left, listener), ctx.slots.subscribe(SLOTS.right, listener), ctx.locale.subscribe(listener)]
              return () => { for (const off of offs) off() }
            },
          }

          const setPreference = (field, value) => form.set(field, value).catch(error => { logger.error(error); return false })
          const saveItems = ops => ops.length
            ? form.mutate(ops, form.getSnapshot().revision).catch(error => { logger.error(error); return false })
            : Promise.resolve(true)
          const setAwake = mode => setPreference('awake', mode).then(saved => { keepAwake.refresh(); return saved })
          const openSettings = () => { ctx.get('pluginNavigation')?.openItem(NS) }
          const loadSettingsPage = () => require.async('./client.settings.js').then(module => {
            loadSettingsPage.loaded ??= module.createSettingsPage(require)
            return loadSettingsPage.loaded
          })

          const hooks = { statusBarSettings: form, systemLoad, keepAwake }
          const slotFace = { StatusItem, hooks }

          ctx.slots.inject('shell.bottom', () => ctx.slots.register({
            name: 'shell.bottom', locale: NS,
            children: {
              [SLOTS.left]: { kind: 'list', scope: 'root', inline: true, inject: slotFace },
              [SLOTS.right]: { kind: 'list', scope: 'root', inline: true, inject: slotFace },
            },
            inject: () => ({ hooks: { statusBarSettings: form, itemEntries }, layout, saveItems, setPreference, openSettings }),
          }, StatusBar))

          const builtIns = [
            // Everything starts on the right, next to the conversation; the left side holds only what the user moves there.
            ['right', 'jan.activity', 10, 'item.activity', ActivityItem, { layout, openSession: id => ctx.get('uiWorkspace')?.openSession(id) }],
            ['right', 'jan.connection', 20, 'item.connection', ConnectionItem,
              { hooks: { connectionState: connection?.state ?? { getSnapshot: () => 'connected', subscribe: () => () => {} } }, reconnect: () => connection?.reconnect() }],
            ['right', 'jan.awake', 30, 'item.awake', AwakeItem, { setAwake }],
            ['right', 'jan.cpu', 40, 'item.cpu', CpuItem, { layout }],
            ['right', 'jan.memory', 50, 'item.memory', MemoryItem, { layout }],
            ['right', 'jan.gpu', 60, 'item.gpu', GpuItem, { layout }],
            ['right', 'jan.clock', 70, 'item.clock', ClockItem, {}],
          ]
          for (const [side, id, order, label, Component, injected] of builtIns) {
            ctx.slots.inject(SLOTS[side], () => ctx.slots.register({
              name: SLOTS[side], id, order, label: () => t(label), locale: NS, inject: () => injected,
            }, Component))
          }

          ctx.effect(() => ctx.shortcuts.register({
            id: 'statusBar.toggle', label: () => t('toggle'), aliases: ['status bar', 'statusbar', 'bottom bar'],
            defaults: {}, regions: ['page', 'editable'], modals: [],
            resolve: () => ({ status: 'handled', run: () => { void setPreference('visible', settingsValue()?.visible === false) } }),
          }))

          ctx.effect(() => ctx.configForms.whileServed([NS], () => {
            const clearItem = ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
              name: SETTINGS_SLOT, id: NS, order: 55, label: () => t('title'), locale: NS,
              inject: () => ({ hooks: { statusBarSettings: form, itemEntries }, layout, saveItems, setPreference, loadSettingsPage }),
            }, SettingsItem))
            const clearActions = ctx.slots.inject(ACTIONS_SLOT, () => ctx.slots.register({
              name: ACTIONS_SLOT, id: NS, locale: NS, inject: () => ({ hooks: { statusBarSettings: form }, setPreference }),
            }, MasterAction))
            return () => { clearActions(); clearItem() }
          }))
        }
      },
    }
  },
})
