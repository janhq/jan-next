// Browser half of the development reload plugin, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-dev-reload',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const { Toast, IconWarningTriangleOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-dev-reload'
    const POLL_MS = 2000
    /** The notice stays until its state changes or the user closes it. */
    const HOLD_MS = 24 * 60 * 60 * 1000

    async function api(method) {
      const response = await fetch(new URL('jan-api/dev-reload', document.baseURI), {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: {} }),
      })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const logger = ctx.logger(NS)
        let live = true
        ctx.effect(() => () => { live = false })
        void require.async('./client.locale.js').then(({ dictionaries }) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(NS, dictionaries))
          const t = ctx.locale.bind(NS)

          function DevReloadNotice() {
            const [state, setState] = useState(null)
            const [dismissed, setDismissed] = useState(null)
            const [busy, setBusy] = useState(false)
            const [failed, setFailed] = useState(false)
            useEffect(() => {
              let active = true
              let timer
              const poll = () => {
                api('state').then((next) => { if (active) setState(next) }, (error) => { logger.debug('dev reload state unavailable', error) })
                  .finally(() => { if (active) timer = setTimeout(poll, POLL_MS) })
              }
              poll()
              return () => { active = false; clearTimeout(timer) }
            }, [])
            if (state === null) return null
            const restart = state.restart !== null
            if (!restart && state.held === null) return null
            const key = restart ? `restart:${state.restart.reason}` : `held:${state.held.count}:${state.running}`
            if (dismissed === key) return null
            const run = (operation) => {
              setBusy(true)
              setFailed(false)
              operation().catch((error) => { logger.warn(error); setFailed(true) }).finally(() => { setBusy(false) })
            }
            const desktop = globalThis.janDesktop?.restartApplication
            const text = failed
              ? t('failed')
              : restart
                ? (desktop === undefined ? t('restart.manual') : t('restart.text'))
                : state.running === 1 ? t('held.one') : t('held.text', { count: state.running })
            const actions = busy ? [] : restart
              ? desktop === undefined ? [] : [{ label: t('restart.action'), onClick: () => {
                run(async () => { await api('prepareRestart'); await desktop() })
              } }]
              : [{ label: t('held.action'), onClick: () => {
                run(async () => { await api('reloadNow'); setState(current => current && { ...current, held: null }) })
              } }]
            return h(Toast, {
              key, text, actions, holdMs: HOLD_MS,
              icon: h(IconWarningTriangleOutlineRegular, { 'aria-hidden': true }),
              onDone: () => { setDismissed(key) },
            })
          }
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, DevReloadNotice))
        }).catch((error) => { if (live) logger.error(error) })
      },
    }
  },
})
