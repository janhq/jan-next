window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on', chunk: 'client.bots.js',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const { Button, Input, Modal, Toast, IconPlusOutlineRegular, IconSettingsOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const palette = ['#42688f', '#8c553d', '#75558b', '#467568', '#676d3e', '#915571', '#436b83', '#974c4c']
    const shapes = ['bubble', 'round', 'square', 'capsule']
    const STOP = Symbol('aborted')
    const botFor = (rows, sessionId) => rows?.find(bot => bot.sessionId === sessionId)
    const nameHash = name => { let hash = 0; for (const ch of name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0; return hash }
    const appearanceFor = name => { const hash = nameHash(name.trim().toLowerCase()); return { shape: hash % 4, color: palette[(hash >>> 2) % palette.length], locked: false } }
    const formatTime = (locale, value) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    const callError = error => error.message === 'project-not-found' ? 'missingProject' : 'error'
    function useRequest(request, method, key, revision) {
      const [state, setState] = useState({ key, value: null, error: false })
      const [retry, setRetry] = useState(0)
      useEffect(() => {
        if (key === STOP) return
        const controller = new AbortController()
        void request(method, key === null ? undefined : { id: key }, controller.signal).then(value => {
          if (!controller.signal.aborted) setState({ key, value, error: false })
        }, () => { if (!controller.signal.aborted) setState(before => ({ key, value: before.key === key ? before.value : null, error: true })) })
        return () => controller.abort()
      }, [request, method, key, revision, retry])
      return { ...(state.key === key ? state : { value: null, error: false }), retry: () => setRetry(value => value + 1) }
    }
    function ButtonAction({ children, ...props }) { return h(Button, { type: 'button', size: 'sm', variant: 'outline', ...props }, children) }
    function Failure({ text, retry, t }) {
      return h('div', { className: 'jao-error', role: 'alert' }, t(text ?? 'error'), retry && h(ButtonAction, { onClick: retry }, t('retry')))
    }
    function Seat({ bot, t, avatar }) {
      const appearance = bot.avatar ?? appearanceFor(bot.name)
      return h(avatar.Avatar, { t, name: bot.name, appearance, mountBotAvatar: avatar.mountBotAvatar, snapshot: bot })
    }
    function ProjectRows({ workspaceId, useRoster, useSelected, open, avatar, t }) {
      const rows = useRoster(state => state.rows)
      const current = useSelected(value => value)
      const bots = rows?.filter(bot => bot.workspaceId === workspaceId)
      if (!bots?.length) return null
      return h('div', { className: 'jao-project-rows' }, bots.map(bot => h('button', { key: bot.id, type: 'button', role: 'treeitem',
        'aria-selected': current === bot.sessionId, className: 'jao-project-row', onClick: () => open(bot) },
        h(Seat, { bot, t, avatar }), h('span', { title: bot.name }, bot.name), bot.unread && h('span', { className: 'jao-unread', title: t('unread') }))))
    }
    function Roster({ t, avatar, useRoster, useLanguage, useWorkspaces, dialog, open, refresh }) {
      const { rows, failed } = useRoster(value => value), language = useLanguage(value => value)
      const projects = useWorkspaces(state => state.items)
      const [search, setSearch] = useState('')
      const projectName = bot => {
        const project = projects.find(row => row.workspaceId === bot.workspaceId)
        return project?.isDefault && project.title === 'default-workspace' ? t('defaultProject') : project?.title ?? bot.project ?? t('missingProject')
      }
      const matched = rows?.toSorted((a, b) => (b.latest?.at ?? b.createdAt) - (a.latest?.at ?? a.createdAt))
        .filter(bot => rows.length <= 6 || `${bot.name} ${bot.role} ${bot.description} ${projectName(bot)}`.toLocaleLowerCase(language).includes(search.trim().toLocaleLowerCase(language)))
      return h('main', { className: 'jao-page' }, h('div', { className: 'jao-content' },
        h('header', { className: 'jao-roster-head' }, h('div', null, h('h1', null, t('title')), h('p', null, t('intro'))),
          h(ButtonAction, { variant: 'primary', onClick: () => dialog({ mode: 'create' }) }, h(IconPlusOutlineRegular, { size: 14 }), t('create'))),
        failed && h(Failure, { t, retry: refresh }),
        !rows && !failed && h('p', { role: 'status' }, t('loading')),
        rows?.length > 6 && h(Input, { value: search, onChange: event => setSearch(event.currentTarget.value), placeholder: t('search'), 'aria-label': t('search'), className: 'jao-search' }),
        rows?.length === 0 && h('div', { className: 'jao-empty' }, h('h2', null, t('empty')), h('p', null, t('emptyDetail'))),
        rows?.length > 6 && matched?.length === 0 && h('p', { role: 'status' }, t('noMatches')),
        h('div', { className: 'jao-roster' }, matched?.map(bot => h('article', { key: bot.id, className: 'jao-roster-row' },
          h('button', { type: 'button', className: 'jao-roster-open', onClick: () => open(bot) }, h(Seat, { bot, avatar, t }),
            h('span', { className: 'jao-roster-copy' }, h('span', { className: 'jao-roster-name' }, bot.name,
              bot.unread && h('span', { className: 'jao-unread', title: t('unread') })),
              h('span', { className: 'jao-roster-project' }, projectName(bot), bot.role && ` · ${bot.role}`),
              h('span', { className: 'jao-preview' }, bot.latest?.text || bot.description || t('noMessages'))),
            bot.latest && h('time', { dateTime: new Date(bot.latest.at).toISOString() }, formatTime(language, bot.latest.at))),
          h(ButtonAction, { className: 'jao-row-edit', 'aria-label': `${t('edit')}: ${bot.name}`, title: t('edit'),
            onClick: () => dialog({ mode: 'edit', bot }) }, h(IconSettingsOutlineRegular, { size: 16 })))))))
    }
    function HeaderAvatar({ sessionId, blank, useRoster, t, avatar, openDetail }) {
      const bot = useRoster(state => botFor(state.rows, sessionId))
      return bot ? h('div', { className: 'jao-header-avatar' }, h(Seat, { bot, t, avatar }),
        blank && h(ButtonAction, { variant: 'ghost', title: t('details'), onClick: openDetail }, bot.name)) : null
    }
    function HeaderTools({ sessionId, useRoster, t, dialog, openDetail }) {
      const bot = useRoster(state => botFor(state.rows, sessionId))
      return bot && h('div', { className: 'jao-header-actions' },
        h(ButtonAction, { onClick: openDetail }, t('details')),
        h(ButtonAction, { title: t('edit'), 'aria-label': t('edit'), onClick: () => dialog({ mode: 'edit', bot }) }, h(IconSettingsOutlineRegular, { size: 16 })))
    }
    function EditForm({ t, avatar, mode, bot, existing, sourceSessionId, useWorkspaces, request, change, close, open, dialog }) {
      const projects = useWorkspaces(state => state.items)
      const [name, setName] = useState(existing?.name ?? '')
      const [custom, setCustom] = useState(existing?.avatar ?? null)
      const [advanced, setAdvanced] = useState(false)
      const [busy, setBusy] = useState(false), [error, setError] = useState(null)
      const options = useRequest(request, 'options', advanced ? null : STOP)
      const appearance = custom ?? appearanceFor(name)
      const title = t(mode === 'edit' ? 'edit' : mode === 'duplicate' ? 'duplicate' : 'create')
      async function save(event) {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setBusy(true); setError(null)
        try {
          if (mode === 'duplicate') {
            const result = await change('duplicate', { id: bot.id, name }); close(); open(result); return
          }
          const input = { name, role: data.get('role'), description: data.get('description'), avatar: custom,
            agentPreset: data.get('preset') || null, model: data.get('model') ? JSON.parse(data.get('model')) : null,
            persona: data.get('persona') }
          const result = mode === 'edit' ? await change('edit', { id: bot.id, patch: input })
            : await change('create', { ...input, sourceSessionId, workspaceId: data.get('project') || undefined })
          close(); if (mode === 'create') open(result)
        } catch (reason) { setError(callError(reason)) }
        finally { setBusy(false) }
      }
      function randomize() {
        const [a, b] = crypto.getRandomValues(new Uint32Array(2))
        setCustom({ shape: (appearance.shape + 1 + a % 3) % 4, color: palette[b % palette.length], locked: false })
      }
      const initialModel = existing?.model && JSON.stringify({ provider: existing.model.provider, model: existing.model.model })
      const models = options.value?.models ?? []
      const presets = options.value?.presets ?? []
      return h(Modal, { open: true, title, closeLabel: t('close'), onClose: busy ? () => {} : close,
        className: 'jao-modal', footer: h('div', { className: 'jao-modal-footer' },
          mode === 'edit' && h('div', { className: 'jao-edit-tools' }, h(ButtonAction, { onClick: () => dialog({ mode: 'duplicate', bot }), disabled: busy }, t('duplicate')),
            h(ButtonAction, { onClick: () => dialog({ mode: 'delete', bot }), disabled: busy, className: 'jao-danger' }, t('delete'))),
          h('div', { className: 'jao-footer-right' }, h(ButtonAction, { onClick: close, disabled: busy }, t('cancel')),
            h(Button, { type: 'submit', variant: 'primary', form: 'jao-bot-editor', disabled: busy || !name.trim() }, t(busy ? 'saving' : mode === 'create' ? 'create' : 'save')))) },
      h('form', { id: 'jao-bot-editor', className: 'jao-form', onSubmit: save },
        error && h(Failure, { t, text: error }),
        h('div', { className: 'jao-identity' }, h(Seat, { bot: { name: name || t('title'), avatar: custom, paused: false, lastDeliveryAgeMs: null }, t, avatar }),
          h('label', null, t('name'), h(Input, { value: name, onChange: event => setName(event.currentTarget.value), maxLength: 80,
            'data-modal-autofocus': true, required: true }))),
        mode !== 'duplicate' && h('div', { className: 'jao-form' },
          h('label', null, t('role'), h(Input, { name: 'role', defaultValue: existing?.role, maxLength: 100, placeholder: t('roleHint') })),
          h('label', null, t('description'), h('textarea', { name: 'description', rows: 2, defaultValue: existing?.description, maxLength: 500 })),
          mode === 'create' && sourceSessionId && h('p', null, t('keepChat')),
          mode === 'create' && !sourceSessionId && h('label', null, t('project'), h('select', { name: 'project' }, h('option', { value: '' }, t('defaultProject')),
            projects.filter(project => !project.isDefault).map(project => h('option', { key: project.workspaceId, value: project.workspaceId }, project.title)))),
          h('details', { className: 'jao-advanced', onToggle: event => { if (event.currentTarget.open) setAdvanced(true) } },
            h('summary', null, t('advanced')), h('div', { className: 'jao-form' },
              h('label', null, t('persona'), h('textarea', { name: 'persona', rows: 4, maxLength: 32768, defaultValue: existing?.persona })),
              h('div', { className: 'jao-form-pair' },
                h('label', null, t('shape'), h('select', { value: appearance.shape, disabled: appearance.locked,
                  onChange: event => setCustom({ ...appearance, shape: Number(event.currentTarget.value) }) },
                shapes.map((shape, i) => h('option', { key: shape, value: i }, t(shape))))),
                h('label', null, t('color'), h('input', { type: 'color', value: appearance.color, disabled: appearance.locked,
                  onChange: event => setCustom({ ...appearance, color: event.currentTarget.value }) }))),
              h('div', { className: 'jao-inline' }, h(ButtonAction, { onClick: randomize, disabled: appearance.locked }, t('randomize')),
                h('label', { className: 'jao-check' }, h('input', { type: 'checkbox', checked: appearance.locked,
                  onChange: event => setCustom({ ...appearance, locked: event.currentTarget.checked }) }), t('lock'))),
              options.error && h(Failure, { t, retry: options.retry }),
              advanced && !options.value && !options.error && h('p', { role: 'status' }, t('loading')),
              h('label', null, t('preset'), h('select', { name: 'preset', defaultValue: existing?.agentPreset ?? '' },
                h('option', { value: '' }, t('useDefault')),
                existing?.agentPreset && !presets.some(row => row.id === existing.agentPreset) && h('option', { value: existing.agentPreset }, existing.agentPreset),
                presets.map(item => h('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
              h('label', null, t('model'), h('select', { name: 'model', defaultValue: initialModel ?? '' },
                h('option', { value: '' }, t('useDefault')),
                initialModel && !models.some(group => group.id === existing.model.provider && group.models.some(item => item.id === existing.model.model))
                  && h('option', { value: initialModel }, `${existing.model.provider} / ${existing.model.model}`),
                models.map(group => h('optgroup', { key: group.id, label: group.name }, group.models.map(item =>
                  h('option', { key: item.id, value: JSON.stringify({ provider: group.id, model: item.id }) }, item.name)))))))))))
    }
    function DeleteDialog({ bot, t, change, close, showRoster }) {
      const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
      const remove = async () => {
        setBusy(true); setFailed(false)
        try { await change('delete', { id: bot.id }); close(); showRoster() }
        catch { setFailed(true) }
        finally { setBusy(false) }
      }
      return h(Modal, { open: true, title: `${t('delete')}: ${bot.name}`, tone: 'warning', closeLabel: t('close'),
        onClose: busy ? () => {} : close, description: t('deleteDetail'), footer: h('div', { className: 'jao-footer-right' },
          h(ButtonAction, { onClick: close, disabled: busy }, t('cancel')),
          h(Button, { type: 'button', variant: 'primary', onClick: remove, disabled: busy }, t('delete'))) }, failed && h(Failure, { t }))
    }
    function EditDialog(props) {
      const { mode, bot, request, t, close } = props
      const data = useRequest(request, 'detail', mode === 'edit' ? bot.id : STOP)
      if (mode === 'delete') return h(DeleteDialog, props)
      if (mode === 'edit' && !data.value) return h(Modal, { open: true, title: t('edit'), closeLabel: t('close'), onClose: close },
        data.error ? h(Failure, { t, retry: data.retry }) : h('p', { role: 'status' }, t('loading')))
      return h(EditForm, { ...props, existing: mode === 'duplicate' ? { name: `${bot.name.slice(0, 65)} ${t('copySuffix')}` } : data.value })
    }
    function Overlays(props) {
      const { useDialogs, useNotices, useRoster, t, dismissNotice, open, dialog } = props
      const edit = useDialogs(value => value), notice = useNotices(value => value)
      const bot = useRoster(state => state.rows?.find(value => value.id === notice?.botId))
      return h('div', { className: 'jao-overlays' }, edit && h(EditDialog, { ...props, ...edit, key: `${edit.mode}:${edit.sourceSessionId ?? edit.bot?.id ?? ''}`, close: () => dialog(null) }),
        notice && h(Toast, { key: notice.id, text: notice.copy ? t(notice.copy) : notice.kind === 'approval' ? t('review') : notice.text ?? t('error'),
          holdMs: 7000, actions: bot ? [{ label: t('openChat'), onClick: () => { open(bot); dismissNotice() } }] : [], onDone: dismissNotice }))
    }
    function Approvals({ sessionId, useRoster, t, request, change, renderFactorySlot }) {
      const bot = useRoster(state => botFor(state.rows, sessionId))
      const revision = useRoster(state => state.revision)
      const { value } = useRequest(request, 'detail', bot?.blocked ? bot.id : STOP, revision)
      return bot?.blocked && value?.approvals.length ? h('div', { className: 'jao-approvals' }, value.approvals.map(approval => h('article', { key: approval.id, className: 'jao-card' },
        h('pre', null, approval.changes.text), renderFactorySlot('conversation.approval.card', { requestKey: approval.id, title: t('approveTitle'),
          description: t('approveDetail'), canAnswer: () => true,
          onAllow: () => change('answer', { id: bot.id, approvalId: approval.id, decision: 'allowed-once' }),
          onReject: () => change('answer', { id: bot.id, approvalId: approval.id, decision: 'rejected' }) })))) : null
    }
    function Routines({ bot, t, change, openScheduled, openRoutine, language }) {
      const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null)
      const [repeat, setRepeat] = useState(false)
      const save = async event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setBusy(true); setError(null)
        try { await change('schedule', { id: bot.id, title: data.get('title'), prompt: data.get('prompt'), delay: Number(data.get('delay')), repeat }); setAdding(false) }
        catch (reason) { setError(callError(reason)) }
        finally { setBusy(false) }
      }
      return h('section', { className: 'jao-list' }, h('div', { className: 'jao-inline' },
        h(ButtonAction, { onClick: () => setAdding(value => !value) }, t(adding ? 'cancel' : 'addRoutine')), h(ButtonAction, { onClick: openScheduled }, t('manageRoutines'))),
        error && h(Failure, { t, text: error }), adding && h('form', { className: 'jao-card jao-form', onSubmit: save },
          h('label', null, t('name'), h(Input, { name: 'title', required: true, maxLength: 120 })),
          h('label', null, t('taskPrompt'), h('textarea', { name: 'prompt', required: true, maxLength: 4000, rows: 3 })),
          h('label', null, t('delay'), h(Input, { name: 'delay', type: 'number', min: repeat ? 60 : 1, max: 31536000, defaultValue: 60, required: true })),
          h('label', { className: 'jao-check' }, h('input', { type: 'checkbox', checked: repeat, onChange: event => setRepeat(event.currentTarget.checked) }), t('repeat')),
          h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: busy }, t('save'))),
        !bot.routines.length && h('p', null, t('noRoutines')),
        bot.routines.map(task => h('article', { key: task.id, className: 'jao-card' }, h('h3', null, task.title), h('p', null, task.prompt),
          h('small', null, `${t(task.status)} · ${formatTime(language, task.scheduledAt)}`),
          h(ButtonAction, { onClick: () => openRoutine(bot.sessionId, task.id) }, t('manageRoutine')))))
    }
    function Memory({ bot, t, request }) {
      const [path, setPath] = useState('instructions.md'), [value, setValue] = useState(null), [serial, refresh] = useState(0)
      useEffect(() => {
        const control = new AbortController()
        void request('read', { id: bot.id, path }, control.signal).then(file => {
          if (!control.signal.aborted) setValue({ path, file })
        }, () => { if (!control.signal.aborted) setValue({ path, failed: true }) })
        return () => control.abort()
      }, [bot.id, path, request, serial])
      const file = value?.path === path ? value.file : null
      return h('div', { className: 'jao-form' }, h('label', null, t('memoryFile'), h('select', { value: path, onChange: event => setPath(event.currentTarget.value) },
        bot.files.map(name => h('option', { key: name }, name)))), h('div', null, h(ButtonAction, { onClick: () => refresh(n => n + 1) }, t('refresh'))),
        value?.path === path && value.failed ? h(Failure, { t }) : !file ? h('p', { role: 'status' }, t('loading'))
          : h('article', { className: 'jao-card' }, file.text ? h('pre', null, file.text) : t('emptyFile'), file.truncated && h('p', null, t('truncated'))))
    }
    function Activity({ bot, t, language }) {
      return h('div', { className: 'jao-list' }, !bot.events.length && !bot.outbox.length && h('p', null, t('noActivity')),
        bot.events.toReversed().map(event => h('article', { key: event.id, className: 'jao-card' }, h('h3', null, `${t(event.kind)} · ${t(event.status)}`),
          event.text && h('p', null, event.text), event.progressPath && h('code', null, event.progressPath), h('small', null, formatTime(language, event.createdAt)))),
        bot.outbox.toReversed().map(message => h('article', { key: message.id, className: 'jao-card' }, h('h3', null, t('notice')), h('p', null, message.text),
          h('small', null, t(message.status), Number(message.createdAt) > 0 && ` · ${formatTime(language, Number(message.createdAt))}`))))
    }
    function Details(props) {
      const { sessionId, useRoster, t, avatar, useLanguage, request, change, dialog, compact } = props
      const bot = useRoster(state => botFor(state.rows, sessionId))
      const revision = useRoster(state => state.revision), language = useLanguage(value => value)
      const data = useRequest(request, 'detail', bot?.id ?? STOP, revision)
      const [tab, setTab] = useState('routines'), [busy, setBusy] = useState(false), [error, setError] = useState(null)
      if (!bot) return null
      const pause = async () => {
        setBusy(true); setError(null)
        try { await change('setPaused', { id: bot.id, paused: !bot.paused }) }
        catch (reason) { setError(callError(reason)) }
        finally { setBusy(false) }
      }
      return h('aside', { className: 'jao-details', 'aria-label': t('details') }, h('header', null, h(Seat, { bot, t, avatar }),
        h('div', null, h('h2', null, bot.name), bot.role && h('p', null, bot.role))),
        bot.description && h('p', null, bot.description),
        h('div', { className: 'jao-inline' }, h(ButtonAction, { disabled: busy, onClick: pause }, t(bot.paused ? 'resume' : 'pause')),
          h(ButtonAction, { onClick: () => dialog({ mode: 'edit', bot }) }, t('edit')), h(ButtonAction, { onClick: () => compact(bot) }, t('newChat'))),
        error && h(Failure, { t, text: error }),
        h('nav', { 'aria-label': t('details'), className: 'jao-tabs' }, ['routines', 'memory', 'activity'].map(key => h(ButtonAction, { key,
          variant: tab === key ? 'outline' : 'ghost', 'aria-pressed': tab === key, onClick: () => setTab(key) }, t(key)))),
        data.error && h(Failure, { t, retry: data.retry }), !data.value && !data.error && h('p', { role: 'status' }, t('loading')),
        data.value && (tab === 'routines' ? h(Routines, { ...props, bot: data.value, language }) : tab === 'memory'
          ? h(Memory, { key: bot.id, bot: data.value, t, request }) : h(Activity, { bot: data.value, t, language })))
    }
    const css = `
      .jao-page,.jao-details{flex:1;min-width:0;overflow:auto;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .jao-content{margin:auto;max-width:820px;padding:calc(30px + var(--jan-frame-top-clearance,0px)) clamp(18px,5vw,52px) 40px}
      .jao-roster-head,.jao-header-actions,.jao-inline,.jao-edit-tools,.jao-footer-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .jao-roster-head{align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}
      .jao-roster-head h1{margin:0;font-size:25px;font-weight:500;line-height:1.2}
      .jao-roster-head p,.jao-empty p,.jao-details p{margin:5px 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .jao-roster-head button{gap:6px}
      .jao-roster{display:grid;gap:8px;margin-top:12px}
      .jao-roster-row{display:flex;align-items:center;min-width:0;gap:8px;padding:3px 10px 3px 3px;
        border:1px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl)}
      .jao-roster-open,.jao-project-row{display:flex;align-items:center;min-width:0;gap:12px;text-align:left;font:inherit;color:inherit;border:0;background:transparent;cursor:pointer}
      .jao-roster-open{flex:1;padding:9px;border-radius:var(--dsw-radius-lg)}
      .jao-roster-open:hover,.jao-project-row:hover,.jao-project-row[aria-selected=true]{background:var(--dsw-alias-bg-layer-2)}
      .jao-roster-copy{display:grid;gap:3px;flex:1;min-width:0}
      .jao-roster-name{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:500;overflow-wrap:anywhere}
      .jao-roster-open time,.jao-roster-project,.jao-preview,.jao-card small{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .jao-roster-open time{max-width:145px;text-align:right}
      .jao-preview,.jao-roster-project,.jao-project-row>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .jao-unread{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);display:inline-block;flex:none}
      .jao-avatar{display:block;position:relative;inline-size:42px;block-size:42px;flex:none}
      .jao-avatar[data-still]{opacity:.55}
      .jao-project-rows{display:grid;margin:0 3px 3px 14px;gap:1px}
      .jao-project-row{height:29px;gap:7px;padding:0 8px;width:100%;border-radius:var(--dsw-radius-md);font-size:13px}
      .jao-project-row .jao-avatar{inline-size:24px;block-size:24px}
      .jao-header-avatar{display:inline-flex;vertical-align:middle;margin-inline-start:3px}
      .jao-header-avatar .jao-avatar{inline-size:28px;block-size:28px}
      .jao-empty{padding:35px 12px;text-align:center}
      .jao-empty h2,.jao-details h2{font-size:16px;font-weight:500;margin:0}
      .jao-modal-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%}
      .jao-footer-right{margin-inline-start:auto;justify-content:flex-end}
      .jao-identity,.jao-form-pair{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:end}
      .jao-form,.jao-list{display:grid;gap:12px;min-width:0}
      .jao-form label:not(.jao-check){display:grid;gap:5px;font-size:13px;min-width:0}
      .jao-form input:where([type=color]){height:30px;width:54px;padding:0;border:0;background:transparent}
      .jao-form textarea,.jao-form select{padding:7px 9px;width:100%;box-sizing:border-box;min-width:0;color:inherit;font:inherit;
        background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md)}
      .jao-form textarea{resize:vertical;min-height:42px}
      .jao-advanced{border-top:1px solid var(--dsw-alias-border-l4);padding-top:10px}
      .jao-advanced summary{cursor:pointer;margin-bottom:10px}
      .jao-check{display:flex;align-items:center;gap:6px;font-size:13px}
      .jao-error,.jao-danger{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary))}
      .jao-error{display:flex;align-items:center;gap:8px;margin-block:6px;font-size:13px}
      .jao-details{padding:14px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;font-size:13px}
      .jao-details header{display:flex;align-items:center;gap:8px}
      .jao-tabs{display:flex;gap:3px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l4);padding-bottom:6px}
      .jao-card{display:grid;gap:5px;min-width:0;padding:10px 12px;overflow-wrap:anywhere;border:1px solid var(--dsw-alias-settings-card-stroke);
        border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill)}
      .jao-card h3,.jao-card p{margin:0}.jao-card h3{font-size:13px;font-weight:500}
      .jao-card button{justify-self:start}.jao-card pre{margin:0;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-markdown-code-block)}
      .jao-approvals{display:grid;gap:5px;margin-bottom:6px}
      @media(max-width:630px){.jao-roster-open time{display:none}.jao-content{padding-inline:18px}.jao-header-actions{gap:2px}}
    `
    return { css, Roster, ProjectRows, HeaderAvatar, HeaderTools, Details, Approvals, Overlays, appearanceFor }
  },
})
