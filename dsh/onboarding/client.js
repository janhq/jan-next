// First-run welcome on DSH's settings.onboarding seat. It shows once per
// version, before DSH's own steps, and points a new user at a working model.
window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-onboarding',
  factory(require) {
    const React = require('react')
    const { Button, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const VERSION = '2026-11-16.1'
    const ENTRY = 'ow-onboarding'

    const CSS = `
.ow-onboarding{display:flex;flex-direction:column;gap:20px;padding:28px;color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-text)}
.ow-onboarding h2{margin:0;font-size:20px;line-height:28px;font-weight:500;text-wrap:balance;outline:none}
.ow-onboarding p{margin:0;text-wrap:pretty;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.ow-onboarding-choices{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ow-onboarding-choice{display:flex;align-items:center;gap:16px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px}
.ow-onboarding-choice div{flex:1;min-width:0;display:grid;gap:4px}
.ow-onboarding-choice strong{font-weight:500;font-size:14px}
.ow-onboarding-status{font-variant-numeric:tabular-nums}
.ow-onboarding-actions{display:flex;justify-content:flex-end;gap:12px}
.ow-onboarding-error{color:var(--dsw-alias-label-primary);border-left:3px solid var(--dsw-alias-state-business-primary);padding-left:12px}
@media(max-width:560px){.ow-onboarding{padding:20px}.ow-onboarding-choice{flex-wrap:wrap}}
`

    // Same-origin host APIs, as the other open-waifu panels use them.
    async function api(feature, method, params = {}) {
      const response = await fetch(`/ow-api/${feature}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    function Welcome({ complete, openSection, explicit, form, catalog, openModelHub }) {
      const subscribe = React.useCallback(listener => form.subscribe(listener), [form])
      const read = React.useCallback(() => form.getSnapshot(), [form])
      const snapshot = React.useSyncExternalStore(subscribe, read)
      const [routes, setRoutes] = React.useState(null)
      const [localCount, setLocalCount] = React.useState(null)
      const [error, setError] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const titleRef = React.useRef(null)
      const done = snapshot.status === 'ready' && snapshot.value?.completedVersion === VERSION
      const finished = React.useRef(false)
      const finish = React.useCallback(() => {
        if (finished.current) return
        finished.current = true
        complete()
      }, [complete])

      React.useEffect(() => {
        if (done && !explicit) finish()
      }, [done, explicit, finish])
      React.useEffect(() => {
        if (snapshot.status === 'unavailable') finish()
      }, [snapshot.status, finish])
      const showing = (snapshot.status === 'ready' && !done) || explicit
      React.useEffect(() => {
        if (!showing) return
        let live = true
        catalog().then(response => { if (live) setRoutes(response.ok ? response.value.routableProviders.filter(id => id !== 'ow-llamacpp').length : 0) })
          .catch(() => { if (live) setRoutes(0) })
        api('llamacpp', 'list').then(list => { if (live) setLocalCount(Array.isArray(list) ? list.length : 0) })
          .catch(() => { if (live) setLocalCount(0) })
        return () => { live = false }
      }, [showing, catalog])
      React.useEffect(() => {
        const root = document.getElementById('root')
        if (!showing || root === null) return
        const previous = root.inert
        root.inert = true
        titleRef.current?.focus()
        return () => { root.inert = previous }
      }, [showing])

      if (!showing) return null
      const leave = async (then) => {
        setSaving(true); setError('')
        try {
          if (!(await form.set('completedVersion', VERSION))) throw new Error('The welcome could not be saved. Try again.')
          finish()
          then?.()
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setSaving(false) }
      }
      const countText = (value, one, many) => value === null ? 'Checking…' : value === 0 ? 'None yet' : `${value} ${value === 1 ? one : many}`
      const choice = (title, body, status, label, onClick, primary) => h('li', { className: 'ow-onboarding-choice' },
        h('div', null, h('strong', null, title), h('p', null, body), status && h('p', { className: 'ow-onboarding-status' }, status)),
        h(Button, { variant: primary ? 'primary' : 'secondary', disabled: saving, onClick }, label))
      const ready = routes !== null && routes > 0

      return h(Modal, { open: true, title: 'Welcome to Jan', onClose: () => {}, headless: true },
        h('div', { className: 'ow-onboarding' },
          h('h2', { ref: titleRef, tabIndex: -1 }, 'Welcome to Jan'),
          h('p', null, 'Jan needs one model to chat. Pick a local model that runs on this computer, or connect a provider you already use. You can change this later in Model Hub and Settings.'),
          h('ul', { className: 'ow-onboarding-choices' },
            choice('Run a model on this computer', 'Download a model in Model Hub. Chats stay on this device.',
              `Installed: ${countText(localCount, 'model', 'models')}`, 'Open Model Hub', () => leave(openModelHub), !ready),
            choice('Connect a provider', 'Add an OpenAI-compatible endpoint and its key in Settings > Models.',
              `Connected: ${countText(routes, 'provider', 'providers')}`, 'Open Models', () => leave(() => openSection('models')), false)),
          error && h('p', { role: 'alert', className: 'ow-onboarding-error' }, error),
          h('div', { className: 'ow-onboarding-actions' },
            h(Button, { variant: ready ? 'primary' : 'secondary', disabled: saving, onClick: () => leave() },
              ready ? 'Start chatting' : 'Skip for now'))))
    }

    return {
      name: '@open-waifu/dsh-onboarding',
      inject: ['slots', 'configForms', 'remote', 'remote.session', 'layout'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'ow-onboarding styles')
        const form = ctx.configForms.get(ENTRY)
        // Read services now; the step's callbacks run later, outside this scope.
        const session = ctx.remote.session
        const layout = ctx.layout
        ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
          name: 'settings.onboarding', id: 'ow-welcome', order: -200,
        }, props => h(Welcome, {
          ...props, form,
          catalog: () => session.modelCatalog(),
          openModelHub: () => layout.selectPanel('ow-models'),
        })))
      },
    }
  },
})
