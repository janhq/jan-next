// Browser half of the notification plugin, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-notifications',
  factory(require) {
    const { createElement: h, useEffect, useState, useSyncExternalStore } = require('react')
    const { Switch, Toast, IconWarningTriangleOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-notifications'
    const KINDS = ['finished', 'failed', 'waiting']
    const DEFAULTS = { enabled: true, finished: true, failed: true, waiting: true }
    /** Notification ids awaiting a click; older ids are dropped once the platform has likely dismissed them. */
    const MAX_TARGETS = 64
    const CSS = `
.jn-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jn-row[data-nested] { padding-left: 16px; }
.jn-title { font-size: 14px; line-height: 20px; }
.jn-description { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jn-error { margin-top: 4px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }`

    return {
      name: NS,
      inject: ['slots', 'locale', 'uiSession', 'sessions', 'remote', 'configForms', 'uiWorkspace'],
      apply(ctx) {
        const logger = ctx.logger(NS)
        const form = ctx.configForms.get(NS)
        const preferences = () => ({ ...DEFAULTS, ...form.getSnapshot().value })
        const bridge = globalThis.janDesktop?.notifications
        /** @type {Map<string, string>} notification id → Session id */
        const targets = new Map()
        /** @type {((toast: { key: number, sessionId: string, text: string }) => void) | undefined} */
        let showToast
        let live = true
        ctx.effect(() => () => { live = false })

        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-notifications'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => { style.remove() })

        void Promise.all([require.async('./client.locale.js'), require.async('./client.watch.js')]).then(([{ dictionaries }, { createStatusWatcher }]) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(NS, dictionaries))
          const t = ctx.locale.bind(NS)
          const summary = sessionId => ctx.sessions.list.getSnapshot().byId[sessionId]
          const nameOf = sessionId => summary(sessionId)?.title?.trim() || t('untitled')
          const isMain = sessionId => (summary(sessionId)?.retainedBy?.mainView ?? 0) > 0
          const visible = () => document.visibilityState === 'visible'
          let serial = 0

          const watcher = createStatusWatcher({
            tracked: (sessionId) => {
              const row = summary(sessionId)
              return row !== undefined && row.origin !== 'subagent' && row.parentSessionId === undefined
            },
            emit: ({ kind, sessionId }) => {
              const name = nameOf(sessionId)
              if (kind === 'failed' && visible() && !isMain(sessionId)) {
                showToast?.({ key: ++serial, sessionId, text: t('toast.failed', { name }) })
              }
              const wanted = preferences()
              if (bridge === undefined || !wanted.enabled || !wanted[kind]) return
              const show = () => {
                const id = `${kind}:${++serial}`
                targets.set(id, sessionId)
                if (targets.size > MAX_TARGETS) targets.delete(targets.keys().next().value)
                bridge.show({ id, title: t(`${kind}.title`), body: t(`${kind}.body`, { name }) })
                  .catch(error => { logger.warn('could not show a desktop notification', error) })
              }
              if (!isMain(sessionId)) { show(); return }
              // The open chat notifies only while the native window is hidden, minimized or unfocused.
              bridge.windowActive().then((active) => { if (!active) show() }, (error) => {
                logger.warn('could not read the window state', error)
                show()
              })
            },
          })
          ctx.effect(() => {
            const status = ctx.uiSession.sessionStatus
            const sync = () => { watcher.observe(status.getSnapshot()) }
            const release = status.subscribe(sync)
            sync()
            return release
          })
          ctx.effect(() => ctx.remote.$on('api-session/error', (sessionId) => { watcher.error(sessionId) }))
          if (bridge !== undefined) {
            ctx.effect(() => bridge.subscribe((id) => {
              const sessionId = targets.get(id)
              targets.delete(id)
              if (sessionId !== undefined) ctx.uiWorkspace.openSession(sessionId)
            }))
          }

          function ErrorToasts() {
            const [toast, setToast] = useState(null)
            useEffect(() => {
              showToast = setToast
              return () => { if (showToast === setToast) showToast = undefined }
            }, [])
            return toast && h(Toast, { key: toast.key, text: toast.text, holdMs: 7000,
              icon: h(IconWarningTriangleOutlineRegular, { 'aria-hidden': true }),
              actions: [{ label: t('toast.open'), onClick: () => { setToast(null); ctx.uiWorkspace.openSession(toast.sessionId) } }],
              onDone: () => { setToast(null) } })
          }
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, ErrorToasts))

          if (bridge === undefined) return
          const usePreferences = () => useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
          function PreferenceRow({ field, title, description, nested }) {
            const snapshot = usePreferences()
            const value = { ...DEFAULTS, ...snapshot.value }
            const [busy, setBusy] = useState(false)
            const [failed, setFailed] = useState(false)
            if (nested && !value.enabled) return null
            return h('div', { className: 'jn-row', 'data-nested': nested || undefined },
              h('div', null, h('div', { className: 'jn-title' }, title),
                description && h('div', { className: 'jn-description' }, description),
                failed && h('div', { className: 'jn-error', role: 'alert' }, t('settings.error'))),
              h(Switch, { label: title, checked: value[field] === true, disabled: busy || !snapshot.writable,
                onChange: (next) => {
                  setFailed(false)
                  setBusy(true)
                  form.set(field, next).then(saved => { if (!saved) setFailed(true) }, () => { setFailed(true) })
                    .finally(() => { setBusy(false) })
                } }))
          }
          const rows = [
            { field: 'enabled', title: () => t('settings.title'), description: () => t('settings.description') },
            ...KINDS.map(kind => ({ field: kind, nested: true, title: () => t(`settings.${kind}`),
              description: () => (kind === 'waiting' ? t('settings.waitingDescription') : undefined) })),
          ]
          // After the conversation rows (12–17) and before performance usage (30).
          rows.forEach((row, index) => {
            ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: `${NS}-${row.field}`, order: 20 + index / 10, locale: NS },
              () => h(PreferenceRow, { field: row.field, nested: row.nested === true, title: row.title(), description: row.description() })))
          })
        }).catch((error) => { if (live) logger.error(error) })
      },
    }
  },
})
