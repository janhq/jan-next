// Browser half. DSH loads this module into the page and calls apply(ctx).
// Rename the id, PANEL_ID and the route together when copying the template.
window.__ModuleLoader__.load({
  id: 'open-waifu-plugin-hello',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'hello'

    // A Tabler outline glyph keeps the sidebar consistent with the Jan icons.
    const Icon = ({ size }) => h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M8 9h8' }), h('path', { d: 'M8 13h6' }),
      h('path', { d: 'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z' }))

    function Panel() {
      const [text, setText] = React.useState('Loading…')
      React.useEffect(() => {
        fetch('/open-waifu-plugin-hello/greeting', { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(body => setText(body.text), error => setText(`Could not reach the host: ${error.message}`))
      }, [])
      return h('section', { 'aria-label': 'Hello', style: { padding: '32px 40px' } },
        h('h1', { style: { margin: '0 0 8px', fontSize: 22, fontWeight: 500 } }, 'Hello'),
        h('p', { role: 'status', style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, text))
    }

    return {
      name: 'open-waifu-plugin-hello',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => 'Hello',
        }, Icon))
      },
    }
  },
})
