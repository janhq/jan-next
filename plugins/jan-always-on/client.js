window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on',
  factory(require) {
    const { createElement: h, useEffect } = require('react')
    const { createSnapshotStore } = require('@janhq/jan-client-store')
    // The sidebar draws panel glyphs at 16px on labelled rows and 18px on the rail;
    // labelled rows take the Medium (1.3px) line like Jan's other row icons.
    const BotGlyph = ({ size }) => h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
      h('path', { d: 'M6 2.5h4M8 2.5V5M3 6.5A1.5 1.5 0 014.5 5h7A1.5 1.5 0 0113 6.5v5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 11.5zM5.5 9h1m3 0h1',
        fill: 'none', stroke: 'currentColor', strokeWidth: size < 18 ? 1.3 : 1, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    // Under the document base, so a Jan served below a proxy prefix reaches its own mount.
    const PANEL = 'jan-always-on', PATH = new URL('jan-api/always-on', document.baseURI).href, TAB = 'botDetails'
    const title = { en: 'Bots', zh: '机器人', ja: 'ボット', es: 'Bots', fr: 'Bots', de: 'Bots', ru: 'Боты', pt: 'Bots' }
    const modes = {
      en: ['Bots mode', 'Create a bot with one ongoing chat.'], zh: ['机器人模式', '创建一个拥有持续聊天的机器人。'],
      ja: ['ボットモード', '一つのチャットを続けるボットを作成します。'], es: ['Modo Bots', 'Crea un bot con un chat permanente.'],
      fr: ['Mode Bots', 'Créez un bot avec une conversation continue.'], de: ['Bot-Modus', 'Erstelle einen Bot mit einem fortlaufenden Chat.'],
      ru: ['Режим ботов', 'Создайте бота с постоянным чатом.'], pt: ['Modo Bots', 'Crie um bot com uma conversa contínua.'],
    }
    let chunks
    function load() {
      chunks ??= Promise.all([require.async('./client.bots.js'), require.async('./client.avatar.js'), require.async('./client.copy.js')])
        .then(async ([ui, avatar, copy]) => ({ ...ui, ...avatar, copy, mountBotAvatar: await avatar.loadAvatarRenderer() }))
        .catch(error => { chunks = undefined; throw error })
      return chunks
    }
    async function call(method, params, signal) {
      const response = await fetch(PATH, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }), signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      return data.result
    }
    async function follow(signal, receive) {
      while (!signal.aborted) {
        try {
          const response = await fetch(`${PATH}/feed`, { signal })
          if (!response.ok || !response.body) throw new Error(`Bots feed: ${response.status}`)
          let pending = ''
          for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
            pending += text
            let end
            while ((end = pending.indexOf('\n')) >= 0) {
              receive(JSON.parse(pending.slice(0, end)))
              pending = pending.slice(end + 1)
            }
          }
        } catch (error) {
          if (signal.aborted) return
          console.warn('[Bots]', error)
        }
        if (signal.aborted) return
        const { promise, resolve } = Promise.withResolvers()
        const timer = setTimeout(resolve, 2000)
        signal.addEventListener('abort', resolve, { once: true })
        await promise
        clearTimeout(timer)
        signal.removeEventListener('abort', resolve)
      }
    }
    return { name: PANEL, inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces'], apply(ctx) {
      const controller = new AbortController(), { signal } = controller
      const roster = createSnapshotStore({ rows: null, failed: false, revision: 0 })
      const notices = createSnapshotStore(null), selected = createSnapshotStore(null), ui = createSnapshotStore(null)
      const hidden = createSnapshotStore(new Set())
      const dialogs = createSnapshotStore(null)
      const t = ctx.locale.bind(PANEL)
      ctx.effect(() => ctx.locale.register(`${PANEL}.navigation`, Object.fromEntries(Object.entries(title).map(([key, value]) => [key,
        { title: value, modeName: modes[key][0], modeDescription: modes[key][1] }]))))
      const tNavigation = ctx.locale.bind(`${PANEL}.navigation`)
      const hooks = { roster, notices, selected, ui, dialogs, workspaces: ctx.workspaces.list, language: {
        getSnapshot: () => ctx.locale.getSnapshot().active, subscribe: listener => ctx.locale.subscribe(listener),
      } }
      let refreshing, dirty = false, style, uniqueNotice = 0, loading
      const seen = new Set()
      function requireUi() {
        loading ??= load().then(value => {
          if (signal.aborted) return
          ctx.effect(() => ctx.locale.register(PANEL, value.copy))
          style = document.createElement('style')
          style.textContent = value.css
          document.head.append(style)
          ui.set(value)
        }).catch(error => { loading = undefined; notices.set({ id: ++uniqueNotice, error: true }); console.warn('[Bots]', error) })
        return loading
      }
      function refresh() {
        dirty = true
        refreshing ??= (async () => {
          do {
            dirty = false
            try {
              const rows = await call('list', undefined, signal)
              if (signal.aborted) return
              const previous = hidden.getSnapshot()
              if (previous.size !== rows.length || rows.some(bot => !previous.has(bot.sessionId))) hidden.set(new Set(rows.map(bot => bot.sessionId)))
              roster.set({ rows, failed: false, revision: roster.getSnapshot().revision + 1 })
              if (rows.length) void requireUi()
            } catch (error) {
              if (!signal.aborted) roster.set({ ...roster.getSnapshot(), failed: true })
            }
          } while (dirty && !signal.aborted)
        })().finally(() => { refreshing = undefined })
        return refreshing
      }
      const request = (method, params, requestSignal) => call(method, params, requestSignal ?? signal)
      async function change(method, params) {
        const value = await request(method, params)
        await refresh()
        return value
      }
      function open(bot) {
        ctx.uiWorkspace.openSession(bot.sessionId)
        void request('markRead', { id: bot.id }).catch(error => console.warn('[Bots]', error))
      }
      const getBot = sessionId => roster.getSnapshot().rows?.find(bot => bot.sessionId === sessionId)
      function openDetail() { ctx.sidebarRight.openTab(TAB) }
      function notify(event) {
        if (event.kind === 'changed') { void refresh(); return }
        if (seen.has(event.id)) return
        if (seen.size >= 128) seen.delete(seen.values().next().value)
        seen.add(event.id)
        void requireUi().then(() => { if (!signal.aborted) notices.set(event) })
      }
      function syncSelection() {
        const active = ctx.layout.panelInfo.getSnapshot().activePanelId
        const current = active === null ? Object.values(ctx.sessions.list.getSnapshot().byId).find(row => row.retainedBy.mainView > 0)?.id ?? null : null
        if (selected.getSnapshot() === current) return
        selected.set(current)
        const bot = getBot(current)
        if (bot?.unread) void request('markRead', { id: bot.id }).catch(error => console.warn('[Bots]', error))
      }
      ctx.effect(() => {
        const stopPanels = ctx.layout.panelInfo.subscribe(syncSelection), stopSessions = ctx.sessions.list.subscribe(syncSelection)
        syncSelection()
        void follow(signal, notify)
        return () => { controller.abort(); stopPanels(); stopSessions(); style?.remove() }
      })
      ctx.effect(() => ctx.uiWorkspace.registerSessionPresentation(hidden))
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: PANEL, kind: TAB, priority: 'builtin', title: () => t('details') }))
      ctx.inject(['uiAgentPreset'], scope => {
        scope.effect(() => scope.uiAgentPreset.registerModeAction({
          id: 'bots', icon: 'users-outline', name: () => tNavigation('modeName'), description: () => tNavigation('modeDescription'),
          run(sourceSessionId) {
            if (getBot(sourceSessionId)) { openDetail(); return }
            void requireUi().then(() => {
              if (!signal.aborted && ui.getSnapshot()) dialogs.set({ mode: 'create', sourceSessionId })
            })
          },
        }))
      })
      function compact(bot) {
        void change('compact', { id: bot.id }).then(result => notices.set({ id: ++uniqueNotice, copy: result ? 'compacted' : 'noCompact' }),
          () => notices.set({ id: ++uniqueNotice, copy: 'compactFailed', error: true }))
      }
      const inject = () => ({ hooks, request, change, refresh, open, openDetail, compact,
        dialog: value => dialogs.set(value), dismissNotice: () => notices.set(null),
        showRoster: () => ctx.layout.selectPanel(PANEL), openScheduled: () => ctx.layout.selectPanel('schedules'),
        openRoutine: (sessionId, id) => ctx.sidebarRight.openTab('scheduleTask', { params: { sessionId, id } }),
      })
      function entry(name, { id = PANEL, key, order, priority, component, props = {}, ...options }) {
        ctx.slots.inject(name, () => ctx.slots.register({ name, ...(key === undefined ? { id } : { key }), order, priority,
          inject, ...options }, function BotSeat(seat) {
          const loaded = seat.useUi(value => value)
          if (!loaded) return null
          return h(loaded[component], { ...seat, ...props, t, avatar: loaded })
        }))
      }
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, inject }, function BotsPanel(props) {
        const loaded = props.useUi(value => value), failed = props.useRoster(value => value.failed)
        useEffect(() => { void requireUi() }, [])
        return loaded ? h(loaded.Roster, { ...props, t, avatar: loaded })
          : h('main', { 'aria-busy': !failed }, h('h1', null, tNavigation('title')))
      }))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 16,
        label: () => tNavigation('title') }, BotGlyph))
      entry('sidebar.workspaces.group.leading', { component: 'ProjectRows' })
      entry('conversation.session.header.identity', { component: 'HeaderAvatar' })
      entry('conversation.session.header.utilities', { component: 'HeaderTools', order: -8 })
      entry('conversation.input.dock', { component: 'Approvals', order: -20 })
      entry('sidebar.right.pane.tab', { key: PANEL, component: 'Details' })
      entry('shell.overlay', { component: 'Overlays' })
    } }
  },
})
