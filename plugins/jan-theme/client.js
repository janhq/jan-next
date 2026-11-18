// Browser half of the Jan theme plugin. Hand-written for the client module
// loader (no build step): `require` hands out the app's shared React and
// slot runtime, and `apply` registers everything through `ctx.slots`.
window.__ModuleLoader__.load({
  id: '@janhq/jan-client-ui-jan-theme',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      IconPluginPinwheelOutlineRegular, IconCheckOutlineRegular, IconFolderCloseRegular, IconSettingsOutlineMedium,
      IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular,
      MenuItemButton, Button, Switch, IconLayersOutlineRegular, IconClockOutlineRegular,
      IconLightOutlineMedium, IconToolOutlineMedium, IconSkillOutlineMedium,
      NavRow, SectionHeading, ColorSwatchGroup, ProjectCard, WindowControls,
    } = require('@janhq/jan-client-ui-primitives')
    // Optional: the matching host publishes the dock model seat. An older
    // host leaves the composer's own selector in place instead.
    let DockModelSelection
    try {
      DockModelSelection = require('@janhq/jan-client-ui-model-selection/client').DockModelSelection
    } catch (error) {
      console.warn('jan-theme: dock model selection unavailable', error)
      DockModelSelection = undefined
    }
    const shell = window.__JAN_THEME__ ?? { look: null }
    // Tauri: the shell draws the title row itself. Electron owns its window
    // chrome and marks the document with `data-platform`.
    const tauri = window.__TAURI_INTERNALS__
    const win = (cmd) => tauri.invoke(`plugin:window|${cmd}`, { label: 'main' })
    // macOS keeps its native traffic lights (titleBarStyle Overlay / hiddenInset);
    // only the frameless Windows/Linux Tauri window needs our own buttons.
    const mac = tauri
      ? /Mac/.test(navigator.platform || navigator.userAgent)
      : document.documentElement.dataset.platform === 'darwin'

    // Jan's blue accent, the app's default when the settings carry none.
    const look = shell.look ?? { primary: '#456BDE', sidebar: { light: '#C4D0F3', dark: '#0F2157' } }
    const PALETTES = [
      ['gray', 'Gray', '#757575', '#f1f1f1', '#171717'],
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
    const DEFAULT_ACCENT = PALETTES.find(p => p[2].toLowerCase() === look.primary.toLowerCase())?.[0] || 'blue'
    let preferences = { accent: DEFAULT_ACCENT, coloredUserBubble: false, ...shell.appearance }
    const appearanceListeners = new Set()
    let retheme = null
    const applyAppearance = (value) => {
      preferences = value
      const palette = PALETTES.find(p => p[0] === value.accent) || PALETTES[7]
      const root = document.documentElement
      root.style.setProperty('--jt-sidebar-light', palette[3])
      root.style.setProperty('--jt-sidebar-dark', palette[4])
      retheme?.()
      appearanceListeners.forEach(listener => listener())
    }
    async function appearanceApi(method, params = {}) {
      const response = await fetch('/jan-api/appearance', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
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
      return h('section', { className: 'jt-appearance', 'aria-labelledby': `${uid}-title`, 'aria-busy': busy },
        h('h2', { id: `${uid}-title` }, 'Interface'),
        h('div', { className: 'jt-interface-row' },
          h('div', null, h('h3', null, 'Accent color'), h('p', null, 'Customize the accent color of the application.')),
          h(ColorSwatchGroup, {
            label: 'Accent color', value: value.accent, disabled: busy, onChange: accent => save({ ...value, accent }),
            swatches: PALETTES.map(([id, label, color]) => ({ id, label, color })),
          })),
        h('div', { className: 'jt-interface-row' },
          h('div', null, h('h3', null, 'Colored user bubbles'), h('p', null, 'Use the accent color for your messages.')),
          h(Switch, { label: 'Colored user bubbles', checked: value.coloredUserBubble, disabled: busy, onChange: checked => save({ ...value, coloredUserBubble: checked }) })),
        h('div', { className: 'jt-interface-row' },
          h('div', null, h('h3', null, 'Reset to default'), h('p', null, 'Reset accent color and user bubble preferences.')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => save({ accent: DEFAULT_ACCENT, coloredUserBubble: false }) }, 'Reset')),
        h('p', null, 'Theme and font size are in General. Automatic conversation titles are in Plugin manager > Conversation-following titles. Token statistics are in General > Performance usage.'),
        error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, busy ? 'Saving appearance…' : notice))
    }
    async function agentApi(method, params = {}) {
      const response = await fetch('/jan-api/agent-settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'Settings could not be saved.')
      return body.result
    }
    const agentDrafts = new Map()
    function useAgentDraft(key, initial) {
      const [value, update] = React.useState(() => agentDrafts.has(key) ? agentDrafts.get(key) : initial)
      return [value, next => { agentDrafts.set(key, next); update(next) }]
    }
    // One MCP tool: name plus the first line of its description; opening it
    // shows the whole description and each argument the agent will fill in.
    function McpTool({ tool: { name, description, args }, server }) {
      const short = name.replace(`mcp__${server}__`, '')
      return h('li', null, h('details', { className: 'jt-mcp-tool' },
        h('summary', null, h('code', null, short), description && h('span', null, description.split('\n')[0])),
        h('div', { className: 'jt-mcp-tool-body' },
          h('p', null, description || 'The server gave no description for this tool.'),
          args.length ? h('dl', null, args.flatMap(arg => [
            h('dt', { key: `${arg.name}:t` }, h('code', null, arg.name), h('em', null, [arg.type, arg.required ? 'required' : 'optional'].filter(Boolean).join(', '))),
            h('dd', { key: `${arg.name}:d` }, arg.description || '-'),
          ])) : h('small', null, 'Takes no arguments.'))))
    }
    function AgentSettings({ skills = false }) {
      const { Input, Modal, RiskConfirmation, Tag } = require('@janhq/jan-client-ui-primitives')
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
      const field = (label, key, multiline = false, props = {}) => h('label', { className: 'jt-agent-field' }, label, h(multiline ? 'textarea' : Input, { value: draft[key] ?? '', disabled: busy, onChange: event => setDraft({ ...draft, [key]: event.target.value }), ...props }))
      const actions = (...children) => h('div', { className: 'jt-agent-actions' }, ...children)
      const button = (text, action, props = {}) => h(Button, { variant: 'outline', disabled: busy, onClick: action, ...props }, text)
      const message = h(React.Fragment, null, error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, busy ? 'Applying settings…' : notice))
      const empty = (Icon, text, ...buttons) => h('div', { className: 'jt-agent-empty' }, h(Icon, { size: 20 }), h('p', null, text), buttons.length > 0 && actions(...buttons))
      const card = (key, head, ...body) => h('article', { className: 'jt-agent-card', key }, h('div', { className: 'jt-agent-card-head' }, ...head), ...body)
      const SERVER_STATE = { ready: ['success', 'Connected'], failed: ['danger', 'Connection failed'], empty: ['warning', 'No tools'], disabled: ['neutral', 'Off'] }
      const allSkills = data?.skills.skills ?? []
      const shownSkills = allSkills.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(skillQuery.toLowerCase()))
      const savedFolders = data?.directories?.length ?? 0
      return h('section', { className: 'jt-appearance jt-agent-settings', 'aria-busy': busy },
        h('header', { className: 'jt-agent-head' },
          h('div', null,
            h('h2', null, skills ? 'Skills' : 'MCP Servers'),
            h('p', null, skills ? 'Reusable instructions the agent loads when a task matches. Jan finds SKILL.md folders in .agents/skills and .jan/skills.' : 'Connect the agent to external tools. A local server runs with your account permissions, so enable only servers you trust.')),
          !skills && actions(button('Import JSON', () => setImportOpen(true)), button('Add server', () => edit(null), { variant: 'primary' }))),
        !data && !error && h('p', { role: 'status' }, 'Loading settings…'),
        skills ? h(React.Fragment, null,
          allSkills.length > 0 && h('div', { className: 'jt-agent-toolbar' },
            h(Input, { type: 'search', placeholder: 'Search skills', 'aria-label': 'Search skills', value: skillQuery, onChange: event => setSkillQuery(event.target.value) }),
            h('span', null, skillQuery ? `${shownSkills.length} of ${allSkills.length}` : `${allSkills.length} skills`)),
          data?.skills.complete === false && h('p', { role: 'alert' }, 'Skill discovery is incomplete. Some sources could not be read.'),
          data && shownSkills.length === 0 && empty(IconSkillOutlineMedium, skillQuery ? 'No skills match your search.' : 'No skills found yet. Add a folder that contains SKILL.md files below.'),
          shownSkills.length > 0 && h('div', { className: 'jt-agent-list' }, ...shownSkills.map(row => card(row.name,
            [h('div', { className: 'jt-agent-card-title' }, h('h3', null, row.name), (row.source || row.provider) && h(Tag, { tone: 'neutral' }, row.source || row.provider)),
            row.path && h(Button, { variant: 'ghost', size: 'sm', disabled: busy, 'aria-label': `Edit ${row.name}`, onClick: () => run(async () => setInstruction({ name: row.name, ...await agentApi('readSkill', { name: row.name }) }), 'Skill opened.') }, 'Edit')],
            row.description && h('p', null, row.description),
            row.path && h('code', { className: 'jt-agent-card-meta' }, row.path)))),
          h('details', { className: 'jt-agent-folders' },
            h('summary', null, savedFolders ? `Skill folders (${savedFolders})` : 'Add skill folders'),
            h('p', null, 'Reuse an existing skill library without copying it. Removing a folder here leaves its files untouched.'),
            h('label', { className: 'jt-agent-field' }, 'Folders (one absolute path per line)', h('textarea', { value: directories ?? '', disabled: busy, onChange: event => setDirectories(event.target.value) })),
            actions(data?.canPickDirectory && button('Choose folder', () => run(async () => { const path = await agentApi('pickDirectory'); if (path) setDirectories([directories, path].filter(Boolean).join('\n')) }, 'Folder added. Save folders to apply.')), button('Save folders', () => run(() => agentApi('saveDirectories', { directories: (directories ?? '').split('\n').map(path => path.trim()).filter(Boolean) }), 'Skill folders saved.'), { variant: 'primary' }))),
          h('details', { className: 'jt-agent-note' }, h('summary', null, 'Using Claude or Codex skills'), h('p', null, 'Claude and Codex skill instructions may work when they use the same format. Their hooks, plugin manifests, permissions and unavailable tool names are not imported. Review instructions and scripts before use.')),
          instruction && h(Modal, { open: true, title: instruction.name, closeLabel: 'Close skill editor', onClose: () => setInstruction(null), className: 'jt-appearance jt-agent-settings jt-agent-modal', contentClassName: 'jt-agent-modal-content', footer: actions(button('Save instructions', () => ask('Save skill instructions?', 'This writes to the original skill file. Other agents using this folder will see the change.', () => run(async () => setInstruction({ name: instruction.name, ...await agentApi('saveSkill', instruction) }), 'Skill instructions saved.')), { variant: 'primary' }), button('Close editor', () => setInstruction(null))) }, h('code', { className: 'jt-agent-card-meta' }, instruction.path), h('p', null, 'This edits the original file, so other agents that use it see the change too. Unsaved edits are lost on reload.'), h('label', { className: 'jt-agent-field' }, 'Skill instruction file', h('textarea', { rows: 16, value: instruction.text, onChange: event => setInstruction({ ...instruction, text: event.target.value }), disabled: busy })), error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, notice))
        ) : h(React.Fragment, null,
          data && data.servers.length === 0 && empty(IconToolOutlineMedium, 'No MCP servers yet. Add one, or import the mcpServers JSON you already use in Jan or Claude Desktop.'),
          data?.servers.length > 0 && h('div', { className: 'jt-agent-list' }, ...data.servers.map(row => {
            const [tone, label] = SERVER_STATE[row.state] ?? SERVER_STATE.empty
            return card(row.name,
              [h('div', { className: 'jt-agent-card-title' }, h('h3', null, row.name), h(Tag, { tone }, row.state === 'ready' ? `${row.tools.length} tools` : label), row.secretConfigured && h(Tag, { tone: 'quiet' }, 'Credentials saved')),
              h(Switch, { label: `Enable ${row.name}`, checked: row.enabled, disabled: busy, onChange: enabled => enabled ? ask('Enable MCP server?', 'The server can run commands or access external services. Enable it only if you trust its source.', () => run(() => agentApi('toggle', { name: row.name, enabled }), 'Server enabled.')) : run(() => agentApi('toggle', { name: row.name, enabled }), 'Server disabled.') })],
              h('code', { className: 'jt-agent-card-meta' }, row.transport === 'stdio' ? [row.command, ...(row.args ?? [])].join(' ') : row.url),
              (row.state === 'failed' || row.state === 'empty') && h('p', null, row.status),
              h('div', { className: 'jt-agent-card-foot' },
                row.tools?.length > 0 ? h('details', { className: 'jt-mcp-tools' }, h('summary', null, `Show ${row.tools.length} tools`), h('ul', null, row.tools.map(tool => h(McpTool, { key: tool.name, tool, server: row.name })))) : h('span'),
                h('div', { className: 'jt-agent-actions' },
                  row.enabled && h(Button, { variant: 'ghost', size: 'sm', disabled: busy, 'aria-label': `Reconnect ${row.name}`, onClick: () => run(() => agentApi('toggle', { name: row.name, enabled: true }), 'Connection refreshed.') }, 'Reconnect'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, 'aria-label': `Edit ${row.name}`, onClick: () => edit(row) }, 'Edit'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, 'aria-label': `Remove ${row.name}`, onClick: () => ask('Remove MCP server?', 'This removes the connection and its saved credentials. It does not uninstall the server software.', () => run(() => agentApi('remove', { name: row.name, confirmed: true }), 'Server removed.')) }, 'Remove'))))
          })),
          h('details', { className: 'jt-agent-note' }, h('summary', null, 'MCP servers, skills, plugins and agent presets'), h('p', null, 'MCP servers provide tools. Skills provide reusable instructions. Plugins add app features through Plugin manager. Agent presets hold saved instructions and working modes.')),
          draft && h(Modal, {
            open: true, title: original ? `Edit ${original}` : 'Add MCP server', closeLabel: 'Close editor', onClose: () => setDraft(null), className: 'jt-appearance jt-agent-settings jt-agent-modal', contentClassName: 'jt-agent-modal-content', footer: actions(button('Save server', () => run(async () => {
              const value = { ...draft, args: draft.args === '' ? [] : draft.args.split('\n'), env: JSON.parse(draft.env), headers: JSON.parse(draft.headers) }
              await agentApi('saveServer', { value, originalName: original || undefined, replaceSecrets }); setDraft(null)
            }, 'MCP server saved.'), { variant: 'primary' }), button('Cancel', () => setDraft(null)))
          },
            field('Server name', 'name', false, { disabled: busy || !!original }),
            h('label', { className: 'jt-agent-field' }, 'Transport', h('select', { value: draft.transport, disabled: busy, onChange: event => setDraft({ ...draft, transport: event.target.value }) }, h('option', { value: 'stdio' }, 'Local command (stdio)'), h('option', { value: 'streamable-http' }, 'Remote endpoint (Streamable HTTP)'))),
            draft.transport === 'stdio' ? h(React.Fragment, null, field('Command', 'command'), field('Arguments (one per line)', 'args', true, { rows: 2 })) : field('MCP endpoint URL', 'url'),
            h('details', null, h('summary', null, 'Advanced: working directory and credentials'),
              draft.transport === 'stdio' && field('Working directory (optional absolute path)', 'cwd'),
              original && h('label', null, h('input', { type: 'checkbox', checked: replaceSecrets, onChange: event => setReplaceSecrets(event.target.checked) }), ' Replace saved environment / headers'),
              replaceSecrets && (draft.transport === 'stdio' ? field('Environment (JSON object, stored as credentials)', 'env', true, { autoComplete: 'off', spellCheck: false }) : field('Headers (JSON object, stored as credentials)', 'headers', true, { autoComplete: 'off', spellCheck: false }))),
            h('p', null, 'Saved connections persist. Unsaved drafts stay while switching sections, but are lost on reload. Credentials are never displayed after saving.'),
            error && h('p', { role: 'alert' }, error)),
          importOpen && h(Modal, { open: true, title: 'Import MCP JSON', closeLabel: 'Close import', onClose: () => setImportOpen(false), className: 'jt-appearance jt-agent-settings jt-agent-modal', contentClassName: 'jt-agent-modal-content', footer: actions(button('Review import', () => run(async () => setPreview(await agentApi('previewImport', { text: importText })), 'Import reviewed. Nothing has been saved.')), preview && button('Import disabled servers', () => run(async () => { await agentApi('importServers', { text: importText, confirmed: true }); setImportText(''); setPreview(null); setImportOpen(false) }, 'Servers imported disabled.'), { variant: 'primary' }), button('Cancel', () => setImportOpen(false))) },
            h('p', null, 'Paste an object containing mcpServers. Imports are all-or-nothing, never overwrite names, and stay disabled until you enable them. Codex TOML, Claude plugins and legacy SSE need separate conversion.'),
            h('label', { className: 'jt-agent-field' }, 'MCP configuration JSON', h('textarea', { rows: 6, value: importText, autoComplete: 'off', spellCheck: false, onChange: event => { setImportText(event.target.value); setPreview(null) } })),
            preview && h('div', null, ...preview.map(row => h('p', { key: row.name }, `${row.name}: ${row.transport}, disabled. Credential fields: ${[...row.environmentKeys, ...row.headerKeys].join(', ') || 'none'}`))), error && h('p', { role: 'alert' }, error))
        ), message,
        h(RiskConfirmation, { open: !!confirmation, title: confirmation?.title || '', description: confirmation?.description || '', acknowledgeLabel: 'I understand this change', cancelLabel: 'Cancel', closeLabel: 'Close', confirmLabel: 'Confirm', acknowledged, disabled: busy, onAcknowledgedChange: setAcknowledged, onCancel: () => setConfirmation(null), onConfirm: () => { const action = confirmation.action; setConfirmation(null); action() } }))
    }
    const both = (v) => ({ light: v, dark: v })
    // Jan's palette (web-app/src/index.css) mapped onto the app's alias tokens.
    // Publish concrete accent values on body. WebKit can retain a transitioning
    // background when only an indirect root custom property changes.
    const tokensFor = (value) => {
      const accent = (PALETTES.find(p => p[0] === value.accent) || PALETTES[7])[2]
      const shade = (weight) => ({
        light: `color-mix(in oklch, ${accent} ${weight}%, black)`,
        dark: `color-mix(in oklch, ${accent} ${weight}%, white)`,
      })
      const hover = shade(88)
      const active = shade(76)
      return {
        ...TOKENS,
        '--dsw-alias-brand-primary': both(accent),
        '--dsw-alias-brand-primary-new-colorprimary-new-color': both(accent),
        '--dsw-alias-button-primary-fill': both(accent),
        '--dsw-alias-button-primary-hover': hover,
        '--dsw-alias-button-primary-active': active,
        '--dsw-alias-button-info-fill': both(accent),
        '--dsw-alias-button-info-hover': hover,
        '--dsw-alias-button-info-active': active,
        '--dsw-alias-state-business-primary': both(accent),
        '--dsw-alias-label-deep-diving': {
          light: `color-mix(in oklch, ${accent} 85%, black)`,
          dark: `color-mix(in oklch, ${accent} 80%, white)`,
        },
        // Set where the overrides land (body), so the neutral grey resolves
        // against the layer-2 token defined there; from :root it would not.
        '--dsw-specific-bubble': value.coloredUserBubble
          ? { light: `color-mix(in oklch, ${accent} 22%, white)`, dark: `color-mix(in oklch, ${accent} 70%, black)` }
          : both('var(--dsw-alias-bg-layer-2)'),
      }
    }
    const TOKENS = {
      '--jan-font-family-text': both("'Inter', 'Segoe UI', sans-serif"),
      '--dsw-alias-bg-base': { light: 'oklch(1 0 0)', dark: 'oklch(0.18 0 0)' },
      '--dsw-alias-bg-layer-1': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-bg-layer-2': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-alias-bg-overlay': { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0 0)' },
      '--dsw-alias-border-l1': { light: 'oklch(0.922 0 0)', dark: 'oklch(1 0 0 / 10%)' },
      '--dsw-alias-border-l2': { light: 'oklch(0.88 0 0)', dark: 'oklch(1 0 0 / 15%)' },
      '--dsw-alias-label-primary': { light: 'oklch(0.145 0 0)', dark: 'oklch(0.985 0 0)' },
      '--dsw-alias-label-secondary': { light: 'oklch(0.556 0 0)', dark: 'oklch(0.708 0 0)' },
      '--dsw-specific-input-major': { light: 'oklch(0.97 0 0)', dark: 'oklch(0.235 0 0)' },
      '--dsw-specific-selector': { light: 'oklch(0.94 0 0)', dark: 'oklch(0.269 0 0)' },
      '--dsw-specific-sidebar-fill': { light: 'var(--jt-sidebar-light)', dark: 'var(--jt-sidebar-dark)' },
      '--dsw-specific-sidebar-nav-item-hover': {
        light: `color-mix(in oklch, var(--jt-sidebar-light) 85%, black)`,
        dark: `color-mix(in oklch, var(--jt-sidebar-dark) 85%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active': {
        light: `color-mix(in oklch, var(--jt-sidebar-light) 75%, black)`,
        dark: `color-mix(in oklch, var(--jt-sidebar-dark) 75%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active-accent': {
        light: `color-mix(in oklch, var(--jt-sidebar-light) 75%, black)`,
        dark: `color-mix(in oklch, var(--jt-sidebar-dark) 75%, white)`,
      },
    }

    const CSS = `
.jt-agent-modal { display: flex; flex-direction: column; width: min(620px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
.jt-agent-modal-content { min-height: 0; overflow-y: auto; }
.jt-agent-field { display: grid; gap: 6px; margin-block: 12px; }
.jt-agent-field textarea, .jt-agent-field select { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; }
.jt-agent-field textarea { min-height: 80px; resize: vertical; }
.jt-agent-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.jt-agent-editor { margin-block: 16px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.jt-agent-settings small, .jt-agent-settings p { overflow-wrap: anywhere; }
.jt-agent-settings small { display: block; color: var(--dsw-alias-label-secondary); margin-block: 4px; }
.jt-agent-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.jt-agent-head > div:first-child { flex: 1 1 auto; min-width: 0; }
.jt-agent-head > .jt-agent-actions { flex: none; }
.jt-agent-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.jt-agent-toolbar > :first-child { flex: 1; min-width: 0; }
.jt-agent-toolbar > span { flex: none; font-size: 13px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.jt-agent-list { display: grid; gap: 8px; }
.jt-agent-card { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
.jt-agent-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.jt-agent-card-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.jt-agent-card-title h3 { font-size: 14px; overflow-wrap: anywhere; }
.jt-agent-settings .jt-agent-card p { margin: 0; font-size: 13px; }
.jt-agent-card-meta { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jt-agent-card-foot { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.jt-agent-card-foot > :first-child { flex: 1 1 240px; min-width: 0; }
.jt-agent-card-foot > .jt-agent-actions { margin-inline-start: auto; }
.jt-agent-settings .jt-agent-card-foot details { margin: 4px 0 0; font-size: 13px; }
.jt-agent-empty { display: grid; justify-items: center; gap: 10px; padding: 32px 24px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 12px; text-align: center; color: var(--dsw-alias-label-secondary); }
.jt-agent-settings .jt-agent-empty p { margin: 0; max-width: 42ch; }
.jt-agent-settings details.jt-agent-folders { margin-block: 16px 0; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.jt-agent-settings details.jt-agent-note { margin-block: 16px 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.jt-agent-settings details { margin-block: 20px; }
.jt-agent-settings summary { cursor: pointer; }
.jt-agent-settings .jt-mcp-tools .jt-mcp-tool { margin: 0; }
.jt-mcp-tools > ul { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.jt-mcp-tools > ul > li + li { border-top: 1px solid var(--dsw-alias-border-l1); }
.jt-mcp-tool > summary { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; min-width: 0; list-style-position: inside; }
.jt-mcp-tool > summary code { flex: none; font-size: 13px; color: var(--dsw-alias-label-primary); }
.jt-mcp-tool > summary span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.jt-mcp-tool[open] > summary span { display: none; }
.jt-mcp-tool-body { padding: 0 12px 12px 28px; font-size: 13px; }
.jt-agent-settings .jt-mcp-tool-body p { margin: 0 0 8px; white-space: pre-wrap; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.jt-mcp-tool-body dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.jt-mcp-tool-body dt code { font-size: 12px; }
.jt-mcp-tool-body dt em { margin-inline-start: 6px; font-style: normal; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.jt-mcp-tool-body dd { margin: 0; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.jt-appearance h2, .jt-appearance h3 { text-wrap: balance; font-size: 16px; font-weight: 500; margin: 0; }
.jt-appearance p { text-wrap: pretty; color: var(--dsw-alias-label-secondary); margin-block: 6px; line-height: 1.5; }
.jt-interface-row { display: flex; align-items: center; justify-content: space-between; gap: 32px; padding-block: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
@media (max-width: 640px) { .jt-interface-row { flex-wrap: wrap; gap: 12px; } }
@font-face { font-family: 'Inter'; font-display: swap; font-weight: 100 900; src: url('/jan-theme/assets/InterVariable.woff2') format('woff2'); }
@font-face { font-family: 'StudioFeixenSans'; font-display: swap; font-weight: 500; src: url('/jan-theme/assets/StudioFeixenSans-Medium.otf') format('opentype'); }
.jt-name { font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.jt-titlebar { position: fixed; inset: 0 0 auto 0; height: var(--jan-windows-titlebar-height); z-index: 40; pointer-events: none; }
.jt-titlebar > .jt-drag { position: absolute; inset: 0 140px 0 280px; pointer-events: auto; }
.jt-controls { position: absolute; top: 0; right: 0; pointer-events: auto; }
/* The stock shell's public data-slot anchors and frame data attributes delimit these
   rules. Only the shipped shell's immediate structure is styled; no hashed
   classes, DOM moves, or blanket slot suppression. A replaced parent owns its
   own geometry. Later theme plugins can override tokens, and later CSS can
   override these marker-scoped rules. */
  html[data-jan-theme] {
    --jt-sidebar-gap: 12px;
    --jt-sidebar-radius: 14px;
  }
  html[data-jan-theme] [data-slot='root'] > [data-sidebar-collapsed], html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay]) {
    background: var(--dsw-alias-bg-base);
  }
  html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay])::before { background: var(--dsw-alias-bg-base); }
  html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']) {
    border: 0;
    border-radius: 0;
  }
  html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-collapsed]):not([data-sidebar-drawer]) > :has(> [data-slot='sidebar']) {
    position: relative;
    margin: var(--jt-sidebar-gap) 0 var(--jt-sidebar-gap) var(--jt-sidebar-gap);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: var(--jt-sidebar-radius);
    background: var(--dsw-alias-bg-base);
    overflow: hidden;
  }
  html[data-jan-theme] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    width: 100% !important; /* The shell passes the outer column width, before the inset. */
    background: linear-gradient(to bottom, var(--dsw-specific-sidebar-fill), var(--dsw-alias-bg-base));
    padding: 6px 8px;
  }
  html[data-jan-theme] body[data-ds-dark-theme] [data-slot='sidebar'] > div:has(> [data-window-drag]) {
    background: linear-gradient(to bottom, color-mix(in srgb, var(--dsw-specific-sidebar-fill) 70%, transparent), var(--dsw-alias-bg-base));
  }
  html[data-jan-theme] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) {
    height: 40px;
    padding: 0 2px 0 4px;
    margin: 0 0 8px;
  }
  html[data-jan-theme] [data-slot='sidebar'] [data-slot='sidebar.brand.mark']:has(.jt-sidebar-mark) { display: none; }
  /* Clear the native traffic lights (tauri.macos.conf.json trafficLightPosition). */
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) { padding-left: 64px; }
  html[data-jan-theme][data-jan-theme-mac]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] { left: 84px; }
  /* Electron on macOS gives the toggle its own strip above the logo row; fold
     that strip into the logo row so the wordmark shares the traffic-light row. */
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div:has(> [data-window-drag] > [data-sidebar-toggle]) { position: relative; }
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div > [data-window-drag]:has(> [data-sidebar-toggle]) {
    position: absolute; top: 6px; right: 10px; height: 40px; display: flex; align-items: center; z-index: 1;
  }
  html[data-jan-theme] [data-slot='sidebar.brand.name'] .jt-name { font-size: 14px; }
  html[data-jan-theme] [data-slot='sidebar'] [data-sidebar-toggle] {
    position: relative;
    inset: auto;
    margin-left: auto;
  }
  html[data-jan-theme]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] {
    position: fixed;
    top: calc((var(--jan-windows-titlebar-height, 40px) - 28px) / 2);
    left: 12px;
  }
  html[data-jan-theme] [data-slot='sidebar'] > div > button {
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
  html[data-jan-theme] [data-slot='sidebar'] > div > button > span:first-child > span { width: auto; justify-content: flex-start; gap: 8px; }
  html[data-jan-theme] [data-slot='sidebar'] > div > button > span:last-child:not(:first-child) { opacity: 1; color: var(--dsw-alias-label-secondary); font-size: 11px; }
  html[data-jan-theme] [data-slot='sidebar'] nav { margin: 0 0 12px; }
  html[data-jan-theme] [data-slot='sidebar'] nav > button, html[data-jan-theme] [data-slot='sidebar'] nav > div > button { min-height: 36px; border-radius: 6px; }
  /* Jan has no panel launchers above the chat list. Plugins and Model Hub move
     to the footer; every remaining management page stays reachable through the
     native More menu, whose trigger keeps aria-haspopup. Without that trigger
     the rows stay so no page loses its only destination. */
  html[data-jan-theme] [data-slot='sidebar'] nav[aria-label]:has(button[aria-haspopup]) > button[aria-label]:not([aria-haspopup]),
  html[data-jan-theme] [data-slot='sidebar'] nav[aria-label]:has(button[aria-haspopup]) > div:has(> button[aria-label]):not(:has(button[aria-haspopup])) { display: none; }
  html[data-jan-theme] [data-row-key^='session:'] { min-height: 36px; }
  /* Jan lists a chat once it has a message; New Chat already reaches the blank
     session, so its "New Session" row reads as a duplicate. */
  html[data-jan-theme] [data-row-key^='session:'][data-blank] { display: none; }
  /* Jan's sidebar paints a gradient, while the native list fade fades to a
     single sidebar-fill colour: either choice paints a hard-edged band across
     the last row (blue with the accent, grey with the base). Drop the overlay;
     the list keeps its own clip. */
  html[data-jan-theme] [data-slot='sidebar.workspaces'] > div > div > div:has([role='tree']) > span:last-child { display: none; }
  /* The shell's sidebar-wide fade above the footer has the same single-colour band. */
  html[data-jan-theme] [data-slot='sidebar'] > div > div:has([data-slot='sidebar.workspaces']) > span[aria-hidden='true']:last-child { display: none; }
  /* The stock More launcher keeps its own 32px / 12px-radius pill; Jan draws
     it as one more nav row so the column has a single row rhythm. */
  html[data-jan-theme] button[aria-label][aria-haspopup='menu'][class*='panelRow'] { height: 36px; padding: 0 8px; border-width: 0; border-radius: 6px; gap: 8px; }
  /* Projects page. */
  .jt-projects { box-sizing: border-box; width: 100%; max-width: 880px; margin: 0 auto; padding: 48px 32px; color: var(--dsw-alias-label-primary); }
  .jt-projects-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .jt-projects-head h1 { margin: 0; font-size: 28px; font-weight: 500; line-height: 36px; }
  .jt-projects-head button { display: inline-flex; align-items: center; gap: 6px; }
  .jt-projects-lede { margin: 4px 0 24px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
  .jt-projects-error { margin: -12px 0 20px; color: var(--dsw-alias-state-error-primary); font-size: 14px; line-height: 20px; }
  .jt-projects-search { display: flex; align-items: center; gap: 8px; height: 40px; margin-bottom: 20px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-primary, var(--dsw-alias-separator)); border-radius: 8px; color: var(--dsw-alias-label-secondary); }
  .jt-projects-search:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
  .jt-projects-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }
  .jt-projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
  .jt-projects-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 0; color: var(--dsw-alias-label-secondary); font-size: 14px; }
  @media (max-width: 600px) { .jt-projects { padding: 24px 16px; } }
  /* Jan's "Chats" heading. The browser-owned search and view-options nodes stay
     mounted inside it; only their presentation folds while search is open. */
  .jt-list-header { flex: none; display: flex; align-items: center; gap: 4px; height: 36px; margin: 2px -4px 4px 0; padding-left: var(--jan-sidebar-row-padding, 12px); color: var(--dsw-alias-label-tertiary); }
  .jt-list-tools { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; }
  .jt-list-actions { display: flex; align-items: center; }
  .jt-list-header[data-search-expanded] .jt-list-heading, .jt-list-header[data-search-expanded] .jt-list-actions { display: none; }
  .jt-list-header[data-search-expanded] .jt-list-tools { flex: 1; }
  /* Jan's row under the composer: model and context reading at the right,
     text-only model trigger. The composer card keeps no second selector. */
  html[data-jan-theme] [data-composer-dock] { box-sizing: border-box; width: 100%; max-width: var(--jan-composer-card-max-width); padding-inline: 12px; justify-content: flex-end; }
  html[data-jan-theme] [data-composer-dock] button[aria-haspopup='menu'] > svg:first-child { display: none; }
  /* The dock seat has no composer measurement: let its trigger shrink with
     the seat so a long model name ellipsizes instead of running under the ring. */
  html[data-jan-theme] [data-composer-dock] button[aria-haspopup='menu'] { max-width: 100%; }
  /* A thin line waving hand in Jan's icon style. The SVG animates itself and
     honours reduced motion; as a mask it takes the status text's colour. */
  html[data-jan-theme] [data-chat-running-mark] { background: currentColor; -webkit-mask: url('/jan-theme/assets/hand-wave.svg') center / contain no-repeat; mask: url('/jan-theme/assets/hand-wave.svg') center / contain no-repeat; }
  html[data-jan-theme] [data-chat-running-mark] > * { display: none; }
  .jt-hero-title { width: 100%; margin: 0 0 16px; font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 24px; font-weight: 500; line-height: 32px; color: var(--dsw-alias-label-primary); text-align: center; text-wrap: balance; }
.jt-footer-action { width: 100%; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; text-align: left; cursor: pointer; }
.jt-footer-action > svg { flex: none; color: var(--dsw-alias-label-secondary); }
.jt-footer-action:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
.jt-footer-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.jt-footer-action[data-rail] { justify-content: center; padding-inline: 0; }
.jt-menu-entry { display: flex; align-items: center; gap: 8px; width: 100%; }
.jt-artwork { color: var(--dsw-alias-label-primary); }
.jt-menu-check { flex: none; margin-left: auto; color: var(--dsw-alias-state-business-primary); }
/* Native titlebar rules need to outrank the shell's platform rules; they never touch
   third-party panel or composer contents. The shell's track motion stays. */
html[data-jan-theme][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) { padding-top: 0; }
html[data-jan-theme][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > :has([data-slot='main']),
html[data-jan-theme][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]) > [data-rightbar-col] { padding-top: var(--jan-windows-titlebar-height); }
/* The inset sidebar card starts below the caption, where the history buttons and menubar sit. */
html[data-jan-theme][data-windows-titlebar] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-collapsed]):not([data-sidebar-drawer]) > :has(> [data-slot='sidebar']) { margin-top: var(--jan-windows-titlebar-height); }
/* The expanded card carries its own toggle, so the caption starts with Back at the toggle's seat. */
html[data-jan-theme][data-windows-titlebar]:not(:has([data-sidebar-collapsed])) { --jan-windows-menu-start: 84px; }
html[data-jan-theme][data-windows-titlebar]:not(:has([data-sidebar-collapsed])) [data-slot='sidebar'] [data-navigation='back'] { left: 12px; }
html[data-jan-theme][data-windows-titlebar]:not(:has([data-sidebar-collapsed])) [data-slot='sidebar'] [data-navigation='forward'] { left: 48px; }
/* Guide labels remain readable when shortcut hints consume a narrow card. */
html[data-jan-theme] [data-sidebar-right-guide-entry='files'] > span:nth-child(2) > span,
html[data-jan-theme] [data-sidebar-right-guide-entry='terminal'] > span:nth-of-type(2) > span:last-child { white-space: normal; overflow-wrap: anywhere; }
/* Guide providers keep their actions; the shell supplies Jan's line artwork. */
html[data-jan-theme] [data-sidebar-right-guide-entry='files'] > span:first-of-type,
html[data-jan-theme] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type { color: var(--dsw-alias-label-secondary); }
html[data-jan-theme] [data-sidebar-right-guide-entry='files'] > span:first-of-type > svg,
html[data-jan-theme] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type > svg { display: none; }
html[data-jan-theme] [data-sidebar-right-guide-entry='files'] > span:first-of-type::before,
html[data-jan-theme] [data-sidebar-right-guide-entry='terminal'] > span:first-of-type::before { content: ''; display: block; width: 22px; height: 22px; background: currentColor; mask: var(--jt-guide-icon) center / contain no-repeat; }
html[data-jan-theme] [data-sidebar-right-guide-entry='files'] { --jt-guide-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'/%3E%3Cpath d='M3 9h18'/%3E%3C/svg%3E"); }
html[data-jan-theme] [data-sidebar-right-guide-entry='terminal'] { --jt-guide-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2'/%3E%3Cpath d='m8 9 3 3-3 3m5 0h3'/%3E%3C/svg%3E"); }
html[data-jan-theme] [data-sidebar-right-panel] button[aria-haspopup='menu'] > span:first-child > svg { stroke: currentColor; color: var(--dsw-alias-label-secondary); }
/* Positioned dock panels ignore their column's padding. Reserve the caption on
   the panel itself so both normal and fullscreen chrome stay below it. */
html[data-jan-theme][data-windows-titlebar] [data-sidebar-right-panel] { top: var(--jan-windows-titlebar-height); }

`

    const svg = (d, size = 10) => h('svg', { width: size, height: size, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1 }, d)
    const Name = () => h('span', { className: 'jt-name' }, 'Jan')

    function TitleBar() {
      const [maximized, setMaximized] = React.useState(false)
      const sync = () => { win('is_maximized').then(setMaximized, () => { }) }
      React.useEffect(() => {
        sync()
        window.addEventListener('resize', sync)
        return () => window.removeEventListener('resize', sync)
      }, [])
      return h('div', { className: 'jt-titlebar' },
        h('div', { className: 'jt-drag', 'data-tauri-drag-region': '' }),
        !mac && h(WindowControls, {
          className: 'jt-controls', maximized,
          labels: { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' },
          onMinimize: () => win('minimize'), onToggleMaximize: () => win('toggle_maximize').then(sync), onClose: () => win('close'),
        }))
    }

    const SidebarMark = () => h('span', { className: 'jt-sidebar-mark', 'aria-hidden': true })

    const NewSession = ({ wide, onStart, shortcutKeys, shortcutAria, t }) => h(NavRow, {
      icon: h(wide ? IconNewChatOutlineMedium : IconNewChatOutlineRegular, { size: wide ? 16 : 18 }),
      label: t('newChat'), shortcutKeys, shortcutAria, rail: !wide, onClick: onStart,
    })

    // Search, Projects, Artifacts and Plugins follow New chat (Claude's order).
    // Each destination with something to create carries a hover "+" for it.
    function WorkspaceActions({
      wide, onSearch, searchShortcut, usePanelInfo, usePluginsAvailable, useArtifactsAvailable, useScheduledAvailable,
      openPanel, addProject, newChat, createPlugin, t,
    }) {
      const active = usePanelInfo((info) => info.activePanelId)
      const plugins = usePluginsAvailable((value) => value)
      const artifacts = useArtifactsAvailable((value) => value)
      const scheduled = useScheduledAvailable((value) => value)
      const size = wide ? 16 : 18
      // The opening click must not reach the browser's outside-click dismissor.
      const requestSearch = (event) => {
        event.stopPropagation()
        onSearch()
      }
      return h(React.Fragment, null,
        h(NavRow, {
          icon: h(IconSearchOutlineRegular, { size }),
          label: t('search'), shortcutKeys: searchShortcut?.keys, shortcutAria: searchShortcut?.aria,
          rail: !wide, onClick: requestSearch,
        }),
        h(NavRow, {
          icon: h(IconFolderCloseRegular, { size }), label: t('projects'), rail: !wide,
          current: active === PROJECTS_PANEL, onClick: () => { openPanel(PROJECTS_PANEL) },
          quick: { label: t('newProject'), onClick: () => { void addProject() } },
        }),
        artifacts && h(NavRow, {
          icon: h(IconLayersOutlineRegular, { size }), label: t('artifacts'), rail: !wide,
          current: active === ARTIFACTS_PANEL, onClick: () => { openPanel(ARTIFACTS_PANEL) },
          quick: { label: t('newArtifact'), onClick: newChat },
        }),
        scheduled && h(NavRow, {
          icon: h(IconClockOutlineRegular, { size }), label: t('scheduled'), rail: !wide,
          current: active === SCHEDULED_PANEL, onClick: () => { openPanel(SCHEDULED_PANEL) },
        }),
        plugins && h(NavRow, {
          icon: h(IconPluginPinwheelOutlineRegular, { size }), label: t('plugins'), rail: !wide,
          current: active === 'plugins', onClick: () => { openPanel('plugins') },
          quick: { label: t('createPlugin'), onClick: createPlugin },
        }))
    }

    // The search node owns its input and refs, so it stays mounted while wide;
    // the view-options node keeps its menu state the same way.
    const WorkspaceHeader = ({ wide, searchExpanded, search, viewOptions, t }) => wide
      ? h('div', { className: 'jt-list-header', 'data-search-expanded': searchExpanded || undefined },
        h(SectionHeading, { as: 'span', className: 'jt-list-heading' }, t('chats')),
        h('div', { className: 'jt-list-tools' }, search, h('div', { className: 'jt-list-actions' }, viewOptions)))
      : null

    const HeroHeadline = ({ t }) => h('h1', { className: 'jt-hero-title' }, t('hero.headline'))

    // Jan draws every plugin with Tabler outline glyphs (MIT), so the cards use
    // the same line icons in the label colour instead of the stock filled artwork.
    const JAN_ARTWORK = { "shell": [["path", { "d": "M8 9l3 3l-3 3" }], ["path", { "d": "M13 15l3 0" }], ["path", { "d": "M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" }]], "agent-loop": [["path", { "d": "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" }], ["path", { "d": "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" }]], "subagent": [["path", { "d": "M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1" }], ["path", { "d": "M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M17 10h2a2 2 0 0 1 2 2v1" }], ["path", { "d": "M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" }], ["path", { "d": "M3 13v-1a2 2 0 0 1 2 -2h2" }]], "web-search": [["path", { "d": "M21 12a9 9 0 1 0 -9 9" }], ["path", { "d": "M3.6 9h16.8" }], ["path", { "d": "M3.6 15h7.9" }], ["path", { "d": "M11.5 3a17 17 0 0 0 0 18" }], ["path", { "d": "M12.5 3a16.984 16.984 0 0 1 2.574 8.62" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M20.2 20.2l1.8 1.8" }]], "@janhq/jan-experimental-agent-team-profile": [["path", { "d": "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" }], ["path", { "d": "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" }], ["path", { "d": "M16 3.13a4 4 0 0 1 0 7.75" }], ["path", { "d": "M21 21v-2a4 4 0 0 0 -3 -3.85" }]], "@janhq/jan-experimental-voice-input-bundle": [["path", { "d": "M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" }], ["path", { "d": "M5 10a7 7 0 0 0 14 0" }], ["path", { "d": "M8 21l8 0" }], ["path", { "d": "M12 17l0 4" }]], "@janhq/jan-experimental-plugin-market-bundle": [["path", { "d": "M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" }], ["path", { "d": "M14 7l6 0" }], ["path", { "d": "M17 4l0 6" }]], "@janhq/jan-experimental-auto-review": [["path", { "d": "M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" }], ["path", { "d": "M15 19l2 2l4 -4" }]], "@janhq/jan-experimental-forge-bundle": [["path", { "d": "M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }], ["path", { "d": "M6 8l0 8" }], ["path", { "d": "M11 6h5a2 2 0 0 1 2 2v8" }], ["path", { "d": "M14 9l-3 -3l3 -3" }]], "@janhq/jan-personalized-recommendations": [["path", { "d": "M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" }]], "@janhq/jan-experimental-inspector-profile": [["path", { "d": "M9 9v-1a3 3 0 0 1 6 0v1" }], ["path", { "d": "M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3" }], ["path", { "d": "M3 13l4 0" }], ["path", { "d": "M17 13l4 0" }], ["path", { "d": "M12 20l0 -6" }], ["path", { "d": "M4 19l3.35 -2" }], ["path", { "d": "M20 19l-3.35 -2" }], ["path", { "d": "M4 7l3.75 2.4" }], ["path", { "d": "M20 7l-3.75 2.4" }]], "@janhq/jan-cua-bundle": [["path", { "d": "M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z" }]], "@janhq/jan-experimental-cot-translation-bundle": [["path", { "d": "M4 5h7" }], ["path", { "d": "M9 3v2c0 4.418 -2.239 8 -5 8" }], ["path", { "d": "M5 9c0 2.144 2.952 3.908 6.7 4" }], ["path", { "d": "M12 20l4 -9l4 9" }], ["path", { "d": "M19.1 18h-6.2" }]], "@janhq/jan-experimental-session-search": [["path", { "d": "M8 9h8" }], ["path", { "d": "M8 13h5" }], ["path", { "d": "M11.008 19.195l-3.008 1.805v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v4.5" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M20.2 20.2l1.8 1.8" }]], "@janhq/jan-experimental-session-titles-bundle": [["path", { "d": "M7 12h10" }], ["path", { "d": "M7 5v14" }], ["path", { "d": "M17 5v14" }], ["path", { "d": "M15 19h4" }], ["path", { "d": "M15 5h4" }], ["path", { "d": "M5 19h4" }], ["path", { "d": "M5 5h4" }]], "@janhq/jan-experimental-badge-skill-bundle": [["path", { "d": "M12 9m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0" }], ["path", { "d": "M12 15l3.4 5.89l1.598 -3.233l3.598 .232l-3.4 -5.889" }], ["path", { "d": "M6.802 12l-3.4 5.89l3.598 -.233l1.598 3.232l3.4 -5.889" }]], "@janhq/jan-experimental-ralph-bundle": [["path", { "d": "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" }], ["path", { "d": "M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" }]], "@janhq/jan-subagent-codex": [["path", { "d": "M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" }], ["path", { "d": "M12 2v2" }], ["path", { "d": "M9 12v9" }], ["path", { "d": "M15 12v9" }], ["path", { "d": "M5 16l4 -2" }], ["path", { "d": "M15 14l4 2" }], ["path", { "d": "M9 18h6" }], ["path", { "d": "M10 8v.01" }], ["path", { "d": "M14 8v.01" }]], "@janhq/jan-subagent-claude-code": [["path", { "d": "M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" }], ["path", { "d": "M12 2v2" }], ["path", { "d": "M9 12v9" }], ["path", { "d": "M15 12v9" }], ["path", { "d": "M5 16l4 -2" }], ["path", { "d": "M15 14l4 2" }], ["path", { "d": "M9 18h6" }], ["path", { "d": "M10 8v.01" }], ["path", { "d": "M14 8v.01" }]], "@janhq/jan-experimental-liveshare": [["path", { "d": "M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" }], ["path", { "d": "M8.7 10.7l6.6 -3.4" }], ["path", { "d": "M8.7 13.3l6.6 3.4" }]] }
    const JanArtwork = ({ nodes, size }) => h('svg', {
      width: Math.round(size * 0.7), height: Math.round(size * 0.7), viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      className: 'jt-artwork', 'aria-hidden': true,
    }, nodes.map(([tag, attrs], i) => h(tag, { key: i, ...attrs })))

    function FilesTabTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null,
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M3 7V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }), h('path', { d: 'M3 9h18' })),
        tab.title)
    }

    // Jan has no panel launcher rows, so the native More menu becomes the one
    // list of the remaining management pages (Plugins, Artifacts and Scheduled
    // have nav rows).
    function PanelDestinations({ entries, onOpen, onDismiss }) {
      const rows = entries.filter(entry => entry.id !== 'plugins' && entry.id !== ARTIFACTS_PANEL && entry.id !== SCHEDULED_PANEL)
      return h(React.Fragment, null, rows.map(entry => h(MenuItemButton, {
        key: entry.id, current: entry.active === true,
        onSelect: () => { onDismiss(); onOpen(entry.id) },
      }, h('span', { className: 'jt-menu-entry' }, entry.label,
        entry.active === true && h(IconCheckOutlineRegular, {
          size: 16, className: 'jt-menu-check', 'aria-hidden': true,
        })))))
    }

    // Fallback launcher when the account menu is absent.
    function SettingsLauncher({ wide, settingsOpen, settingsShortcut, openSettings, t }) {
      return h('button', {
        type: 'button', className: 'jt-footer-action', 'data-rail': !wide || undefined,
        'aria-label': t('settings'), title: !wide ? t('settings') : undefined,
        'aria-haspopup': 'dialog', 'aria-expanded': settingsOpen,
        'aria-keyshortcuts': settingsShortcut?.aria, onClick: openSettings,
      }, h(IconSettingsOutlineMedium, { size: 16 }), wide && t('settings'))
    }

    const PROJECTS_PANEL = 'jt-projects'
    // Last failed project creation, shown on the Projects page; the sidebar
    // quick action has no surface of its own, so it opens that page.
    let projectError = ''
    const projectErrorListeners = new Set()
    const setProjectError = (message) => { projectError = message; for (const listener of projectErrorListeners) listener(message) }
    const useProjectError = () => {
      const [message, update] = React.useState(projectError)
      React.useEffect(() => { projectErrorListeners.add(update); return () => { projectErrorListeners.delete(update) } }, [])
      return message
    }
    // Registered by ui-deliverables; the row appears only while it is.
    const ARTIFACTS_PANEL = 'artifacts'
    // Registered by ui-schedule; the row appears only while it is.
    const SCHEDULED_PANEL = 'schedules'
    const relative = (iso) => {
      const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
      if (!(minutes >= 0)) return ''
      if (minutes < 60) return `${minutes}m`
      if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
      return `${Math.round(minutes / 60 / 24)}d`
    }

    // Projects page: every project folder Jan knows, newest first. A card
    // starts a chat inside that project; New project picks a folder.
    function ProjectsPanel({ useWorkspaces, startSession, addProject, t }) {
      const items = useWorkspaces((snapshot) => snapshot.items)
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const needle = query.trim().toLowerCase()
      const rows = [...items]
        .filter(row => needle === '' || row.title.toLowerCase().includes(needle) || row.path.toLowerCase().includes(needle))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      const error = useProjectError()
      const add = async () => {
        setBusy(true)
        try { await addProject() } finally { setBusy(false) }
      }
      return h('section', { className: 'jt-projects', 'aria-labelledby': 'jt-projects-title' },
        h('header', { className: 'jt-projects-head' },
          h('h1', { id: 'jt-projects-title' }, t('projects')),
          h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => { void add() } },
            h(IconProjectAddOutlineRegular, { size: 16, 'aria-hidden': true }), t('newProject'))),
        h('p', { className: 'jt-projects-lede' }, t('projects.lede')),
        error && h('p', { className: 'jt-projects-error', role: 'alert' }, t('projects.addFailed', { reason: error })),
        items.length > 0 && h('label', { className: 'jt-projects-search' },
          h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }),
          h('input', { type: 'search', value: query, placeholder: t('projects.search'), 'aria-label': t('projects.search'), onChange: (event) => { setQuery(event.target.value) } })),
        items.length === 0
          ? h('div', { className: 'jt-projects-empty' },
            h(IconFolderCloseRegular, { size: 32, 'aria-hidden': true }),
            h('p', null, t('projects.empty')))
          : h('ul', { className: 'jt-projects-grid' }, rows.map(row => h('li', { key: row.workspaceId },
            h(ProjectCard, {
              title: row.title, path: row.path, onClick: () => { startSession(row.workspaceId) },
              meta: [t(row.sessionIds.length === 1 ? 'projects.chat' : 'projects.chats', { count: row.sessionIds.length }), ' · ', t('projects.updated', { ago: relative(row.updatedAt) })].join(''),
            })))))
    }

    return {
      name: 'jan-theme',
      inject: ['slots'],
      apply(ctx) {
        applyAppearance(preferences)
        ctx.inject(['locale'], (scope) => {
          const t = scope.locale.bind('jan-theme')
          scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'jt-appearance', order: 5, label: () => t('section.appearance'), locale: 'jan-theme' }, AppearanceSettings))
          scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'jt-mcp', order: 30, label: () => t('section.mcp'), locale: 'jan-theme' }, () => h(AgentSettings, { key: 'mcp' })))
          scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'jt-skills', order: 31, label: () => t('section.skills'), locale: 'jan-theme' }, () => h(AgentSettings, { skills: true, key: 'skills' })))
        })
        // Distinct nav glyphs: the settings dialog falls back to the gear for ids it does not know.
        for (const [id, Icon] of [['jt-appearance', IconLightOutlineMedium], ['jt-mcp', IconToolOutlineMedium], ['jt-skills', IconSkillOutlineMedium]]) {
          ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id }, ({ size }) => h(Icon, { size })))
        }
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-client-ui-jan-theme'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'jan-theme: styles')

        ctx.inject(['theme'], (scope) => {
          scope.effect(() => {
            // Re-overriding the same source replaces the layer; the first disposer then no-ops.
            let dispose = scope.theme.overrideTokens('jan-theme', tokensFor(preferences))
            retheme = () => { dispose = scope.theme.overrideTokens('jan-theme', tokensFor(preferences)) }
            return () => { retheme = null; dispose() }
          }, 'jan-theme: Jan palette')
        })

        const html = document.documentElement
        html.setAttribute('data-jan-theme', '')
        ctx.effect(() => () => html.removeAttribute('data-jan-theme'), 'jan-theme: root marker')

        ctx.inject(['uiWorkspace'], (scope) => {
          // Jan's list is a flat Chats list. Apply it once as a default; the
          // setter persists, so a grouping the user picks later is kept.
          const key = 'jan-theme:session-grouping-default'
          if (localStorage.getItem(key) === null) {
            scope.uiWorkspace.setSessionGrouping('flat')
            localStorage.setItem(key, 'flat')
          }
        })

        ctx.inject(['locale'], (scope) => {
          scope.effect(() => scope.locale.register('jan-theme', {
            en: {
              'hero.headline': 'How can I help you today?',
              chats: 'Chats',
              newChat: 'New Chat',
              newProject: 'New project',
              search: 'Search',
              projects: 'Projects', plugins: 'Plugins', settings: 'Settings', artifacts: 'Artifacts', scheduled: 'Scheduled',
              newArtifact: 'New artifact', createPlugin: 'Create plugin',
              'newArtifact.prompt': 'Create a file for me: ',
              'createPlugin.prompt': 'Create a Jan plugin with a left sidebar entry.',
              'projects.lede': 'Each project is a folder. Chats started in it can read and write its files.',
              'projects.search': 'Search projects',
              'projects.empty': 'No projects yet. Create one from a folder on this computer.',
              'projects.chat': '{count} chat', 'projects.chats': '{count} chats',
              'projects.updated': 'updated {ago} ago',
              'projects.addFailed': 'Could not add the project: {reason}',
              'section.appearance': 'Appearance', 'section.mcp': 'MCP Servers', 'section.skills': 'Skills',
            },
            zh: {
              'hero.headline': '今天有什么可以帮您？',
              chats: '聊天',
              newChat: '新对话',
              newProject: '新建项目',
              search: '搜索',
              projects: '项目', plugins: '插件', settings: '设置', artifacts: '成果',
              newArtifact: '新建成果', createPlugin: '创建插件',
              'newArtifact.prompt': '帮我创建一个文件：',
              'createPlugin.prompt': '创建一个带左侧栏入口的 Jan 插件。',
              'projects.lede': '每个项目对应一个文件夹，在其中开始的对话可以读写该文件夹的文件。',
              'projects.search': '搜索项目',
              'projects.empty': '还没有项目。从本机的文件夹创建一个。',
              'projects.chat': '{count} 个对话', 'projects.chats': '{count} 个对话',
              'projects.updated': '{ago}前更新',
              'section.appearance': '外观', 'section.mcp': 'MCP 服务器', 'section.skills': '技能',
            },
            ja: {
              'hero.headline': '今日はどのようにお手伝いできますか？',
              chats: 'チャット',
              newChat: '新しいチャット',
              newProject: '新しいプロジェクト',
              search: '検索',
              projects: 'プロジェクト', plugins: 'プラグイン', settings: '設定', artifacts: '成果物',
              newArtifact: '新しい成果物', createPlugin: 'プラグインを作成',
              'newArtifact.prompt': 'ファイルを作成してください: ',
              'createPlugin.prompt': '左サイドバーに項目を持つ Jan プラグインを作成してください。',
              'projects.lede': '各プロジェクトはフォルダーです。その中で始めたチャットは、そのフォルダーのファイルを読み書きできます。',
              'projects.search': 'プロジェクトを検索',
              'projects.empty': 'プロジェクトはまだありません。このコンピューター上のフォルダーから作成してください。',
              'projects.chat': '{count} 件のチャット', 'projects.chats': '{count} 件のチャット',
              'projects.updated': '{ago}前に更新',
              'section.appearance': '外観', 'section.mcp': 'MCP サーバー', 'section.skills': 'スキル',
            },
            es: {
              'hero.headline': '¿En qué puedo ayudarte hoy?',
              chats: 'Chats',
              newChat: 'Nuevo chat',
              newProject: 'Nuevo proyecto',
              search: 'Buscar',
              projects: 'Proyectos', plugins: 'Complementos', settings: 'Configuración', artifacts: 'Artefactos',
              newArtifact: 'Nuevo artefacto', createPlugin: 'Crear complemento',
              'newArtifact.prompt': 'Crea un archivo para mí: ',
              'createPlugin.prompt': 'Crea un complemento de Jan con una entrada en la barra lateral izquierda.',
              'projects.lede': 'Cada proyecto es una carpeta. Los chats iniciados en él pueden leer y escribir sus archivos.',
              'projects.search': 'Buscar proyectos',
              'projects.empty': 'Aún no hay proyectos. Crea uno a partir de una carpeta de este equipo.',
              'projects.chat': '{count} chat', 'projects.chats': '{count} chats',
              'projects.updated': 'actualizado hace {ago}',
              'section.appearance': 'Apariencia', 'section.mcp': 'Servidores MCP', 'section.skills': 'Habilidades',
            },
            fr: {
              'hero.headline': "Comment puis-je vous aider aujourd'hui ?",
              chats: 'Discussions',
              newChat: 'Nouvelle discussion',
              newProject: 'Nouveau projet',
              search: 'Rechercher',
              projects: 'Projets', plugins: 'Plugins', settings: 'Paramètres', artifacts: 'Artefacts',
              newArtifact: 'Nouvel artefact', createPlugin: 'Créer un plugin',
              'newArtifact.prompt': 'Crée un fichier pour moi : ',
              'createPlugin.prompt': 'Crée un plugin Jan avec une entrée dans la barre latérale gauche.',
              'projects.lede': 'Chaque projet est un dossier. Les discussions qui y sont lancées peuvent lire et écrire ses fichiers.',
              'projects.search': 'Rechercher des projets',
              'projects.empty': 'Aucun projet pour le moment. Créez-en un à partir d’un dossier de cet ordinateur.',
              'projects.chat': '{count} discussion', 'projects.chats': '{count} discussions',
              'projects.updated': 'mis à jour il y a {ago}',
              'section.appearance': 'Apparence', 'section.mcp': 'Serveurs MCP', 'section.skills': 'Compétences',
            },
            de: {
              'hero.headline': 'Wie kann ich dir heute helfen?',
              chats: 'Chats',
              newChat: 'Neuer Chat',
              newProject: 'Neues Projekt',
              search: 'Suchen',
              projects: 'Projekte', plugins: 'Plugins', settings: 'Einstellungen', artifacts: 'Artefakte',
              newArtifact: 'Neues Artefakt', createPlugin: 'Plugin erstellen',
              'newArtifact.prompt': 'Erstelle eine Datei für mich: ',
              'createPlugin.prompt': 'Erstelle ein Jan-Plugin mit einem Eintrag in der linken Seitenleiste.',
              'projects.lede': 'Jedes Projekt ist ein Ordner. Darin gestartete Chats können seine Dateien lesen und schreiben.',
              'projects.search': 'Projekte suchen',
              'projects.empty': 'Noch keine Projekte. Erstelle eines aus einem Ordner auf diesem Computer.',
              'projects.chat': '{count} Chat', 'projects.chats': '{count} Chats',
              'projects.updated': 'vor {ago} aktualisiert',
              'section.appearance': 'Darstellung', 'section.mcp': 'MCP-Server', 'section.skills': 'Skills',
            },
            ru: {
              'hero.headline': 'Чем я могу помочь сегодня?',
              chats: 'Чаты',
              newChat: 'Новый чат',
              newProject: 'Новый проект',
              search: 'Поиск',
              projects: 'Проекты', plugins: 'Плагины', settings: 'Настройки', artifacts: 'Артефакты',
              newArtifact: 'Новый артефакт', createPlugin: 'Создать плагин',
              'newArtifact.prompt': 'Создай для меня файл: ',
              'createPlugin.prompt': 'Создай плагин Jan с пунктом в левой боковой панели.',
              'projects.lede': 'Каждый проект - это папка. Чаты, начатые в нем, могут читать и изменять ее файлы.',
              'projects.search': 'Поиск проектов',
              'projects.empty': 'Проектов пока нет. Создайте проект из папки на этом компьютере.',
              'projects.chat': 'Чатов: {count}', 'projects.chats': 'Чатов: {count}',
              'projects.updated': 'обновлено {ago} назад',
              'section.appearance': 'Оформление', 'section.mcp': 'MCP-серверы', 'section.skills': 'Навыки',
            },
            pt: {
              'hero.headline': 'Como posso ajudar hoje?',
              chats: 'Conversas',
              newChat: 'Nova conversa',
              newProject: 'Novo projeto',
              search: 'Pesquisar',
              projects: 'Projetos', plugins: 'Plug-ins', settings: 'Configurações', artifacts: 'Artefatos',
              newArtifact: 'Novo artefato', createPlugin: 'Criar plug-in',
              'newArtifact.prompt': 'Crie um arquivo para mim: ',
              'createPlugin.prompt': 'Crie um plug-in do Jan com uma entrada na barra lateral esquerda.',
              'projects.lede': 'Cada projeto é uma pasta. As conversas iniciadas nele podem ler e gravar seus arquivos.',
              'projects.search': 'Pesquisar projetos',
              'projects.empty': 'Nenhum projeto ainda. Crie um a partir de uma pasta deste computador.',
              'projects.chat': '{count} conversa', 'projects.chats': '{count} conversas',
              'projects.updated': 'atualizado há {ago}',
              'section.appearance': 'Aparência', 'section.mcp': 'Servidores MCP', 'section.skills': 'Habilidades',
            },
          }), 'jan-theme: owned copy')
        })

        // Single seats elect the lowest priority. These replace bundled chrome
        // at zero; a user plugin can shadow Jan with priority -2 or lower.
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, SidebarMark))
        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, Name))
        // Jan's navigation rows and chat heading. Each leaf keeps the browser's
        // own callback, ref, search node and view options.
        ctx.slots.inject('sidebar.session.new', () => ctx.slots.register({ name: 'sidebar.session.new', priority: -1, locale: 'jan-theme' }, NewSession))
        ctx.slots.inject('sidebar.workspaces.header', () => ctx.slots.register({ name: 'sidebar.workspaces.header', priority: -1, locale: 'jan-theme' }, WorkspaceHeader))
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: '@janhq/jan-client-ui-sidebar-files', priority: -1 }, FilesTabTitle))
        // Jan's greeting replaces the bundled headline stack; the rest of the
        // hero and composer stay the stock shell's own.
        ctx.slots.inject('conversation.hero.headline', () => ctx.slots.register({ name: 'conversation.hero.headline', priority: -1, locale: 'jan-theme' }, HeroHeadline))
        // One icon language on the Plugins page: each known plugin keeps its
        // card, only the artwork inside the frame becomes Jan's line glyph.
        for (const [key, nodes] of Object.entries(JAN_ARTWORK)) {
          ctx.slots.inject('plugins.artwork', () => ctx.slots.register({ name: 'plugins.artwork', key }, ({ size }) => h(JanArtwork, { nodes, size })))
        }
        // The More menu's real panel destinations. Registering it also keeps
        // the More trigger present, so no launcher row is hidden without a
        // reachable menu entry.
        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions', id: 'jt-panel-destinations', order: -100,
        }, PanelDestinations))
        // The stock "Browse other plugins" / "Create your plugin" rows repeat
        // the Plugins row and its "+"; shadow that sidebar entry with nothing.
        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions', id: 'entry-customization', priority: -1,
        }, () => null))

        if (DockModelSelection !== undefined) {
          // The dock seat replaces the composer card's seat; the composer seat
          // stands down while it is mounted.
          ctx.plugin(DockModelSelection)
        }
        // Jan's row under the composer holds only the model and the context
        // ring; run statistics stay in each turn's expanded footer.
        for (const [id, order] of [['activity', 0], ['usage', 1]]) {
          ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id, order, priority: -1 }, () => null))
        }

        ctx.inject(['layout'], (scope) => {
          scope.layout.configureSidebar({ defaultWidth: 240, minWidth: 224, maxWidth: 320 })
        })
        ctx.inject(['layout', 'uiWorkspace', 'workspaces', 'locale'], (scope) => {
          const mainKeyAvailable = (key) => ({
            getSnapshot: () => scope.slots.entriesOfSlot('main').some((entry) => entry.options.key === key),
            subscribe: (listener) => scope.slots.subscribe('main', listener),
          })
          const t = scope.locale.bind('jan-theme')
          const startDraft = (prompt, agentPreset) => {
            scope.layout.selectPanel(null)
            scope.uiWorkspace.startSession(undefined, {
              prompt, whenDraftExists: 'append', ...agentPreset === undefined ? {} : { agentPreset },
            })
          }
          const addProject = async () => {
            try {
              const path = await scope.uiWorkspace.pickDirectory()
              if (path === null) return
              const workspace = await scope.workspaces.create({ path })
              setProjectError('')
              scope.layout.selectPanel(null)
              scope.uiWorkspace.startSession(workspace.workspaceId)
            } catch (failure) {
              setProjectError(failure instanceof Error ? failure.message : String(failure))
              scope.layout.selectPanel(PROJECTS_PANEL)
            }
          }
          scope.slots.inject('sidebar.workspaces.actions', () => scope.slots.register({
            name: 'sidebar.workspaces.actions', priority: -1, locale: 'jan-theme',
            inject: () => ({
              hooks: {
                panelInfo: scope.layout.panelInfo,
                pluginsAvailable: mainKeyAvailable('plugins'),
                artifactsAvailable: mainKeyAvailable(ARTIFACTS_PANEL),
                scheduledAvailable: mainKeyAvailable(SCHEDULED_PANEL),
              },
              openPanel: (id) => scope.layout.selectPanel(id),
              addProject,
              newChat: () => { startDraft(t('newArtifact.prompt')) },
              // Same draft the stock More menu's "Create your plugin" starts.
              createPlugin: () => { startDraft(t('createPlugin.prompt'), 'cordis') },
            }),
          }, WorkspaceActions))
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PROJECTS_PANEL, locale: 'jan-theme',
            inject: () => ({
              hooks: { workspaces: scope.workspaces.list },
              startSession: (workspaceId) => {
                scope.layout.selectPanel(null)
                scope.uiWorkspace.startSession(workspaceId)
              },
              addProject,
            }),
          }, ProjectsPanel))
        })
        // The account menu carries Settings plus Sign in with Tokamak; it
        // registers at the default rank, so ours renders only without it.
        ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: 1, locale: 'jan-theme',
        }, SettingsLauncher))

        if (mac) {
          html.setAttribute('data-jan-theme-mac', '')
          ctx.effect(() => () => { html.removeAttribute('data-jan-theme-mac') }, 'jan-theme: traffic light clearance')
        }
        if (tauri) {
          // The stock layout reserves a Windows-style title row under these two
          // values; the row's buttons are ours, since the window has no frame.
          html.setAttribute('data-windows-titlebar', '')
          html.style.setProperty('--jan-windows-titlebar-height', '40px')
          ctx.effect(() => () => {
            html.removeAttribute('data-windows-titlebar')
            html.style.removeProperty('--jan-windows-titlebar-height')
          }, 'jan-theme: title row')
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'jt-titlebar', order: 100 }, TitleBar))
        }
      },
    }
  },
})
