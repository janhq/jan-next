// Browser half of the diagnostics plugin, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-diagnostics',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, IconInfoOutlineRegular, registerFailureLogSource } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-diagnostics'
    /** How long a finished action's confirmation stays. */
    const NOTE_MS = 2500
    const CSS = `
.jd-actions { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.jd-link { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; text-decoration: underline; }
.jd-link:disabled { cursor: default; opacity: 0.6; }
.jd-link:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.jd-note { color: var(--dsw-alias-label-secondary); }
.jd-note[data-error] { color: var(--dsw-alias-state-error-primary); }
.jd-about { display: flex; flex-direction: column; }
.jd-lede { margin: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.jd-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 24px; margin: 0; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 20px; }
.jd-facts dt { color: var(--dsw-alias-label-secondary); }
.jd-facts dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
.jd-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jd-row > button { flex-shrink: 0; white-space: nowrap; }
.jd-title { font-size: 14px; line-height: 20px; }
.jd-description { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jd-status { padding-top: 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.jd-status[data-error] { color: var(--dsw-alias-state-error-primary); }`

    async function api(method, params = {}, signal) {
      // Desktop's handler transports Host requests to the sidecar instead of using Chromium fetch.
      const fetchHost = globalThis.__JAN_TRANSPORT__?.fetch ?? fetch
      const response = await fetchHost(new URL('jan-api/diagnostics', document.baseURI), {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }), signal,
      })
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('unavailable')
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'unavailable')
      return body.result
    }

    /**
     * One action at a time, with a short confirmation or an error after it.
     * @returns {{ busy: string | null, note: { text: string, error: boolean } | null, run: (key: string, task: () => Promise<string | undefined>) => Promise<void> }}
     */
    function useActions(t) {
      const [busy, setBusy] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const timer = React.useRef(undefined)
      React.useEffect(() => () => { clearTimeout(timer.current) }, [])
      const run = async (key, task) => {
        if (busy !== null) return
        setBusy(key)
        setNote(null)
        clearTimeout(timer.current)
        try {
          const done = await task()
          if (done !== undefined) {
            setNote({ text: done, error: false })
            timer.current = setTimeout(() => { setNote(null) }, NOTE_MS)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setNote({ text: message === 'unavailable' ? t('error.unavailable') : message, error: true })
        } finally {
          setBusy(null)
        }
      }
      return { busy, note, run }
    }

    const copyReport = async (t, focus) => {
      const { text } = await api('report', focus)
      await navigator.clipboard.writeText(text)
      return t('copied')
    }

    /** Copy details and Open logs on a failed turn. A sign-out the person chose needs neither. */
    function FailureActions({ t, code, message }) {
      const { busy, note, run } = useActions(t)
      if (code === 'ACCOUNT_SIGNED_OUT') return null
      const focus = code === undefined ? { message } : { code, message }
      return h('span', { className: 'jd-actions', 'data-diagnostics-actions': '' },
        h('button', { type: 'button', className: 'jd-link', disabled: busy !== null, onClick: () => { void run('copy', () => copyReport(t, focus)) } }, t('copy')),
        h('button', { type: 'button', className: 'jd-link', disabled: busy !== null, onClick: () => { void run('logs', async () => { await api('openLogs'); return undefined }) } }, t('openLogs')),
        note && h('span', { className: 'jd-note', role: note.error ? 'alert' : 'status', 'data-error': note.error || undefined }, note.text))
    }

    function ActionRow({ title, description, children }) {
      return h('div', { className: 'jd-row' },
        h('div', null, h('div', { className: 'jd-title' }, title), h('div', { className: 'jd-description' }, description)),
        children)
    }

    /** Settings > About: what this Jan is, and the report tools. */
    function AboutSection({ t }) {
      const [info, setInfo] = React.useState(null)
      const [loadError, setLoadError] = React.useState(false)
      const { busy, note, run } = useActions(t)
      React.useEffect(() => {
        let live = true
        api('info').then((value) => { if (live) setInfo(value) }, () => { if (live) setLoadError(true) })
        return () => { live = false }
      }, [])
      const working = busy !== null
      return h('section', { className: 'jd-about', 'data-diagnostics-about': '' },
        h('p', { className: 'jd-lede' }, t('about.lede')),
        h('dl', { className: 'jd-facts' },
          h('dt', null, t('about.version')), h('dd', null, info?.version ?? (loadError ? t('error.unavailable') : '...')),
          h('dt', null, t('about.system')), h('dd', null, info?.system ?? '...'),
          h('dt', null, t('about.logs')), h('dd', null, info?.logDirectory ?? (info ? t('about.noLogs') : '...'))),
        h(ActionRow, { title: t('copy'), description: t('about.copyDescription') },
          h(Button, { size: 'sm', variant: 'outline', disabled: working, onClick: () => { void run('copy', () => copyReport(t, {})) } }, t('copy'))),
        h(ActionRow, { title: t('openLogs'), description: info && !info.canOpen ? t('about.noDesktop') : t('about.openLogsDescription') },
          h(Button, { size: 'sm', variant: 'outline', disabled: working || !info?.canOpen || info.logDirectory === null, onClick: () => { void run('logs', async () => { await api('openLogs'); return undefined }) } }, t('openLogs'))),
        h(ActionRow, { title: t('about.save'), description: t('about.saveDescription') },
          h(Button, { size: 'sm', variant: 'outline', disabled: working || info?.logDirectory === null, onClick: () => { void run('save', async () => t('about.saved', { path: (await api('saveReport')).path })) } }, t('about.save'))),
        h(ActionRow, { title: t('about.send'), description: t('about.sendDescription') },
          h(Button, { size: 'sm', variant: 'outline', disabled: true }, t('about.send'))),
        note && h('div', { className: 'jd-status', role: note.error ? 'alert' : 'status', 'data-error': note.error || undefined }, note.text))
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        let live = true
        if (registerFailureLogSource) ctx.effect(() => registerFailureLogSource({
          async readTail(signal) { return (await api('failureLogTail', {}, signal)).text ?? undefined },
          async open(signal) { await api('openLogs', {}, signal) },
        }), 'jan-diagnostics: failure log source')
        ctx.effect(() => () => { live = false }, 'jan-diagnostics: lifetime')
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-diagnostics'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => { style.remove() }, 'jan-diagnostics: styles')
        void require.async('./client.locale.js').then(({ dictionaries }) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(NS, dictionaries), 'jan-diagnostics: copy')
          const t = ctx.locale.bind(NS)
          ctx.slots.inject('conversation.chat.turn-error-actions', () => ctx.slots.register({
            name: 'conversation.chat.turn-error-actions', id: NS, order: 10, locale: NS,
          }, FailureActions))
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: NS, order: 90, label: () => t('about.title'), locale: NS,
          }, AboutSection))
          ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon', id: NS,
          }, ({ size }) => h(IconInfoOutlineRegular, { size, 'aria-hidden': true })))
        }, (error) => { ctx.logger(NS).error('copy failed to load', error) })
      },
    }
  },
})
