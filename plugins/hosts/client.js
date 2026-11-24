// Browser half of Jan Hosts: the Hosts settings section, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-hosts',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Switch, Tag, StateDot, RiskConfirmation, IconLinkOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-hosts'
    // Below this many config Hosts the whole list fits the picker, so a filter box is noise.
    const FILTER_FROM = 8

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
        openInBrowser: 'Open in browser',
        connect: 'Connect',
        connecting: 'Connecting...',
        'progress.checking': 'Checking that computer...',
        'progress.copying': 'Copying Jan to that computer...',
        'progress.copyingBytes': 'Copying Jan: {sent} of {total} MB',
        'progress.starting': 'Starting Jan there...',
        disconnect: 'Disconnect',
        'setup.title': 'Use your model providers on {name}?',
        'setup.lede': 'Jan on {name} has no model provider set up yet. Copy the ones you choose, with their keys and your default model. Keys travel only through your SSH connection. Nothing that computer already has is replaced.',
        'setup.keyOnly': 'key only',
        'setup.submit': 'Copy {count}',
        'setup.none': 'Copy',
        'setup.skip': 'Not now',
        'setup.done': 'Copied to {name}: {routes}. Reload its window to see them.',
        'setup.doneKept': '{routes} were already there and stay as they are.',
        'bring.open': 'Sync setup…',
        'sync.title': 'Sync setup to {name}',
        'sync.description': 'Review what will change on {name}. Items already there stay unchanged unless you choose to replace them.',
        'sync.providers': 'Model providers',
        'sync.model': 'Default model',
        'sync.keys': 'Provider keys',
        'sync.new': 'Add to remote',
        'sync.selectNew': 'Select visible additions',
        'sync.addItem': 'Add {name} to remote',
        'sync.chooseItem': 'Resolve conflict for {name}',
        'sync.noSelection': 'Select changes to apply',
        'sync.keep': 'Keep remote',
        'sync.replace': 'Use this computer',
        'sync.sensitive': 'May contain credentials',
        'sync.machine': 'Uses settings specific to one computer',
        'sync.unreadable': 'Cannot copy this skill',
        'sync.environment': 'Key is managed by the remote environment',
        'sync.empty': 'No setup changes to apply.',
        'sync.noMatch': 'No items match your filter.',
        'sync.apply': 'Apply {count} changes',
        'sync.applying': 'Applying {count} changes…',
        'sync.refresh': 'Review again',
        'sync.previewFailed': 'Could not compare setup. Reconnect to {name} with the current Jan build and try again.',
        'sync.applyFailed': 'Could not confirm what changed on {name}. Review again before applying more changes.',
        'sync.done': 'Updated {count} items on {name}.',
        'sync.copied': 'Added',
        'sync.replaced': 'Replaced',
        'sync.stale': 'Changed since review. Review again.',
        'sync.failed': 'Could not apply. Check the setup on {name}.',
        'sync.restart': 'Saved. Restart Jan on {name} to apply.',
        'sync.unknown': 'Could not confirm the result. Review again.',
        'sync.unattempted': 'Not applied. Review again.',
        'bring.title': 'Bring your setup to {name}',
        'bring.lede': 'Choose what Jan on {name} should get from this computer. Nothing it already has is replaced.',
        'bring.loading': 'Checking what {name} already has...',
        'bring.empty': '{name} already has every MCP server, skill and plugin from this computer.',
        'bring.servers': 'MCP servers',
        'bring.skills': 'Skills',
        'bring.plugins': 'Plugins',
        'bring.filter': 'Filter by name',
        'bring.localPath': 'Uses a path on this computer',
        'bring.installs': 'Installs {spec}',
        'bring.shipped': 'Turns on',
        'bring.submit': 'Bring {count}',
        'bring.none': 'Bring',
        'bring.working': 'Bringing...',
        'bring.cancel': 'Cancel',
        'bring.done': 'Brought to {name}: {items}. Reload its window to see them.',
        'bring.failed': '{name} didn\u2019t install: {error}',
        'kind.url': 'Address',
        'kind.ssh': 'SSH',
        'state.signedIn': 'Signed in',
        'state.signIn': 'Needs its link',
        'state.connected': 'Connected',
        'state.idle': 'Not connected',
        'state.connecting': 'Connecting',
        'form.name': 'Name',
        'form.namePlaceholder': 'Office desktop',
        'form.namePlaceholderSsh': 'Optional: the host name is used',
        'form.kind': 'How to reach it',
        'form.url': 'Jan link',
        'form.urlHelp': 'Paste the whole jan web: line from that computer, including ?token=. The token signs you in and is stored only on this computer.',
        'form.urlEditHelp': 'Leave the token out to keep the saved sign-in.',
        'form.ssh': 'SSH host',
        'form.sshHelp': 'A Host name from your ssh config, user@host, or user@host:port. Your own SSH keys and config are used. Connect copies Jan there if it is missing; that computer needs no internet.',
        'import.open': 'Import from SSH config',
        'import.title': 'Hosts in your SSH config',
        'import.lede': 'Choose the computers to add. Jan connects by the Host name, so your keys, ports and proxies from the config still apply.',
        'import.loading': 'Reading your SSH config...',
        'import.empty': 'Your SSH config has no Host entries to import.',
        'import.filter': 'Filter {count} hosts',
        'import.filterLabel': 'Filter hosts',
        'import.noMatch': 'No host matches.',
        'import.saved': 'Already added',
        'import.submit': 'Import {count}',
        'import.none': 'Import',
        'import.done': 'Added {count}.',
        'import.failed': '{alias}: {message}',
        'form.save': 'Save',
        'form.cancel': 'Cancel',
        'devices.title': 'Devices that reach this Jan',
        'devices.lede': 'Turn on device access, then scan the code with a phone on the same network. Each device gets its own sign-in that you can remove here.',
        'devices.switch': 'Device access',
        'devices.allowInsecureLan': 'Allow unencrypted LAN access',
        'devices.insecureLanWarning': 'Without HTTPS, anyone who can observe network traffic can capture device sign-ins and activity. Allow this only on a trusted network.',
        'devices.running': 'Listening on {url}',
        'devices.off': 'Off. Only this computer can use this Jan.',
        'devices.empty': 'No paired devices yet.',
        'devices.pair': 'Pair a device',
        'devices.pairName': 'Device name',
        'devices.pairPlaceholder': 'Phone',
        'devices.makeCode': 'Make code',
        'devices.scan': 'Scan with the camera of {name}. The link works once and expires after ten minutes; keep it private.',
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
        'devices.pairWarning': 'Anyone with an unused device link can use this Jan, including its tools and files. Pair only devices you own.',
        loading: 'Loading...',
        error: 'Hosts are unavailable right now: {error}',
        retry: 'Retry',
      },
      zh: {
        'devices.allowInsecureLan': '允许未加密的局域网访问',
        'devices.insecureLanWarning': '如果不使用 HTTPS，能监视网络流量的人就可能截获设备登录凭据和操作信息。请仅在受信任的网络上启用此选项。',
        'devices.scan': '用 {name} 的相机扫描。链接只能使用一次，十分钟后失效，请勿分享。',
        'devices.pairWarning': '拥有未使用配对链接的人都可以使用此 Jan，包括其工具和文件。请只配对自己的设备。',
      },
      ja: {
        'devices.allowInsecureLan': '暗号化されていない LAN アクセスを許可',
        'devices.insecureLanWarning': 'HTTPS を使わない場合、通信を監視できる人にデバイスのログイン情報や操作内容を傍受されるおそれがあります。信頼できるネットワークでのみ許可してください。',
        'devices.scan': '{name} のカメラでスキャンしてください。リンクは一度だけ使え、10 分で期限切れになります。他の人と共有しないでください。',
        'devices.pairWarning': '未使用のペアリングリンクを持つ人は誰でも、この Jan のツールやファイルを利用できます。自分のデバイスだけをペアリングしてください。',
      },
      es: {
        'devices.allowInsecureLan': 'Permitir acceso sin cifrar en la red local',
        'devices.insecureLanWarning': 'Sin HTTPS, cualquiera que pueda observar el tráfico de la red puede interceptar las credenciales y la actividad de los dispositivos. Permite este acceso solo en una red de confianza.',
        'devices.scan': 'Escanea el código con la cámara de {name}. El enlace solo funciona una vez y caduca a los diez minutos. No lo compartas.',
        'devices.pairWarning': 'Cualquiera que tenga un enlace de vinculación sin usar puede acceder a este Jan, incluidas sus herramientas y archivos. Vincula solo tus propios dispositivos.',
      },
      fr: {
        'devices.allowInsecureLan': 'Autoriser l’accès non chiffré sur le réseau local',
        'devices.insecureLanWarning': 'Sans HTTPS, toute personne capable d’observer le trafic réseau peut intercepter les identifiants de connexion et l’activité des appareils. N’autorisez cet accès que sur un réseau de confiance.',
        'devices.scan': 'Scannez le code avec l’appareil photo de {name}. Le lien ne fonctionne qu’une fois et expire au bout de dix minutes. Ne le partagez pas.',
        'devices.pairWarning': 'Toute personne disposant d’un lien d’association inutilisé peut accéder à ce Jan, y compris à ses outils et fichiers. N’associez que vos propres appareils.',
      },
      de: {
        'devices.allowInsecureLan': 'Unverschlüsselten LAN-Zugriff erlauben',
        'devices.insecureLanWarning': 'Ohne HTTPS können Personen, die den Netzwerkverkehr beobachten, Anmeldedaten und Aktivitäten der Geräte abfangen. Erlaube den Zugriff nur in einem vertrauenswürdigen Netzwerk.',
        'devices.scan': 'Scanne den Code mit der Kamera von {name}. Der Link funktioniert nur einmal und läuft nach zehn Minuten ab. Teile ihn nicht.',
        'devices.pairWarning': 'Wer einen unbenutzten Kopplungslink hat, kann dieses Jan samt Werkzeugen und Dateien nutzen. Kopple nur deine eigenen Geräte.',
      },
      ru: {
        'devices.allowInsecureLan': 'Разрешить доступ без шифрования в локальной сети',
        'devices.insecureLanWarning': 'Без HTTPS любой, кто может наблюдать за сетевым трафиком, может перехватить данные для входа и сведения о действиях устройств. Разрешайте доступ только в доверенной сети.',
        'devices.scan': 'Отсканируйте код камерой устройства {name}. Ссылка сработает только один раз и истечёт через десять минут. Не делитесь ею.',
        'devices.pairWarning': 'Любой, у кого есть неиспользованная ссылка для подключения, может пользоваться этим Jan, включая его инструменты и файлы. Подключайте только свои устройства.',
      },
      pt: {
        'devices.allowInsecureLan': 'Permitir acesso sem criptografia na rede local',
        'devices.insecureLanWarning': 'Sem HTTPS, qualquer pessoa que possa observar o tráfego da rede pode interceptar as credenciais e a atividade dos dispositivos. Permita esse acesso somente em uma rede confiável.',
        'devices.scan': 'Escaneie o código com a câmera de {name}. O link funciona uma única vez e expira em dez minutos. Não o compartilhe.',
        'devices.pairWarning': 'Qualquer pessoa com um link de pareamento não utilizado pode acessar este Jan, incluindo suas ferramentas e arquivos. Pareie apenas os seus próprios dispositivos.',
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
.jh-row-note { flex-basis: 100%; }
.jh-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* Up to six buttons would squeeze the name and address; the button group moves under them whole instead. */
.jh-row[data-host] { flex-wrap: wrap; row-gap: 6px; }
[data-host] > .jh-info { flex: 1 1 180px; }
.jh-name { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; min-width: 0; }
.jh-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jh-detail { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; user-select: text; font-variant-numeric: tabular-nums; }
.jh-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
/* Connect and Disconnect share one slot; a fixed width keeps every row's buttons in one column. */
.jh-primary { min-width: 88px; justify-content: center; }
.jh-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.jh-note[data-error] { color: var(--dsw-alias-state-error-primary); }
.jh-empty { margin: 0; padding: 14px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.jh-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px; background: var(--dsw-alias-settings-card-fill); box-shadow: var(--dsw-alias-settings-card-stroke, none); }
.jh-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; }
.jh-form .jh-help { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jh-kinds { display: flex; gap: 16px; border: 0; margin: 0; padding: 0; }
.jh-kinds legend { padding: 0; margin-bottom: 6px; font-size: 13px; }
.jh-kinds label { flex-direction: row; align-items: center; gap: 6px; }
/* The border marks the box's edge, so rows cut at its bottom read as more below, not as the end. */
.jh-pick { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 2px 10px; }
.jh-pick label { flex-direction: row; align-items: center; gap: 10px; padding: 6px 0; min-width: 0; }
.jh-pick label[data-saved] { color: var(--dsw-alias-label-secondary); }
.jh-pick .jh-detail { margin-inline-start: auto; text-align: end; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; }
.jh-bring-group { display: flex; flex-direction: column; gap: 6px; border: 0; margin: 0; padding: 0; min-width: 0; }
.jh-bring-group legend { padding: 0; margin-bottom: 6px; width: 100%; }
.jh-sync-title { margin: 0; font-size: 14px; font-weight: 500; }
.jh-sync-row, .jh-sync-actions, .jh-sync-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.jh-sync-row { justify-content: space-between; padding-block: 8px; }
.jh-sync-row + .jh-sync-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.jh-sync-actions label { padding: 0; }
.jh-sync-actions select { max-width: 100%; color: inherit; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 4px 8px; font: inherit; }
.jh-sync-actions .jh-detail { margin: 0; text-align: start; white-space: normal; }
.jh-form .jh-sync-all { flex-direction: row; align-items: center; }
.jh-bring-name { min-width: 0; overflow-wrap: anywhere; }
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
      const response = await fetch(new URL('jan-api/hosts', document.baseURI), {
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
      const note = (id, value) => setNotes(current => ({ ...current, [id]: value }))
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
      return { busy, notes, run, note }
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
        // An SSH Host left unnamed takes its host name; an Address has nothing readable to fall back on.
        h('label', null, t('form.name'), h(Input, { name: 'name', required: kind !== 'ssh', maxLength: 64, defaultValue: initial?.name, placeholder: kind === 'ssh' ? t('form.namePlaceholderSsh') : t('form.namePlaceholder'), autoComplete: 'off' })),
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
          ],
        error && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, error),
        h('div', { className: 'jh-actions', style: { justifyContent: 'flex-start' } },
          h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving }, t('form.save')),
          h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: onCancel }, t('form.cancel'))))
    }

    function SshImport({ t, onDone, onCancel }) {
      const [hosts, setHosts] = React.useState(null)
      const [filter, setFilter] = React.useState('')
      const [chosen, setChosen] = React.useState(() => new Set())
      const address = host => [host.user && `${host.user}@`, host.hostName ?? host.alias, host.port && `:${host.port}`].filter(Boolean).join('')
      const needle = filter.trim().toLowerCase()
      const shown = hosts === null || needle === '' ? (hosts ?? []) : hosts.filter(host => `${host.alias} ${address(host)}`.toLowerCase().includes(needle))
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
        hosts !== null && hosts.length > FILTER_FROM && h(Input, {
          type: 'search', value: filter, onChange: event => setFilter(event.currentTarget.value), placeholder: t('import.filter', { count: hosts.length }),
          'aria-label': t('import.filterLabel'), autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false,
        }),
        hosts !== null && hosts.length > 0 && h('div', { className: 'jh-pick' }, shown.length === 0 && h('p', { className: 'jh-empty' }, t('import.noMatch')), shown.map(host => h('label', { key: host.alias, 'data-saved': host.saved ? '' : undefined },
          h('input', { type: 'checkbox', checked: host.saved || chosen.has(host.alias), disabled: host.saved || saving, onChange: (event) => toggle(host.alias, event.currentTarget.checked) }),
          h('span', null, host.alias),
          h('span', { className: 'jh-detail', title: address(host) }, host.saved ? t('import.saved') : address(host))))),
        error && h('div', { className: 'jh-note', role: 'alert', 'data-error': '', style: { whiteSpace: 'pre-line' } }, error),
        h('div', { className: 'jh-actions', style: { justifyContent: 'flex-start' } },
          h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || chosen.size === 0 }, chosen.size === 0 ? t('import.none') : t('import.submit', { count: chosen.size })),
          h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: onCancel }, t('form.cancel'))))
    }

    async function openInWindow(id) {
      const { url } = await api('open', { id })
      // The desktop opens http(s) links outside the app window; a browser opens a tab.
      window.open(url, '_blank', 'noopener')
    }

    /** What a running Connect is doing, from the Host's last published step. */
    function progressText(t, progress) {
      if (progress?.step === 'copying' && progress.total > 0) {
        const mb = value => (value / 1e6).toFixed(0)
        return t('progress.copyingBytes', { sent: mb(progress.sent), total: mb(progress.total) })
      }
      return progress?.step === undefined ? t('connecting') : t(`progress.${progress.step}`)
    }

    function HostRow({ t, host, busy, note, run, onEdit, onRemove, onBring }) {
      const ssh = host.kind === 'ssh'
      const connected = ssh && host.tunnel !== undefined
      const ready = ssh ? connected : host.signedIn
      const connecting = !connected && (busy === 'connect' || host.progress !== undefined)
      const sshState = connected ? 'state.connected' : connecting ? 'state.connecting' : 'state.idle'
      const openHost = () => run(host.id, 'open', () => openInWindow(host.id))
      // One press copies Jan there when needed and starts it; its projects and chats open inside this app.
      const connect = () => run(host.id, 'connect', async () => { await api('connect', { id: host.id }) })
      return h('div', { className: 'jh-row', 'data-host': host.id },
        h('div', { className: 'jh-info' },
          h('div', { className: 'jh-name' }, h('span', null, host.name), h(Tag, { tone: 'neutral' }, t(`kind.${host.kind}`)),
            h(Tag, { tone: ready ? 'success' : 'outline' }, t(ssh ? sshState : (host.signedIn ? 'state.signedIn' : 'state.signIn')))),
          h('div', { className: 'jh-detail' }, ssh ? (host.address ?? host.ssh) : host.url),
        ),
        h('div', { className: 'jh-actions' },
          // A Connect started before a reload still runs on the Host; its progress keeps the row busy.
          ssh && !connected && h(Button, { size: 'sm', variant: 'outline', className: 'jh-primary', disabled: busy !== undefined || connecting, onClick: connect }, t('connect')),
          ssh && connected && h(Button, { size: 'sm', variant: 'outline', className: 'jh-primary', disabled: busy !== undefined, onClick: () => run(host.id, 'disconnect', async () => { await api('disconnect', { id: host.id }) }) }, t('disconnect')),
          h(Button, {
            size: 'sm', variant: 'outline', disabled: busy !== undefined || (ssh && !connected), onClick: () => run(host.id, 'test', async () => {
              const result = await api('test', { id: host.id })
              return { text: result.message, error: result.websocket !== 'ok' }
            })
          }, busy === 'test' ? t('testing') : t('test')),
          ssh && connected && h(Button, { size: 'sm', variant: 'outline', disabled: busy !== undefined, onClick: onBring }, t('bring.open')),
          h(Button, { size: 'sm', variant: 'outline', disabled: busy !== undefined || (ssh && !connected), onClick: openHost }, t('openInBrowser')),
          h(Button, { size: 'sm', variant: 'ghost', disabled: busy !== undefined, onClick: onEdit }, t('hosts.edit')),
          h(Button, { size: 'sm', variant: 'ghost', disabled: busy !== undefined, onClick: onRemove }, t('hosts.remove'))),
        // Notes take their own line under the row, so a long result is not squeezed beside the buttons.
        connecting && h('div', { className: 'jh-note jh-row-note', role: 'status' }, progressText(t, host.progress)),
        note && h('div', { className: 'jh-note jh-row-note', role: note.error ? 'alert' : 'status', 'data-error': note.error || undefined }, note.text))
    }

    const SYNC_KINDS = ['providers', 'keys', 'model', 'servers', 'skills', 'plugins']
    const syncId = ({ kind, id }) => JSON.stringify([kind, id])

    function BringSetup({ t, host, onNote, onClose }) {
      const [preview, setPreview] = React.useState(null)
      const [chosen, setChosen] = React.useState(() => new Set())
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [filter, setFilter] = React.useState('')
      const [revision, refresh] = React.useReducer(n => n + 1, 0)
      const [outcomes, setOutcomes] = React.useState(null)
      const hostArgs = { name: host.name }
      React.useEffect(() => {
        let live = true
        api('syncPreview', { id: host.id }).then(result => {
          if (!live) return
          setPreview(result)
          setChosen(new Set(result.rows.filter(row => row.status === 'new' && !row.sensitive).map(syncId)))
        }, () => { if (live) setError('sync.previewFailed') })
        return () => { live = false }
      }, [host.id, revision])
      const reviewAgain = () => {
        setError(null)
        setPreview(null)
        setOutcomes(null)
        setChosen(new Set())
        refresh()
      }
      const choose = (rows, selected) => setChosen(current => {
        const next = new Set(current)
        for (const row of rows) selected ? next.add(syncId(row)) : next.delete(syncId(row))
        return next
      })
      const rows = (preview?.rows ?? []).filter(row => row.status !== 'same')
      const shown = rows.filter(row => row.name.toLowerCase().includes(filter.trim().toLowerCase()))
      const group = kind => {
        const items = shown.filter(row => row.kind === kind)
        if (!items.length) return null
        const additions = items.filter(row => row.status === 'new' && !row.sensitive)
        const label = t(SYNC_KINDS.indexOf(kind) < 3 ? 'sync.' + kind : 'bring.' + kind)
        return h('fieldset', { key: kind, className: 'jh-bring-group', disabled: saving || Boolean(outcomes) || Boolean(error) },
          h('legend', null, label),
          additions.length > 1 && !outcomes && h('label', { className: 'jh-sync-all' },
            h('input', { type: 'checkbox', checked: additions.every(row => chosen.has(syncId(row))), onChange: e => choose(additions, e.currentTarget.checked) }), t('sync.selectNew')),
          h('div', { className: 'jh-pick' }, items.map(row => {
            const id = syncId(row)
            const selected = chosen.has(id)
            const result = outcomes && (outcomes.get(id) ?? (row.status === 'conflict' ? 'keep' : undefined))
            return h('div', { key: id, className: 'jh-sync-row' },
              h('span', { className: 'jh-bring-name' }, row.name),
              h('div', { className: 'jh-sync-actions' },
                result ? h('span', { className: 'jh-detail' }, t('sync.' + result, hostArgs))
                  : row.status === 'new' ? h('label', null,
                    h('input', { type: 'checkbox', checked: selected, 'aria-label': t('sync.addItem', { name: row.name }), onChange: e => choose([row], e.currentTarget.checked) }), t('sync.new'))
                    : row.status === 'conflict' ? h('select', { value: selected ? 'replace' : 'keep', 'aria-label': t('sync.chooseItem', { name: row.name }), onChange: e => choose([row], e.currentTarget.value === 'replace') },
                      h('option', { value: 'keep' }, t('sync.keep')), h('option', { value: 'replace' }, t('sync.replace')))
                      : h('span', { className: 'jh-detail' }, t('sync.' + row.problem)),
                row.sensitive && !result && h('span', { className: 'jh-detail' }, t('sync.sensitive'))))
          })))
      }
      const title = t('sync.title', hostArgs)
      return h('form', {
        className: 'jh-form', 'aria-label': title, async onSubmit(event) {
          event.preventDefault()
          if (saving || error || outcomes || !chosen.size || !preview) return
          setSaving(true)
          const choices = rows.filter(row => chosen.has(syncId(row))).map(({ kind, id, status }) => ({ kind, id, action: status === 'conflict' ? 'replace' : 'add' }))
          try {
            const result = await api('syncApply', { id: host.id, token: preview.token, choices })
            const status = new Map(choices.map(item => [syncId(item), 'unattempted']))
            for (const item of result) status.set(syncId(item), item.status)
            setOutcomes(status)
            const count = result.filter(item => ['copied', 'replaced', 'restart'].includes(item.status)).length
            onNote(count ? { text: t('sync.done', { ...hostArgs, count }) } : undefined)
          } catch {
            setError('sync.applyFailed')
          } finally {
            setSaving(false)
          }
        }
      },
        h('h3', { className: 'jh-sync-title' }, title),
        h('p', { className: 'jh-lede', role: 'status' }, saving ? t('sync.applying', { count: chosen.size }) : error ? null : !preview ? t('bring.loading', hostArgs) : !rows.length ? t('sync.empty') : t('sync.description', hostArgs)),
        rows.length >= FILTER_FROM && h(Input, { type: 'search', value: filter, onChange: e => setFilter(e.currentTarget.value), placeholder: t('bring.filter'), 'aria-label': t('bring.filter') }),
        rows.length > 0 && !shown.length && h('p', { className: 'jh-empty' }, t('sync.noMatch')),
        SYNC_KINDS.map(group),
        error && h('div', { className: 'jh-note', role: 'alert', 'data-error': '' }, t(error, hostArgs)),
        h('div', { className: 'jh-sync-footer' },
          (error || outcomes) ? h(Button, { type: 'button', size: 'sm', variant: 'primary', onClick: reviewAgain }, t('sync.refresh'))
            : rows.length > 0 && h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: saving || !chosen.size }, chosen.size ? t('sync.apply', { count: chosen.size }) : t('sync.noSelection')),
          h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: saving, onClick: onClose }, t(outcomes ? 'devices.done' : 'bring.cancel'))))
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
      const [bringing, setBringing] = React.useState(null)
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
      const { busy, notes, run, note } = useRowActions()
      const refresh = React.useCallback(async () => {
        try {
          setState(await api('state'))
          setLoadError(null)
        } catch (error) {
          setLoadError(error.message)
        }
      }, [])
      React.useEffect(() => { void refresh() }, [refresh])
      // A Connect can copy for a minute; its steps arrive by asking again while one runs.
      const connectingNow = Object.values(busy).includes('connect') || state?.connections.some(host => host.progress !== undefined)
      React.useEffect(() => {
        if (!connectingNow) return undefined
        const timer = setInterval(() => { void refresh() }, 1000)
        return () => clearInterval(timer)
      }, [connectingNow, refresh])
      // The import note answers the import; the next row action moves on from it.
      const act = (id, key, task) => { setImported(null); return run(id, key, async () => { const note = await task(); await refresh(); return note }) }

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
              : state.connections.map(host => h(React.Fragment, { key: host.id },
                h(HostRow, {
                  t, host, busy: busy[host.id], note: notes[host.id], run: act,
                  onEdit: () => setEditing(host), onRemove: () => { setAcknowledged(false); setRemoving(host) },
                  onBring: () => setBringing(host.id),
                }),
                bringing === host.id && host.tunnel !== undefined && h(BringSetup, { key: host.tunnel.root, t, host, onNote: value => note(host.id, value), onClose: () => setBringing(null) }))))),

        h('div', { className: 'jh-group', role: 'group', 'aria-labelledby': 'jh-devices-title' },
          h('div', { className: 'jh-group-head' },
            h('div', null, h('h3', { id: 'jh-devices-title' }, t('devices.title')), h('p', { className: 'jh-lede' }, t('devices.lede'))),
            h(Switch, {
              label: t('devices.switch'), checked: gateway.enabled, disabled: switching, onChange: async (next) => {
                setSwitching(true)
                try { await api('enableGateway', { enabled: next }); setPairing(null) } catch (error) { setLoadError(error.message) } finally { setSwitching(false); await refresh() }
              }
            })),
          !gateway.secure && (gateway.lanAvailable || gateway.allowInsecureLan) && h('div', { className: 'jh-group-head' },
            h('div', null,
              h('p', { className: 'jh-detail' }, t('devices.allowInsecureLan')),
              h('p', { className: 'jh-warning' }, t('devices.insecureLanWarning'))),
            h(Switch, {
              label: t('devices.allowInsecureLan'), checked: gateway.allowInsecureLan, disabled: switching, onChange: async (allowed) => {
                setSwitching(true)
                try { await api('allowInsecureLan', { allowed }); setPairing(null) } catch (error) { setLoadError(error.message) } finally { setSwitching(false); await refresh() }
              },
            })),
          h('div', { className: 'jh-detail', role: 'status' },
            h(StateDot, { state: gateway.running ? 'done' : gateway.error ? 'error' : 'idle' }), ' ',
            gateway.running ? t('devices.running', { url: gateway.url }) : gateway.error ?? t('devices.off')),
          gateway.running && h('p', { className: 'jh-warning' }, t('devices.pairWarning')),
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
          pairing && h(PairPanel, { t, pairing, onDone: () => { setPairing(null); void refresh() } }),
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
        // Saved SSH Hosts appear under Remote in the new-project menu. Picking one connects it
        // when it is not up yet, without opening a browser. Only SSH Hosts carry the link that
        // serves the folder chooser; an address Host opens in its own window instead.
        ctx.inject(['uiWorkspace'], scope => {
          scope.effect(() => scope.uiWorkspace.registerRemoteMachines({
            async list() {
              const { connections } = await api('state')
              return connections.filter(host => host.kind === 'ssh').map(host => ({
                id: host.id,
                name: host.name,
                detail: host.address ?? host.ssh,
                state: host.tunnel !== undefined ? 'ready' : host.progress !== undefined ? 'connecting' : 'idle',
              }))
            },
            async connect(id) {
              const { connections } = await api('state')
              const host = connections.find(entry => entry.id === id)
              if (host?.kind === 'ssh' && host.tunnel === undefined) await api('connect', { id })
            },
            listDirectory: (id, path) => api('browse', path === undefined ? { id } : { id, path }),
            async createDirectory(id, path, name) {
              return (await api('makeFolder', { id, path, name })).path
            },
            manage() {
              if (ctx.get('settingsNavigation')?.open(NS) !== true) console.warn('jan-hosts: the Hosts settings section is unavailable')
            },
          }), 'jan-hosts: remote computers')
        })
      },
    }
  },
})
