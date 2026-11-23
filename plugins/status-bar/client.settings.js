// Customize > Plugins > Status bar: everything the right-click menu offers, plus
// thresholds, reading interval, per-item side and order, and a layout reset.
window.__ModuleLoader__.load({
  id: '@janhq/jan-status-bar',
  chunk: 'client.settings.js',
  factory() {
    const CSS = `
.jsb-settings-section + .jsb-settings-section { margin-top: 32px; }
.jsb-settings-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.jsb-settings-hint { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.jsb-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 52px; padding: 8px 0; box-sizing: border-box; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jsb-settings-label { min-width: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.jsb-settings-controls { display: flex; flex: none; align-items: center; gap: 8px; }
.jsb-settings-number { width: 64px; height: 30px; padding: 0 8px; box-sizing: border-box; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; }
.jsb-settings-number:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.jsb-settings-error { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.jsb-settings-actions { margin-top: 16px; }
`

    /**
     * @param {(id: string) => any} require - the module loader's require.
     * @returns {(props: object) => unknown} the settings page component.
     */
    function createSettingsPage(require) {
      const React = require('react')
      const h = React.createElement
      const { useEffect, useId, useState } = React
      const { Button, SegmentedControl, Switch } = require('@janhq/jan-client-ui-primitives')

      function useStyle() {
        useEffect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@janhq/jan-status-bar/settings'
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        }, [])
      }

      function NumberRow({ label, value, min, max, disabled, onCommit }) {
        const id = useId()
        const [draft, setDraft] = useState(String(value))
        useEffect(() => { setDraft(String(value)) }, [value])
        const commit = () => {
          const next = Math.round(Number(draft))
          if (!Number.isFinite(next) || next < min || next > max) { setDraft(String(value)); return }
          if (next !== value) onCommit(next)
        }
        return h('div', { className: 'jsb-settings-row' },
          h('label', { className: 'jsb-settings-label', htmlFor: id }, label),
          h('input', { id, className: 'jsb-settings-number', type: 'number', inputMode: 'numeric', min, max, step: 1, value: draft, disabled,
            onChange: event => setDraft(event.target.value), onBlur: commit,
            onKeyDown: event => { if (event.key === 'Enter') commit() } }))
      }

      return function StatusBarSettings({ t, useStatusBarSettings, useItemEntries, layout, saveItems, setPreference }) {
        useStyle()
        const snapshot = useStatusBarSettings(s => s)
        const entries = useItemEntries(s => s)
        const [failed, setFailed] = useState(false)
        const generalId = useId()
        const itemsId = useId()
        const value = snapshot.value ?? {}
        const disabled = snapshot.status !== 'ready' || !snapshot.writable
        const items = layout.arrange(entries, value.items ?? {})
        const run = write => { setFailed(false); void write().then(saved => { if (!saved) setFailed(true) }) }
        const nameOf = item => entries.labels[item.id] ?? item.id

        const itemRow = item => {
          const row = items.filter(other => other.side === item.side)
          const index = row.indexOf(item)
          const name = nameOf(item)
          return h('div', { className: 'jsb-settings-row', key: item.id },
            h('span', { className: 'jsb-settings-label' }, name),
            h('div', { className: 'jsb-settings-controls' },
              h(SegmentedControl, { id: `jsb-side-${item.id}`, label: t('settings.side', { name }), value: item.side, disabled,
                options: [{ value: 'left', label: t('settings.left') }, { value: 'right', label: t('settings.right') }],
                onChange: side => run(() => saveItems(layout.placeAt(items, item.id, side, side === 'left' ? Infinity : 0))) }),
              h(Button, { variant: 'ghost', size: 'sm', disabled: disabled || index === 0, 'aria-label': t('settings.earlier', { name }),
                onClick: () => run(() => saveItems(layout.placeAt(items, item.id, item.side, index - 1))) }, '\u2190'),
              h(Button, { variant: 'ghost', size: 'sm', disabled: disabled || index === row.length - 1, 'aria-label': t('settings.later', { name }),
                onClick: () => run(() => saveItems(layout.placeAt(items, item.id, item.side, index + 1))) }, '\u2192'),
              h(Switch, { label: name, checked: !item.hidden, disabled,
                onChange: next => run(() => saveItems([{ op: 'set', path: ['items', item.id, 'hidden'], value: !next }])) })))
        }

        return h('div', null,
          h('section', { className: 'jsb-settings-section', 'aria-labelledby': generalId },
            h('h4', { className: 'jsb-settings-title', id: generalId }, t('settings.general')),
            h('div', { className: 'jsb-settings-row' },
              h('span', { className: 'jsb-settings-label' }, t('settings.compact')),
              h(Switch, { label: t('settings.compact'), checked: value.compact === true, disabled, onChange: next => run(() => setPreference('compact', next)) })),
            h(NumberRow, { label: t('settings.interval'), value: value.interval ?? 2, min: 1, max: 30, disabled, onCommit: next => run(() => setPreference('interval', next)) }),
            h(NumberRow, { label: t('settings.warnAt'), value: value.warnAt ?? 60, min: 1, max: 100, disabled, onCommit: next => run(() => setPreference('warnAt', next)) }),
            h(NumberRow, { label: t('settings.criticalAt'), value: value.criticalAt ?? 85, min: 1, max: 100, disabled, onCommit: next => run(() => setPreference('criticalAt', next)) })),
          h('section', { className: 'jsb-settings-section', 'aria-labelledby': itemsId },
            h('h4', { className: 'jsb-settings-title', id: itemsId }, t('settings.items')),
            h('p', { className: 'jsb-settings-hint' }, t('settings.itemsHint')),
            items.map(itemRow),
            h('div', { className: 'jsb-settings-actions' },
              h(Button, { variant: 'outline', size: 'sm', disabled, onClick: () => run(() => saveItems([{ op: 'unset', path: ['items'] }])) }, t('settings.reset')))),
          failed && h('p', { className: 'jsb-settings-error', role: 'alert' }, t('saveFailed')),
          snapshot.status === 'ready' && !snapshot.writable && h('p', { className: 'jsb-settings-hint', role: 'status' }, t('readOnly')))
      }
    }

    return { createSettingsPage }
  },
})
