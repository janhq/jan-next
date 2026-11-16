window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-assistant',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Menu, MenuItemButton, RiskConfirmation, IconChevronDownOutlineRegular, IconUsersOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const CSS = `
.ow-assistants { height:100%; overflow:auto; padding:24px; color:var(--dsw-alias-label-primary); }
.ow-assistants-inner { max-width:960px; margin-inline:auto; }
.ow-assistants h1,.ow-assistants h2 { text-wrap:balance; margin:0; }
.ow-assistants h1 { font-size:24px; }
.ow-assistants h2 { font-size:18px; }
.ow-assistants p { text-wrap:pretty; }
.ow-assistants-header,.ow-assistants-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.ow-assistants-header { justify-content:space-between; margin-bottom:24px; }
.ow-assistants-layout { display:grid; grid-template-columns:minmax(160px,240px) minmax(0,1fr); gap:24px; }
.ow-assistants-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.ow-assistants-list button { width:100%; text-align:left; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:12px; background:var(--dsw-alias-bg-layer-1); color:inherit; cursor:pointer; overflow-wrap:anywhere; }
.ow-assistants-list button[aria-pressed=true] { border-color:var(--dsw-alias-state-business-primary); background:var(--dsw-specific-selector); }
.ow-assistants-list button:focus-visible,.ow-assistants textarea:focus-visible,.ow-assistants select:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.ow-assistants-field { display:flex; flex-direction:column; gap:8px; margin-top:16px; }
.ow-assistants textarea,.ow-assistants select { font:inherit; color:inherit; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:10px 12px; width:100%; box-sizing:border-box; }
.ow-assistants textarea { resize:vertical; min-height:100px; }
.ow-assistants .ow-assistants-instructions { min-height:280px; }
.ow-assistants-actions { margin-top:20px; }
.ow-assistants-muted { color:var(--dsw-alias-label-secondary); font-size:13px; }
.ow-assistants-error { color:var(--dsw-alias-label-primary); border-left:3px solid var(--dsw-alias-state-business-primary); padding-left:12px; }
.ow-assistants-apply { border-top:1px solid var(--dsw-alias-border-l1); margin-top:28px; padding-top:20px; }
.ow-assistant-control { display:inline-flex; align-items:center; gap:4px; height:28px; max-width:200px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; line-height:20px; cursor:pointer; }
.ow-assistant-control:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.ow-assistant-control:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.ow-assistant-control:disabled { cursor:default; opacity:.6; }
.ow-assistant-control-label { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.ow-assistant-error { max-width:280px; color:var(--dsw-alias-state-error-primary); font-size:12px; line-height:16px; overflow-wrap:anywhere; }
@media(max-width:680px) { .ow-assistants { padding:16px; } .ow-assistants-layout { grid-template-columns:1fr; } }
`
    const emptyDraft = () => ({ id: `assistant-${crypto.randomUUID()}`, name: '', description: '', instructions: '' })
    const fields = (item) => ({ id: item.id, name: item.name ?? '', description: item.description ?? '', instructions: item.instructions ?? '' })
    const message = (error) => error instanceof Error ? error.message : String(error)

    async function api(method, params = {}, signal) {
      const response = await fetch('/ow-api/assistant', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }), signal,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.error) throw new Error(body?.error ?? `Assistant request failed (${response.status}).`)
      if (!body || !Object.hasOwn(body, 'result')) throw new Error('The assistant service returned an invalid response.')
      return body.result
    }

    // Labels are the host's durable assignment, read back through
    // getAssignment; confirmed applies from this run update the same memory so
    // the picker and the Assistants page agree without waiting for a read.
    const appliedBySession = new Map()
    const appliedGeneration = new Map()
    const appliedListeners = new Set()
    const rememberApplied = (sessionId, value) => {
      appliedBySession.set(sessionId, value)
      appliedGeneration.set(sessionId, (appliedGeneration.get(sessionId) ?? 0) + 1)
      for (const listener of appliedListeners) listener()
    }
    const generationOf = (sessionId) => appliedGeneration.get(sessionId) ?? 0
    // A read that started before a newer apply must not overwrite its label.
    const readAssignment = async (sessionId, signal, generation) => {
      const result = await api('getAssignment', { sessionId }, signal)
      if (signal?.aborted || generationOf(sessionId) !== generation) return
      if (!result || typeof result.id !== 'string') return
      // A deleted assistant keeps its session instructions; the id is then the
      // only truthful label the host can supply.
      const name = typeof result.name === 'string' && result.name !== '' ? result.name : result.id
      rememberApplied(sessionId, { id: result.id, name })
    }

    function AssistantPicker({ sessionId }) {
      const [open, setOpen] = React.useState(false)
      const [items, setItems] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [, refresh] = React.useReducer((value) => value + 1, 0)
      const applied = appliedBySession.get(sessionId) ?? null

      React.useEffect(() => {
        appliedListeners.add(refresh)
        return () => { appliedListeners.delete(refresh) }
      }, [])

      React.useEffect(() => {
        setOpen(false)
        setItems(null)
        setError('')
        const controller = new AbortController()
        // Unknown reads keep the neutral label; only a host assignment can
        // name the current assistant.
        readAssignment(sessionId, controller.signal, generationOf(sessionId)).catch(() => { })
        return () => controller.abort()
      }, [sessionId])

      React.useEffect(() => {
        if (!open) return
        const controller = new AbortController()
        setLoading(true)
        setError('')
        api('list', {}, controller.signal).then((result) => {
          if (controller.signal.aborted) return
          const list = Array.isArray(result) ? result : []
          setItems(list)
          // The list is the name authority; refresh a remembered label only
          // when the same assistant is still present under a new name.
          const current = appliedBySession.get(sessionId)
          const named = current === undefined ? undefined : list.find((item) => item.id === current.id)
          if (current && named && named.name !== current.name) rememberApplied(sessionId, { id: current.id, name: named.name })
        }).catch((failure) => {
          if (controller.signal.aborted) return
          setItems(null)
          setError(message(failure))
          setOpen(false)
        }).finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
      }, [open, sessionId])

      const choose = async (item) => {
        setOpen(false)
        setBusy(true)
        setError('')
        try {
          const result = await api('apply', { id: item.id, sessionId })
          rememberApplied(sessionId, { id: result?.assistantId ?? item.id, name: item.name })
          // Confirm the persisted assignment without delaying the label; a
          // read failure leaves the response-derived label in place.
          readAssignment(sessionId, undefined, generationOf(sessionId)).catch(() => { })
        } catch (failure) {
          setError(message(failure))
        } finally {
          setBusy(false)
        }
      }

      const label = busy ? 'Applying…' : applied ? applied.name : 'Assistant'
      return h(React.Fragment, null,
        h(Menu, {
          open,
          onClose: () => setOpen(false),
          portal: true,
          side: 'top',
          align: 'start',
          anchor: h('button', {
            type: 'button',
            className: 'ow-assistant-control',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': applied ? `Assistant: ${applied.name}` : 'Choose an assistant',
            disabled: busy,
            onClick: () => setOpen((value) => !value),
          }, h('span', { className: 'ow-assistant-control-label' }, label), h(IconChevronDownOutlineRegular, { size: 14 })),
        },
          loading && h(MenuItemButton, { key: 'loading', disabled: true, onSelect: () => { } }, 'Loading assistants…'),
          !loading && items !== null && items.length === 0 && h(MenuItemButton, { key: 'empty', disabled: true, onSelect: () => { } }, 'No assistants saved yet.'),
          !loading && items !== null && items.map((item) => h(MenuItemButton, {
            key: item.id,
            current: applied?.id === item.id || undefined,
            onSelect: () => { void choose(item) },
          }, item.name))),
        error && h('span', { className: 'ow-assistant-error', role: 'alert' }, error))
    }

    function AssistantsPage({ useSessions }) {
      const uid = React.useId()
      const sessions = useSessions((state) => state)
      const sessionRows = sessions.ids.map((id) => sessions.byId[id]).filter((row) => row && row.origin !== 'subagent' && row.formatStatus !== 'legacy')
      const [items, setItems] = React.useState([])
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [sessionId, setSessionId] = React.useState('')
      const [confirming, setConfirming] = React.useState(false)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [revision, setRevision] = React.useState(0)
      const nameRef = React.useRef(null)
      const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)
      const exists = draft !== null && items.some((item) => item.id === draft.id)
      const selectedSession = sessionRows.find((row) => row.id === sessionId)

      React.useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        setError('')
        api('list', {}, controller.signal).then((result) => {
          if (controller.signal.aborted) return
          setItems(result)
          const first = result[0] ? fields(result[0]) : null
          setDraft(first)
          setSaved(first)
        }).catch((failure) => {
          if (!controller.signal.aborted) setError(message(failure))
        }).finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
      }, [revision])

      const select = (item) => {
        const value = fields(item)
        setDraft(value)
        setSaved(value)
        setError('')
        setStatus('')
      }
      const create = () => {
        setDraft(emptyDraft())
        setSaved(null)
        setError('')
        setStatus('')
        requestAnimationFrame(() => nameRef.current?.focus())
      }
      const change = (key) => (event) => {
        const value = event.currentTarget.value
        setDraft((current) => ({ ...current, [key]: value }))
        setStatus('')
      }
      const save = async (event) => {
        event.preventDefault()
        setBusy('save')
        setError('')
        setStatus('')
        try {
          const result = await api('save', { assistant: draft })
          setItems((current) => current.some((item) => item.id === result.id) ? current.map((item) => item.id === result.id ? result : item) : [...current, result])
          const value = fields(result)
          setDraft(value)
          setSaved(value)
          setStatus('Assistant saved.')
        } catch (failure) { setError(message(failure)) }
        finally { setBusy('') }
      }
      const remove = async () => {
        setBusy('remove')
        setError('')
        setStatus('')
        try {
          await api('remove', { id: draft.id, confirmed: true })
          const remaining = items.filter((item) => item.id !== draft.id)
          setItems(remaining)
          const first = remaining[0] ? fields(remaining[0]) : null
          setDraft(first)
          setSaved(first)
          setConfirming(false)
          setAcknowledged(false)
          setStatus('Assistant deleted. Sessions already using it keep their applied instructions.')
        } catch (failure) {
          setConfirming(false)
          setError(message(failure))
        } finally { setBusy('') }
      }
      const applyAssistant = async () => {
        setBusy('apply')
        setError('')
        setStatus('')
        try {
          await api('apply', { id: draft.id, sessionId })
          rememberApplied(sessionId, { id: draft.id, name: draft.name })
          setStatus(`Applied ${draft.name} to ${selectedSession?.displayTitle ?? sessionId}. Its instructions will be used on the next turn.`)
        } catch (failure) { setError(message(failure)) }
        finally { setBusy('') }
      }
      const disabled = Boolean(busy) || loading
      return h('section', { className: 'ow-assistants', 'aria-labelledby': `${uid}-title`, 'aria-busy': loading || Boolean(busy) },
        h('div', { className: 'ow-assistants-inner' },
          h('header', { className: 'ow-assistants-header' },
            h('div', null, h('h1', { id: `${uid}-title` }, 'Assistants'), h('p', { className: 'ow-assistants-muted' }, 'Save reusable instructions and apply them to a conversation.')),
            h(Button, { variant: 'primary', onClick: create, disabled: disabled || dirty }, 'New assistant')),
          loading && h('p', { role: 'status' }, 'Loading assistants...'),
          error && h('div', { id: `${uid}-error`, role: 'alert', className: 'ow-assistants-error' }, h('p', null, error), !draft && !loading && h(Button, { variant: 'outline', onClick: () => setRevision((value) => value + 1) }, 'Try again')),
          h('p', { role: 'status', 'aria-live': 'polite' }, busy ? ({ save: 'Saving assistant...', remove: 'Deleting assistant...', apply: 'Applying instructions...' })[busy] : status),
          !loading && h('div', { className: 'ow-assistants-layout' },
            h('nav', { 'aria-label': 'Saved assistants' },
              items.length === 0 ? h('p', { className: 'ow-assistants-muted' }, 'No assistants saved yet.') :
                h('ul', { className: 'ow-assistants-list' }, items.map((item) => h('li', { key: item.id },
                  h('button', { type: 'button', 'aria-pressed': draft?.id === item.id, disabled: disabled || dirty, onClick: () => select(item) }, item.name))))),
            draft ? h('div', null,
              h('form', { onSubmit: save, 'aria-describedby': error ? `${uid}-error` : undefined },
                h('h2', null, exists ? 'Edit assistant' : 'Create assistant'),
                h('label', { className: 'ow-assistants-field', htmlFor: `${uid}-name` }, 'Name',
                  h(Input, { id: `${uid}-name`, ref: nameRef, value: draft.name, required: true, maxLength: 200, disabled, onChange: change('name') })),
                h('label', { className: 'ow-assistants-field', htmlFor: `${uid}-description` }, 'Description',
                  h('textarea', { id: `${uid}-description`, value: draft.description, maxLength: 4000, disabled, onChange: change('description'), rows: 3 })),
                h('label', { className: 'ow-assistants-field', htmlFor: `${uid}-instructions` }, 'Instructions',
                  h('textarea', { id: `${uid}-instructions`, className: 'ow-assistants-instructions', value: draft.instructions, maxLength: 262144, disabled, onChange: change('instructions'), rows: 14, 'aria-describedby': `${uid}-instructions-help` })),
                h('p', { id: `${uid}-instructions-help`, className: 'ow-assistants-muted' }, 'These instructions are added to the selected conversation system prompt. Applying another assistant replaces this contribution.'),
                dirty && h('p', { className: 'ow-assistants-muted' }, 'You have unsaved changes. Save or discard them before selecting or creating another assistant, or applying instructions.'),
                h('div', { className: 'ow-assistants-actions' },
                  h(Button, { type: 'submit', variant: 'primary', disabled: disabled || !dirty }, 'Save assistant'),
                  dirty && h(Button, { type: 'button', variant: 'outline', disabled, onClick: () => { setDraft(saved); setError(''); setStatus('Changes discarded.') } }, 'Discard changes'),
                  exists && h(Button, { type: 'button', variant: 'outline', disabled, onClick: () => { setAcknowledged(false); setConfirming(true) } }, 'Delete assistant'))),
              exists && h('section', { className: 'ow-assistants-apply', 'aria-labelledby': `${uid}-apply-title` },
                h('h2', { id: `${uid}-apply-title` }, 'Use in a conversation'),
                h('label', { className: 'ow-assistants-field', htmlFor: `${uid}-session` }, 'Conversation',
                  h('select', { id: `${uid}-session`, value: selectedSession ? sessionId : '', disabled, onChange: (event) => { setSessionId(event.currentTarget.value); setStatus('') }, 'aria-describedby': `${uid}-session-help` },
                    h('option', { value: '' }, 'Select a conversation'),
                    sessionRows.map((row) => h('option', { key: row.id, value: row.id }, `${row.displayTitle}${row.running ? ' (responding)' : ''}`)))),
                h('p', { id: `${uid}-session-help`, className: 'ow-assistants-muted' }, sessionRows.length ? 'Open the conversation first so DSH has loaded its session. Existing messages stay unchanged.' : 'Create or open a conversation to apply an assistant.'),
                h(Button, { variant: 'primary', disabled: disabled || dirty || !selectedSession || selectedSession.running, onClick: applyAssistant }, 'Apply assistant'),
                selectedSession?.running && h('p', { className: 'ow-assistants-muted' }, 'Wait for this conversation to finish responding.')),
              h(RiskConfirmation, {
                open: confirming, title: 'Delete assistant?', description: `Delete ${draft.name || 'this assistant'} from saved assistants? Conversations already using it keep their instructions.`,
                acknowledgeLabel: 'I understand this assistant will be deleted.', cancelLabel: 'Cancel', closeLabel: 'Close deletion confirmation', confirmLabel: 'Delete assistant',
                acknowledged, disabled: Boolean(busy), onAcknowledgedChange: setAcknowledged,
                onCancel: () => { if (!busy) setConfirming(false) }, onConfirm: remove,
              })) : !error && h('div', null, h('h2', null, 'Create an assistant'), h('p', null, 'Choose New assistant to write reusable instructions.')))))
    }

    return {
      name: 'ow-assistant',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@open-waifu/dsh-assistant'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'ow-assistant: styles')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'ow-assistant', label: 'Assistants', order: 40,
        }, ({ size }) => h(IconUsersOutlineRegular, { size, 'aria-hidden': true })))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ow-assistant' }, AssistantsPage))
        // Jan puts the assistant control in the composer's left tool row. The
        // seat is session-scoped, so the picker only exists in a conversation.
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'ow-assistant-picker', order: 10,
        }, AssistantPicker))
      },
    }
  },
})
