window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-assistant',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, RiskConfirmation } = require('@deepseek-ai/dsh-client-ui-primitives')
    async function api(method, params = {}) {
      const response = await fetch('/ow-api/assistant', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `Preset request failed (${response.status}).`)
      return body.result
    }
    function PresetEditor() {
      const [items, setItems] = React.useState([])
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const uid = React.useId()
      const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
      const refresh = () => api('list').then(setItems).catch(failure => setError(failure.message))
      React.useEffect(() => { void refresh() }, [])
      const select = item => { setDraft(item); setSaved(item); setError(''); setNotice('') }
      const change = key => event => { setDraft(current => ({ ...current, [key]: event.target.value })); setNotice('') }
      const save = async event => {
        event.preventDefault()
        setBusy(true); setError('')
        try { const value = await api('save', { assistant: draft }); setSaved(value); setDraft(value); await refresh(); setNotice('Agent preset saved. Select it from the conversation mode menu for the next turn.') }
        catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      const remove = async () => {
        setBusy(true); setError('')
        try { await api('remove', { id: draft.id, confirmed: true }); select(null); await refresh(); setConfirming(false); setNotice('Preset deleted. Existing conversation history is unchanged.') }
        catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      return h('section', { className: 'ow-preset-editor', 'aria-labelledby': `${uid}-heading` },
        h('h3', { id: `${uid}-heading` }, 'Custom instructions'),
        h('p', null, 'Create an agent preset with Standard mode tools and your own instructions. Imported Jan assistants appear here and in the mode menu.'),
        h('div', { className: 'ow-preset-actions' },
          items.map(item => h(Button, { key: item.id, variant: draft?.id === item.id ? 'primary' : 'outline', disabled: busy || dirty, onClick: () => select(item) }, item.name)),
          h(Button, { variant: 'outline', disabled: busy || dirty, onClick: () => { setDraft({ id: `custom-${crypto.randomUUID()}`, name: '', description: '', instructions: '' }); setSaved(null); setError(''); setNotice('') } }, 'New preset')),
        error && h('p', { role: 'alert' }, error),
        h('p', { role: 'status' }, notice),
        draft && h('form', { onSubmit: save, 'aria-busy': busy },
          h('label', { htmlFor: `${uid}-name` }, 'Name'),
          h(Input, { id: `${uid}-name`, value: draft.name, required: true, maxLength: 200, disabled: busy, onChange: change('name') }),
          h('label', { htmlFor: `${uid}-description` }, 'Description'),
          h('textarea', { id: `${uid}-description`, value: draft.description, maxLength: 4000, rows: 2, disabled: busy, onChange: change('description') }),
          h('label', { htmlFor: `${uid}-instructions` }, 'Instructions'),
          h('textarea', { id: `${uid}-instructions`, value: draft.instructions, maxLength: 262144, rows: 10, disabled: busy, onChange: change('instructions') }),
          dirty && h('p', null, 'Unsaved changes are not kept when you close or reload Settings. Save or discard before selecting another preset.'),
          h('div', { className: 'ow-preset-actions' },
            h(Button, { type: 'submit', variant: 'primary', disabled: busy || !dirty }, 'Save preset'),
            h(Button, { type: 'button', variant: 'outline', disabled: busy || !dirty, onClick: () => { setDraft(saved); setError('') } }, 'Discard changes'),
            items.some(item => item.id === draft.id) && h(Button, { type: 'button', variant: 'outline', disabled: busy, onClick: () => { setAcknowledged(false); setConfirming(true) } }, 'Delete preset'))),
        h(RiskConfirmation, { open: confirming, title: 'Delete agent preset?', description: `Delete ${draft?.name || 'this preset'}? Conversation history stays unchanged.`, acknowledgeLabel: 'I understand this preset will be deleted.', cancelLabel: 'Cancel', closeLabel: 'Close deletion confirmation', confirmLabel: 'Delete preset', acknowledged, disabled: busy, onAcknowledgedChange: setAcknowledged, onCancel: () => { if (!busy) setConfirming(false) }, onConfirm: remove }))
    }
    return {
      name: 'ow-assistant', inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.textContent = '.ow-preset-editor{margin-top:24px}.ow-preset-editor h3{text-wrap:balance}.ow-preset-editor p{text-wrap:pretty}.ow-preset-actions{display:flex;flex-wrap:wrap;gap:8px;margin-block:12px}.ow-preset-editor label{display:block;margin-block:16px 8px}.ow-preset-editor textarea{box-sizing:border-box;width:100%;resize:vertical;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}'
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'ow-assistant: preset editor styles')
        ctx.slots.inject('settings.agentPresets.custom', () => ctx.slots.register({ name: 'settings.agentPresets.custom', id: 'ow-custom-instructions' }, PresetEditor))
      },
    }
  },
})
