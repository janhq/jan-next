// Browser half of Jan Hosts: the Hosts settings section, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-hosts',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Switch, Tag, StateDot, RiskConfirmation, IconLinkOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-hosts'

    const COPY = {
      en: {
        title: 'Hosts',
        lede: 'Jan on your other computers, and the phones and devices that use the Jan on this computer.',
        'hosts.title': 'Other computers',
        'hosts.lede': 'Save a Jan you run elsewhere to test it and open it here. Its chats, files and tools stay on that computer.',
        'hosts.empty': 'No other computers yet. Add one by its address or over SSH.',
        'hosts.add': 'Add computer',
        'hosts.edit': 'Edit',
        'hosts.remove': 'Remove',
        'hosts.removeTitle': 'Remove {name}?',
        'hosts.removeDescription': 'Jan forgets this computer and its sign-in. Jan on that computer is not changed, and you can add it again any time.',
        'hosts.removeAck': 'I understand this computer will be signed out here.',
        'hosts.keep': 'Keep',
        test: 'Test',
        testing: 'Testing...',
        open: 'Open',
        connect: 'Connect',
        connecting: 'Starting Jan over SSH...',
        disconnect: 'Disconnect',
        'kind.url': 'Address',
        'kind.ssh': 'SSH',
        'state.signedIn': 'Signed in',
        'state.signIn': 'Needs its link',
        'state.connected': 'Connected',
        'state.idle': 'Not connected',
        'form.name': 'Name',
        'form.namePlaceholder': 'Homelab',
        'form.kind': 'How to reach it',
        'form.url': 'Jan link',
        'form.urlHelp': 'Paste the whole jan web: line from that computer, including ?token=. The token signs you in and is stored only on this computer.',
        'form.urlEditHelp': 'Leave the token out to keep the saved sign-in.',
        'form.ssh': 'SSH host',
        'form.sshHelp': 'A Host name from your ssh config, user@host, or user@host:port. Your own SSH keys and config are used; Jan must be installed there.',
        'import.open': 'Import from SSH config',
        'import.title': 'Hosts in your SSH config',
        'import.lede': 'Choose the computers to add. Jan connects by the Host name, so your keys, ports and proxies from the config still apply.',
        'import.loading': 'Reading your SSH config...',
        'import.empty': 'Your SSH config has no Host entries to import.',
        'import.saved': 'Already added',
        'import.submit': 'Import {count}',
        'import.none': 'Import',
        'import.done': 'Added {count}.',
        'import.failed': '{alias}: {message}',
        'form.remotePort': 'Port on that computer',
        'form.command': 'Jan command',
        'form.profile': 'Profile',
        'form.profileHelp': 'Use edge on a Raspberry Pi or another small board. An older Jan without edge needs web.',
        'form.save': 'Save',
        'form.cancel': 'Cancel',
        'devices.title': 'Devices that reach this Jan',
        'devices.lede': 'Turn on device access, then scan the code with a phone on the same network. Each device gets its own sign-in that you can remove here.',
        'devices.switch': 'Device access',
        'devices.running': 'Listening on {url}',
        'devices.off': 'Off. Only this computer can use this Jan.',
        'devices.empty': 'No paired devices yet.',
        'devices.pair': 'Pair a device',
        'devices.pairName': 'Device name',
        'devices.pairPlaceholder': 'Phone',
        'devices.makeCode': 'Make code',
        'devices.scan': 'Scan with the camera of {name}. The link works only for that device; keep it private.',
        'devices.copy': 'Copy link',
        'devices.copied': 'Copied',
        'devices.done': 'Done',
        'devices.paired': 'Paired {date}',
        'devices.seen': 'Last used {date}',
        'devices.never': 'Not used yet',
        'devices.revoke': 'Remove',
        'devices.revokeTitle': 'Remove {name}?',
        'devices.revokeDescription': '{name} is signed out at once, including any chat it has open. Pair it again to bring it back.',
        'devices.revokeAck': 'I understand this device loses access now.',
        'devices.lanWarning': 'Anyone on this network who gets a device link can use this Jan, including its tools and files. Pair only devices you own.',
        loading: 'Loading...',
        error: 'Hosts are unavailable right now: {error}',
        retry: 'Retry',
      },
    }

    const CSS = `
.jh { display: flex; flex-direction: column; gap: 32px; }
.jh-lede { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-wrap: pretty; }
.jh-group { display: flex; flex-direction: column; gap: 8px; }
.jh-group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.jh-group-head h3 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; text-wrap: balance; }
.jh-group-head > button { flex-shrink: 0; }
.jh-list { display: flex; flex-direction: column; }
.jh-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jh-row:last-child { border-bottom: 0; }
.jh-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.jh-name { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; min-width: 0; }
.jh-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jh-detail { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; user-select: text; font-variant-numeric: tabular-nums; }
.jh-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.jh-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.jh-note[data-error] { color: var(--dsw-alias-state-error-primary); }
.jh-empty { margin: 0; padding: 14px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.jh-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px; background: var(--dsw-alias-settings-card-fill); box-shadow: var(--dsw-alias-settings-card-stroke, none); }
.jh-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; }
.jh-form .jh-help { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jh-kinds { display: flex; gap: 16px; border: 0; margin: 0; padding: 0; }
.jh-kinds legend { padding: 0; margin-bottom: 6px; font-size: 13px; }
.jh-kinds label { flex-direction: row; align-items: center; gap: 6px; }
.jh-pick { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; }
.jh-pick label { flex-direction: row; align-items: center; gap: 10px; padding: 6px 0; }
.jh-pick label[data-saved] { color: var(--dsw-alias-label-secondary); }
.jh-pick .jh-detail { margin-inline-start: auto; text-align: end; }
.jh-pair { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; padding: 16px; border-radius: 12px; background: var(--dsw-alias-settings-card-fill); }
.jh-qr { flex-shrink: 0; width: 200px; aspect-ratio: 1; padding: 8px; border-radius: 8px; background: #fff; color: #000; }
.jh-qr svg { display: block; width: 100%; height: 100%; }
.jh-pair-text { display: flex; flex-direction: column; gap: 12px; flex: 1 1 220px; min-width: 0; }
.jh-pair-text code { font-size: 12px; overflow-wrap: anywhere; user-select: text; }
.jh-inline { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
.jh-inline label { flex: 1 1 180px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; }
.jh-warning { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
@media (pointer: coarse) { .jh input { font-size: 16px; } }
@media (max-width: 600px) {
  .jh-row { flex-direction: column; align-items: stretch; }
  .jh-actions { justify-content: flex-start; }
  .jh-qr { width: 100%; max-width: 260px; }
}`

    async function api(method, params = {}) {
      const response = await fetch('/jan-api/hosts', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }),
      })
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    function when(value) {
      return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }

    /** One action per row at a time; its outcome stays beside the row it came from. */
    function useRowActions() {
      const [busy, setBusy] = React.useState({})
      const [notes, setNotes] = React.useState({})
      const run = async (id, key, task) => {
        setBusy(current => ({ ...current, [id]: key }))
        setNotes(current => ({ ...current, [id]: undefined }))
        try {
          const note = await task()
          if (note !== undefined) setNotes(current => ({ ...current, [id]: note }))
        } catch (error) {
          setNotes(current => ({ ...current, [id]: { text: error instanceof Error ? error.message : String(error), error: true } }))
        } finally {
          setBusy(current => ({ ...current, [id]: undefined }))
        }
      }
      return { busy, notes, run }
    }

    function HostForm({ t, initial, onSaved, onCancel }) {
      const [kind, setKind] = React.useState(initial?.kind ?? 'url')
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      return h('form', {
        className: 'jh-form', 'aria-label': initial ? t('hosts.edit') : t('hosts.add'),
        async onSubmit(event) {
          event.preventDefault()
          const data = Object.fromEntries(new FormData(event.currentTarget))
          setSaving(true)
          setError(null)
          try {
            await api('save', { ...data, kind, ...(initial ? { id: initial.id } : {}) })
            onSaved()
          } catch (failure) {
            setError(failure.message)
          } finally {
            setSaving(false)
          }
        },
      },
        h('label', null, t('form.name'), h(Input, { name: 'name', required: true, maxLength: 64, defaultValue: initial?.name, placeholder: t('form.namePlaceholder'), autoComplete: 'off' })),
        h('fieldset', { className: 'jh-kinds' }, h('legend', null, t('form.kind')),
          ['url', 'ssh'].map(value => h('label', { key: value },
            h('input', { type: 'radio', name: 'kindChoice', value, checked: kind === value, onChange: () => setKind(value) }), t(`kind.${value}`)))),
        kind === 'url'
          ? h('label', null, t('form.url'),
            h(Input, { name: 'url', required: true, defaultValue: initial?.url, placeholder: 'http://192.168.1.20:3080/?token=...', inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }),
            h('span', { className: 'jh-help' }, initial ? t('form.urlEditHelp') : t('form.urlHelp')))
          : [
            h('label', { key: 'ssh' }, t('form.ssh'),
              h(Input, { name: 'ssh', required: true, defaultValue: initial?.ssh, placeholder: 'pi@raspberrypi.local', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }),
              h('span', { className: 'jh-help' }, t('form.sshHelp'))),
            h('div', { key: 'more', className: 'jh-inline' },
              h('label', null, t('form.remotePort'), h(Input, { name: 'remotePort', type: 'number', inputMode: 'numeric', min: 1, max: 65535, defaultValue: initial?.remotePort ?? 3080 })),
              h('label', null, t('form.command'), h(Input, { name: 'command', defaultValue: initial?.command ?? 'jan', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false })),
              h('label', null, t('form.profile'), h(Input, { name: 'profile', defaultValue: initial?.profile ?? 'web', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }))),
            h('span', { key: 'help', className: 'jh-help' }, t('form.profileHelp')),
          ],
        error && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, error),
        h('div', { className: 'jh-actions', style: { justifyContent: 'flex-start' } },
          h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving }, t('form.save')),
          h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: onCancel }, t('form.cancel'))))
    }

    function SshImport({ t, onDone, onCancel }) {
      const [hosts, setHosts] = React.useState(null)
      const [chosen, setChosen] = React.useState(() => new Set())
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      React.useEffect(() => {
        let live = true
        api('sshConfig').then(result => { if (live) setHosts(result.hosts) }, failure => { if (live) setError(failure.message) })
        return () => { live = false }
      }, [])
      const toggle = (alias, on) => setChosen(current => {
        const next = new Set(current)
        if (on) next.add(alias)
        else next.delete(alias)
        return next
      })
      return h('form', {
        className: 'jh-form', 'aria-label': t('import.title'),
        async onSubmit(event) {
          event.preventDefault()
          setSaving(true)
          setError(null)
          try {
            const result = await api('importSsh', { aliases: [...chosen] })
            if (result.failed.length > 0) {
              setError(result.failed.map(item => t('import.failed', item)).join('\n'))
              setChosen(new Set(result.failed.map(item => item.alias)))
              setHosts(current => current.map(host => result.imported.some(item => item.ssh === host.alias.toLowerCase()) ? { ...host, saved: true } : host))
            } else {
              onDone(t('import.done', { count: result.imported.length }))
            }
          } catch (failure) {
            setError(failure.message)
          } finally {
            setSaving(false)
          }
        },
      },
        h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 500 } }, t('import.title')),
        h('p', { className: 'jh-lede' }, t('import.lede')),
        hosts === null && !error && h('p', { className: 'jh-lede', role: 'status' }, t('import.loading')),
        hosts !== null && hosts.length === 0 && h('p', { className: 'jh-empty' }, t('import.empty')),
        hosts !== null && hosts.length > 0 && h('div', { className: 'jh-pick' }, hosts.map(host => h('label', { key: host.alias, 'data-saved': host.saved ? '' : undefined },
          h('input', { type: 'checkbox', checked: host.saved || chosen.has(host.alias), disabled: host.saved || saving, onChange: (event) => toggle(host.alias, event.currentTarget.checked) }),
          h('span', null, host.alias),
          h('span', { className: 'jh-detail' }, host.saved ? t('import.saved')
            : [host.user && `${host.user}@`, host.hostName ?? host.alias, host.port && `:${host.port}`].filter(Boolean).join(''))))),
        error && h('div', { className: 'jh-note', role: 'alert', 'data-error': '', style: { whiteSpace: 'pre-line' } }, error),
        h('div', { className: 'jh-actions', style: { justifyContent: 'flex-start' } },
          h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || chosen.size === 0 }, chosen.size === 0 ? t('import.none') : t('import.submit', { count: chosen.size })),
          h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: onCancel }, t('form.cancel'))))
    }

    function HostRow({ t, host, busy, note, run, onEdit, onRemove }) {
      const ssh = host.kind === 'ssh'
      const connected = ssh && host.tunnel !== undefined
      const ready = ssh ? connected : host.signedIn
      const openHost = () => run(host.id, 'open', async () => {
        const { url } = await api('open', { id: host.id })
        // The desktop opens http(s) links outside the app window; a browser opens a tab.
        window.open(url, '_blank', 'noopener')
      })
      return h('div', { className: 'jh-row', 'data-host': host.id },
        h('div', { className: 'jh-info' },
          h('div', { className: 'jh-name' }, h('span', null, host.name), h(Tag, { tone: 'neutral' }, t(`kind.${host.kind}`)),
            h(Tag, { tone: ready ? 'success' : 'outline' }, t(ssh ? (connected ? 'state.connected' : 'state.idle') : (host.signedIn ? 'state.signedIn' : 'state.signIn')))),
          h('div', { className: 'jh-detail' }, ssh ? `${host.ssh} · ${host.command} --profile ${host.profile} · port ${host.remotePort}` : host.url),
          busy === 'connect' && h('div', { className: 'jh-note', role: 'status' }, t('connecting')),
          note && h('div', { className: 'jh-note', role: note.error ? 'alert' : 'status', 'data-error': note.error || undefined }, note.text)),
        h('div', { className: 'jh-actions' },
          ssh && !connected && h(Button, { size: 'sm', variant: 'outline', disabled: busy !== undefined, onClick: () => run(host.id, 'connect', async () => { await api('connect', { id: host.id }) }) }, t('connect')),
          ssh && connected && h(Button, { size: 'sm', variant: 'outline', disabled: busy !== undefined, onClick: () => run(host.id, 'disconnect', async () => { await api('disconnect', { id: host.id }) }) }, t('disconnect')),
          h(Button, {
            size: 'sm', variant: 'outline', disabled: busy !== undefined || (ssh && !connected), onClick: () => run(host.id, 'test', async () => {
              const result = await api('test', { id: host.id })
              return { text: result.message, error: result.websocket !== 'ok' }
            })
          }, busy === 'test' ? t('testing') : t('test')),
          h(Button, { size: 'sm', variant: 'outline', disabled: busy !== undefined || (ssh && !connected), onClick: openHost }, t('open')),
          h(Button, { size: 'sm', variant: 'ghost', disabled: busy !== undefined, onClick: onEdit }, t('hosts.edit')),
          h(Button, { size: 'sm', variant: 'ghost', disabled: busy !== undefined, onClick: onRemove }, t('hosts.remove'))))
    }

    function PairPanel({ t, pairing, onDone }) {
      const [copied, setCopied] = React.useState(false)
      return h('div', { className: 'jh-pair', role: 'region', 'aria-label': t('devices.pair') },
        h('div', { className: 'jh-qr', role: 'img', 'aria-label': t('devices.scan', { name: pairing.device.name }), dangerouslySetInnerHTML: { __html: pairing.qr } }),
        h('div', { className: 'jh-pair-text' },
          h('p', { className: 'jh-lede' }, t('devices.scan', { name: pairing.device.name })),
          h('code', null, pairing.url),
          h('div', { className: 'jh-actions', style: { justifyContent: 'flex-start' } },
            h(Button, { size: 'sm', variant: 'outline', onClick: async () => { await navigator.clipboard.writeText(pairing.url); setCopied(true) } }, copied ? t('devices.copied') : t('devices.copy')),
            h(Button, { size: 'sm', variant: 'primary', onClick: onDone }, t('devices.done')))))
    }

    function HostsSection({ t }) {
      const [state, setState] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [editing, setEditing] = React.useState(undefined)
      const [removing, setRemoving] = React.useState(null)
      const [revoking, setRevoking] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [pairing, setPairing] = React.useState(null)
      const [pairError, setPairError] = React.useState(null)
      const [switching, setSwitching] = React.useState(false)
      const [importing, setImporting] = React.useState(false)
      const [imported, setImported] = React.useState(null)
      const { busy, notes, run } = useRowActions()
      const refresh = React.useCallback(async () => {
        try {
          setState(await api('state'))
          setLoadError(null)
        } catch (error) {
          setLoadError(error.message)
        }
      }, [])
      React.useEffect(() => { void refresh() }, [refresh])
      const act = (id, key, task) => run(id, key, async () => { const note = await task(); await refresh(); return note })

      if (state === null) {
        return h('section', { className: 'jh' }, loadError
          ? h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, t('error', { error: loadError }), ' ', h(Button, { size: 'sm', variant: 'outline', onClick: refresh }, t('retry')))
          : h('p', { className: 'jh-lede', role: 'status' }, t('loading')))
      }
      const gateway = state.gateway
      return h('section', { className: 'jh', 'data-jan-hosts': '' },
        h('p', { className: 'jh-lede' }, t('lede')),
        loadError && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, t('error', { error: loadError })),

        h('div', { className: 'jh-group', role: 'group', 'aria-labelledby': 'jh-hosts-title' },
          h('div', { className: 'jh-group-head' },
            h('div', null, h('h3', { id: 'jh-hosts-title' }, t('hosts.title')), h('p', { className: 'jh-lede' }, t('hosts.lede'))),
            editing === undefined && !importing && h('div', { className: 'jh-actions' },
              h(Button, { size: 'sm', variant: 'outline', onClick: () => { setImported(null); setImporting(true) } }, t('import.open')),
              h(Button, { size: 'sm', variant: 'outline', onClick: () => { setImported(null); setEditing(null) } }, t('hosts.add')))),
          importing && h(SshImport, {
            t, onDone: (message) => { setImporting(false); setImported(message); void refresh() }, onCancel: () => { setImporting(false); void refresh() }
          }),
          imported && h('div', { className: 'jh-note', role: 'status' }, imported),
          editing !== undefined && h(HostForm, {
            key: editing?.id ?? 'new', t, initial: editing ?? undefined,
            onSaved: () => { setEditing(undefined); void refresh() }, onCancel: () => setEditing(undefined)
          }),
          h('div', { className: 'jh-list' },
            state.connections.length === 0 && editing === undefined && !importing
              ? h('p', { className: 'jh-empty' }, t('hosts.empty'))
              : state.connections.map(host => h(HostRow, {
                key: host.id, t, host, busy: busy[host.id], note: notes[host.id], run: act,
                onEdit: () => setEditing(host), onRemove: () => { setAcknowledged(false); setRemoving(host) }
              })))),

        h('div', { className: 'jh-group', role: 'group', 'aria-labelledby': 'jh-devices-title' },
          h('div', { className: 'jh-group-head' },
            h('div', null, h('h3', { id: 'jh-devices-title' }, t('devices.title')), h('p', { className: 'jh-lede' }, t('devices.lede'))),
            h(Switch, {
              label: t('devices.switch'), checked: gateway.enabled, disabled: switching, onChange: async (next) => {
                setSwitching(true)
                try { await api('enableGateway', { enabled: next }) } catch (error) { setLoadError(error.message) } finally { setSwitching(false); await refresh() }
              }
            })),
          h('div', { className: 'jh-detail', role: 'status' },
            h(StateDot, { state: gateway.running ? 'done' : gateway.error ? 'error' : 'idle' }), ' ',
            gateway.running ? t('devices.running', { url: gateway.url }) : gateway.error ?? t('devices.off')),
          gateway.running && h('p', { className: 'jh-warning' }, t('devices.lanWarning')),
          gateway.running && !pairing && h('form', {
            className: 'jh-inline', async onSubmit(event) {
              event.preventDefault()
              setPairError(null)
              try {
                setPairing(await api('pair', { name: new FormData(event.currentTarget).get('name') }))
                await refresh()
              } catch (error) { setPairError(error.message) }
            }
          },
            h('label', null, t('devices.pairName'), h(Input, { name: 'name', required: true, maxLength: 64, placeholder: t('devices.pairPlaceholder'), autoComplete: 'off' })),
            h(Button, { type: 'submit', size: 'sm', variant: 'primary' }, t('devices.makeCode'))),
          pairError && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, pairError),
          pairing && h(PairPanel, { t, pairing, onDone: () => setPairing(null) }),
          h('div', { className: 'jh-list' },
            state.devices.length === 0
              ? h('p', { className: 'jh-empty' }, t('devices.empty'))
              : state.devices.map(device => h('div', { key: device.id, className: 'jh-row', 'data-device': device.id },
                h('div', { className: 'jh-info' },
                  h('div', { className: 'jh-name' }, h('span', null, device.name)),
                  h('div', { className: 'jh-detail' }, t('devices.paired', { date: when(device.pairedAt) }), ' · ',
                    device.lastSeenAt ? t('devices.seen', { date: when(device.lastSeenAt) }) : t('devices.never')),
                  notes[device.id] && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, notes[device.id].text)),
                h('div', { className: 'jh-actions' },
                  h(Button, { size: 'sm', variant: 'ghost', disabled: busy[device.id] !== undefined, onClick: () => { setAcknowledged(false); setRevoking(device) } }, t('devices.revoke'))))))),

        h(RiskConfirmation, {
          open: removing !== null, title: removing ? t('hosts.removeTitle', { name: removing.name }) : '',
          description: t('hosts.removeDescription'), acknowledgeLabel: t('hosts.removeAck'),
          cancelLabel: t('hosts.keep'), closeLabel: t('hosts.keep'), confirmLabel: t('hosts.remove'),
          acknowledged, onAcknowledgedChange: setAcknowledged, onCancel: () => setRemoving(null),
          onConfirm: () => { const host = removing; setRemoving(null); void act(host.id, 'remove', async () => { await api('remove', { id: host.id }) }) },
        }),
        h(RiskConfirmation, {
          open: revoking !== null, title: revoking ? t('devices.revokeTitle', { name: revoking.name }) : '',
          description: revoking ? t('devices.revokeDescription', { name: revoking.name }) : '', acknowledgeLabel: t('devices.revokeAck'),
          cancelLabel: t('hosts.keep'), closeLabel: t('hosts.keep'), confirmLabel: t('devices.revoke'),
          acknowledged, onAcknowledgedChange: setAcknowledged, onCancel: () => setRevoking(null),
          onConfirm: () => { const device = revoking; setRevoking(null); void act(device.id, 'revoke', async () => { await api('revoke', { id: device.id }) }) },
        }))
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-hosts'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => { style.remove() }, 'jan-hosts: styles')
        ctx.effect(() => ctx.locale.register(NS, COPY), 'jan-hosts: copy')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: NS, order: 80, label: () => t('title'), locale: NS,
        }, HostsSection))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: NS,
        }, ({ size }) => h(IconLinkOutlineRegular, { size, 'aria-hidden': true })))
      },
    }
  },
})
