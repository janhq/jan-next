// Uses the app's shared React and public slots; no client build step is required.
window.__ModuleLoader__.load({
  id: '@janhq/jan-preset-square',
  factory(require) {
    const React = require('react')
    const { Button, RiskConfirmation, IconAgentPresetOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const h = React.createElement
    const PANEL_ID = 'preset-square'
    const CSS = `
.jan-presets{height:100%;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--jan-font-family-text);font-size:14px}
.jan-presets-inner{max-width:960px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.jan-presets h1,.jan-presets h2{margin:0;text-wrap:balance;font-weight:600}.jan-presets h1{font-size:24px}.jan-presets h2{font-size:15px}
.jan-presets p{margin:0;text-wrap:pretty}.jan-presets .jan-presets-muted{color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
.jan-presets-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px}
.jan-presets-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.jan-presets-card{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;display:grid;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.jan-presets-row{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.jan-presets-name{min-width:0;display:grid;gap:4px;overflow-wrap:anywhere}
.jan-presets-meta{font-variant-numeric:tabular-nums}
.jan-presets-error{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
@media(max-width:600px){.jan-presets-inner{padding:16px}.jan-presets-row{flex-direction:column}}
`

    async function api(method, params = {}) {
      const response = await fetch('/jan-api/preset-square', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      let body
      try { body = await response.json() } catch { throw new Error(`Preset Square returned HTTP ${response.status}.`) }
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    const lang = () => {
      const tag = (document.documentElement.lang || 'en').toLowerCase()
      const base = tag.split('-')[0]
      return ['zh', 'en', 'ja', 'ru', 'es', 'pt'].includes(base) ? base : 'en'
    }
    const count = new Intl.NumberFormat()

    function PresetSquare() {
      const [sort, setSort] = React.useState('downloads')
      const [presets, setPresets] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [confirming, setConfirming] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const load = React.useCallback(async (order = sort) => {
        setError('')
        try { setPresets((await api('list', { sort: order, lang: lang() })).presets) } catch (e) { setError(e.message); setPresets([]) }
      }, [sort])
      React.useEffect(() => { void load() }, [load])
      const install = async (preset) => {
        setBusy(preset.slug); setError(''); setNotice('')
        try {
          await api('install', { slug: preset.slug })
          setConfirming(null)
          setNotice(`${preset.title} is installed. Pick it from the mode menu under the message box in a new chat.`)
          await load()
        } catch (e) { setError(e.message) } finally { setBusy(''); setConfirming(null) }
      }
      const remove = async (preset) => {
        setBusy(preset.slug); setError(''); setNotice('')
        try {
          await api('remove', { id: preset.presetId })
          setNotice(`${preset.title} was removed. Chats that used it keep their history.`)
          await load()
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }
      return h('section', { className: 'jan-presets', 'aria-label': 'Presets' },
        h('div', { className: 'jan-presets-inner' },
          h('div', { className: 'jan-presets-name' },
            h('h1', null, 'Presets'),
            h('p', { className: 'jan-presets-muted' }, 'Ready-made agent setups from the Preset Square gallery (dshdesktop.com). Each one bundles a role, skills and tools. Installed presets appear in the mode menu of a new chat.')),
          h('div', { className: 'jan-presets-bar', role: 'group', 'aria-label': 'Sort presets' },
            h(Button, { variant: sort === 'downloads' ? 'primary' : 'outline', onClick: () => setSort('downloads'), 'aria-pressed': sort === 'downloads' }, 'Most downloaded'),
            h(Button, { variant: sort === 'newest' ? 'primary' : 'outline', onClick: () => setSort('newest'), 'aria-pressed': sort === 'newest' }, 'Newest')),
          error ? h('p', { role: 'alert', className: 'jan-presets-error' }, error) : null,
          notice ? h('p', { role: 'status' }, notice) : null,
          presets === null ? h('p', { className: 'jan-presets-muted', role: 'status' }, 'Loading presets…') : presets.length === 0 && !error ? h('p', { className: 'jan-presets-muted' }, 'Preset Square has no presets to show.') : null,
          presets?.length ? h('ul', { className: 'jan-presets-list' }, presets.map(preset => h('li', { key: preset.slug, className: 'jan-presets-card' },
            h('div', { className: 'jan-presets-row' },
              h('div', { className: 'jan-presets-name' },
                h('h2', null, preset.title),
                h('p', { className: 'jan-presets-muted jan-presets-meta' }, `@${preset.publisher ?? 'unknown'} · ${count.format(preset.downloads ?? 0)} downloads · ${preset.presetId}`)),
              preset.installed
                ? h(Button, { variant: 'outline', disabled: Boolean(busy), onClick: () => remove(preset) }, busy === preset.slug ? 'Removing…' : 'Remove')
                : h(Button, { variant: 'primary', disabled: Boolean(busy) || preset.conflict, title: preset.conflict ? 'A preset with this id already exists' : undefined, onClick: () => { setConfirming(preset); setAcknowledged(false) } }, busy === preset.slug ? 'Installing…' : preset.conflict ? 'Already present' : 'Install')),
            h('p', { className: 'jan-presets-muted' }, preset.description)))) : null),
        h(RiskConfirmation, {
          open: Boolean(confirming), title: `Install ${confirming?.title ?? 'preset'}?`,
          description: 'Community presets are shared by users and are not security reviewed. A preset can run tools and commands with the same permissions as the agent. Install only presets you trust.',
          acknowledgeLabel: 'I understand this preset can run tools and commands.', cancelLabel: 'Cancel', closeLabel: 'Cancel install', confirmLabel: busy ? 'Installing…' : 'Install',
          acknowledged, disabled: Boolean(busy), onAcknowledgedChange: setAcknowledged,
          onCancel: () => { if (!busy) setConfirming(null) }, onConfirm: () => { if (confirming) void install(confirming) },
        }))
    }

    return {
      name: '@janhq/jan-preset-square',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-preset-square'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'preset-square: styles')
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PresetSquare))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'Presets' }, ({ size }) => h(IconAgentPresetOutlineRegular, { size, 'aria-hidden': true })))
      },
    }
  },
})
