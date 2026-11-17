// Browser half of the open-waifu shell plugin. Hand-written for DSH's module
// loader (no build step): `require` hands out the shell's shared React and
// slot runtime, and `apply` registers everything through `ctx.slots`.
window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-shell',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      IconPluginPinwheelOutlineRegular, IconSettingsOutlineMedium, IconDatabaseOutlineRegular, IconCheckOutlineRegular,
      IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular,
      MenuItemButton, ShortcutKeys, Button, Switch,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    // Optional: the matching host publishes the header model seat. An older
    // host leaves the composer's own selector in place instead.
    let HeaderModelSelection
    try {
      HeaderModelSelection = require('@deepseek-ai/dsh-client-ui-model-selection/client').HeaderModelSelection
    } catch (error) {
      console.warn('open-waifu-shell: header model selection unavailable', error)
      HeaderModelSelection = undefined
    }
    const shell = window.__OW_SHELL__ ?? { look: null }
    // Present only inside the app window; a plain browser tab has no window to drive.
    const tauri = window.__TAURI_INTERNALS__
    const win = (cmd) => tauri.invoke(`plugin:window|${cmd}`, { label: 'main' })
    // macOS keeps its native traffic lights (titleBarStyle Overlay); only the
    // frameless Windows/Linux window needs our own buttons.
    const mac = /Mac/.test(navigator.platform || navigator.userAgent)

    // Jan's blue accent, the app's default when the settings carry none.
    const look = shell.look ?? { primary: '#456BDE', sidebar: { light: '#C4D0F3', dark: '#0F2157' } }
    const PALETTES = [
      ['gray', 'Gray', '#f17455', '#f1f1f1', '#171717'],
      ['red', 'Red', '#F0614B', '#F3CBC4', '#5E1308'],
      ['orange', 'Orange', '#E9A23F', '#F3DFC4', '#5C3A0A'],
      ['green', 'Green', '#88BA42', '#DFF3C4', '#374B1B'],
      ['emerald', 'Emerald', '#38AB51', '#C4F3CE', '#194D24'],
      ['teal', 'Teal', '#38AB8D', '#C4F3E6', '#194D3F'],
      ['cyan', 'Cyan', '#45BBDE', '#C4E8F3', '#0F4657'],
      ['blue', 'Blue', '#456BDE', '#C4D0F3', '#0F2157'],
      ['purple', 'Purple', '#865EEA', '#D2C4F3', '#220C5A'],
      ['pink', 'Pink', '#D55EF3', '#FFDAE9', '#4D075F'],
      ['rose', 'Rose', '#F655B8', '#F3C4E1', '#61053E'],
    ]
    let preferences = { accent: PALETTES.find(p => p[2].toLowerCase() === look.primary.toLowerCase())?.[0] || 'blue', coloredUserBubble: true, ...shell.appearance }
    const appearanceListeners = new Set()
    const applyAppearance = (value) => {
      preferences = value
      const palette = PALETTES.find(p => p[0] === value.accent) || PALETTES[7]
      const primary = palette[2]
      const root = document.documentElement
      root.style.setProperty('--ow-accent', primary)
      root.style.setProperty('--ow-sidebar-light', palette[3])
      root.style.setProperty('--ow-sidebar-dark', palette[4])
      root.style.setProperty('--ow-bubble-light', value.coloredUserBubble ? `color-mix(in oklch, ${primary} 22%, white)` : 'var(--dsw-alias-bg-layer-2)')
      root.style.setProperty('--ow-bubble-dark', value.coloredUserBubble ? `color-mix(in oklch, ${primary} 70%, black)` : 'var(--dsw-alias-bg-layer-2)')
      appearanceListeners.forEach(listener => listener())
    }
    async function appearanceApi(method, params = {}) {
      const response = await fetch('/ow-api/appearance', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'Appearance settings could not be saved.')
      return body.result
    }
    function AppearanceSettings() {
      const value = React.useSyncExternalStore(listener => { appearanceListeners.add(listener); return () => appearanceListeners.delete(listener) }, () => preferences)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const uid = React.useId()
      async function save(next) {
        setBusy(true); setError(''); setNotice('')
        try { const saved = await appearanceApi('save', next); applyAppearance({ ...preferences, ...saved }); setNotice('Appearance saved.') }
        catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      return h('section', { className: 'ow-appearance', 'aria-labelledby': `${uid}-title`, 'aria-busy': busy },
        h('h2', { id: `${uid}-title` }, 'Interface'),
        h('div', { className: 'ow-interface-row' },
          h('div', null, h('h3', null, 'Accent color'), h('p', null, 'Customize the accent color of the application.')),
          h('div', { className: 'ow-color-options', role: 'group', 'aria-label': 'Accent color' }, PALETTES.map(palette => h('button', {
            key: palette[0], type: 'button', className: 'ow-color-swatch', disabled: busy,
            title: palette[1], 'aria-label': palette[1], 'aria-pressed': value.accent === palette[0],
            style: { backgroundColor: palette[0] === 'gray' ? 'var(--dsw-alias-bg-base)' : palette[2] },
            onClick: () => save({ ...value, accent: palette[0] }),
          })))),
        h('div', { className: 'ow-interface-row' },
          h('div', null, h('h3', null, 'Colored user bubbles'), h('p', null, 'Use the accent color for your messages.')),
          h(Switch, { label: 'Colored user bubbles', checked: value.coloredUserBubble, disabled: busy, onChange: checked => save({ ...value, coloredUserBubble: checked }) })),
        h('div', { className: 'ow-interface-row' },
          h('div', null, h('h3', null, 'Reset to default'), h('p', null, 'Reset accent color and user bubble preferences.')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => save({ accent: 'gray', coloredUserBubble: true }) }, 'Reset')),
        h('p', null, 'Theme and font size are in General. Automatic conversation titles are in Plugin manager > Conversation-following titles. Token statistics are in General > Performance usage.'),
        error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, busy ? 'Saving appearance…' : notice))
    }
    async function agentApi(method, params = {}) {
      const response = await fetch('/ow-api/agent-settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'Settings could not be saved.')
      return body.result
    }
    const agentDrafts = new Map()
    function useAgentDraft(key, initial) {
      const [value, update] = React.useState(() => agentDrafts.has(key) ? agentDrafts.get(key) : initial)
      return [value, next => { agentDrafts.set(key, next); update(next) }]
    }
    function AgentSettings({ skills = false }) {
      const { Input, Modal, RiskConfirmation } = require('@deepseek-ai/dsh-client-ui-primitives')
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [draft, setDraft] = useAgentDraft('server', null)
      const [original, setOriginal] = useAgentDraft('original', '')
      const [replaceSecrets, setReplaceSecrets] = useAgentDraft('replaceSecrets', false)
      const [importText, setImportText] = useAgentDraft('import', '')
      const [preview, setPreview] = React.useState(null)
      const [importOpen, setImportOpen] = React.useState(false)
      const [skillQuery, setSkillQuery] = useAgentDraft('skillQuery', '')
      const [directories, setDirectories] = useAgentDraft('directories', null)
      const [instruction, setInstruction] = useAgentDraft('instruction', null)
      const [confirmation, setConfirmation] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const hasDraft = !!draft || !!importText || !!instruction
      React.useEffect(() => {
        if (!hasDraft) return
        const warn = event => { event.preventDefault(); event.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
      }, [hasDraft])
      async function refresh() {
        const next = await agentApi('list')
        setData(next); if (directories === null) setDirectories(next.directories.join('\n'))
      }
      React.useEffect(() => { let live = true; agentApi('list').then(next => { if (live) { setData(next); if (directories === null) setDirectories(next.directories.join('\n')) } }).catch(failure => { if (live) setError(failure.message) }); return () => { live = false } }, [])
      async function run(action, message) {
        setBusy(true); setError(''); setNotice('')
        try { await action(); await refresh(); setNotice(message) }
        catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      function ask(title, description, action) { setAcknowledged(false); setConfirmation({ title, description, action }) }
      function edit(row) {
        setOriginal(row?.name || ''); setReplaceSecrets(!row)
        setDraft(row ? { ...row, args: (row.args ?? []).join('\n'), env: '{}', headers: '{}' } : { name: '', transport: 'stdio', command: '', args: '', env: '{}', headers: '{}', url: '', cwd: '', enabled: false })
      }
      const field = (label, key, multiline = false, props = {}) => h('label', { className: 'ow-agent-field' }, label, h(multiline ? 'textarea' : Input, { value: draft[key] ?? '', disabled: busy, onChange: event => setDraft({ ...draft, [key]: event.target.value }), ...props }))
      const actions = (...children) => h('div', { className: 'ow-agent-actions' }, ...children)
      const button = (text, action, props = {}) => h(Button, { variant: 'outline', disabled: busy, onClick: action, ...props }, text)
      const message = h(React.Fragment, null, error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, busy ? 'Applying settings…' : notice))
      return h('section', { className: 'ow-appearance ow-agent-settings', 'aria-busy': busy },
        h('h2', null, skills ? 'Skills' : 'MCP Servers'),
        h('p', null, skills ? 'Skills are reusable instructions. DSH discovers compatible SKILL.md folders in .agents/skills and .dsh/skills. Add another folder below to reuse an existing library without copying it.' : 'MCP servers connect the agent to external tools. A local command runs with your account permissions. Enable only servers you trust.'),
        h('details', null, h('summary', null, skills ? 'Compatibility with Claude and Codex' : 'MCP, skills, plugins and agent presets'), h('p', null, skills ? 'Claude and Codex skill instructions may work when they use the same format. Their hooks, plugin manifests, permissions and unavailable tool names are not imported. Review instructions and scripts before use.' : 'MCP servers provide tools. Skills provide reusable instructions. Plugins add app features through Plugin manager. Agent presets hold saved instructions and working modes.')),
        !data && !error && h('p', { role: 'status' }, 'Loading settings…'),
        skills ? h(React.Fragment, null,
          h('label', { className: 'ow-agent-field' }, 'Additional skill folders (one absolute path per line)', h('textarea', { value: directories ?? '', disabled: busy, onChange: event => setDirectories(event.target.value) })),
          actions(data?.canPickDirectory && button('Choose skill folder', () => run(async () => { const path = await agentApi('pickDirectory'); if (path) setDirectories([directories, path].filter(Boolean).join('\n')) }, 'Folder selection completed. Save folders to apply.')), button('Save skill folders', () => run(() => agentApi('saveDirectories', { directories: (directories ?? '').split('\n').map(path => path.trim()).filter(Boolean) }), 'Skill folders saved.'))),
          data?.skills.complete === false && h('p', { role: 'alert' }, 'Skill discovery is incomplete. Some sources could not be read.'),
          h('p', null, 'Editing a linked skill changes its original file, including use by other agents. Removing a folder here leaves its files untouched. Unsaved drafts stay during navigation but are lost on reload.'),
          h('label', { className: 'ow-agent-field' }, 'Search skills', h(Input, { value: skillQuery, onChange: event => setSkillQuery(event.target.value) })),
          ...(data?.skills.skills ?? []).filter(row => `${row.name} ${row.description}`.toLowerCase().includes(skillQuery.toLowerCase())).map(row => h('div', { className: 'ow-interface-row', key: row.name }, h('div', null, h('h3', null, row.name), h('p', null, row.description), h('small', null, row.path || row.source || row.provider)), row.path && button('Edit instructions', () => run(async () => setInstruction({ name: row.name, ...await agentApi('readSkill', { name: row.name }) }), 'Skill opened.')))),
          instruction && h(Modal, { open: true, title: instruction.name, closeLabel: 'Close skill editor', onClose: () => setInstruction(null), className: 'ow-appearance ow-agent-settings ow-agent-modal', contentClassName: 'ow-agent-modal-content', footer: actions(button('Save instructions', () => ask('Save skill instructions?', 'This writes to the original skill file. Other agents using this folder will see the change.', () => run(async () => setInstruction({ name: instruction.name, ...await agentApi('saveSkill', instruction) }), 'Skill instructions saved.')), { variant: 'primary' }), button('Close editor', () => setInstruction(null))) }, h('p', null, instruction.path), h('label', { className: 'ow-agent-field' }, 'Skill instruction file', h('textarea', { rows: 16, value: instruction.text, onChange: event => setInstruction({ ...instruction, text: event.target.value }), disabled: busy })), error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, notice))
        ) : h(React.Fragment, null,
          actions(button('Add MCP server', () => edit(null))),
          data && data.servers.length === 0 && h('p', null, 'No MCP servers configured. Add a server or import your existing Jan or Claude Desktop JSON.'),
          ...(data?.servers ?? []).map(row => h('div', { className: 'ow-interface-row', key: row.name }, h('div', null, h('h3', null, row.name), h('p', null, row.status), row.secretConfigured && h('small', null, 'Credentials stored separately'), row.tools?.length > 0 && h('details', null, h('summary', null, 'Available tools'), ...row.tools.map(name => h('p', { key: name }, name.replace(`mcp__${row.name}__`, '')))), h('small', null, row.transport === 'stdio' ? row.command : row.url)), actions(h(Switch, { label: `Enable ${row.name}`, checked: row.enabled, disabled: busy, onChange: enabled => enabled ? ask('Enable MCP server?', 'The server can run commands or access external services. Enable it only if you trust its source.', () => run(() => agentApi('toggle', { name: row.name, enabled }), 'Server enabled. Check its connection status below.')) : run(() => agentApi('toggle', { name: row.name, enabled }), 'Server disabled.') }), row.enabled && button('Reconnect', () => run(() => agentApi('toggle', { name: row.name, enabled: true }), 'Connection refreshed. Check the tools and connection status.'), { 'aria-label': `Reconnect ${row.name}` }), button('Edit', () => edit(row), { 'aria-label': `Edit ${row.name}` }), button('Remove', () => ask('Remove MCP server?', 'This removes the connection and its saved credentials. It does not uninstall the server software.', () => run(() => agentApi('remove', { name: row.name, confirmed: true }), 'Server removed.')), { 'aria-label': `Remove ${row.name}` })))),
          draft && h(Modal, {
            open: true, title: original ? `Edit ${original}` : 'Add MCP server', closeLabel: 'Close editor', onClose: () => setDraft(null), className: 'ow-appearance ow-agent-settings ow-agent-modal', contentClassName: 'ow-agent-modal-content', footer: actions(button('Save server', () => run(async () => {
              const value = { ...draft, args: draft.args === '' ? [] : draft.args.split('\n'), env: JSON.parse(draft.env), headers: JSON.parse(draft.headers) }
              await agentApi('saveServer', { value, originalName: original || undefined, replaceSecrets }); setDraft(null)
            }, 'MCP server saved.'), { variant: 'primary' }), button('Cancel', () => setDraft(null)))
          },
            field('Server name', 'name', false, { disabled: busy || !!original }),
            h('label', { className: 'ow-agent-field' }, 'Transport', h('select', { value: draft.transport, disabled: busy, onChange: event => setDraft({ ...draft, transport: event.target.value }) }, h('option', { value: 'stdio' }, 'Local command (stdio)'), h('option', { value: 'streamable-http' }, 'Remote endpoint (Streamable HTTP)'))),
            draft.transport === 'stdio' ? h(React.Fragment, null, field('Command', 'command'), field('Arguments (one per line)', 'args', true, { rows: 2 })) : field('MCP endpoint URL', 'url'),
            h('details', null, h('summary', null, 'Advanced: working directory and credentials'),
              draft.transport === 'stdio' && field('Working directory (optional absolute path)', 'cwd'),
              original && h('label', null, h('input', { type: 'checkbox', checked: replaceSecrets, onChange: event => setReplaceSecrets(event.target.checked) }), ' Replace saved environment / headers'),
              replaceSecrets && (draft.transport === 'stdio' ? field('Environment (JSON object, stored as credentials)', 'env', true, { autoComplete: 'off', spellCheck: false }) : field('Headers (JSON object, stored as credentials)', 'headers', true, { autoComplete: 'off', spellCheck: false }))),
            h('p', null, 'Saved connections persist. Unsaved drafts stay while switching sections, but are lost on reload. Credentials are never displayed after saving.'),
            error && h('p', { role: 'alert' }, error)),
          button('Import MCP JSON', () => setImportOpen(true)),
          importOpen && h(Modal, { open: true, title: 'Import MCP JSON', closeLabel: 'Close import', onClose: () => setImportOpen(false), className: 'ow-appearance ow-agent-settings ow-agent-modal', contentClassName: 'ow-agent-modal-content', footer: actions(button('Review import', () => run(async () => setPreview(await agentApi('previewImport', { text: importText })), 'Import reviewed. Nothing has been saved.')), preview && button('Import disabled servers', () => run(async () => { await agentApi('importServers', { text: importText, confirmed: true }); setImportText(''); setPreview(null); setImportOpen(false) }, 'Servers imported disabled.'), { variant: 'primary' }), button('Cancel', () => setImportOpen(false))) },
            h('p', null, 'Paste an object containing mcpServers. Imports are all-or-nothing, never overwrite names, and stay disabled until you enable them. Codex TOML, Claude plugins and legacy SSE need separate conversion.'),
            h('label', { className: 'ow-agent-field' }, 'MCP configuration JSON', h('textarea', { rows: 6, value: importText, autoComplete: 'off', spellCheck: false, onChange: event => { setImportText(event.target.value); setPreview(null) } })),
            preview && h('div', null, ...preview.map(row => h('p', { key: row.name }, `${row.name}: ${row.transport}, disabled. Credential fields: ${[...row.environmentKeys, ...row.headerKeys].join(', ') || 'none'}`))), error && h('p', { role: 'alert' }, error))
        ), message,
        h(RiskConfirmation, { open: !!confirmation, title: confirmation?.title || '', description: confirmation?.description || '', acknowledgeLabel: 'I understand this change', cancelLabel: 'Cancel', closeLabel: 'Close', confirmLabel: 'Confirm', acknowledged, disabled: busy, onAcknowledgedChange: setAcknowledged, onCancel: () => setConfirmation(null), onConfirm: () => { const action = confirmation.action; setConfirmation(null); action() } }))
    }
    const both = (v) => ({ light: v, dark: v })
    // Jan's palette (web-app/src/index.css) mapped onto DSH's alias tokens.
    const TOKENS = {
      '--dsh-font-family-text': both("'Inter', 'Segoe UI', sans-serif"),
      '--dsw-alias-bg-base': { light: 'oklch(1 0 0)', dark: 'oklch(0.18 0 0)' },
      '--dsw-alias-bg-layer-1': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-bg-layer-2': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-alias-bg-overlay': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-border-l1': { light: 'oklch(0.922 0 0)', dark: 'oklch(1 0 0 / 10%)' },
      '--dsw-alias-border-l2': { light: 'oklch(0.88 0 0)', dark: 'oklch(1 0 0 / 15%)' },
      '--dsw-alias-label-primary': { light: 'oklch(0.145 0 0)', dark: 'oklch(0.985 0 0)' },
      '--dsw-alias-label-secondary': { light: 'oklch(0.556 0 0)', dark: 'oklch(0.708 0 0)' },
      '--dsw-alias-button-primary-fill': both('var(--ow-accent)'),
      '--dsw-alias-button-info-fill': both('var(--ow-accent)'),
      '--dsw-alias-state-business-primary': both('var(--ow-accent)'),
      // The running "Deep diving" status and its hand; DSH tints them its own blue.
      '--dsw-alias-label-deep-diving': {
        light: `color-mix(in oklch, var(--ow-accent) 85%, black)`,
        dark: `color-mix(in oklch, var(--ow-accent) 80%, white)`,
      },
      '--dsw-specific-input-major': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-specific-selector': { light: 'oklch(0.94 0 0)', dark: 'oklch(0.269 0 0)' },
      '--dsw-specific-bubble': {
        light: 'var(--ow-bubble-light)',
        dark: 'var(--ow-bubble-dark)',
      },
      '--dsw-specific-sidebar-fill': { light: 'var(--ow-sidebar-light)', dark: 'var(--ow-sidebar-dark)' },
      '--dsw-specific-sidebar-nav-item-hover': {
        light: `color-mix(in oklch, var(--ow-sidebar-light) 85%, black)`,
        dark: `color-mix(in oklch, var(--ow-sidebar-dark) 85%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active': {
        light: `color-mix(in oklch, var(--ow-sidebar-light) 75%, black)`,
        dark: `color-mix(in oklch, var(--ow-sidebar-dark) 75%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active-accent': {
        light: `color-mix(in oklch, var(--ow-sidebar-light) 75%, black)`,
        dark: `color-mix(in oklch, var(--ow-sidebar-dark) 75%, white)`,
      },
    }

    const CSS = `
.ow-agent-modal { display: flex; flex-direction: column; width: min(620px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
.ow-agent-modal-content { min-height: 0; overflow-y: auto; }
.ow-agent-field { display: grid; gap: 6px; margin-block: 12px; }
.ow-agent-field textarea, .ow-agent-field select { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; }
.ow-agent-field textarea { min-height: 80px; resize: vertical; }
.ow-agent-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ow-agent-editor { margin-block: 16px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.ow-agent-settings small, .ow-agent-settings p { overflow-wrap: anywhere; }
.ow-agent-settings small { display: block; color: var(--dsw-alias-label-secondary); margin-block: 4px; }
.ow-agent-settings .ow-interface-row { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
.ow-agent-settings .ow-interface-row > div:first-child { flex: 1 1 220px; min-width: 0; }
.ow-agent-settings .ow-interface-row > .ow-agent-actions { justify-content: flex-end; }
.ow-agent-settings .ow-interface-row details { margin-block: 8px; }
.ow-agent-settings details { margin-block: 20px; }
.ow-agent-settings summary { cursor: pointer; }
.ow-appearance h2, .ow-appearance h3 { text-wrap: balance; font-size: 16px; font-weight: 500; margin: 0; }
.ow-appearance p { text-wrap: pretty; color: var(--dsw-alias-label-secondary); margin-block: 6px; line-height: 1.5; }
.ow-interface-row { display: flex; align-items: center; justify-content: space-between; gap: 32px; padding-block: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ow-color-options { display: flex; flex-wrap: wrap; gap: 6px; max-width: 180px; flex-shrink: 0; padding: 4px; }
.ow-color-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--dsw-alias-bg-layer-2); cursor: pointer; }
.ow-color-swatch[aria-pressed='true'] { outline: 2px solid var(--ow-accent); outline-offset: 2px; border-color: transparent; }
.ow-color-swatch:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
@media (max-width: 640px) { .ow-interface-row { flex-wrap: wrap; gap: 12px; } }
@font-face { font-family: 'Inter'; font-display: swap; font-weight: 100 900; src: url('/ow-shell/assets/InterVariable.woff2') format('woff2'); }
@font-face { font-family: 'StudioFeixenSans'; font-display: swap; font-weight: 500; src: url('/ow-shell/assets/StudioFeixenSans-Medium.otf') format('opentype'); }
.ow-name { font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.ow-titlebar { position: fixed; inset: 0 0 auto 0; height: var(--dsh-windows-titlebar-height); z-index: 40; pointer-events: none; }
.ow-titlebar > .ow-drag { position: absolute; inset: 0 140px 0 280px; pointer-events: auto; }
.ow-controls { position: absolute; top: 0; right: 0; display: flex; height: 100%; pointer-events: auto; }
.ow-controls button { width: 46px; height: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: default; }
.ow-controls button:hover { background: color-mix(in oklch, var(--dsw-alias-label-primary) 10%, transparent); color: var(--dsw-alias-label-primary); }
.ow-controls button.ow-close:hover { background: #c42b1c; color: #fff; }
/* DSH 0.2.2's public data-slot anchors and frame data attributes delimit these
   rules. Only the shipped shell's immediate structure is styled; no hashed
   classes, DOM moves, or blanket slot suppression. A replaced parent owns its
   own geometry. Later theme plugins can override tokens, and later CSS can
   override these marker-scoped rules. */
  html[data-ow-shell] {
    --ow-sidebar-gap: 12px;
    --ow-sidebar-radius: 14px;
  }
  html[data-ow-shell] [data-slot='root'] > [data-sidebar-collapsed], html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]) {
    background: var(--dsw-alias-bg-base);
  }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay])::before { background: var(--dsw-alias-bg-base); }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']) {
    border: 0;
    border-radius: 0;
  }
  html[data-ow-shell] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-collapsed]):not([data-sidebar-drawer]) > :has(> [data-slot='sidebar']) {
    position: relative;
    margin: var(--ow-sidebar-gap) 0 var(--ow-sidebar-gap) var(--ow-sidebar-gap);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: var(--ow-sidebar-radius);
    background: var(--dsw-alias-bg-base);
    overflow: hidden;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    width: 100% !important; /* DSH passes the outer column width, before the inset. */
    background: linear-gradient(to bottom, var(--dsw-specific-sidebar-fill), var(--dsw-alias-bg-base));
    padding: 6px 8px;
  }
  html[data-ow-shell] body[data-ds-dark-theme] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    background: linear-gradient(to bottom, color-mix(in srgb, var(--dsw-specific-sidebar-fill) 70%, transparent), var(--dsw-alias-bg-base));
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) {
    height: 40px;
    padding: 0 2px 0 4px;
    margin: 0 0 8px;
  }
  html[data-ow-shell] [data-slot='sidebar'] [data-slot='sidebar.brand.mark']:has(.ow-sidebar-mark) { display: none; }
  /* Clear the native traffic lights (tauri.macos.conf.json trafficLightPosition). */
  html[data-ow-shell][data-ow-mac] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) { padding-left: 64px; }
  html[data-ow-shell][data-ow-mac]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] { left: 84px; }
  html[data-ow-shell] [data-slot='sidebar.brand.name'] .ow-name { font-size: 14px; }
  html[data-ow-shell] [data-slot='sidebar'] [data-sidebar-toggle] {
    position: relative;
    inset: auto;
    margin-left: auto;
  }
  html[data-ow-shell]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] {
    position: fixed;
    top: calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2);
    left: 12px;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > button {
    justify-content: flex-start;
    height: 36px;
    margin: 0 3px 2px;
    padding: 7px 9px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    font-weight: 400;
  }
  html[data-ow-shell] [data-slot='sidebar'] > div > button > span:first-child > span { width: auto; justify-content: flex-start; gap: 8px; }
  html[data-ow-shell] [data-slot='sidebar'] > div > button > span:last-child:not(:first-child) { opacity: 1; color: var(--dsw-alias-label-secondary); font-size: 11px; }
  html[data-ow-shell] [data-slot='sidebar'] nav { margin: 0 0 12px; }
  html[data-ow-shell] [data-slot='sidebar'] nav > button, html[data-ow-shell] [data-slot='sidebar'] nav > div > button { min-height: 36px; border-radius: 6px; }
  /* Jan has no panel launchers above the chat list. Plugins and Model Hub move
     to the footer; every remaining management page stays reachable through the
     native More menu, whose trigger keeps aria-haspopup. Without that trigger
     the rows stay so no page loses its only destination. */
  html[data-ow-shell] [data-slot='sidebar'] nav[aria-label]:has(button[aria-haspopup]) > button[aria-label]:not([aria-haspopup]) { display: none; }
  html[data-ow-shell] [data-row-key^='session:'] { min-height: 36px; }
  /* Jan lists a chat once it has a message; New Chat already reaches the blank
     session, so its "New Session" row reads as a duplicate. */
  html[data-ow-shell] [data-row-key^='session:'][data-blank] { display: none; }
  /* Jan's sidebar paints a gradient, while the native list fade fades to a
     single sidebar-fill colour: either choice paints a hard-edged band across
     the last row (blue with the accent, grey with the base). Drop the overlay;
     the list keeps its own clip. */
  html[data-ow-shell] [data-slot='sidebar.workspaces'] > div > div > div:has([role='tree']) > span:last-child { display: none; }
  html[data-ow-shell] [data-slot='sidebar.settings'] { color: var(--dsw-alias-label-secondary); }
  html[data-ow-shell] [data-slot='sidebar'] div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column; align-items: stretch; }
  /* Jan's plain navigation rows. The leaves supply the real callbacks; the
     shell owns only how New Chat / New project / Search read. */
  .ow-nav-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; margin: 0 0 2px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 400; line-height: 20px; text-align: left; cursor: pointer; }
  .ow-nav-row > svg { flex: none; color: var(--dsw-alias-label-secondary); }
  .ow-nav-row:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
  .ow-nav-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
  .ow-nav-row[data-rail] { justify-content: center; padding: 0; }
  .ow-nav-row[data-rail] > svg { color: inherit; }
  .ow-nav-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ow-nav-row > .ow-nav-shortcut { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
  /* Jan's "Chats" heading. The browser-owned search and view-options nodes stay
     mounted inside it; only their presentation folds while search is open. */
  .ow-list-header { flex: none; display: flex; align-items: center; gap: 4px; height: 36px; margin: 2px -4px 4px 0; padding-left: var(--dsh-sidebar-row-padding, 12px); color: var(--dsw-alias-label-tertiary); }
  .ow-list-heading { flex: none; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-secondary); }
  .ow-list-tools { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; }
  .ow-list-actions { display: flex; align-items: center; }
  .ow-list-header[data-search-expanded] .ow-list-heading, .ow-list-header[data-search-expanded] .ow-list-actions { display: none; }
  .ow-list-header[data-search-expanded] .ow-list-tools { flex: 1; }
  /* Jan's provider/model pill sits at the main area's top left, before the
     Session title. The composer keeps no second selector. */
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button { height: 36px; padding: 0 14px; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; }
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button > svg:first-child { display: none; }
  html[data-ow-shell] [data-conversation-header-leading] [data-slot='conversation.header.model'] button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
  /* A thin line waving hand in Jan's icon style. The SVG animates itself and
     honours reduced motion; as a mask it takes the status text's colour. */
  html[data-ow-shell] [data-chat-running-mark] { background: currentColor; -webkit-mask: url('/ow-shell/assets/hand-wave.svg') center / contain no-repeat; mask: url('/ow-shell/assets/hand-wave.svg') center / contain no-repeat; }
  html[data-ow-shell] [data-chat-running-mark] > * { display: none; }
  .ow-hero-title { width: 100%; margin: 0 0 16px; font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 24px; font-weight: 500; line-height: 32px; color: var(--dsw-alias-label-primary); text-align: center; text-wrap: balance; }
.ow-footer-action { width: 100%; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; }
.ow-footer-action:hover { background: var(--dsw-specific-sidebar-nav-item-hover); color: var(--dsw-alias-label-primary); }
.ow-footer-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.ow-footer-action[data-rail] { justify-content: center; padding-inline: 0; }
.ow-menu-entry { display: flex; align-items: center; gap: 8px; width: 100%; }
.ow-artwork { color: var(--dsw-alias-label-primary); }
.ow-menu-check { flex: none; margin-left: auto; color: var(--dsw-alias-state-business-primary); }
/* Native titlebar rules need to outrank DSH's platform rules; they never touch
   third-party panel or composer contents. The existing DSH track motion stays. */
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) { padding-top: 0; }
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']),
html[data-ow-shell][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > [data-rightbar-col] { padding-top: var(--dsh-windows-titlebar-height); }
/* Guide labels remain readable when shortcut hints consume a narrow card. */
html[data-ow-shell] [data-sidebar-right-guide-entry='files'] > span:nth-child(2) > span,
html[data-ow-shell] [data-sidebar-right-guide-entry='terminal'] > span:nth-of-type(2) > span:last-child { white-space: normal; overflow-wrap: anywhere; }
/* Guide providers keep their actions; the shell supplies Jan's line artwork. */
html[data-ow-shell] [data-sidebar-right-guide-entry='files'] > span:first-of-type,
html[data-ow-shell] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type { color: var(--dsw-alias-label-secondary); }
html[data-ow-shell] [data-sidebar-right-guide-entry='files'] > span:first-of-type > svg,
html[data-ow-shell] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type > svg { display: none; }
html[data-ow-shell] [data-sidebar-right-guide-entry='files'] > span:first-of-type::before,
html[data-ow-shell] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type::before { content: ''; display: block; width: 22px; height: 22px; background: currentColor; mask: var(--ow-guide-icon) center / contain no-repeat; }
html[data-ow-shell] [data-sidebar-right-guide-entry='files'] { --ow-guide-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'/%3E%3Cpath d='M3 9h18'/%3E%3C/svg%3E"); }
html[data-ow-shell] [data-sidebar-right-guide-entry='terminal'] { --ow-guide-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2'/%3E%3Cpath d='m8 9 3 3-3 3m5 0h3'/%3E%3C/svg%3E"); }
html[data-ow-shell] [data-sidebar-right-panel] button[aria-haspopup='menu'] > span:first-child > svg { stroke: currentColor; color: var(--dsw-alias-label-secondary); }
/* Positioned dock panels ignore their column's padding. Reserve the caption on
   the panel itself so both normal and fullscreen chrome stay below it. */
html[data-ow-shell][data-windows-titlebar] [data-sidebar-right-panel] { top: var(--dsh-windows-titlebar-height); }

`

    const svg = (d, size = 10) => h('svg', { width: size, height: size, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1 }, d)
    const Name = () => h('span', { className: 'ow-name' }, 'Jan')

    function TitleBar() {
      const [maximized, setMaximized] = React.useState(false)
      const sync = () => { win('is_maximized').then(setMaximized, () => { }) }
      React.useEffect(() => {
        sync()
        window.addEventListener('resize', sync)
        return () => window.removeEventListener('resize', sync)
      }, [])
      return h('div', { className: 'ow-titlebar' },
        h('div', { className: 'ow-drag', 'data-tauri-drag-region': '' }),
        !mac && h('div', { className: 'ow-controls' },
          h('button', { type: 'button', 'aria-label': 'Minimize', onClick: () => win('minimize') }, svg(h('path', { d: 'M0 5h10' }))),
          h('button', { type: 'button', 'aria-label': maximized ? 'Restore' : 'Maximize', onClick: () => win('toggle_maximize').then(sync) },
            svg(maximized ? h('path', { d: 'M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z' }) : h('rect', { x: 0.5, y: 0.5, width: 9, height: 9 }))),
          h('button', { type: 'button', className: 'ow-close', 'aria-label': 'Close', onClick: () => win('close') }, svg(h('path', { d: 'M0 0l10 10M10 0L0 10' })))))
    }

    const SidebarMark = () => h('span', { className: 'ow-sidebar-mark', 'aria-hidden': true })

    // One row shape for the sidebar controls Jan keeps plain. The rail keeps
    // the glyph and its accessible name; wide rows add the label and hint.
    function NavRow({ icon, label, shortcutKeys, shortcutAria, rail, buttonRef, onClick }) {
      return h('button', {
        type: 'button', className: 'ow-nav-row', 'data-rail': rail || undefined,
        'aria-label': label, title: rail ? label : undefined,
        'aria-keyshortcuts': shortcutAria, ref: buttonRef, onClick,
      }, icon,
        !rail && h('span', { className: 'ow-nav-label' }, label),
        !rail && shortcutKeys !== undefined && shortcutKeys.length > 0
        && h(ShortcutKeys, { keys: shortcutKeys, className: 'ow-nav-shortcut' }))
    }

    const NewSession = ({ wide, onStart, shortcutKeys, shortcutAria, t }) => h(NavRow, {
      icon: h(wide ? IconNewChatOutlineMedium : IconNewChatOutlineRegular, { size: wide ? 16 : 18 }),
      label: t('newChat'), shortcutKeys, shortcutAria, rail: !wide, onClick: onStart,
    })

    // The browser keeps the add flow and its anchor; forwarding the ref onto
    // the visible row is what lets the picker hang off the Jan control.
    function WorkspaceActions({
      wide, canAddWorkspace, onSearch, onAddWorkspace, addWorkspaceButtonRef,
      searchShortcut, addWorkspaceShortcut, t,
    }) {
      // The opening click must not reach the browser's outside-click dismissor.
      const requestSearch = (event) => {
        event.stopPropagation()
        onSearch()
      }
      return h(React.Fragment, null,
        canAddWorkspace && h(NavRow, {
          icon: h(IconProjectAddOutlineRegular, { size: wide ? 16 : 18 }),
          label: t('newProject'), shortcutKeys: addWorkspaceShortcut?.keys, shortcutAria: addWorkspaceShortcut?.aria,
          rail: !wide, buttonRef: addWorkspaceButtonRef, onClick: onAddWorkspace,
        }),
        h(NavRow, {
          icon: h(IconSearchOutlineRegular, { size: wide ? 16 : 18 }),
          label: t('search'), shortcutKeys: searchShortcut?.keys, shortcutAria: searchShortcut?.aria,
          rail: !wide, onClick: requestSearch,
        }))
    }

    // The search node owns its input and refs, so it stays mounted while wide;
    // the view-options node keeps its menu state the same way.
    const WorkspaceHeader = ({ wide, searchExpanded, search, viewOptions, t }) => wide
      ? h('div', { className: 'ow-list-header', 'data-search-expanded': searchExpanded || undefined },
        h('span', { className: 'ow-list-heading' }, t('chats')),
        h('div', { className: 'ow-list-tools' }, search, h('div', { className: 'ow-list-actions' }, viewOptions)))
      : null

    const HeroHeadline = ({ t }) => h('h1', { className: 'ow-hero-title' }, t('hero.headline'))

    // Jan draws every plugin with Tabler outline glyphs (MIT), so the cards use
    // the same line icons in the label colour instead of DSH's filled artwork.
    const JAN_ARTWORK = { "shell": [["path", { "d": "M8 9l3 3l-3 3" }], ["path", { "d": "M13 15l3 0" }], ["path", { "d": "M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" }]], "agent-loop": [["path", { "d": "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" }], ["path", { "d": "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" }]], "subagent": [["path", { "d": "M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1" }], ["path", { "d": "M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M17 10h2a2 2 0 0 1 2 2v1" }], ["path", { "d": "M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M3 13v-1a2 2 0 0 1 2 -2h2" }]], "web-search": [["path", { "d": "M21 12a9 9 0 1 0 -9 9" }], ["path", { "d": "M3.6 9h16.8" }], ["path", { "d": "M3.6 15h7.9" }], ["path", { "d": "M11.5 3a17 17 0 0 0 0 18" }], ["path", { "d": "M12.5 3a16.984 16.984 0 0 1 2.574 8.62" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M20.2 20.2l1.8 1.8" }]], "@deepseek-ai/dsh-experimental-agent-team-profile": [["path", { "d": "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" }], ["path", { "d": "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" }], ["path", { "d": "M16 3.13a4 4 0 0 1 0 7.75" }], ["path", { "d": "M21 21v-2a4 4 0 0 0 -3 -3.85" }]], "@deepseek-ai/dsh-experimental-voice-input-bundle": [["path", { "d": "M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" }], ["path", { "d": "M5 10a7 7 0 0 0 14 0" }], ["path", { "d": "M8 21l8 0" }], ["path", { "d": "M12 17l0 4" }]], "@deepseek-ai/dsh-experimental-plugin-market-bundle": [["path", { "d": "M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M14 7l6 0" }], ["path", { "d": "M17 4l0 6" }]], "@deepseek-ai/dsh-experimental-auto-review": [["path", { "d": "M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" }], ["path", { "d": "M15 19l2 2l4 -4" }]], "@deepseek-ai/dsh-experimental-forge-bundle": [["path", { "d": "M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M6 8l0 8" }], ["path", { "d": "M11 6h5a2 2 0 0 1 2 2v8" }], ["path", { "d": "M14 9l-3 -3l3 -3" }]], "@deepseek-ai/dsh-personalized-recommendations": [["path", { "d": "M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" }]], "@deepseek-ai/dsh-experimental-inspector-profile": [["path", { "d": "M9 9v-1a3 3 0 0 1 6 0v1" }], ["path", { "d": "M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3" }], ["path", { "d": "M3 13l4 0" }], ["path", { "d": "M17 13l4 0" }], ["path", { "d": "M12 20l0 -6" }], ["path", { "d": "M4 19l3.35 -2" }], ["path", { "d": "M20 19l-3.35 -2" }], ["path", { "d": "M4 7l3.75 2.4" }], ["path", { "d": "M20 7l-3.75 2.4" }]], "@deepseek-ai/dsh-cua-bundle": [["path", { "d": "M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z" }]], "@deepseek-ai/dsh-experimental-cot-translation-bundle": [["path", { "d": "M4 5h7" }], ["path", { "d": "M9 3v2c0 4.418 -2.239 8 -5 8" }], ["path", { "d": "M5 9c0 2.144 2.952 3.908 6.7 4" }], ["path", { "d": "M12 20l4 -9l4 9" }], ["path", { "d": "M19.1 18h-6.2" }]], "@deepseek-ai/dsh-experimental-session-search": [["path", { "d": "M8 9h8" }], ["path", { "d": "M8 13h5" }], ["path", { "d": "M11.008 19.195l-3.008 1.805v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v4.5" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M20.2 20.2l1.8 1.8" }]], "@deepseek-ai/dsh-experimental-session-titles-bundle": [["path", { "d": "M7 12h10" }], ["path", { "d": "M7 5v14" }], ["path", { "d": "M17 5v14" }], ["path", { "d": "M15 19h4" }], ["path", { "d": "M15 5h4" }], ["path", { "d": "M5 19h4" }], ["path", { "d": "M5 5h4" }]], "@deepseek-ai/dsh-experimental-badge-skill-bundle": [["path", { "d": "M12 9m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0" }], ["path", { "d": "M12 15l3.4 5.89l1.598 -3.233l3.598 .232l-3.4 -5.889" }], ["path", { "d": "M6.802 12l-3.4 5.89l3.598 -.233l1.598 3.232l3.4 -5.889" }]], "@deepseek-ai/dsh-experimental-ralph-bundle": [["path", { "d": "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" }], ["path", { "d": "M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" }]], "@deepseek-ai/dsh-subagent-codex": [["path", { "d": "M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" }], ["path", { "d": "M12 2v2" }], ["path", { "d": "M9 12v9" }], ["path", { "d": "M15 12v9" }], ["path", { "d": "M5 16l4 -2" }], ["path", { "d": "M15 14l4 2" }], ["path", { "d": "M9 18h6" }], ["path", { "d": "M10 8v.01" }], ["path", { "d": "M14 8v.01" }]], "@deepseek-ai/dsh-subagent-claude-code": [["path", { "d": "M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" }], ["path", { "d": "M12 2v2" }], ["path", { "d": "M9 12v9" }], ["path", { "d": "M15 12v9" }], ["path", { "d": "M5 16l4 -2" }], ["path", { "d": "M15 14l4 2" }], ["path", { "d": "M9 18h6" }], ["path", { "d": "M10 8v.01" }], ["path", { "d": "M14 8v.01" }]], "@deepseek-ai/dsh-experimental-liveshare": [["path", { "d": "M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M8.7 10.7l6.6 -3.4" }], ["path", { "d": "M8.7 13.3l6.6 3.4" }]] }
    const JanArtwork = ({ nodes, size }) => h('svg', {
      width: Math.round(size * 0.7), height: Math.round(size * 0.7), viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      className: 'ow-artwork', 'aria-hidden': true,
    }, nodes.map(([tag, attrs], i) => h(tag, { key: i, ...attrs })))

    function FilesTabTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null,
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M3 7V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }), h('path', { d: 'M3 9h18' })),
        tab.title)
    }

    // Jan has no panel launcher rows, so the native More menu becomes the one
    // list of management pages. Plugins and Model Hub keep their footer seats;
    // every other registered panel is opened from here, so hiding its launcher
    // never removes its only destination.
    function PanelDestinations({ entries, onOpen, onDismiss }) {
      // Model Hub already owns the Local models panel from the footer; every
      // other panel is listed here so Jan's launcher-less sidebar keeps each
      // destination.
      const rows = entries.filter(entry => entry.id !== 'ow-models')
      return h(React.Fragment, null, rows.map(entry => h(MenuItemButton, {
        key: entry.id, current: entry.active === true,
        onSelect: () => { onDismiss(); onOpen(entry.id) },
      }, h('span', { className: 'ow-menu-entry' }, entry.label,
        entry.active === true && h(IconCheckOutlineRegular, {
          size: 16, className: 'ow-menu-check', 'aria-hidden': true,
        })))))
    }

    function PluginManagerAction({ wide, useAvailable, openPlugins, t }) {
      const available = useAvailable((value) => value)
      if (!available) return null
      return h('button', {
        type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('plugins'), title: !wide ? t('plugins') : undefined,
        onClick: openPlugins,
      }, h(IconPluginPinwheelOutlineRegular, { size: 16 }), wide && t('plugins'))
    }

    function ModelHubAction({ wide, useAvailable, openModelHub, t }) {
      const available = useAvailable((value) => value)
      if (!available) return null
      return h('button', {
        type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('modelHub'), title: !wide ? t('modelHub') : undefined,
        onClick: () => { if (available) openModelHub() },
      }, h(IconDatabaseOutlineRegular, { size: 16 }), wide && t('modelHub'))
    }

    function SettingsLauncher({ wide, settingsOpen, settingsShortcut, openSettings, t }) {
      return h('button', {
        type: 'button', className: 'ow-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('settings'), title: !wide ? t('settings') : undefined,
        'aria-haspopup': 'dialog', 'aria-expanded': settingsOpen,
        'aria-keyshortcuts': settingsShortcut?.aria, onClick: openSettings,
      }, h(IconSettingsOutlineMedium, { size: 16 }), wide && t('settings'))
    }

    return {
      name: 'ow-shell',
      inject: ['slots'],
      apply(ctx) {
        applyAppearance(preferences)
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ow-appearance', order: 5, label: 'Appearance' }, AppearanceSettings))
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ow-mcp', order: 30, label: 'MCP Servers' }, () => h(AgentSettings, { key: 'mcp' })))
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ow-skills', order: 31, label: 'Skills' }, () => h(AgentSettings, { skills: true, key: 'skills' })))
        const style = document.createElement('style')
        style.dataset.plugin = '@open-waifu/dsh-shell'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'open-waifu-shell: styles')

        ctx.inject(['theme'], (scope) => {
          scope.effect(() => scope.theme.overrideTokens('open-waifu', TOKENS), 'open-waifu-shell: Jan palette')
        })

        const html = document.documentElement
        html.setAttribute('data-ow-shell', '')
        ctx.effect(() => () => html.removeAttribute('data-ow-shell'), 'open-waifu-shell: root marker')

        ctx.inject(['uiWorkspace'], (scope) => {
          // Jan's list is a flat Chats list; the public setter persists through
          // the existing workspace view store, so call it once per mount.
          scope.uiWorkspace.setSessionGrouping('flat')
        })

        ctx.inject(['locale'], (scope) => {
          scope.effect(() => scope.locale.register('open-waifu.shell', {
            en: {
              'hero.headline': 'How can I help you today?',
              chats: 'Chats',
              newChat: 'New Chat',
              newProject: 'Open folder…',
              search: 'Search',
              modelHub: 'Model Hub',
              plugins: 'Plugin manager', settings: 'Settings',
            },
            zh: {
              'hero.headline': '今天有什么可以帮您？',
              chats: '聊天',
              newChat: '新对话',
              newProject: '打开文件夹…',
              search: '搜索',
              modelHub: '中心',
              plugins: '插件管理', settings: '设置',
            },
          }), 'open-waifu-shell: owned copy')
        })

        // Single seats elect the lowest priority. These replace bundled chrome
        // at zero; a user plugin can shadow Jan with priority -2 or lower.
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, SidebarMark))
        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, Name))
        // Jan's navigation rows and chat heading. Each leaf keeps the browser's
        // own callback, ref, search node and view options.
        ctx.slots.inject('sidebar.session.new', () => ctx.slots.register({ name: 'sidebar.session.new', priority: -1, locale: 'open-waifu.shell' }, NewSession))
        ctx.slots.inject('sidebar.workspaces.actions', () => ctx.slots.register({ name: 'sidebar.workspaces.actions', priority: -1, locale: 'open-waifu.shell' }, WorkspaceActions))
        ctx.slots.inject('sidebar.workspaces.header', () => ctx.slots.register({ name: 'sidebar.workspaces.header', priority: -1, locale: 'open-waifu.shell' }, WorkspaceHeader))
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: '@deepseek-ai/dsh-client-ui-sidebar-files', priority: -1 }, FilesTabTitle))
        // Jan's greeting replaces the bundled headline stack; the rest of the
        // hero and composer stay DSH's own.
        ctx.slots.inject('conversation.hero.headline', () => ctx.slots.register({ name: 'conversation.hero.headline', priority: -1, locale: 'open-waifu.shell' }, HeroHeadline))
        // One icon language on the Plugins page: each known plugin keeps its
        // card, only the artwork inside the frame becomes Jan's line glyph.
        for (const [key, nodes] of Object.entries(JAN_ARTWORK)) {
          ctx.slots.inject('plugins.artwork', () => ctx.slots.register({ name: 'plugins.artwork', key }, ({ size }) => h(JanArtwork, { nodes, size })))
        }
        // The More menu's real panel destinations. Registering it also keeps
        // the More trigger present, so no launcher row is hidden without a
        // reachable menu entry.
        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions', id: 'ow-panel-destinations', order: -100,
        }, PanelDestinations))

        if (HeaderModelSelection !== undefined) {
          // The header pill and the composer row read one native directory; the
          // shell moves the seat and declares no child slots of its own.
          ctx.plugin(HeaderModelSelection)
          ctx.slots.inject('conversation.input.model', () => ctx.slots.register({ name: 'conversation.input.model', priority: -1 }, () => null))
        }

        ctx.inject(['layout'], (scope) => {
          scope.layout.configureSidebar({ defaultWidth: 240, minWidth: 224, maxWidth: 320 })
          const available = {
            getSnapshot: () => scope.slots.entriesOfSlot('main').some((entry) => entry.options.key === 'plugins'),
            subscribe: (listener) => scope.slots.subscribe('main', listener),
          }
          const modelHubAvailable = {
            getSnapshot: () => scope.slots.entriesOfSlot('sidebar.panellist').some((entry) => entry.options.id === 'ow-models'),
            subscribe: (listener) => scope.slots.subscribe('sidebar.panellist', listener),
          }
          scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
            name: 'sidebar.footer.action', id: 'ow-model-hub', order: -10,
            locale: 'open-waifu.shell',
            inject: () => ({
              hooks: { available: modelHubAvailable },
              openModelHub: () => scope.layout.selectPanel('ow-models'),
            }),
          }, ModelHubAction))
          scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
            name: 'sidebar.footer.action', id: 'ow-plugin-manager', order: 0,
            locale: 'open-waifu.shell',
            inject: () => ({
              hooks: { available },
              openPlugins: () => scope.layout.selectPanel('plugins'),
            }),
          }, PluginManagerAction))
        })
        ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: -1, locale: 'open-waifu.shell',
        }, SettingsLauncher))

        if (tauri) {
          // DSH's layout reserves a Windows-style title row under these two
          // values; the row's buttons are ours, since the window has no frame.
          const html = document.documentElement
          html.setAttribute('data-windows-titlebar', '')
          html.style.setProperty('--dsh-windows-titlebar-height', '40px')
          if (mac) html.setAttribute('data-ow-mac', '')
          ctx.effect(() => () => {
            html.removeAttribute('data-windows-titlebar')
            html.style.removeProperty('--dsh-windows-titlebar-height')
            html.removeAttribute('data-ow-mac')
          }, 'open-waifu-shell: title row')
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ow-titlebar', order: 100 }, TitleBar))
        }
      },
    }
  },
})
