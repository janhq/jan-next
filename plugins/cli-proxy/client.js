window.__ModuleLoader__.load({
  id: '@janhq/jan-cli-proxy',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const { Button, IconUserOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const ID = 'jan-cli-proxy'
    const SETUP_SLOT = 'settings.models.setup-subscription'
    const providers = {
      claude: 'Claude', codex: 'ChatGPT', antigravity: 'Google Antigravity', xai: 'Grok', kimi: 'Kimi Code (kimi.com)',
      'kimi-ai': 'Kimi Code (kimi.ai)', copilot: 'GitHub Copilot', devin: 'Devin', meta: 'Meta Muse',
    }
    const CSS = `
.jan-cli-proxy{display:grid;gap:12px;max-width:640px;padding-block-end:12px}
.jan-cli-proxy h2,.jan-cli-proxy p{margin:0}
.jan-cli-proxy h2{font:inherit;font-weight:500}
.jan-cli-proxy-detail{color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
.jan-cli-proxy-card{display:grid;gap:12px;padding:16px;border:1px solid var(--dsw-alias-separator);border-radius:var(--dsw-radius-lg)}
.jan-cli-proxy-providers{display:flex;flex-wrap:wrap;gap:8px}
.jan-cli-proxy-provider{display:inline-flex;align-items:center;gap:8px}
.jan-cli-proxy-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.jan-cli-proxy-account{min-width:0;overflow-wrap:anywhere}
.jan-cli-proxy progress{width:100%;accent-color:var(--dsw-alias-state-business-primary)}
.jan-cli-proxy-error{color:var(--dsw-alias-state-error-primary)}
.jan-cli-proxy-link{font-size:13px;color:var(--dsw-alias-label-primary);text-underline-offset:2px}
`

    async function call(method, params, signal) {
      const response = await fetch(new URL('jan-api/cli-proxy', document.baseURI), {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }), signal,
      })
      if (!response.ok) throw new Error('Subscription request failed')
      return (await response.json()).result
    }

    function Section({ t, ProviderIcon }) {
      const [state, setState] = useState(null)
      const [problem, setProblem] = useState(false)
      const [busy, setBusy] = useState(false)
      const owner = useRef(null)
      const openWhenReady = useRef(false)
      const revision = useRef(0)
      const refresh = async signal => {
        const version = ++revision.current
        try {
          const result = await call('state', undefined, signal)
          if (signal.aborted || version !== revision.current) return
          setState(result)
          setProblem(false)
          if (!result.signIn) openWhenReady.current = false
          else if (result.signIn.url && openWhenReady.current) {
            openWhenReady.current = false
            // The desktop window-open handler sends HTTP(S) links to the OS browser.
            // In a regular browser the visible link remains available if a popup is blocked.
            window.open(result.signIn.url, '_blank', 'noopener,noreferrer')
          }
        } catch {
          if (!signal.aborted && version === revision.current) setProblem(true)
        }
      }
      useEffect(() => {
        const controller = new AbortController()
        owner.current = controller
        let timer
        const poll = async () => {
          await refresh(controller.signal)
          if (!controller.signal.aborted) timer = setTimeout(poll, 750)
        }
        void poll()
        return () => { controller.abort(); clearTimeout(timer) }
      }, [])

      const act = async (method, params) => {
        const signal = owner.current?.signal
        if (!signal || signal.aborted) return
        setBusy(true)
        try {
          if (method === 'cancel') openWhenReady.current = false
          const accepted = await call(method, params, signal)
          if (method === 'signIn' && accepted) openWhenReady.current = true
          await refresh(signal)
        } catch {
          if (!signal.aborted) setProblem(true)
        } finally {
          if (!signal.aborted) setBusy(false)
        }
      }

      const status = state?.status
      const signIn = state?.signIn
      const accounts = state?.accounts ?? []
      const working = busy || Boolean(signIn) || ['starting', 'downloading', 'restarting'].includes(status?.phase)
      const phase = problem ? 'unavailable' : (status?.error ?? status?.phase ?? 'loading')
      const canRetry = problem || phase === 'startup' || phase === 'download' || phase === 'checksum' || Boolean(state?.error)
      const percent = status?.phase === 'downloading' ? status.percent : null
      const renderIcon = provider => ['copilot', 'devin'].includes(provider)
        ? h(IconUserOutlineRegular, { size: 16, 'aria-hidden': true })
        : h(ProviderIcon, { provider })
      return h('section', { className: 'jan-cli-proxy', 'aria-label': t('title') },
        h('p', { className: 'jan-cli-proxy-detail' }, t('intro')),
        h('div', { className: 'jan-cli-proxy-card' },
          h('div', { className: 'jan-cli-proxy-row' }, h('h2', null, t('proxy')),
            status?.phase !== 'downloading' && h('p', {
              role: 'status', className: status?.error ? 'jan-cli-proxy-error' : 'jan-cli-proxy-detail',
            },
              t(phase))),
          state?.version && h('p', { className: 'jan-cli-proxy-detail' }, t('poweredBy', { version: state.version })),
          status?.phase === 'downloading' && h('div', null,
            h('p', { className: 'jan-cli-proxy-detail' }, percent === null ? t('downloading') : t('progress', { percent })),
            h('progress', { max: 100, value: percent ?? undefined, 'aria-label': t('downloading') })),
          state?.error && h('p', { role: 'alert', className: 'jan-cli-proxy-error' }, t(state.error)),
          canRetry && h('div', null, h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: () => {
            if (problem) void refresh(owner.current.signal)
            else void act('retry')
          } }, t('retry')))),
        h('div', { className: 'jan-cli-proxy-card' },
          h('h2', null, t('connect')),
          h('div', { className: 'jan-cli-proxy-providers' }, Object.entries(providers).map(([provider, label]) =>
            h(Button, { key: provider, size: 'sm', variant: 'outline',
              disabled: working || state === null || problem || status?.error === 'unsupported',
              onClick: () => { void act('signIn', { provider }) } },
            h('span', { className: 'jan-cli-proxy-provider' }, renderIcon(provider), t('signIn', { provider: label }))))),
          signIn && h('div', { className: 'jan-cli-proxy-card' },
            h('p', { role: 'status' }, t(signIn.cancelling ? 'cancelling' : signIn.url ? 'pending' : 'preparing')),
            signIn.code && h('p', null, t('deviceCode', { code: signIn.code })),
            h('div', { className: 'jan-cli-proxy-row' },
              signIn.url && h('a', { className: 'jan-cli-proxy-link', href: signIn.url, target: '_blank', rel: 'noopener noreferrer' },
                t('openBrowser')),
              h(Button, { size: 'sm', variant: 'ghost', disabled: busy || signIn.cancelling,
                onClick: () => { void act('cancel') } }, t('cancel'))))),
        h('div', { className: 'jan-cli-proxy-card' }, h('h2', null, t('accounts')),
          accounts.length === 0 && state && h('p', { className: 'jan-cli-proxy-detail' }, t('empty')),
          accounts.map(({ id, provider, label }) => h('div', { className: 'jan-cli-proxy-row', key: id },
            h('div', { className: 'jan-cli-proxy-account' },
              h('div', { className: 'jan-cli-proxy-provider' }, renderIcon(provider),
                Object.hasOwn(providers, provider) ? providers[provider] : provider),
              h('p', { className: 'jan-cli-proxy-detail' }, label)),
            h(Button, { size: 'sm', variant: 'ghost', disabled: working || problem || status?.phase !== 'running',
              onClick: () => { void act('signOut', { id }) } }, t('signOut'))))))
    }

    return {
      name: ID,
      inject: ['slots', 'locale', 'settingsNavigation'],
      apply(ctx) {
        let live = true
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.append(style)
          return () => { live = false; style.remove() }
        }, 'Subscription settings styles')
        const locale = require.async('./client.locale.js')
        const icons = require.async('./client.icons.js')
        void Promise.all([locale, icons]).then(([{ dictionaries }, { ProviderIcon }]) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(ID, dictionaries), 'Subscription settings copy')
          const t = ctx.locale.bind(ID)
          const Page = props => h(Section, { ...props, ProviderIcon })
          ctx.slots.inject(SETUP_SLOT, function* () {
            yield ctx.slots.register({ name: SETUP_SLOT, locale: ID }, Page)
            yield ctx.settingsNavigation.registerTarget({
              sectionId: 'models', id: 'subscription', title: () => t('title'), aliases: [ID, 'subscriptions'],
            })
          })
        }).catch(() => console.warn('Subscription settings assets could not be loaded'))
      },
    }
  },
})
