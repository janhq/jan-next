window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on', chunk: 'client.bots.js',
  factory(require) {
    const { createElement: h, useEffect, useId, useRef, useState } = require('react')
    const { Button, Checkbox, Input, Modal, SectionHeading, SegmentedTabs, SelectMenu, Toast, Tooltip,
      IconClockOutlineRegular, IconEditOutlineRegular, IconLinkOutlineRegular, IconLoadingOutlineRegular,
      IconPauseOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
      IconSearchOutlineRegular, IconSettingsOutlineRegular, IconTrashOutlineRegular, IconUsersOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const palette = ['#42688f', '#8c553d', '#75558b', '#467568', '#676d3e', '#915571', '#436b83', '#974c4c']
    const shapes = ['bubble', 'round', 'square', 'capsule']
    const STOP = Symbol('aborted')
    const sourceKinds = { github: 'GitHub', slack: 'Slack', discord: 'Discord' }
    const sourceOptions = Object.entries(sourceKinds).map(([id, label]) => ({ id, label }))
    const maxSources = 8
    const detailTabs = ['routines', 'sources', 'memory', 'activity']
    const modelKey = model => model ? JSON.stringify({ provider: model.provider, model: model.model }) : ''
    const botFor = (rows, sessionId) => rows?.find(bot => bot.sessionId === sessionId)
    const nameHash = name => { let hash = 0; for (const ch of name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0; return hash }
    const appearanceFor = name => { const hash = nameHash(name.trim().toLowerCase()); return { shape: hash % 4, color: palette[(hash >>> 2) % palette.length], locked: false } }
    const formatTime = (locale, value) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    const callError = error => ({ 'project-not-found': 'missingProject', 'invalid-sources': 'invalidSources' })[error?.message] ?? 'error'
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
    function ButtonAction({ children, ...props }) { return h(Button, { size: 'sm', variant: 'toolbar', ...props }, children) }
    function Failure({ text, retry, t }) {
      return h('div', { className: 'jao-error', role: 'alert' }, t(text ?? 'error'), retry && h(ButtonAction, { onClick: retry }, t('retry')))
    }
    function Loading({ t }) {
      return h('div', { className: 'jao-loading', role: 'status', 'aria-label': t('loading') }, h(IconLoadingOutlineRegular, { size: 18, 'aria-hidden': true }))
    }
    function Empty({ icon, title, description, heading = 'p' }) {
      return h('div', { className: 'jao-empty' }, icon && h(icon, { size: 24, 'aria-hidden': true }), h(heading, null, title), description && h('p', null, description))
    }
    function IconAction({ label, icon: Icon, ...props }) {
      return h(Tooltip, { label, side: 'top', portal: true }, h(Button, { size: 'sm', className: 'jao-icon-action', 'aria-label': label, ...props }, h(Icon, { size: 16, 'aria-hidden': true })))
    }
    function Choice({ label, className, ...props }) {
      return h('div', { className: `jao-field${className ? ` ${className}` : ''}` }, h('span', null, label),
        h(SelectMenu, { ...props, label, align: 'start', className: 'jao-select' }))
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
      return h('main', { className: 'jao-page', 'aria-labelledby': 'jao-roster-title' }, h('div', { className: 'jao-content' },
        h('header', { className: 'jao-roster-head', 'data-window-drag': '' },
          h('h1', { id: 'jao-roster-title' }, t('title')),
          h(ButtonAction, { className: 'jao-page-action', variant: 'primary', onClick: () => dialog({ mode: 'create' }),
            icon: h(IconPlusOutlineRegular, { size: 14, 'aria-hidden': true }) }, t('create')),
          h('p', null, t('intro'))),
        failed && h(Failure, { t, retry: refresh }),
        !rows && !failed && h(Loading, { t }),
        rows?.length > 6 && h(Input, { type: 'search', value: search, onChange: event => setSearch(event.currentTarget.value),
          placeholder: t('search'), 'aria-label': t('search'), className: 'jao-search', icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }) }),
        rows?.length === 0 && h(Empty, { icon: IconUsersOutlineRegular, title: t('empty'), description: t('emptyDetail'), heading: 'h2' }),
        rows?.length > 6 && matched?.length === 0 && h(Empty, { icon: IconSearchOutlineRegular, title: t('noMatches'), heading: 'h2' }),
        matched?.length > 0 && h('ul', { className: 'jao-roster' }, matched.map(bot => h('li', { key: bot.id, className: 'jao-roster-row' },
          h('button', { type: 'button', className: 'jao-roster-open', onClick: () => open(bot) }, h(Seat, { bot, avatar, t }),
            h('span', { className: 'jao-roster-copy' }, h('span', { className: 'jao-roster-name' }, bot.name,
              bot.unread && h('span', { className: 'jao-unread', title: t('unread') })),
              h('span', { className: 'jao-roster-project' }, projectName(bot), bot.role && ` · ${bot.role}`),
              h('span', { className: 'jao-preview' }, bot.latest?.text || bot.description || t('noMessages'))),
            bot.latest && h('time', { dateTime: new Date(bot.latest.at).toISOString() }, formatTime(language, bot.latest.at))),
          h(IconAction, { label: `${t('edit')}: ${bot.name}`, icon: IconEditOutlineRegular,
            onClick: () => dialog({ mode: 'edit', bot }) }))))))
    }
    function HeaderAvatar({ sessionId, blank, useRoster, t, avatar, openDetail }) {
      const bot = useRoster(state => botFor(state.rows, sessionId))
      return bot ? h('div', { className: 'jao-header-avatar' }, h(Seat, { bot, t, avatar }),
        blank && h(ButtonAction, { variant: 'ghost', title: t('details'), onClick: openDetail }, bot.name)) : null
    }
    function HeaderTools({ sessionId, useRoster, t, dialog, openDetail }) {
      const bot = useRoster(state => botFor(state.rows, sessionId))
      return bot && h('div', { className: 'jao-header-actions' },
        h(ButtonAction, { variant: 'ghost', onClick: openDetail }, t('details')),
        h(IconAction, { label: t('edit'), icon: IconSettingsOutlineRegular, onClick: () => dialog({ mode: 'edit', bot }) }))
    }
    function WatchFields({ t, sources, add, update, remove }) {
      return h('section', { className: 'jao-watch' },
        h('div', { className: 'jao-section-heading' }, h(SectionHeading, { as: 'h3' }, t('watch')),
          h(ButtonAction, { onClick: add, disabled: sources.length >= maxSources,
            icon: h(IconPlusOutlineRegular, { size: 14, 'aria-hidden': true }) }, t('addSource'))),
        h('p', { className: 'jao-hint' }, t(sources.length >= maxSources ? 'sourceLimit' : 'watchHint')),
        sources.map(({ key, kind, target, everyMinutes }) => h('div', { key, className: 'jao-source-draft jao-card' },
          h(Choice, { label: t('sourceKind'), value: kind, options: sourceOptions, onChange: kind => update(key, { kind }) }),
          h('label', { className: 'jao-field' }, t(kind === 'github' ? 'repository' : 'channelId'),
            h(Input, { value: target, required: true, maxLength: 140, autoCapitalize: 'off', spellCheck: false,
              placeholder: kind === 'github' ? 'owner/repo' : t('channelId'), onChange: event => update(key, { target: event.currentTarget.value }) })),
          h('label', { className: 'jao-field' }, t('intervalMinutes'), h(Input, { type: 'number', min: 5, max: 1440, step: 1,
            required: true, value: everyMinutes, onChange: event => update(key, { everyMinutes: event.currentTarget.value }) })),
          h(IconAction, { label: t('removeSource'), icon: IconTrashOutlineRegular, onClick: () => remove(key) }))))
    }
    function EditForm({ t, avatar, mode, bot, existing, sourceSessionId, useWorkspaces, request, change, close, open, dialog }) {
      const projects = useWorkspaces(state => state.items)
      const [name, setName] = useState(existing?.name ?? '')
      const [custom, setCustom] = useState(existing?.avatar ?? null)
      const [advanced, setAdvanced] = useState(false)
      const [busy, setBusy] = useState(false), [error, setError] = useState(null)
      const options = useRequest(request, 'options', mode === 'create' || advanced ? null : STOP)
      const [project, setProject] = useState('')
      const [preset, setPreset] = useState(existing?.agentPreset ?? '')
      const [model, setModel] = useState(null)
      const [sources, setSources] = useState(() => (existing?.sources ?? []).map(({ kind, target, everyMinutes }, key) => ({ key, kind, target, everyMinutes })))
      const nextSource = useRef(sources.length)
      const defaultModel = mode === 'create' && !sourceSessionId ? options.value?.defaultModel : null
      const defaultModelKey = modelKey(defaultModel)
      const selectedModel = model ?? (mode === 'edit' ? modelKey(existing?.model) : defaultModelKey)
      const appearance = custom ?? appearanceFor(name)
      const title = t(mode === 'edit' ? 'edit' : mode === 'duplicate' ? 'duplicate' : 'create')
      async function save(event) {
        event.preventDefault()
        if (busy) return
        const data = new FormData(event.currentTarget)
        setBusy(true); setError(null)
        try {
          if (mode === 'duplicate') {
            const result = await change('duplicate', { id: bot.id, name }); close(); open(result); return
          }
          const modelChoice = mode === 'edit' ? selectedModel : model
          const input = { name, role: data.get('role'), description: data.get('description'), avatar: custom,
            agentPreset: preset || null, model: modelChoice ? JSON.parse(modelChoice) : null, persona: data.get('persona'),
            sources: sources.map(({ kind, target, everyMinutes }) => ({ kind, target: target.trim(), everyMinutes: Number(everyMinutes) })) }
          const result = mode === 'edit' ? await change('edit', { id: bot.id, patch: input })
            : await change('create', { ...input, sourceSessionId, workspaceId: project || undefined })
          close(); if (mode === 'create') open(result)
        } catch (reason) { setError(callError(reason)) }
        finally { setBusy(false) }
      }
      function randomize() {
        const [a, b] = crypto.getRandomValues(new Uint32Array(2))
        setCustom({ shape: (appearance.shape + 1 + a % 3) % 4, color: palette[b % palette.length], locked: false })
      }
      const models = (options.value?.models ?? []).flatMap(group => group.models.map(item => ({
        id: modelKey({ provider: group.id, model: item.id }), label: `${group.name} / ${item.name}`, name: item.name,
      })))
      const modelOptions = defaultModelKey
        ? [{ id: defaultModelKey, label: `${models.find(item => item.id === defaultModelKey)?.name ?? defaultModel.model} (${t('botDefault')})` }]
        : [{ id: '', label: t('useDefault') }]
      const initialModel = existing?.model
      const initialModelKey = modelKey(initialModel)
      if (initialModelKey && !models.some(item => item.id === initialModelKey)) {
        modelOptions.push({ id: initialModelKey, label: `${initialModel.provider} / ${initialModel.model}` })
      }
      const presets = (options.value?.presets ?? []).map(item => ({ id: item.id, label: item.name ?? item.id }))
      if (preset && !presets.some(item => item.id === preset)) presets.unshift({ id: preset, label: preset })
      return h(Modal, { open: true, title, closeLabel: t('close'), onClose: busy ? () => {} : close,
        className: 'jao-modal', footer: h('div', { className: 'jao-modal-footer' },
          mode === 'edit' && h('div', { className: 'jao-edit-tools' }, h(ButtonAction, { variant: 'ghost', onClick: () => dialog({ mode: 'duplicate', bot }), disabled: busy }, t('duplicate')),
            h(ButtonAction, { variant: 'ghost', onClick: () => dialog({ mode: 'delete', bot }), disabled: busy, className: 'jao-danger' }, t('delete'))),
          h('div', { className: 'jao-footer-right' }, h(Button, { onClick: close, disabled: busy }, t('cancel')),
            h(Button, { type: 'submit', variant: 'primary', form: 'jao-bot-editor', disabled: busy || !name.trim() }, t(busy ? 'saving' : mode === 'create' ? 'create' : 'save')))) },
      h('form', { id: 'jao-bot-editor', className: 'jao-form', onSubmit: save },
        error && h(Failure, { t, text: error }),
        h('div', { className: 'jao-identity' }, h(Seat, { bot: { name: name || t('title'), avatar: custom, paused: false, lastDeliveryAgeMs: null }, t, avatar }),
          h('label', { className: 'jao-field' }, t('name'), h(Input, { value: name, onChange: event => setName(event.currentTarget.value), maxLength: 80,
            'data-modal-autofocus': true, required: true }))),
        mode !== 'duplicate' && h('div', { className: 'jao-form' },
          h('label', { className: 'jao-field' }, t('role'), h(Input, { name: 'role', defaultValue: existing?.role, maxLength: 100, placeholder: t('roleHint') })),
          h('label', { className: 'jao-field' }, t('description'), h('textarea', { name: 'description', rows: 2, defaultValue: existing?.description, maxLength: 500 })),
          mode === 'create' && sourceSessionId && h('p', { className: 'jao-hint' }, t('keepChat')),
          mode === 'create' && !sourceSessionId && h(Choice, { label: t('project'), value: project, onChange: setProject,
            options: [{ id: '', label: t('defaultProject') }, ...projects.filter(item => !item.isDefault).map(item => ({ id: item.workspaceId, label: item.title }))] }),
          mode === 'create' && !sourceSessionId && h(Choice, { label: t('model'), value: selectedModel, onChange: setModel, busy: !options.value && !options.error,
            options: [...modelOptions, ...models.filter(item => item.id !== defaultModelKey)] }),
          mode === 'create' && !sourceSessionId && options.error && !advanced && h(Failure, { t, retry: options.retry }),
          h('details', { className: 'jao-advanced', onToggle: event => { if (event.currentTarget.open) setAdvanced(true) } },
            h('summary', null, t('advanced')), h('div', { className: 'jao-form' },
              h('label', { className: 'jao-field' }, t('persona'), h('textarea', { name: 'persona', rows: 4, maxLength: 32768, defaultValue: existing?.persona })),
              h('div', { className: 'jao-form-pair' },
                h(Choice, { label: t('shape'), value: String(appearance.shape), disabled: appearance.locked,
                  onChange: value => setCustom({ ...appearance, shape: Number(value) }), options: shapes.map((shape, index) => ({ id: String(index), label: t(shape) })) }),
                h('label', { className: 'jao-field' }, t('color'), h('input', { type: 'color', value: appearance.color, disabled: appearance.locked,
                  onChange: event => setCustom({ ...appearance, color: event.currentTarget.value }) }))),
              h('div', { className: 'jao-inline' }, h(ButtonAction, { onClick: randomize, disabled: appearance.locked }, t('randomize')),
                h(Checkbox, { label: t('lock'), checked: appearance.locked, onChange: locked => setCustom({ ...appearance, locked }) })),
              options.error && h(Failure, { t, retry: options.retry }),
              h(Choice, { label: t('preset'), value: preset, onChange: setPreset, busy: advanced && !options.value && !options.error,
                options: [{ id: '', label: t('useDefault') }, ...presets] }),
              (mode !== 'create' || sourceSessionId) && h(Choice, { label: t('model'), value: selectedModel, onChange: setModel, busy: advanced && !options.value && !options.error,
                options: [...modelOptions, ...models.filter(item => item.id !== defaultModelKey)] }))),
          h(WatchFields, { t, sources,
            add: () => {
              const key = nextSource.current++
              setSources(rows => rows.length >= maxSources ? rows : [...rows, { key, kind: 'github', target: '', everyMinutes: 15 }])
            },
            update: (key, patch) => setSources(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row)),
            remove: key => setSources(rows => rows.filter(row => row.key !== key)),
          }))))
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
          h(Button, { onClick: close, disabled: busy }, t('cancel')),
          h(Button, { type: 'button', variant: 'primary', onClick: remove, disabled: busy }, t('delete'))) }, failed && h(Failure, { t }))
    }
    function EditDialog(props) {
      const { mode, bot, request, t, close } = props
      const data = useRequest(request, 'detail', mode === 'edit' ? bot.id : STOP)
      if (mode === 'delete') return h(DeleteDialog, props)
      if (mode === 'edit' && !data.value) return h(Modal, { open: true, title: t('edit'), closeLabel: t('close'), onClose: close },
        data.error ? h(Failure, { t, retry: data.retry }) : h(Loading, { t }))
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
        h(ButtonAction, { variant: adding ? 'ghost' : 'primary', disabled: busy, onClick: () => setAdding(value => !value),
          icon: !adding && h(IconPlusOutlineRegular, { size: 14, 'aria-hidden': true }) }, t(adding ? 'cancel' : 'addRoutine')),
        h(ButtonAction, { variant: 'ghost', onClick: openScheduled }, t('manageRoutines'))),
        error && h(Failure, { t, text: error }), adding && h('form', { className: 'jao-card jao-form', onSubmit: save },
          h('label', { className: 'jao-field' }, t('name'), h(Input, { name: 'title', required: true, maxLength: 120 })),
          h('label', { className: 'jao-field' }, t('taskPrompt'), h('textarea', { name: 'prompt', required: true, maxLength: 4000, rows: 3 })),
          h('label', { className: 'jao-field' }, t('delay'), h(Input, { name: 'delay', type: 'number', min: repeat ? 60 : 1, max: 31536000, defaultValue: 60, required: true })),
          h(Checkbox, { label: t('repeat'), checked: repeat, onChange: setRepeat }),
          h(Button, { className: 'jao-start', type: 'submit', variant: 'primary', size: 'sm', disabled: busy }, t('save'))),
        !bot.routines.length && !adding && h(Empty, { icon: IconClockOutlineRegular, title: t('noRoutines') }),
        bot.routines.map(task => h('article', { key: task.id, className: 'jao-card' },
          h('div', { className: 'jao-section-heading' }, h('h3', null, task.title),
            h(ButtonAction, { variant: 'ghost', onClick: () => openRoutine(bot.sessionId, task.id) }, t('manageRoutine'))),
          h('p', null, task.prompt), h('small', null, `${t(task.status)} · ${formatTime(language, task.scheduledAt)}`))))
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
      const retry = () => refresh(n => n + 1)
      return h('section', { className: 'jao-list' }, h('div', { className: 'jao-memory-tools' },
        h(Choice, { label: t('memoryFile'), value: path, onChange: setPath, options: bot.files.map(id => ({ id, label: id })) }),
        h(ButtonAction, { onClick: retry, icon: h(IconRefreshOutlineRegular, { size: 14, 'aria-hidden': true }) }, t('refresh'))),
        value?.path === path && value.failed ? h(Failure, { t, retry }) : !file ? h(Loading, { t })
          : h('article', { className: 'jao-card' }, file.text ? h('pre', null, file.text) : h('p', null, t('emptyFile')),
            file.truncated && h('p', null, t('truncated'))))
    }
    function Activity({ bot, t, language }) {
      return h('div', { className: 'jao-list' }, !bot.events.length && !bot.outbox.length && h(Empty, { icon: IconClockOutlineRegular, title: t('noActivity') }),
        bot.events.toReversed().map(event => h('article', { key: event.id, className: 'jao-card' }, h('h3', null, `${t(event.kind)} · ${t(event.status)}`),
          event.text && h('p', null, event.text), event.progressPath && h('code', null, event.progressPath), h('small', null, formatTime(language, event.createdAt)))),
        bot.outbox.toReversed().map(message => h('article', { key: message.id, className: 'jao-card' }, h('h3', null, t('notice')), h('p', null, message.text),
          h('small', null, t(message.status), Number(message.createdAt) > 0 && ` · ${formatTime(language, Number(message.createdAt))}`))))
    }
    const sourceErrorKey = code => ({ 'token-missing': 'tokenMissing', 'token-rejected': 'tokenRejected',
      'not-found': 'sourceNotFound', 'slack-channel_not_found': 'sourceNotFound', 'slack-not_in_channel': 'sourceNotFound',
      'rate-limited': 'sourceRateLimited' })[code] ?? 'sourceFailed'
    function SourceStatus({ source, t, dates, numbers }) {
      const time = at => at == null ? t('noCheckTime') : h('time', { dateTime: new Date(at).toISOString() }, dates.format(at))
      return h('article', { className: 'jao-card' },
        h('h3', null, `${sourceKinds[source.kind]} · ${source.target}`),
        h('dl', { className: 'jao-source-stats' },
          h('div', null, h('dt', null, t('lastCheck')), h('dd', null, time(source.lastCheckAt))),
          h('div', null, h('dt', null, t('nextCheck')), h('dd', null, time(source.nextCheckAt))),
          h('div', null, h('dt', null, t('itemsFound')), h('dd', null, numbers.format(source.lastFound))),
          source.lastError && h('div', { className: 'jao-source-error' }, h('dt', null, t('lastError')),
            h('dd', null, t(sourceErrorKey(source.lastError))))))
    }
    function TokenDialog({ kind, configured, change, close, t }) {
      const formId = useId()
      const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
      const save = async value => {
        setBusy(true); setFailed(false)
        try { await change('setToken', { kind, token: value }); close() }
        catch { setFailed(true) }
        finally { setBusy(false) }
      }
      return h(Modal, { open: true, title: `${sourceKinds[kind]} · ${t(configured ? 'replaceToken' : 'setToken')}`,
        closeLabel: t('close'), description: t('tokensHint'), onClose: busy ? () => {} : close,
        footer: h('div', { className: 'jao-modal-footer' },
          configured && h(Button, { className: 'jao-danger', disabled: busy, onClick: () => save(null) }, t('removeToken')),
          h('div', { className: 'jao-footer-right' }, h(Button, { disabled: busy, onClick: close }, t('cancel')),
            h(Button, { type: 'submit', form: formId, variant: 'primary', disabled: busy || !token.trim() }, t(busy ? 'saving' : 'save')))) },
        h('form', { id: formId, className: 'jao-form', onSubmit: event => { event.preventDefault(); if (!busy && token.trim()) void save(token.trim()) } },
          h('label', { className: 'jao-field' }, t('token'), h(Input, { type: 'password', autoComplete: 'new-password', autoCapitalize: 'off',
            spellCheck: false, maxLength: 4000, value: token, disabled: busy, required: true, 'data-modal-autofocus': true,
            onChange: event => setToken(event.currentTarget.value) })), failed && h(Failure, { t })))
    }
    function Sources({ bot, t, change, language }) {
      const [checking, setChecking] = useState(false), [failed, setFailed] = useState(false), [editing, setEditing] = useState(null)
      const dates = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
      const numbers = new Intl.NumberFormat(language)
      const check = async () => {
        setChecking(true); setFailed(false)
        try { await change('checkNow', { id: bot.id }) }
        catch { setFailed(true) }
        finally { setChecking(false) }
      }
      return h('div', { className: 'jao-sources' },
        h('section', { className: 'jao-list' }, h('div', { className: 'jao-section-heading' },
          h(SectionHeading, { as: 'h3' }, t('watch')), h(ButtonAction, { variant: 'primary', disabled: checking || !bot.sources.length, onClick: check,
            icon: h(IconRefreshOutlineRegular, { size: 14, 'aria-hidden': true }) }, t(checking ? 'checking' : 'checkNow'))),
          failed && h(Failure, { t, retry: check }),
          bot.sources.length ? bot.sources.map(source => h(SourceStatus, { key: `${source.kind}:${source.target}`, source, t, dates, numbers }))
            : h(Empty, { icon: IconLinkOutlineRegular, title: t('noSources'), description: t('noSourcesHint') })),
        h('section', { className: 'jao-list' }, h('div', null, h(SectionHeading, { as: 'h3' }, t('tokens')),
          h('p', { className: 'jao-hint' }, t('tokensHint'))),
          h('ul', { className: 'jao-token-list' }, sourceOptions.map(({ id, label }) => h('li', { key: id, className: 'jao-token-row' },
            h('div', null, h('h4', null, label), h('p', { className: 'jao-hint' }, t(bot.tokens[id] ? 'tokenSet' : id === 'github' ? 'tokenOptional' : 'tokenMissing'))),
            h(ButtonAction, { onClick: () => setEditing(id), 'aria-label': `${label}: ${t(bot.tokens[id] ? 'replaceToken' : 'setToken')}` },
              t(bot.tokens[id] ? 'replaceToken' : 'setToken')))))),
        editing && h(TokenDialog, { key: editing, kind: editing, configured: bot.tokens[editing], t, change, close: () => setEditing(null) }))
    }
    function Details(props) {
      const { sessionId, useRoster, t, avatar, useLanguage, request, change, dialog, compact } = props
      const bot = useRoster(state => botFor(state.rows, sessionId))
      const revision = useRoster(state => state.revision), language = useLanguage(value => value)
      const data = useRequest(request, 'detail', bot?.id ?? STOP, revision)
      const [tab, setTab] = useState('routines'), [busy, setBusy] = useState(false), [error, setError] = useState(null)
      const tabsId = useId()
      if (!bot) return null
      const pause = async () => {
        setBusy(true); setError(null)
        try { await change('setPaused', { id: bot.id, paused: !bot.paused }) }
        catch (reason) { setError(callError(reason)) }
        finally { setBusy(false) }
      }
      const tabs = detailTabs.map(key => ({ value: key, label: h('span', null, t(key)), id: `${tabsId}-${key}`, panelId: `${tabsId}-${key}-panel` }))
      const body = !data.value ? !data.error && h(Loading, { t }) : h(
        tab === 'routines' ? Routines : tab === 'sources' ? Sources : tab === 'memory' ? Memory : Activity,
        { ...props, key: bot.id, bot: data.value, language })
      return h('aside', { className: 'jao-details', 'aria-label': t('details') },
        h('header', { className: 'jao-detail-head' }, h(Seat, { bot, t, avatar }),
          h('div', { className: 'jao-detail-identity' }, h('h2', null, bot.name), bot.role && h('p', { className: 'jao-hint' }, bot.role),
            bot.description && h('p', { className: 'jao-hint' }, bot.description))),
        h('div', { className: 'jao-toolbar' },
          h(ButtonAction, { variant: 'ghost', disabled: busy, onClick: pause,
            icon: h(bot.paused ? IconPlayOutlineRegular : IconPauseOutlineRegular, { size: 14, 'aria-hidden': true }) }, t(bot.paused ? 'resume' : 'pause')),
          h(ButtonAction, { variant: 'ghost', onClick: () => dialog({ mode: 'edit', bot }),
            icon: h(IconEditOutlineRegular, { size: 14, 'aria-hidden': true }) }, t('edit')),
          h(ButtonAction, { variant: 'ghost', onClick: () => compact(bot) }, t('newChat'))),
        error && h(Failure, { t, text: error }),
        h(SegmentedTabs, { className: 'jao-tabs', size: 'sm', label: t('details'), items: tabs, value: tab, onChange: setTab }),
        data.error && h(Failure, { t, retry: data.retry }),
        tabs.map(({ value, id, panelId }) => h('div', { key: value, id: panelId, role: 'tabpanel', 'aria-labelledby': id,
          className: 'jao-tab-panel', hidden: tab !== value, tabIndex: 0 }, tab === value && body)))
    }
    const css = `
      .jao-page,.jao-details{flex:1;min-width:0;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family)}
      .jao-page,.jao-details,.jao-card pre{scrollbar-gutter:stable;--jan-scrollbar-width:9px;--jan-scrollbar-thumb-border:2px}
      .jao-content{--jao-page-inset:clamp(24px,4vw,48px);box-sizing:border-box;width:100%;max-width:calc(960px + 2 * var(--jao-page-inset));
        margin-inline:auto;padding:0 var(--jao-page-inset) 48px;display:grid;gap:16px}
      .jao-header-actions,.jao-inline,.jao-edit-tools,.jao-footer-right,.jao-toolbar,.jao-section-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .jao-section-heading{justify-content:space-between}
      .jao-roster-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding-top:28px;margin-bottom:8px}
      [data-platform='darwin'] .jao-roster-head{padding-top:calc(28px + var(--jan-frame-top-clearance,0px))}
      .jao-roster-head h1,.jao-detail-head h2{margin:0;font-size:20px;line-height:28px;font-weight:500;overflow-wrap:anywhere}
      .jao-roster-head h1{grid-column:1;grid-row:1;line-height:32px}
      .jao-roster-head p,.jao-hint{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .jao-roster-head p{grid-column:1 / -1;margin:0}
      .jao-page-action{grid-column:2;grid-row:1;height:32px;padding-inline:12px;gap:6px}
      .jao-roster,.jao-token-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
      .jao-roster-row,.jao-token-row{display:flex;align-items:center;min-width:0;gap:12px;padding-inline-end:12px;
        background:var(--dsw-alias-settings-card-fill);box-shadow:inset 0 0 0 .5px var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg)}
      .jao-roster-open,.jao-project-row{display:flex;align-items:center;min-width:0;gap:12px;text-align:start;font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;
        transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-out)}
      .jao-roster-open{flex:1;padding:12px;border-radius:var(--dsw-radius-lg)}
      @media(hover:hover){.jao-roster-open:hover,.jao-project-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
      .jao-project-row[aria-selected=true]{background:var(--dsw-alias-bg-layer-2)}
      .jao-roster-open:focus-visible,.jao-project-row:focus-visible{outline-offset:-2px}
      .jao-roster-copy{display:grid;gap:2px;flex:1;min-width:0}
      .jao-roster-name{display:flex;align-items:center;gap:8px;font-size:14px;line-height:20px;font-weight:500;overflow-wrap:anywhere}
      .jao-roster-open time,.jao-roster-project,.jao-preview,.jao-card small{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
      .jao-preview{line-height:20px}
      .jao-roster-open time{max-width:145px;text-align:end}
      .jao-preview,.jao-roster-project,.jao-project-row>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .jao-unread{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);display:inline-block;flex:none}
      .jao-avatar{display:block;position:relative;inline-size:42px;block-size:42px;flex:none}
      .jao-avatar[data-still]{opacity:.55}
      .jao-project-rows{display:grid;margin:0 3px 3px 14px;gap:1px}
      .jao-project-row{height:29px;gap:7px;padding:0 8px;width:100%;border-radius:var(--dsw-radius-md);font-size:13px}
      .jao-project-row .jao-avatar{inline-size:24px;block-size:24px}
      .jao-header-avatar{display:inline-flex;vertical-align:middle;margin-inline-start:3px}
      .jao-header-avatar .jao-avatar{inline-size:28px;block-size:28px}
      .jao-dock-title{display:inline-flex;align-items:center;gap:4px;min-width:0}
      .jao-dock-title svg{flex:none}
      .jao-empty,.jao-loading{padding:36px 20px;text-align:center;display:grid;justify-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
      .jao-empty svg{color:var(--dsw-alias-label-caption);margin-bottom:4px}
      .jao-empty h2,.jao-empty p{margin:0;font:inherit}
      .jao-page .jao-empty{padding-block:48px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg)}
      .jao-page .jao-empty h2{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}
      .jao-loading svg{animation:jao-spin 1s linear infinite}
      @keyframes jao-spin{to{transform:rotate(1turn)}}
      .jao-modal{width:560px;max-width:100%}
      .jao-modal-footer{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;width:100%}
      .jao-footer-right{margin-inline-start:auto;justify-content:flex-end}
      .jao-identity,.jao-form-pair{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}
      .jao-identity>:first-child{grid-column:2;grid-row:1}.jao-identity>.jao-field{grid-column:1;grid-row:1}
      .jao-form,.jao-list{display:grid;gap:12px;min-width:0}
      .jao-form{gap:16px;font-size:14px;line-height:20px}
      .jao-field{display:grid;gap:8px;font-size:13px;line-height:18px;min-width:0}
      .jao-field .jao-select{width:100%;max-width:none;justify-content:space-between;height:33px;padding-inline:8px}
      .jao-form input[type=color]{height:36px;width:48px;padding:0;border:0;background:transparent}
      .jao-form textarea{padding:8px;width:100%;box-sizing:border-box;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;
        background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);resize:vertical;min-height:42px}
      .jao-form textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
      .jao-advanced,.jao-watch{border-top:.5px solid var(--dsw-alias-border-l4);padding-top:12px}
      .jao-advanced summary{cursor:pointer;width:fit-content;border-radius:var(--dsw-radius-sm)}
      .jao-advanced[open] summary{margin-bottom:12px}
      .jao-watch{display:grid;gap:8px}
      .jao-watch>.jao-hint{margin:0}
      .jao-source-draft{grid-template-columns:minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr) auto;align-items:end}
      .jao-source-draft .jao-icon-action{align-self:end;height:33px}
      .jao-icon-action{width:28px;flex:none;padding:0;justify-content:center}
      .jao-error,.jao-danger,.jao-source-error dd{color:var(--dsw-alias-state-error-primary)}
      .jao-error{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}
      .jao-details{container:jao-details / inline-size;--jao-detail-inset:24px;padding:16px var(--jao-detail-inset) 24px;box-sizing:border-box;
        display:flex;flex-direction:column;gap:16px;font-size:13px;line-height:20px}
      .jao-detail-head{display:flex;align-items:center;gap:12px}
      .jao-detail-identity{min-width:0}
      .jao-detail-identity .jao-hint{margin:0}
      .jao-toolbar{gap:4px}
      .jao-tabs{flex:none;width:fit-content;max-width:100%;min-width:min(100%,320px);box-sizing:border-box}
      .jao-tabs [role=tab]{min-width:0;padding-inline:8px;font-size:13px}
      .jao-tabs [role=tab]>span{overflow:hidden;text-overflow:ellipsis}
      .jao-tab-panel:not([hidden]){transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-out)}
      @starting-style{.jao-tab-panel:not([hidden]){opacity:0}}
      .jao-card,.jao-token-row{min-width:0;padding:12px;overflow-wrap:anywhere}
      .jao-card{display:grid;gap:8px;box-shadow:inset 0 0 0 .5px var(--dsw-alias-settings-card-stroke);
        border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill)}
      .jao-card h3,.jao-card p,.jao-token-row h4,.jao-token-row p{margin:0}
      .jao-card h3,.jao-token-row h4{font-size:14px;line-height:20px;font-weight:500}
      .jao-card pre{margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-markdown-code-block)}
      .jao-approvals{display:grid;gap:8px;margin-bottom:8px}
      .jao-approvals pre{max-height:220px}
      .jao-memory-tools{display:flex;align-items:end;justify-content:space-between;gap:12px}
      .jao-memory-tools>.jao-field{flex:0 1 280px}
      .jao-memory-tools>button{height:33px;flex:none}
      .jao-start{justify-self:start}
      .jao-sources{display:grid;gap:24px}
      .jao-source-stats{display:flex;gap:8px 20px;flex-wrap:wrap;margin:0}
      .jao-source-stats dt{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .jao-source-stats dd{margin:0}
      .jao-source-error{flex-basis:100%}
      .jao-token-row{justify-content:space-between;flex-wrap:wrap}
      .jao-token-row button{flex:none}
      @container jao-details (max-width:300px){.jao-tabs [role=tab]{padding-inline:4px;font-size:12px}.jao-memory-tools{flex-wrap:wrap}.jao-memory-tools>.jao-field{flex:1 1 100%}}
      @media(max-width:767px){.jao-content{--jao-page-inset:20px}.jao-details{--jao-detail-inset:16px}}
      @media(max-width:500px){.jao-source-draft{grid-template-columns:minmax(0,1fr) auto}.jao-source-draft>.jao-field:not(:nth-child(3)){grid-column:1 / -1}
        .jao-roster-open time{display:none}.jao-header-actions{gap:2px}}
      @media(pointer:coarse){.jao-field textarea,.jao-field input:not([type=color]){font-size:16px}}
      @media(prefers-reduced-motion:reduce){.jao-tab-panel:not([hidden]),.jao-roster-open,.jao-project-row{transition:none}.jao-loading svg{animation:none}}
    `
    return { css, Roster, ProjectRows, HeaderAvatar, HeaderTools, Details, Approvals, Overlays, appearanceFor }
  },
})
