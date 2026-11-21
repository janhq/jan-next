window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const { Button, IconAlarmClockOutlineRegular, Input, StateDot, Toast } = require('@janhq/jan-client-ui-primitives')
    const PANEL = 'jan-always-on'
    const PATH = '/jan-api/always-on'
    const title = { en: 'Bots', zh: '机器人', ja: 'ボット', es: 'Bots', fr: 'Bots', de: 'Bots', ru: 'Боты', pt: 'Bots' }
    const tabs = ['events', 'timers', 'memory', 'messages']
    let avatarModule
    function loadAvatar() {
      avatarModule ??= Promise.all([require.async('./client.avatar.js'), require.async('./client.open-bot-avatar.js')])
        .then(([{ Avatar }, { mountAvatar }]) => ({ Avatar, mountAvatar }))
        .catch(error => { avatarModule = undefined; throw error })
      return avatarModule
    }
    function AvatarSeat({ state, t }) {
      const [avatar, setAvatar] = useState(null)
      useEffect(() => {
        let disposed = false
        void loadAvatar().then(value => { if (!disposed) setAvatar(value) }, error => console.warn('[always-on] avatar', error))
        return () => { disposed = true }
      }, [])
      return avatar ? h(avatar.Avatar, { snapshot: state, t, mountAvatar: avatar.mountAvatar })
        : h('span', { className: 'jao-avatar', 'aria-hidden': true })
    }

    async function call(method, params, signal) {
      const response = await fetch(PATH, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }), signal })
      if (!response.ok) throw new Error(`Always-on: ${response.status}`)
      return (await response.json()).result
    }

    async function follow(signal, receive) {
      while (!signal.aborted) {
        try {
          const response = await fetch(`${PATH}/feed`, { signal })
          if (!response.ok || !response.body) throw new Error(`Always-on feed: ${response.status}`)
          let pending = ''
          for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
            pending += chunk
            let end
            while ((end = pending.indexOf('\n')) >= 0) {
              receive(JSON.parse(pending.slice(0, end)))
              pending = pending.slice(end + 1)
            }
          }
        } catch (error) {
          if (signal.aborted) return
          console.warn('[always-on]', error)
        }
        if (signal.aborted) return
        const { promise, resolve } = Promise.withResolvers()
        const retry = setTimeout(resolve, 2000)
        signal.addEventListener('abort', resolve, { once: true })
        await promise
        clearTimeout(retry)
        signal.removeEventListener('abort', resolve)
      }
    }

    function Approval({ approval, decide, t, renderFactorySlot }) {
      return h('article', { className: 'jao-card' },
        h('pre', null, approval.changes.text),
        renderFactorySlot('conversation.approval.card', { requestKey: approval.id, title: t('approveTitle'),
          description: t('approveDetail'), canAnswer: () => true,
          onAllow: () => decide(approval.id, 'allowed-once'), onReject: () => decide(approval.id, 'rejected') }))
    }

    function NewTimer({ t, busy, submit }) {
      const [repeat, setRepeat] = useState(false)
      return h('form', { className: 'jao-card jao-form', onSubmit(event) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void submit({ title: data.get('title'), prompt: data.get('prompt'), delay: Number(data.get('delay')),
          repeat }).then(ok => { if (ok) { form.reset(); setRepeat(false) } })
      } }, h('h2', null, t('newTimer')),
      h('label', null, t('timerName'), h(Input, { name: 'title', required: true, maxLength: 120 })),
      h('label', null, t('taskPrompt'), h('textarea', { name: 'prompt', required: true, maxLength: 4000, rows: 3 })),
      h('label', null, t('delay'), h(Input, { name: 'delay', type: 'number', min: repeat ? 60 : 1, max: 31536000, step: 1, defaultValue: 60, required: true })),
      h('label', { className: 'jao-check' }, h('input', { name: 'repeat', type: 'checkbox', checked: repeat,
        onChange: event => setRepeat(event.currentTarget.checked) }), t('repeat')),
      h('div', null, h(Button, { variant: 'primary', type: 'submit', disabled: busy }, t('saveTimer'))))
    }

    function Memory({ files, t }) {
      const [path, setPath] = useState('instructions.md')
      const [file, setFile] = useState(null)
      const serial = useRef(0)
      const select = (value) => {
        const attempt = ++serial.current
        setPath(value); setFile(null)
        void call('read', { path: value }).then(result => {
          if (serial.current === attempt) setFile(result)
        }, () => { if (serial.current === attempt) setFile({ failed: true }) })
      }
      useEffect(() => { select('instructions.md'); return () => { serial.current++ } }, [])
      return h('div', { className: 'jao-card jao-form' }, h('label', null, t('memory'), h('select', {
        value: path, onChange: event => select(event.currentTarget.value),
      }, files.map(name => h('option', { key: name }, name)))),
      h('div', null, h(Button, { variant: 'outline', size: 'sm', onClick: () => select(path) }, t('updated'))),
      file?.text ? h('pre', null, file.text) : h('p', { role: file?.failed ? 'alert' : 'status' },
        t(!file ? 'loading' : file.failed ? 'error' : 'emptyFile')),
      file?.truncated && h('p', null, t('truncated')))
    }

    function Page({ state, refresh, loadingFailed, activeTab, setTab, t, useLanguage, renderFactorySlot, openScheduled }) {
      const language = useLanguage(value => value)
      const date = value => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState(false)
      const command = async (method, params) => {
        setBusy(true); setFailure(false)
        try { const outcome = await call(method, params); await refresh(); return outcome !== false }
        catch { setFailure(true); return false }
        finally { setBusy(false) }
      }
      const decide = async (id, decision) => { if (!await command('answer', { id, decision })) throw new Error('approval') }
      const tab = activeTab
      return h('main', { className: 'jao-page' }, h('div', { className: 'jao-content' },
        h('header', { className: 'jao-header' }, h('div', null, h('h1', null, t('title')), h('p', null, t('intro'))),
          state && h('div', { className: 'jao-actions' },
            h('div', { className: 'jao-presence' }, h(AvatarSeat, { state, t }),
              h('span', { className: 'jao-status', role: 'status' }, h(StateDot, { state: state.enabled && !state.paused ? 'ongoing' : 'idle' }),
                t(!state.enabled ? 'off' : state.paused ? 'paused' : 'active'))),
            h(Button, { variant: state.paused ? 'primary' : 'outline', disabled: busy,
              onClick: () => { void command('setPaused', { paused: !state.paused }) } }, t(!state.enabled ? 'enable' : state.paused ? 'resume' : 'pause')))),
        (failure || loadingFailed) && h('p', { className: 'jao-error', role: 'alert' }, t('error'), ' ',
          h(Button, { size: 'sm', variant: 'outline', onClick: () => { setFailure(false); void refresh() } }, t('updated'))),
        !state && !loadingFailed && h('p', { role: 'status' }, t('loading')),
        state && h('nav', { className: 'jao-nav', 'aria-label': t('title') }, tabs.map(key => h(Button, { key, size: 'sm',
          variant: key === tab ? 'outline' : 'ghost', 'aria-pressed': key === tab, onClick: () => setTab(key) }, t(key)))),
        state && tab === 'events' && h('section', { className: 'jao-list', 'aria-label': t('events') },
          state.approvals.map(approval => h(Approval, { key: approval.id, approval, decide, t, renderFactorySlot })),
          state.events.length === 0 && h('p', null, t('noEvents')),
          state.events.toReversed().map(item => h('article', { className: 'jao-card', key: item.id, 'data-run-id': item.runId },
            h('div', { className: 'jao-row' }, h('h2', null, t(item.kind)), h('span', null, t(item.status))),
            item.text && h('p', null, item.text), item.progressPath && h('code', null, item.progressPath),
            h('small', null, date(item.createdAt))))),
        state && tab === 'timers' && h('section', { className: 'jao-list', 'aria-label': t('timers') },
          h('div', null, h(Button, { variant: 'outline', size: 'sm', onClick: openScheduled }, t('manageTimers'))),
          state.enabled && h(NewTimer, { t, busy, submit: params => command('schedule', params) }),
          state.timers.length === 0 && h('p', null, t('noTimers')),
          state.timers.toReversed().map(timer => h('article', { className: 'jao-card', key: timer.id },
            h('div', { className: 'jao-row' }, h('h2', null, timer.title), h('span', null, t(timer.status))),
            h('p', null, timer.prompt),
            h('div', { className: 'jao-row' }, h('small', null, date(timer.scheduledAt)), timer.status === 'active' && h(Button, {
              size: 'sm', variant: 'outline', disabled: busy, onClick: () => { void command('cancel', { id: timer.id }) },
            }, t('cancelTimer')))))),
        state && tab === 'memory' && h(Memory, { files: state.files, t }),
        state && tab === 'messages' && h('section', { className: 'jao-list', 'aria-label': t('messages') },
          state.outbox.length === 0 && h('p', null, t('noMessages')),
          state.outbox.toReversed().map(message => h('article', { className: 'jao-card', key: message.id },
            h('div', { className: 'jao-row' }, h('small', null, date(Number(message.createdAt))), h('span', null, t(message.status))),
            h('p', null, message.text), message.status === 'sent' && h('form', { className: 'jao-reply', onSubmit(event) {
              event.preventDefault()
              const form = event.currentTarget
              const prompt = new FormData(form).get('reply')
              void command('reply', { id: message.id, sourceId: crypto.randomUUID(), prompt }).then(ok => { if (ok) form.reset() })
            } }, h(Input, { name: 'reply', 'aria-label': t('replyPrompt'), placeholder: t('replyPrompt'), maxLength: 4000, required: true }),
            h(Button, { type: 'submit', size: 'sm', variant: 'outline', disabled: busy }, t('sendReply'))))))))
    }

    const css = `
      .jao-page{flex:1;min-width:0;overflow:auto;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .jao-content{margin:auto;max-width:840px;padding:28px clamp(16px,5vw,48px) 40px}
      [data-platform='darwin'] .jao-content{padding-top:calc(28px + var(--jan-frame-top-clearance,0px))}
      .jao-header,.jao-row,.jao-actions,.jao-reply{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}
      .jao-header>div:first-child{flex:1;min-width:min(280px,100%)}
      .jao-header h1{margin:0;font-size:20px;line-height:28px;font-weight:500}
      .jao-page p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}
      .jao-header p,.jao-page small,.jao-status,.jao-row span{color:var(--dsw-alias-label-secondary)}
      .jao-page .jao-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary))}
      .jao-status,.jao-check{display:inline-flex;align-items:center;gap:6px}
      .jao-presence{display:inline-flex;align-items:center;gap:6px}
      .jao-avatar{display:block;position:relative;inline-size:48px;block-size:48px;flex:none}
      .jao-avatar[data-still]{opacity:.45}
      .jao-nav{display:flex;flex-wrap:wrap;gap:6px;margin:20px 0 12px}
      .jao-list,.jao-form{display:grid;gap:10px;min-width:0}
      .jao-card{border:0.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:16px;min-width:0}
      .jao-card h2{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}
      .jao-form label:not(.jao-check){display:grid;gap:4px;max-width:100%}
      .jao-reply input{flex:1;min-width:min(100%,200px)}
      .jao-form textarea,.jao-form select{box-sizing:border-box;min-width:0;width:100%;padding:8px 12px;color:inherit;font:inherit;
        background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md)}
      .jao-form textarea{resize:vertical}
      .jao-card pre{max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-markdown-code-block)}
    `

    return { name: PANEL, inject: ['slots', 'locale', 'layout', 'configForms'], apply(ctx) {
      const labels = Object.fromEntries(Object.entries(title).map(([locale, value]) => [locale, { title: value }]))
      ctx.effect(() => ctx.locale.register(`${PANEL}.title`, labels))
      const tTitle = ctx.locale.bind(`${PANEL}.title`)
      let dictionaries, disposed = false, tab = 'events'
      let source, lifetime, handling, currentListener
      function loadCopy() {
        dictionaries ??= require.async('./client.copy.js').then(copy => {
          if (disposed) return
          ctx.effect(() => ctx.locale.register(PANEL, Object.fromEntries(Object.entries(copy).map(([locale, messages]) =>
            [locale, { ...messages, title: title[locale] }]))))
        }).catch(error => { dictionaries = undefined; throw error })
        return dictionaries
      }
      function Panel(props) {
        const [state, setState] = useState(null), [failed, setFailed] = useState(false)
        const [loaded, setLoaded] = useState(false), [activeTab, setTab] = useState(tab)
        const lifetime = useRef(null)
        const refresh = async () => {
          const live = lifetime.current
          if (!live || live.signal.aborted) return
          if (live.running) { live.again = true; return live.running }
          live.running = (async () => {
            do {
              live.again = false
              try {
                const value = await call('state', undefined, live.signal)
                if (!live.signal.aborted) { setState(value); setFailed(false) }
              }
              catch { if (!live.signal.aborted) setFailed(true) }
            } while (live.again && !live.signal.aborted)
          })().finally(() => { live.running = undefined })
          return live.running
        }
        useEffect(() => {
          const controller = new AbortController()
          const live = { signal: controller.signal }
          lifetime.current = live
          source = refresh
          const style = document.createElement('style')
          style.textContent = css
          document.head.append(style)
          void loadCopy().then(() => { if (!live.signal.aborted) setLoaded(true) }, () => { if (!live.signal.aborted) setFailed(true) })
          void refresh()
          return () => { controller.abort(); style.remove(); if (source === refresh) source = undefined }
        }, [])
        const t = ctx.locale.bind(PANEL)
        return loaded ? h(Page, { ...props, t, state, refresh, loadingFailed: failed, activeTab,
          openScheduled: () => ctx.layout.selectPanel('schedules'),
          setTab: value => { tab = value; setTab(value) } }) : h('main', { className: 'jao-content', 'aria-busy': !failed }, h('h1', null, tTitle('title')))
      }
      function Notices() {
        const [notice, setNotice] = useState(null)
        useEffect(() => {
          currentListener = setNotice
          return () => { currentListener = undefined }
        }, [])
        return notice && h(Toast, { key: notice.id, text: notice.text, icon: h(IconAlarmClockOutlineRegular), holdMs: 7000,
          actions: [{ label: notice.label, onClick: () => { setNotice(null); tab = notice.tab; ctx.layout.selectPanel(PANEL) } }],
          onDone: () => setNotice(null) })
      }
      const settings = ctx.configForms.describe()
      function syncFeed() {
        const enabled = settings.getSnapshot().view?.namespaces.find(entry => entry.ns === PANEL)?.value?.enabled === true
        if (!enabled) { lifetime?.abort(); lifetime = undefined; return }
        if (lifetime) return
        lifetime = new AbortController()
        void follow(lifetime.signal, event => {
          if (event.kind === 'changed') { source?.(); return }
          if (event.kind !== 'notification' && event.kind !== 'approval') return
          handling ??= new Set()
          if (handling.has(event.id)) return
          handling.add(event.id)
          void loadCopy().then(() => {
            if (disposed) return
            const t = ctx.locale.bind(PANEL)
            currentListener?.({ id: event.id, text: event.kind === 'approval' ? t('review') : event.text,
              label: t('open'), tab: event.kind === 'approval' ? 'events' : 'messages' })
          }).catch(error => console.warn('[always-on]', error))
        })
      }
      ctx.effect(() => {
        const release = settings.subscribe(syncFeed)
        syncFeed()
        return () => { disposed = true; release(); lifetime?.abort() }
      })
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: `${PANEL}.title`,
        inject: () => ({ hooks: { language: { getSnapshot: () => ctx.locale.getSnapshot().active,
          subscribe: listener => ctx.locale.subscribe(listener) } } }),
      }, Panel))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 22,
        label: () => tTitle('title') }, ({ size }) => h(IconAlarmClockOutlineRegular, { size, 'aria-hidden': true })))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: PANEL }, Notices))
    } }
  },
})
