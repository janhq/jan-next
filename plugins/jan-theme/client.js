// Browser half of the Jan theme plugin. Hand-written for the client module
// loader (no build step): `require` hands out the app's shared React and
// slot runtime, and `apply` registers everything through `ctx.slots`.
window.__ModuleLoader__.load({
  id: '@janhq/jan-client-ui-jan-theme',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      IconPluginPinwheelOutlineRegular, IconCheckOutlineRegular, IconFolderCloseRegular, IconSettingsOutlineMedium, IconSettingsOutlineRegular,
      IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular,
      MenuItemButton, Button, Switch, Checkbox, IconLayersOutlineRegular, IconClockOutlineRegular, IconAppsAddOutlineRegular,
      IconToolOutlineMedium, IconSkillOutlineMedium,
      NavRow, SectionHeading, ColorSwatchGroup, ProjectCard, WindowControls,
      Modal, ShortcutKeys, FileTypeIcon, rankByName, IconSparkleRegular, IconRightUpOutlineRegular,
      IconWarningTriangleOutlineRegular, IconCloseOutlineRegular, IconSendOutlineRegular,
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

    // Jan yellow, the logo's color and the app's default when the settings carry none.
    const look = shell.look ?? { primary: '#FFC928', sidebar: { light: '#F3E6C4', dark: '#5C4A0A' } }
    const PALETTES = [
      ['gray', 'Gray', '#757575', '#f1f1f1', '#171717'],
      ['red', 'Red', '#F0614B', '#F3CBC4', '#5E1308'],
      ['orange', 'Orange', '#E9A23F', '#F3DFC4', '#5C3A0A'],
      ['yellow', 'Yellow', '#FFC928', '#F3E6C4', '#5C4A0A'],
      ['green', 'Green', '#88BA42', '#DFF3C4', '#374B1B'],
      ['emerald', 'Emerald', '#38AB51', '#C4F3CE', '#194D24'],
      ['teal', 'Teal', '#38AB8D', '#C4F3E6', '#194D3F'],
      ['cyan', 'Cyan', '#45BBDE', '#C4E8F3', '#0F4657'],
      ['blue', 'Blue', '#456BDE', '#C4D0F3', '#0F2157'],
      ['purple', 'Purple', '#865EEA', '#D2C4F3', '#220C5A'],
      ['pink', 'Pink', '#D55EF3', '#E9C4F3', '#4D075F'],
      ['rose', 'Rose', '#F655B8', '#FFDAE9', '#61053E'],
    ]
    const DEFAULT_ACCENT = PALETTES.find(p => p[2].toLowerCase() === look.primary.toLowerCase())?.[0] || 'yellow'
    const paletteOf = accent => PALETTES.find(p => p[0] === accent) || PALETTES.find(p => p[0] === DEFAULT_ACCENT)
    let preferences = { accent: DEFAULT_ACCENT, coloredUserBubble: false, navigationButtons: false, ...shell.appearance }
    const appearanceListeners = new Set()
    let retheme = null
    const applyAppearance = (value) => {
      preferences = value
      const palette = paletteOf(value.accent)
      const root = document.documentElement
      // Back and Forward stay hidden until General turns them on; the shortcuts keep working.
      root.toggleAttribute('data-jt-hide-navigation', value.navigationButtons !== true)
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
    // Accent rows live in General beside theme and font size; they share one save state.
    const appearanceSave = { busy: false, error: '' }
    const appearanceSaveListeners = new Set()
    async function saveAppearance(next) {
      appearanceSave.busy = true; appearanceSave.error = ''
      appearanceSaveListeners.forEach(listener => listener())
      try { applyAppearance({ ...preferences, ...await appearanceApi('save', next) }) }
      catch (failure) { appearanceSave.error = failure.message }
      finally { appearanceSave.busy = false; appearanceSaveListeners.forEach(listener => listener()) }
    }
    function useAppearance() {
      const value = React.useSyncExternalStore(listener => { appearanceListeners.add(listener); return () => appearanceListeners.delete(listener) }, () => preferences)
      const [, rerender] = React.useReducer(count => count + 1, 0)
      React.useEffect(() => { appearanceSaveListeners.add(rerender); return () => { appearanceSaveListeners.delete(rerender) } }, [])
      return { value, busy: appearanceSave.busy, error: appearanceSave.error }
    }
    function GeneralRow({ title, description, error, children }) {
      return h('div', { className: 'jt-general-row' },
        h('div', null, h('div', { className: 'jt-general-title' }, title), h('div', { className: 'jt-general-description' }, description),
          error && h('div', { className: 'jt-general-error', role: 'alert' }, error)),
        children)
    }
    function AccentColorRow() {
      const { value, busy, error } = useAppearance()
      return h(GeneralRow, { title: 'Accent color', description: 'Customize the accent color of the application.', error },
        h(ColorSwatchGroup, {
          label: 'Accent color', value: value.accent, disabled: busy, onChange: accent => saveAppearance({ ...value, accent }),
          swatches: PALETTES.map(([id, label, color]) => ({ id, label, color })),
        }))
    }
    function UserBubbleRow() {
      const { value, busy } = useAppearance()
      return h(GeneralRow, { title: 'Colored user bubbles', description: 'Use the accent color for your messages.' },
        h(Switch, { label: 'Colored user bubbles', checked: value.coloredUserBubble, disabled: busy, onChange: checked => saveAppearance({ ...value, coloredUserBubble: checked }) }))
    }
    function NavigationButtonsRow() {
      const { value, busy } = useAppearance()
      return h(GeneralRow, { title: 'Back and forward buttons', description: 'Show Back and Forward beside the sidebar button. The keyboard shortcuts work either way.' },
        h(Switch, { label: 'Back and forward buttons', checked: value.navigationButtons === true, disabled: busy, onChange: checked => saveAppearance({ ...value, navigationButtons: checked }) }))
    }
    function AppearanceResetRow() {
      const { value, busy } = useAppearance()
      return h(GeneralRow, { title: 'Reset colors', description: 'Reset accent color and user bubble preferences.' },
        h(Button, { variant: 'outline', disabled: busy, onClick: () => saveAppearance({ ...value, accent: DEFAULT_ACCENT, coloredUserBubble: false }) }, 'Reset'))
    }
    // A saved MCP or skill change reloads this plugin, and its route is absent until the reload ends.
    // Reads retry through that gap; a write is sent once, because the Host may already have applied it.
    async function agentApi(method, params = {}) {
      const read = method === 'list' || method === 'readSkill' || method === 'previewImport'
      for (let attempt = 0; ; attempt++) {
        const response = await fetch('/jan-api/agent-settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
        const body = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : undefined
        if (body !== undefined) {
          if (!response.ok || body.error) throw new Error(body.error || 'Settings could not be saved.')
          return body.result
        }
        if (!read || attempt === 20) throw new Error('Jan is applying the change. Reopen this section in a few seconds.')
        await new Promise(resolve => setTimeout(resolve, 500))
      }
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
    function AgentSettings({ skills = false, onCreate }) {
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
          skills
            ? onCreate && actions(button('Create skill', onCreate, { variant: 'primary' }))
            : actions(onCreate && button('Create connector', onCreate), button('Import JSON', () => setImportOpen(true)), button('Add server', () => edit(null), { variant: 'primary' }))),
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
    // WCAG relative luminance of a #RRGGBB color.
    const luminance = (hex) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const tokensFor = (value) => {
      const accent = paletteOf(value.accent)[2]
      // White text fails contrast on a light accent such as Jan yellow; such accents carry dark text
      // on their fills and a deeper shade where the accent colors text on white.
      const light = luminance(accent) > 0.5
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
          light: `color-mix(in oklch, ${accent} ${light ? 50 : 85}%, black)`,
          dark: `color-mix(in oklch, ${accent} 80%, white)`,
        },
        ...light ? { '--dsw-alias-label-primary-foreground': both('#222222') } : {},
        // Set where the overrides land (body), so the neutral grey resolves
        // against the layer-2 token defined there; from :root it would not.
        '--dsw-specific-bubble': value.coloredUserBubble
          ? { light: `color-mix(in oklch, ${accent} 22%, white)`, dark: `color-mix(in oklch, ${accent} 70%, black)` }
          : both('var(--dsw-alias-bg-layer-2)'),
      }
    }
    // Mimi's Jan - Desktop v04 palette (design/mimi-tokens.json, enforced by
    // ui-theme's jan-design-contract spec). Dark values Mimi has not drawn
    // (border-l2, selected sidebar row) keep Jan's earlier dark steps.
    const TOKENS = {
      '--jan-font-family-text': both("'Inter', 'Segoe UI', sans-serif"),
      '--dsw-alias-bg-base': { light: '#FFFFFF', dark: '#111111' },
      '--dsw-alias-bg-layer-1': { light: '#FFFFFF', dark: '#1B1B1B' },
      '--dsw-alias-bg-layer-2': { light: '#F7F7F7', dark: '#151515' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#1B1B1B' },
      '--dsw-alias-border-l1': { light: 'rgb(34 34 34 / 5%)', dark: 'rgb(255 255 255 / 8%)' },
      '--dsw-alias-border-l2': { light: 'rgb(34 34 34 / 10%)', dark: 'oklch(1 0 0 / 15%)' },
      '--dsw-alias-label-primary': { light: '#3D3D3D', dark: 'rgb(255 255 255 / 80%)' },
      '--dsw-alias-label-secondary': { light: '#808080', dark: 'rgb(255 255 255 / 40%)' },
      '--dsw-alias-label-tertiary': both('#999999'),
      '--dsw-alias-interactive-bg-hover': { light: 'rgb(0 0 0 / 4%)', dark: 'rgb(255 255 255 / 8%)' },
      '--dsw-specific-input-major': { light: '#FFFFFF', dark: '#1B1B1B' },
      '--dsw-specific-selector': { light: 'oklch(0.94 0 0)', dark: 'oklch(0.269 0 0)' },
      '--dsw-specific-sidebar-fill': { light: 'var(--jt-sidebar-light)', dark: 'var(--jt-sidebar-dark)' },
      '--dsw-specific-sidebar-nav-item-hover': { light: 'rgb(0 0 0 / 4%)', dark: 'rgb(255 255 255 / 8%)' },
      '--dsw-specific-sidebar-nav-item-active': {
        light: 'rgb(0 0 0 / 6%)',
        dark: `color-mix(in oklch, var(--jt-sidebar-dark) 75%, white)`,
      },
      '--dsw-specific-sidebar-nav-item-active-accent': {
        light: 'rgb(0 0 0 / 6%)',
        dark: `color-mix(in oklch, var(--jt-sidebar-dark) 75%, white)`,
      },
      // Sidebar card, composer and other enclosing panels.
      '--jt-sidebar-radius': both('20px'),
      '--dsw-radius-panel': both('24px'),
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
.jt-general-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jt-general-title { font-size: 14px; line-height: 20px; }
.jt-general-description { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.jt-general-error { margin-top: 4px; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
@media (max-width: 640px) { .jt-general-row { flex-wrap: wrap; gap: 12px; } }
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
  /* The floating card runs the full window height; the shell's bottom row (status bars and
     the like) lives in the chat column only, beside the card instead of under it. */
  html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-drawer]) > :has(> [data-slot='sidebar']) { grid-row: 1 / -1; }
  html[data-jan-theme] [data-slot='root'] > :has(> [data-shell-overlay]):not([data-sidebar-drawer]) > [data-shell-bottom] { grid-column: 2 / -1; }
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
  /* Clear the native traffic lights (desktop main.ts trafficLightPosition). */
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) { padding-left: 64px; }
  html[data-jan-theme][data-jan-theme-mac]:has([data-sidebar-collapsed]) [data-slot='sidebar'] [data-sidebar-toggle] { left: 84px; }
  /* Electron on macOS gives the toggle its own strip above the logo row; fold
     that strip into the logo row and centre it on the traffic lights and the
     conversation title row (ui-layout --jan-frame-title-inset + 15 from the
     window top; the strip's box starts 5px above the card's top edge). */
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div:has(> [data-window-drag] > [data-sidebar-toggle]) { position: relative; }
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div > [data-window-drag]:has(> [data-sidebar-toggle]) {
    position: absolute; top: calc(var(--jan-frame-title-inset, 10px) + 1px - var(--jt-sidebar-gap)); right: 12px; height: 40px; display: flex; align-items: center; z-index: 1;
  }
  /* Back and Forward are off by default (General -> Back and forward buttons).
     The collapsed macOS seat then holds two controls, sidebar and new chat, so
     the title clears 96 + 28 + 8 + 28 + 8 (ui-layout AppFrame leading seat). */
  html[data-jan-theme][data-jt-hide-navigation] [data-navigation] { display: none; }
  html[data-jan-theme][data-jt-hide-navigation][data-jan-theme-mac] [data-slot='root'] > [data-sidebar-collapsed] { --jan-frame-leading-clearance: 168px; }
  html[data-jan-theme][data-jt-hide-navigation][data-jan-theme-mac][data-fullscreen] [data-slot='root'] > [data-sidebar-collapsed] { --jan-frame-leading-clearance: 84px; }
  /* Sidebar rhythm from Jan Desktop v04 ("Chat + Cowork merged"), in card
     coordinates: icons at x 19, labels at x 46, shortcuts end 19 from the
     right edge, 38px rows on a 40px pitch, and the first row centred 57px
     under the traffic lights. Chat titles carry no icon, so they start on the
     icon column; a running Session's status dots still take their slot. */
  html[data-jan-theme][data-jan-theme-mac] { --jt-sidebar-gap: 11px; }
  html[data-jan-theme][data-jan-theme-mac] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) { margin-bottom: 18px; }
  /* Fullscreen hides the traffic lights, so the logo row neither clears them nor keeps the
     57px rhythm under them: the toggle strip rides that row (the strip's -6px margin cancels
     the card's 6px top padding), and the first row follows at the stock 8px. */
  html[data-jan-theme][data-jan-theme-mac][data-fullscreen] [data-slot='sidebar'] > div > :has([data-slot='sidebar.brand.name']) { padding-left: 4px; margin-bottom: 8px; }
  html[data-jan-theme][data-jan-theme-mac][data-fullscreen] [data-slot='sidebar'] > div > [data-window-drag]:has(> [data-sidebar-toggle]) { top: 6px; }
  html[data-jan-theme] .jt-nav-row:not([class*='rail']) { height: 38px; padding: 0 10px; gap: 11px; }
  /* The More launcher matches these rows (see the panelRow rule below). */
  html[data-jan-theme] [data-slot='sidebar'] nav { gap: 2px; }
  html[data-jan-theme] [data-slot='sidebar'] [data-row-key^='session:'] { height: 38px; padding-inline-start: calc(7px + var(--jan-workspace-indent, 0px)); }
  /* Grouped lists: a folder's chats start under its name, not under its icon, so the grouping
     reads at a glance. Only a section headed by a folder row gets it; the flat list stays flush. */
  html[data-jan-theme] [data-slot='sidebar'] :has(> * > [data-row-key^='workspace:']) > * > [data-row-key^='session:'] {
    padding-inline-start: calc(7px + 16px + var(--jan-sidebar-label-gap, 6px) + var(--jan-workspace-indent, 0px));
  }
  html[data-jan-theme] [data-slot='sidebar'] [data-row-key^='session:'] > span:first-child:has(> [data-slot='sidebar.session.row.leading']:only-child:empty) { display: none; }
  html[data-jan-theme] [data-slot='sidebar'] [data-row-key^='session:'] > span:first-child:has(> [data-slot='sidebar.session.row.leading']:only-child:empty) + span { margin-inline-start: 0; }
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
    border-radius: 12px;
    background: transparent;
    box-shadow: none;
    font-weight: 400;
  }
  html[data-jan-theme] [data-slot='sidebar'] > div > button > span:first-child > span { width: auto; justify-content: flex-start; gap: 8px; }
  html[data-jan-theme] [data-slot='sidebar'] > div > button > span:last-child:not(:first-child) { opacity: 1; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 500; }
  html[data-jan-theme] [data-slot='sidebar'] nav { margin: 0 0 12px; }
  html[data-jan-theme] [data-slot='sidebar'] nav > button, html[data-jan-theme] [data-slot='sidebar'] nav > div > button { min-height: 36px; border-radius: 12px; }
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
  /* Without it the scroll area cut the last chat row in half above the footer.
     A mask fades the rows themselves, so it works over any sidebar fill; the
     padding lets the final row scroll clear of the fade. */
  html[data-jan-theme] [data-slot='sidebar'] div:has(> div > [data-slot='sidebar.workspaces']) {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
    padding-bottom: 20px;
  }
  /* The stock More launcher keeps its own 32px / 12px-radius pill; Jan draws
     it as one more nav row so the column has a single row rhythm. */
  html[data-jan-theme] button[aria-label][aria-haspopup='menu'][class*='panelRow'] { height: 38px; padding: 0 10px; border-width: 0; border-radius: 12px; gap: 11px; line-height: 20px; }
  /* More is the next row of the nav, on the same 40px pitch and with the same
     secondary icon ink, not a separate group 12px further down. */
  html[data-jan-theme] [data-slot='sidebar'] [class*='scrollRegion'] { margin-top: 0; }
  html[data-jan-theme] [data-slot='sidebar'] [class*='scrollArea'] { grid-template-rows: 0 max-content 2px max-content; }
  html[data-jan-theme] button[aria-haspopup='menu'][class*='panelRow'] [class*='panelGlyph'] { color: var(--dsw-alias-label-secondary); }
  /* Projects page. */
  .jt-projects { box-sizing: border-box; width: 100%; max-width: 880px; margin: 0 auto; padding: 48px 32px; color: var(--dsw-alias-label-primary); }
  .jt-projects-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .jt-projects-head h1 { margin: 0; font-size: 24px; font-weight: 500; line-height: 32px; }
  .jt-projects-head button { display: inline-flex; align-items: center; gap: 6px; }
  .jt-projects-lede { margin: 4px 0 24px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
  .jt-projects-error { margin: -12px 0 20px; color: var(--dsw-alias-state-error-primary); font-size: 14px; line-height: 20px; }
  .jt-projects-search { display: flex; align-items: center; gap: 8px; height: 40px; margin-bottom: 20px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-primary, var(--dsw-alias-separator)); border-radius: 8px; color: var(--dsw-alias-label-secondary); }
  .jt-projects-search:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
  .jt-projects-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }
  .jt-projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
  .jt-projects-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 0; color: var(--dsw-alias-label-secondary); font-size: 14px; }
  @media (max-width: 600px) { .jt-projects { padding: 24px 16px; } }
  /* Project home: the main column (title, composer, recents) and a details rail. */
  .jt-project { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 40px; width: 100%; max-width: 1120px; margin: 0 auto; padding: 40px 32px 48px; color: var(--dsw-alias-label-primary); }
  .jt-project-back { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 12px -6px; padding: 2px 6px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
  .jt-project-back:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
  @media (hover: hover) { .jt-project-back:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); } }
  .jt-project-title { margin: 0; font-size: 24px; font-weight: 500; line-height: 32px; overflow-wrap: anywhere; }
  .jt-project-path { margin: 4px 0 24px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
  .jt-project-composer { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 10px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: 0 1px 2px rgb(0 0 0 / 0.04); }
  .jt-project-composer:focus-within { border-color: var(--dsw-alias-state-business-primary); }
  .jt-project-composer textarea { box-sizing: border-box; width: 100%; min-height: 56px; max-height: 240px; padding: 4px 0; border: 0; outline: 0; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; field-sizing: content; }
  .jt-project-composer textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
  .jt-project-composer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .jt-project-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-project-send { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 999px; background: var(--dsw-alias-state-business-primary); color: #fff; cursor: pointer; }
  .jt-project-send:disabled { opacity: 0.4; cursor: default; }
  .jt-project-send:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
  .jt-project-recents { margin-top: 32px; }
  .jt-project-heading { margin: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; line-height: 20px; }
  .jt-project-sessions { margin: 0; padding: 0; list-style: none; border-top: 0.5px solid var(--dsw-alias-border-l2); }
  .jt-project-session { display: flex; align-items: baseline; gap: 12px; width: 100%; padding: 12px 4px; border: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .jt-project-session:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; border-radius: 12px; }
  @media (hover: hover) { .jt-project-session:hover { background: var(--dsw-alias-interactive-bg-hover); } }
  .jt-project-session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
  .jt-project-session-date { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
  .jt-project-empty { margin: 0; padding: 20px 4px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
  .jt-project-rail { display: flex; flex-direction: column; gap: 12px; align-self: start; position: sticky; top: 24px; }
  .jt-project-card { padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; }
  .jt-project-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .jt-project-card-head h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
  .jt-project-card-text { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .jt-project-card-text[data-empty='true'] { color: var(--dsw-alias-label-tertiary); }
  .jt-project-files { margin: 8px 0 0; padding: 0; list-style: none; max-height: 220px; overflow-y: auto; }
  .jt-project-file { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; line-height: 18px; }
  .jt-project-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jt-project-file-size { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
  .jt-project-tasks { margin: 8px 0 0; padding: 0; list-style: none; }
  .jt-project-task { padding: 6px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 18px; }
  .jt-project-task:first-child { border-top: 0; }
  .jt-project-task-meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-project-error { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 18px; }
  /* Text-style card links align with the card text instead of the button's inner padding. */
  .jt-project-card .jt-project-link { margin: 6px 0 0 -10px; }
  .jt-project-editor { display: flex; flex-direction: column; gap: 12px; }
  .jt-project-editor textarea { box-sizing: border-box; width: 100%; min-height: 280px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
  .jt-project-editor textarea:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
  .jt-project-editor input, .jt-project-editor select { box-sizing: border-box; width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }
  .jt-project-editor label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
  .jt-project-editor-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-project-editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
  @media (max-width: 900px) { .jt-project { grid-template-columns: minmax(0, 1fr); } .jt-project-rail { position: static; } }
  @media (max-width: 600px) { .jt-project { padding: 24px 16px; } }
  /* Startup failure notices: a bottom-right stack, newest last. */
  .jt-startup { position: absolute; right: 16px; bottom: 16px; z-index: 40; display: flex; flex-direction: column; gap: 8px; width: min(380px, calc(100% - 32px)); pointer-events: none; }
  .jt-startup-card { display: grid; grid-template-columns: 20px minmax(0, 1fr) 24px; column-gap: 12px; padding: 14px 12px 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 24px rgb(0 0 0 / 0.14); color: var(--dsw-alias-label-primary); pointer-events: auto; animation: jt-startup-in 200ms cubic-bezier(0.23, 1, 0.32, 1); }
  .jt-startup-glyph { padding-top: 1px; color: var(--dsw-alias-state-warning-primary, #d99a00); }
  .jt-startup-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
  .jt-startup-text { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); text-wrap: pretty; }
  .jt-startup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .jt-startup-close { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px; corner-shape: round; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
  .jt-startup-close:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
  @media (hover: hover) { .jt-startup-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
  @keyframes jt-startup-in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { .jt-startup-card { animation: none; } }
  /* Universal search: a top-anchored command palette over the shared modal. */
  .jt-palette { box-sizing: border-box; width: min(640px, 100%); max-height: min(560px, 100%); align-self: flex-start; margin-top: 8vh; padding: 0; gap: 0; border-radius: 16px; }
  .jt-palette:focus { outline: none; }
  .jt-palette-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  /* Two shared axes: icons start 20px in (row glyph boxes sit 18px in with 2px of slack), text starts 48px in. */
  .jt-palette-field, .jt-palette-tabs, .jt-palette-footer { flex: none; }
  .jt-palette-field { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 20px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); }
  .jt-palette-field input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; }
  .jt-palette-field input::placeholder { color: var(--dsw-alias-label-tertiary); }
  .jt-palette-tabs { display: flex; gap: 4px; padding: 10px 8px 2px; overflow-x: auto; scrollbar-width: none; }
  .jt-palette-tab { flex: none; height: 28px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
  .jt-palette-tab[aria-selected='true'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
  @media (hover: hover) { .jt-palette-tab:hover { color: var(--dsw-alias-label-primary); } }
  .jt-palette-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 8px; }
  .jt-palette-heading { padding: 10px 10px 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-palette-option { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 10px; border-radius: 8px; color: var(--dsw-alias-label-primary); cursor: pointer; }
  .jt-palette-option[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-hover); }
  .jt-palette-glyph { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--dsw-alias-label-secondary); }
  .jt-palette-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .jt-palette-name, .jt-palette-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jt-palette-name { font-size: 14px; line-height: 20px; }
  .jt-palette-detail { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-palette-keys { flex: none; color: var(--dsw-alias-label-tertiary); }
  .jt-palette-enter { flex: none; color: var(--dsw-alias-label-tertiary); }
  .jt-palette-empty { margin: 0; padding: 32px 12px; color: var(--dsw-alias-label-secondary); font-size: 14px; text-align: center; }
  .jt-palette-footer { display: flex; gap: 16px; padding: 10px 18px; border-top: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
  .jt-palette-footer span { display: inline-flex; align-items: center; gap: 4px; }
  .jt-palette-footer kbd { min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 4px; background: var(--dsw-alias-bg-module-platform); font: inherit; font-size: 10px; line-height: 18px; text-align: center; }
  /* Jan's "Chats" heading. The browser-owned search and view-options nodes stay
     mounted inside it; only their presentation folds while search is open. */
  /* Jan Desktop v04: the heading sits 56px (centre to centre) under the last
     nav row and 35px over the first chat. */
  .jt-list-header { flex: none; display: flex; align-items: center; gap: 4px; height: 36px; margin: 5px -4px -2px 0; padding-left: 10px; color: var(--dsw-alias-label-tertiary); }
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
.jt-footer-action { width: 100%; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; text-align: left; cursor: pointer; }
.jt-footer-action > svg { flex: none; color: var(--dsw-alias-label-secondary); }
.jt-footer-action:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
.jt-footer-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.jt-footer-action[data-rail] { justify-content: center; padding-inline: 0; }
.jt-menu-entry { display: flex; align-items: center; gap: 8px; width: 100%; }
.jt-sidebar-editor-lede { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
.jt-sidebar-editor { display: flex; flex-direction: column; gap: 4px; touch-action: none; }
.jt-sidebar-editor-item { display: flex; align-items: center; gap: 8px; margin: 0 -8px; padding: 0 8px; border-radius: var(--dsw-radius-md); }
.jt-sidebar-editor-item[data-dragging] { background: var(--dsw-alias-interactive-bg-hover); }
.jt-sidebar-editor .jt-sidebar-editor-row { flex: 1; min-width: 0; gap: 12px; min-height: 32px; }
.jt-sidebar-editor .jt-sidebar-editor-row svg { display: block; }
.jt-sidebar-editor-grip { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; margin-inline-end: -9px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: grab; }
.jt-sidebar-editor-grip:hover { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.jt-sidebar-editor-grip:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.jt-sidebar-editor-item[data-dragging] .jt-sidebar-editor-grip { cursor: grabbing; color: var(--dsw-alias-label-secondary); }
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
    // The macOS desktop keeps its traffic lights where the label would sit, and
    // the earlier Jan app shows no title there, so the seat stays empty.
    const Name = () => mac ? null : h('span', { className: 'jt-name' }, 'Jan')

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
      label: t('newChat'), shortcutKeys, shortcutAria, rail: !wide, onClick: onStart, className: 'jt-nav-row',
    })

    // New chat and Search always show. The pages below follow them only while
    // pinned (Edit sidebar...); unpinned ones live in the More menu.
    function WorkspaceActions({
      wide, onSearch, searchShortcut, usePanelInfo, usePluginsAvailable, useArtifactsAvailable, useScheduledAvailable,
      useHubAvailable, useOtherPanels, openPanel, addProject, newChat, createPlugin, renderFactorySlot, t,
    }) {
      const active = usePanelInfo((info) => info.activePanelId)
      const available = useDestinationsAvailable({ useHubAvailable, useArtifactsAvailable, useScheduledAvailable, usePluginsAvailable })
      const others = useOtherPanels((value) => value)
      const pinned = useSidebarPins()
      const order = useSidebarOrder()
      const editing = useSidebarEditor()
      const size = wide ? 16 : 18
      const quick = {
        [PROJECTS_PANEL]: { label: t('newProject'), onClick: () => { void addProject() } },
        [ARTIFACTS_PANEL]: { label: t('newArtifact'), onClick: newChat },
        plugins: { label: t('createPlugin'), onClick: createPlugin },
      }
      // The opening click must not reach the browser's outside-click dismissor.
      const requestSearch = (event) => {
        event.stopPropagation()
        onSearch()
      }
      return h(React.Fragment, null,
        h(NavRow, {
          icon: h(IconSearchOutlineRegular, { size }),
          label: t('search'), shortcutKeys: searchShortcut?.keys, shortcutAria: searchShortcut?.aria,
          rail: !wide, onClick: requestSearch, className: 'jt-nav-row',
        }),
        sortBySidebarOrder([
          ...SIDEBAR_DESTINATIONS.filter(({ id }) => available[id] && pinned.includes(id)).map(({ id, Icon, label }) => ({
            id, icon: h(Icon, { size }), label: t(label), quick: quick[id],
          })),
          ...others.filter(({ id }) => pinned.includes(id)).map(({ id, label }) => ({
            id, icon: renderFactorySlot('sidebar.panel.icon', { id, size, active: active === id }), label,
          })),
        ], order).map(({ id, icon, label, quick: action }) => h(NavRow, {
          key: id, icon, label, rail: !wide, className: 'jt-nav-row',
          current: active === id, onClick: () => { openPanel(id) }, quick: action,
        })),
        editing && h(SidebarEditor, { available, others, pinned, renderFactorySlot, t }))
    }

    // A cube on Jan's 16px icon grid with its 1px stroke, so Models carries the
    // same size and ink as the sidebar's other line icons (More must not share it).
    const ModelsGlyph = ({ size }) => h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1, strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M8 1.5L14 4.75V11.25L8 14.5L2 11.25V4.75L8 1.5Z' }), h('path', { d: 'M2 4.75L8 8L14 4.75' }),
    h('path', { d: 'M8 8V14.5' }))

    // Every destination Edit sidebar can pin, in sidebar order.
    const SIDEBAR_DESTINATIONS = [
      { id: 'jan-model-hub', Icon: ModelsGlyph, label: 'hub' },
      { id: 'plugins', Icon: IconPluginPinwheelOutlineRegular, label: 'customize' },
      { id: 'jt-projects', Icon: IconFolderCloseRegular, label: 'projects' },
      { id: 'artifacts', Icon: IconLayersOutlineRegular, label: 'artifacts' },
      { id: 'schedules', Icon: IconClockOutlineRegular, label: 'scheduled' },
    ]
    const PINS_KEY = 'jan-theme.sidebar.pinned'
    const DEFAULT_PINS = ['jan-model-hub', 'plugins']
    const readPins = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(PINS_KEY) ?? 'null')
        return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : DEFAULT_PINS
      } catch { return DEFAULT_PINS }
    }
    let sidebarPins = readPins()
    let sidebarEditorOpen = false
    const sidebarListeners = new Set()
    const notifySidebar = () => { for (const listener of sidebarListeners) listener() }
    const subscribeSidebar = (listener) => { sidebarListeners.add(listener); return () => { sidebarListeners.delete(listener) } }
    const setSidebarPinned = (id, pin) => {
      sidebarPins = pin ? [...sidebarPins.filter(entry => entry !== id), id] : sidebarPins.filter(entry => entry !== id)
      try { localStorage.setItem(PINS_KEY, JSON.stringify(sidebarPins)) } catch { /* the choice still holds for this window */ }
      notifySidebar()
    }
    // Sidebar order: every page Edit sidebar lists, by id; ids it has never seen
    // keep their built-in order after the stored ones.
    const ORDER_KEY = 'jan-theme.sidebar.order'
    const readOrder = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')
        return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : []
      } catch { return [] }
    }
    let sidebarOrder = readOrder()
    const setSidebarOrder = (ids) => {
      sidebarOrder = ids
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)) } catch { /* the order still holds for this window */ }
      notifySidebar()
    }
    const sortBySidebarOrder = (rows, order) => rows
      .map((row, index) => ({ row, rank: order.includes(row.id) ? order.indexOf(row.id) : order.length + index }))
      .sort((a, b) => a.rank - b.rank).map(({ row }) => row)
    const setSidebarEditor = (open) => { sidebarEditorOpen = open; notifySidebar() }
    const useSidebarPins = () => React.useSyncExternalStore(subscribeSidebar, () => sidebarPins)
    const useSidebarOrder = () => React.useSyncExternalStore(subscribeSidebar, () => sidebarOrder)
    const useSidebarEditor = () => React.useSyncExternalStore(subscribeSidebar, () => sidebarEditorOpen)
    // Which of Jan's own pages can open now. The sidebar rows, the More menu and
    // Edit sidebar read the same answer, so an unpinned page always stays in More.
    const useDestinationsAvailable = ({ useHubAvailable, useArtifactsAvailable, useScheduledAvailable, usePluginsAvailable }) => ({
      [PROJECTS_PANEL]: true,
      [HUB_PANEL]: useHubAvailable((value) => value),
      [ARTIFACTS_PANEL]: useArtifactsAvailable((value) => value),
      [SCHEDULED_PANEL]: useScheduledAvailable((value) => value),
      plugins: usePluginsAvailable((value) => value),
    })

    const GripGlyph = () => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
      [[6, 4], [10, 4], [6, 8], [10, 8], [6, 12], [10, 12]].map(([cx, cy]) => h('circle', { key: `${cx}-${cy}`, cx, cy, r: 1 })))

    // Each row keeps its checkbox and gains a grip: drag it, or focus it and
    // press the up and down arrows, to move the page in the sidebar.
    function SidebarEditor({ available, others, pinned, renderFactorySlot, t }) {
      const order = useSidebarOrder()
      const rows = sortBySidebarOrder([
        ...SIDEBAR_DESTINATIONS.filter(({ id }) => available[id]).map(({ id, Icon, label }) => ({ id, icon: h(Icon, { size: 16 }), label: t(label) })),
        ...others.map(({ id, label }) => ({ id, icon: renderFactorySlot('sidebar.panel.icon', { id, size: 16, active: false }), label })),
      ], order)
      const [draft, setDraft] = React.useState(null)
      const [dragging, setDragging] = React.useState(null)
      const list = React.useRef(null)
      const ids = draft ?? rows.map(({ id }) => id)
      const shown = ids.map(id => rows.find(row => row.id === id)).filter(Boolean)
      // Keep the ids this window does not list, so another page's place survives.
      const commit = (next) => { setSidebarOrder([...next, ...order.filter(id => !next.includes(id))]) }
      const move = (id, delta) => {
        const from = ids.indexOf(id)
        const to = Math.max(0, Math.min(ids.length - 1, from + delta))
        if (from === to) return
        const next = [...ids]
        next.splice(to, 0, ...next.splice(from, 1))
        commit(next)
      }
      const startDrag = (event, id) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(id)
        setDraft(ids)
      }
      // Insert the dragged page before the first other row whose middle sits below the pointer.
      const dragOver = (event) => {
        if (dragging === null || !list.current) return
        const current = draft ?? ids
        const before = [...list.current.querySelectorAll('[data-sidebar-row]')]
          .filter(item => item.dataset.sidebarRow !== dragging)
          .find(item => { const box = item.getBoundingClientRect(); return event.clientY < box.top + box.height / 2 })
        const next = current.filter(id => id !== dragging)
        next.splice(before ? next.indexOf(before.dataset.sidebarRow) : next.length, 0, dragging)
        if (next.some((id, i) => id !== current[i])) setDraft(next)
      }
      const endDrag = () => {
        if (dragging === null) return
        if (draft) commit(draft)
        setDragging(null)
        setDraft(null)
      }
      return h(Modal, {
        open: true, title: t('editSidebar.title'), closeLabel: t('editSidebar.close'), onClose: () => setSidebarEditor(false),
        className: 'jt-appearance', footer: h(Button, { variant: 'contrast', onClick: () => setSidebarEditor(false) }, t('editSidebar.done')),
      },
      h('p', { className: 'jt-sidebar-editor-lede' }, t('editSidebar.lede')),
      h('div', { ref: list, className: 'jt-sidebar-editor', onPointerMove: dragOver, onPointerUp: endDrag, onPointerCancel: endDrag },
        shown.map(({ id, icon, label }) => h('div', { key: id, className: 'jt-sidebar-editor-item', 'data-sidebar-row': id, 'data-dragging': dragging === id || undefined },
          h(Checkbox, {
            className: 'jt-sidebar-editor-row', icon, label,
            checked: pinned.includes(id), onChange: (pin) => { setSidebarPinned(id, pin) },
          }),
          h('button', {
            type: 'button', className: 'jt-sidebar-editor-grip', 'aria-label': t('editSidebar.reorder', { name: label }), title: t('editSidebar.reorderHint'),
            onPointerDown: (event) => { startDrag(event, id) },
            onKeyDown: (event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(id, event.key === 'ArrowUp' ? -1 : 1) }
            },
          }, h(GripGlyph))))))
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

    // The More menu: every page that is not pinned (Jan's own destinations and
    // other plugins' panels), then Edit sidebar to choose what shows. The stock
    // onOpen only opens sidebar-registered panels, so Jan's own pages (Projects
    // has no sidebar entry) open through the layout directly.
    function PanelDestinations({
      entries, onOpen, onDismiss, usePanelInfo, openPanel, renderFactorySlot, t,
      useHubAvailable, useArtifactsAvailable, useScheduledAvailable, usePluginsAvailable,
    }) {
      const pinned = useSidebarPins()
      const active = usePanelInfo((info) => info.activePanelId)
      const available = useDestinationsAvailable({ useHubAvailable, useArtifactsAvailable, useScheduledAvailable, usePluginsAvailable })
      const jan = new Set(SIDEBAR_DESTINATIONS.map(({ id }) => id))
      const own = SIDEBAR_DESTINATIONS
        .filter(({ id }) => !pinned.includes(id) && available[id])
        .map(({ id, Icon, label }) => ({ id, label: t(label), icon: h(Icon, { size: 16 }), active: active === id, open: () => openPanel(id) }))
      const others = entries.filter(entry => !jan.has(entry.id) && !pinned.includes(entry.id))
        .map(entry => ({ ...entry, icon: renderFactorySlot('sidebar.panel.icon', { id: entry.id, size: 16, active: entry.active === true }), open: () => onOpen(entry.id) }))
      const rows = [...own, ...others]
      return h(React.Fragment, null,
        rows.map(entry => h(MenuItemButton, {
          key: entry.id, current: entry.active === true, icon: entry.icon,
          onSelect: () => { onDismiss(); entry.open() },
        }, h('span', { className: 'jt-menu-entry' }, entry.label,
          entry.active === true && h(IconCheckOutlineRegular, {
            size: 16, className: 'jt-menu-check', 'aria-hidden': true,
          })))),
        h(MenuItemButton, {
          separatorBefore: rows.length > 0,
          onSelect: () => { onDismiss(); setSidebarEditor(true) },
        }, t('editSidebar')))
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
    // Registered by the model-hub plugin; the row appears only while it is.
    const HUB_PANEL = 'jan-model-hub'
    const relative = (iso) => {
      const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
      if (!(minutes >= 0)) return ''
      if (minutes < 60) return `${minutes}m`
      if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
      return `${Math.round(minutes / 60 / 24)}d`
    }

    // Projects page: every project folder Jan knows, newest first. A card
    // starts a chat inside that project; New project picks a folder.
    function ProjectsPanel({ useWorkspaces, openProject, addProject, t }) {
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
              title: row.title, path: row.path, onClick: () => { openProject(row.workspaceId) },
              meta: [t(row.sessionIds.length === 1 ? 'projects.chat' : 'projects.chats', { count: row.sessionIds.length }), ' · ', t('projects.updated', { ago: relative(row.updatedAt) })].join(''),
            })))))
    }

    // Project home: one Workspace's page. Which project it shows is a plain
    // module store, because the main panel registration is shared by all.
    const PROJECT_PANEL = 'jt-project'
    const currentProject = (() => {
      let workspaceId = null
      const listeners = new Set()
      return {
        getSnapshot: () => workspaceId,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set(next) { workspaceId = next; for (const listener of listeners) listener() },
      }
    })()
    async function projectApi(method, params = {}, signal) {
      const response = await fetch('/jan-api/project-home', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }), signal })
      // A settings save reloads the Host plugin; its route is briefly absent and answers without JSON.
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('Jan is reloading. Try again in a moment.')
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'Request failed.')
      return body.result
    }
    const fileSize = (bytes) => bytes === undefined ? ''
      : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
    const readBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => { resolve(String(reader.result).split(',', 2)[1] ?? '') }
      reader.onerror = () => { reject(reader.error ?? new Error('The file could not be read.')) }
      reader.readAsDataURL(file)
    })
    const scheduleZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const sameFolder = (a, b) => a !== undefined && b !== undefined
      && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

    // Edits one instruction file; the draft survives closing the dialog until it is saved.
    const projectDrafts = new Map()
    function ProjectTextEditor({ open, title, description, note, initial, draftKey, onSave, onClose, t }) {
      const [text, setText] = React.useState(initial)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        if (open) { setText(projectDrafts.get(draftKey) ?? initial); setError('') }
      }, [open, draftKey, initial])
      const change = (value) => { projectDrafts.set(draftKey, value); setText(value) }
      const save = async () => {
        setBusy(true)
        setError('')
        try {
          await onSave(text)
          projectDrafts.delete(draftKey)
          onClose()
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
      }
      return h(Modal, {
        open, onClose, title, description,
        footer: h('div', { className: 'jt-project-editor-actions' },
          h(Button, { variant: 'outline', onClick: onClose }, t('project.cancel')),
          h(Button, { variant: 'primary', disabled: busy, onClick: () => { void save() } }, busy ? t('project.saving') : t('project.save'))),
      }, h('div', { className: 'jt-project-editor' },
        h('textarea', {
          'data-modal-autofocus': '', value: text, 'aria-label': title, spellCheck: true,
          onChange: (event) => { change(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() } },
        }),
        h('p', { className: 'jt-project-editor-note' }, note),
        error && h('p', { className: 'jt-project-error', role: 'alert' }, error)))
    }

    const TASK_TIMES = [['daily', 'project.task.daily'], ['weekdays', 'project.task.weekdays'], ['weekly', 'project.task.weekly'], ['once', 'project.task.once']]
    function ProjectTaskEditor({ open, onCreate, onClose, t }) {
      const [title, setTitle] = React.useState('')
      const [prompt, setPrompt] = React.useState('')
      const [repeat, setRepeat] = React.useState('daily')
      const [time, setTime] = React.useState('09:00')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => { if (open) { setError('') } }, [open])
      const timing = () => {
        const zone = scheduleZone()
        if (repeat === 'once') {
          const [hours, minutes] = time.split(':').map(Number)
          const at = new Date()
          at.setHours(hours, minutes, 0, 0)
          if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
          return { kind: 'at', at: at.toISOString() }
        }
        if (repeat === 'daily') return { kind: 'daily', daily: { time: `${time}:00`, time_zone: zone } }
        // ISO weekdays, Monday 1 through Sunday 7; Weekly repeats on today's weekday.
        const weekdays = repeat === 'weekdays' ? [1, 2, 3, 4, 5] : [new Date().getDay() || 7]
        return { kind: 'weekly', weekly: { time: `${time}:00`, time_zone: zone, weekdays } }
      }
      const create = async () => {
        if (title.trim() === '' || prompt.trim() === '') { setError(t('project.task.missing')); return }
        setBusy(true)
        setError('')
        try {
          await onCreate({ title: title.trim(), prompt: prompt.trim(), timing: timing() })
          setTitle(''); setPrompt(''); onClose()
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
      }
      return h(Modal, {
        open, onClose, title: t('project.task.title'), description: t('project.task.description'),
        footer: h('div', { className: 'jt-project-editor-actions' },
          h(Button, { variant: 'outline', onClick: onClose }, t('project.cancel')),
          h(Button, { variant: 'primary', disabled: busy, onClick: () => { void create() } }, busy ? t('project.saving') : t('project.task.create'))),
      }, h('div', { className: 'jt-project-editor' },
        h('label', null, t('project.task.name'), h('input', { 'data-modal-autofocus': '', value: title, maxLength: 120, onChange: (event) => { setTitle(event.target.value) } })),
        h('label', null, t('project.task.prompt'), h('textarea', { value: prompt, style: { minHeight: '120px', fontFamily: 'inherit', fontSize: '14px' }, onChange: (event) => { setPrompt(event.target.value) } })),
        h('label', null, t('project.task.repeat'), h('select', { value: repeat, onChange: (event) => { setRepeat(event.target.value) } },
          TASK_TIMES.map(([value, label]) => h('option', { key: value, value }, t(label))))),
        h('label', null, t('project.task.time'), h('input', { type: 'time', value: time, required: true, onChange: (event) => { setTime(event.target.value || '09:00') } })),
        h('p', { className: 'jt-project-editor-note' }, t('project.task.note', { zone: scheduleZone() })),
        error && h('p', { className: 'jt-project-error', role: 'alert' }, error)))
    }

    function ProjectHome({ useProject, useWorkspaces, backToProjects, t, ...props }) {
      const workspaceId = useProject(value => value)
      const workspace = useWorkspaces(snapshot => snapshot.items.find(item => item.workspaceId === workspaceId))
      if (workspace === undefined) {
        return h('section', { className: 'jt-projects' },
          h('p', { className: 'jt-projects-empty' }, t('project.missing')),
          h(Button, { variant: 'outline', onClick: backToProjects }, t('project.back')))
      }
      return h(ProjectDetails, { ...props, key: workspace.workspaceId, workspace, backToProjects, t })
    }

    function ProjectDetails({ workspace, useArchived, useSessions, startSession, openChat, backToProjects, loadSchedules, createSchedule, openScheduled, t }) {
      const { workspaceId } = workspace
      const sessions = useSessions(value => value)
      const archivedIds = useArchived(value => value)
      const [details, setDetails] = React.useState(null)
      const [error, setError] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [tasks, setTasks] = React.useState([])
      const [taskError, setTaskError] = React.useState('')
      const [addingTask, setAddingTask] = React.useState(false)
      const [fileError, setFileError] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const fileInput = React.useRef(null)
      const [detailsVersion, reloadDetails] = React.useReducer(version => version + 1, 0)
      React.useEffect(() => {
        const controller = new AbortController()
        const { signal } = controller
        void projectApi('read', { workspaceId }, signal).then(
          (next) => { if (!signal.aborted) { setDetails(next); setError('') } },
          (failure) => { if (!signal.aborted) setError(failure.message) },
        )
        return () => { controller.abort() }
      }, [workspaceId, detailsVersion])
      const reloadTasks = React.useCallback(async () => {
        const pending = loadSchedules()
        if (pending === undefined) { setTasks(null); return }
        try {
          const result = await pending
          if (!result.ok) throw new Error(result.error.message)
          setTasks(result.value)
          setTaskError('')
        } catch (failure) { setTaskError(failure.message) }
      }, [])
      React.useEffect(() => { void reloadTasks() }, [reloadTasks])
      const archived = new Set(archivedIds)
      const recents = workspace.sessionIds
        .map(id => sessions.byId[id])
        .filter(summary => summary !== undefined && !summary.blank && summary.origin !== 'subagent' && summary.parentId === undefined && !archived.has(summary.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const projectTasks = tasks === null ? null : tasks.filter(task => task.status !== 'ended'
        && (task.target.kind === 'session' ? workspace.sessionIds.includes(task.target.sessionId) : sameFolder(task.target.create?.cwd, workspace.path)))
      const send = () => {
        const text = draft.trim()
        if (text === '') return
        setDraft('')
        startSession(workspaceId, text)
      }
      const addFiles = async (files) => {
        setFileError('')
        for (const file of files) {
          try { await projectApi('addFile', { workspaceId, name: file.name, data: await readBase64(file) }) } catch (failure) { setFileError(failure.message) }
        }
        reloadDetails()
      }
      const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const card = (titleKey, action, body) => h('section', { className: 'jt-project-card', 'aria-label': t(titleKey) },
        h('div', { className: 'jt-project-card-head' }, h('h2', null, t(titleKey)), action), body)
      const preview = (text, emptyKey) => h('p', { className: 'jt-project-card-text', 'data-empty': text.trim() === '' || undefined },
        text.trim() === '' ? t(emptyKey) : text.trim())
      return h('div', { className: 'jt-project' },
        h('div', null,
          h('button', { type: 'button', className: 'jt-project-back', onClick: backToProjects }, '‹ ', t('projects')),
          h('h1', { className: 'jt-project-title' }, workspace.title),
          h('p', { className: 'jt-project-path' }, workspace.path),
          h('form', { className: 'jt-project-composer', onSubmit: (event) => { event.preventDefault(); send() } },
            h('textarea', {
              value: draft, rows: 2, 'aria-label': t('project.newSession', { name: workspace.title }),
              placeholder: t('project.newSession', { name: workspace.title }),
              onChange: (event) => { setDraft(event.target.value) },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
              },
            }),
            h('div', { className: 'jt-project-composer-row' },
              h('span', { className: 'jt-project-hint' }, t('project.composerHint')),
              h('button', { type: 'submit', className: 'jt-project-send', disabled: draft.trim() === '', 'aria-label': t('project.start') },
                h(IconSendOutlineRegular, { size: 16, 'aria-hidden': true })))),
          h('section', { className: 'jt-project-recents', 'aria-labelledby': 'jt-project-recents' },
            h('h2', { className: 'jt-project-heading', id: 'jt-project-recents' }, t('project.recents')),
            recents.length === 0
              ? h('p', { className: 'jt-project-empty' }, t('project.noSessions'))
              : h('ul', { className: 'jt-project-sessions' }, recents.map(summary => h('li', { key: summary.id },
                h('button', { type: 'button', className: 'jt-project-session', onClick: () => { openChat(summary.id) } },
                  h('span', { className: 'jt-project-session-title' }, summary.displayTitle),
                  h('span', { className: 'jt-project-session-date' }, dateFormat.format(new Date(summary.updatedAt))))))))),
        h('aside', { className: 'jt-project-rail', 'aria-label': t('project.details') },
          error && h('p', { className: 'jt-project-error', role: 'alert' }, error),
          card('project.instructions',
            h(Button, { size: 'sm', variant: 'outline', disabled: details === null, onClick: () => { setEditing('instructions') } }, t(details?.instructions.trim() ? 'project.edit' : 'project.add')),
            preview(details?.instructions ?? '', 'project.instructions.empty')),
          card('project.context',
            h(Button, { size: 'sm', variant: 'outline', disabled: details === null, onClick: () => { fileInput.current?.click() } }, t('project.addFiles')),
            h(React.Fragment, null,
              h('input', { ref: fileInput, type: 'file', multiple: true, hidden: true, onChange: (event) => { const files = [...event.target.files]; event.target.value = ''; void addFiles(files) } }),
              details === null ? null : details.files.length === 0
                ? preview('', 'project.context.empty')
                : h('ul', { className: 'jt-project-files' }, details.files.map(file => h('li', { key: file.name, className: 'jt-project-file' },
                  h(file.directory ? IconFolderCloseRegular : FileTypeIcon, file.directory ? { size: 16, 'aria-hidden': true } : { path: file.name, size: 16 }),
                  h('span', { className: 'jt-project-file-name', title: file.name }, file.name),
                  h('span', { className: 'jt-project-file-size' }, fileSize(file.size))))),
              details?.truncated && h('p', { className: 'jt-project-card-text' }, t('project.context.more')),
              h(Button, { size: 'sm', variant: 'ghost', className: 'jt-project-link', onClick: () => { void projectApi('openFolder', { workspaceId }).catch(failure => { setFileError(failure.message) }) } }, t('project.openFolder')),
              fileError && h('p', { className: 'jt-project-error', role: 'alert' }, fileError))),
          card('project.memory',
            h(Button, { size: 'sm', variant: 'outline', disabled: details === null, onClick: () => { setEditing('memory') } }, t(details?.memory.trim() ? 'project.edit' : 'project.add')),
            preview(details?.memory ?? '', 'project.memory.empty')),
          projectTasks !== null && card('project.scheduled',
            h(Button, { size: 'sm', variant: 'outline', onClick: () => { setAddingTask(true) } }, t('project.add')),
            h(React.Fragment, null,
              projectTasks.length === 0
                ? preview('', 'project.scheduled.empty')
                : h('ul', { className: 'jt-project-tasks' }, projectTasks.map(task => h('li', { key: task.id, className: 'jt-project-task' },
                  h('div', null, task.title),
                  h('div', { className: 'jt-project-task-meta' }, task.status === 'paused' ? t('project.task.paused') : t('project.task.next', { when: new Date(task.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }))))),
              projectTasks.length > 0 && h(Button, { size: 'sm', variant: 'ghost', className: 'jt-project-link', onClick: openScheduled }, t('project.task.manage')),
              taskError && h('p', { className: 'jt-project-error', role: 'alert' }, taskError)))),
        h(ProjectTextEditor, {
          open: editing !== null, t,
          title: editing === 'memory' ? t('project.memory') : t('project.instructions'),
          description: editing === 'memory' ? t('project.memory.description') : t('project.instructions.description'),
          note: editing === 'memory' ? t('project.memory.note') : t('project.instructions.note'),
          initial: editing === 'memory' ? details?.memory ?? '' : details?.instructions ?? '',
          draftKey: `${workspaceId}:${editing}`,
          onSave: async (text) => { await projectApi('save', { workspaceId, kind: editing, text }); reloadDetails() },
          onClose: () => { setEditing(null) },
        }),
        h(ProjectTaskEditor, {
          open: addingTask, t,
          onCreate: async (request) => { await createSchedule({ ...request, target: { kind: 'new', create: { cwd: workspace.path } } }); await reloadTasks() },
          onClose: () => { setAddingTask(false) },
        }))
    }

    // Universal search (Mod+K and the Search row): chats, artifacts, projects,
    // scheduled tasks and app actions in one keyboard-driven list.
    const palette = (() => {
      let snapshot = { open: false, seq: 0, kind: 'all' }
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        // Opening again while open re-targets the tab, as VS Code's Ctrl+P / Ctrl+Shift+P do.
        set(open, kind = 'all') {
          if (!open && !snapshot.open) return
          snapshot = open ? { open, seq: snapshot.seq + 1, kind } : { ...snapshot, open }
          for (const listener of listeners) listener()
        },
      }
    })()
    // Search-only kinds in All results; the Commands tab lists actions then settings.
    const PALETTE_KINDS = ['chats', 'artifacts', 'projects', 'scheduled', 'actions', 'settings']
    const COMMAND_KINDS = ['actions', 'settings']
    const PALETTE_COMMANDS = ['search.quickOpen', 'search.commands']
    const RESULTS_PER_GROUP = 5
    const RESULTS_PER_TAB = 50
    const RECENTS = 8
    const baseName = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
    const ChatGlyph = () => h(IconNewChatOutlineRegular, { size: 16 })
    const KIND_ICON = {
      chats: ChatGlyph,
      artifacts: () => h(IconLayersOutlineRegular, { size: 16 }),
      projects: () => h(IconFolderCloseRegular, { size: 16 }),
      scheduled: () => h(IconClockOutlineRegular, { size: 16 }),
      actions: () => h(IconSparkleRegular, { size: 16 }),
      settings: () => h(IconSettingsOutlineRegular, { size: 16 }),
    }

    // Title matches rank first (prefix, then alignment); keywords such as a
    // path or alias match only as plain substrings so long text stays quiet.
    const rankItems = (items, query) => {
      if (query === '') return items
      const titled = rankByName(items.map(item => ({ name: item.title, item })), query).map(match => match.item)
      const seen = new Set(titled)
      const needle = query.toLowerCase()
      return [...titled, ...items.filter(item => !seen.has(item)
        && (item.keywords ?? []).some(keyword => keyword.toLowerCase().includes(needle)))]
    }
    const byTime = (a, b) => (b.time ?? 0) - (a.time ?? 0)

    async function healthApi(method, params = {}) {
      const response = await fetch('/jan-api/startup-health', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      // A settings save reloads the Host plugin; its route is briefly absent and answers without JSON.
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('unavailable')
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || 'Request failed.')
      return body.result
    }
    // Failures of plugins and MCP servers that could not start. The Host
    // already switched them off; each notice says so and offers the log,
    // removal of an MCP server, and the matching Settings section.
    function StartupNotices({ openSettings }) {
      const [state, setState] = React.useState({ failures: [], logAvailable: false })
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        let live = true
        let timer
        const poll = async (attempt) => {
          let pending = true
          try {
            const next = await healthApi('list')
            if (!live) return
            setState(next)
            pending = next.pending
          } catch { /* The route returns after the Host plugin reloads; keep asking. */ }
          // Starts settle within the MCP start budget; stop asking after about two minutes.
          if (live && pending && attempt < 60) timer = setTimeout(() => poll(attempt + 1), 2000)
        }
        poll(0)
        return () => { live = false; clearTimeout(timer) }
      }, [])
      const forget = (key) => setState(value => ({ ...value, failures: value.failures.filter(item => item.key !== key) }))
      const act = async (task) => { setError(''); try { await task() } catch (failure) { setError(failure.message) } }
      const dismiss = (item) => { forget(item.key); void healthApi('dismiss', { key: item.key }).catch(() => { }) }
      if (!state.failures.length) return null
      return h('div', { className: 'jt-startup', role: 'region', 'aria-label': 'Startup problems' },
        state.failures.map(item => h('section', { key: item.key, className: 'jt-startup-card', role: 'alert', 'aria-labelledby': `jt-startup-${item.key}` },
          h('span', { className: 'jt-startup-glyph', 'aria-hidden': true }, h(IconWarningTriangleOutlineRegular, { size: 20 })),
          h('div', null,
            h('p', { className: 'jt-startup-title', id: `jt-startup-${item.key}` }, `${item.name} couldn't start`),
            h('p', { className: 'jt-startup-text' }, `${item.reason} ${item.disabled ? 'Jan turned it off so it won\'t slow down startup. ' : ''}${item.kind === 'mcp' ? 'Remove it, or fix it in Settings.' : 'Check its settings, or open the log for details.'}`),
            error ? h('p', { className: 'jt-startup-text', role: 'status' }, error) : null,
            h('div', { className: 'jt-startup-actions' },
              state.logAvailable && h(Button, { size: 'sm', onClick: () => act(() => healthApi('openLog')) }, 'Open log'),
              item.kind === 'mcp' && h(Button, { size: 'sm', onClick: () => act(async () => { await agentApi('remove', { name: item.id, confirmed: true }); dismiss(item) }) }, 'Remove'),
              h(Button, { size: 'sm', onClick: () => { openSettings(item.kind === 'mcp' ? 'jt-mcp' : 'plugins'); dismiss(item) } }, 'Open settings'))),
          h('button', { type: 'button', className: 'jt-startup-close', 'aria-label': `Dismiss ${item.name} notice`, onClick: () => dismiss(item) }, h(IconCloseOutlineRegular, { size: 16 })))))
    }
    function SearchPalette({
      usePalette, useSessions, useWorkspaces, useCatalog, useArtifactsAvailable, useScheduledAvailable, usePluginsAvailable, useHubAvailable,
      useSettingsTargets, closePalette, loadSchedules, openChat, openProject, openArtifact, openPanel, openSettings, runCommand, t,
    }) {
      const { open, seq, kind: initialKind } = usePalette(value => value)
      const settingsTargets = useSettingsTargets(value => value)
      const sessions = useSessions(value => value)
      const workspaces = useWorkspaces(value => value)
      const catalog = useCatalog(value => value)
      const artifactsAvailable = useArtifactsAvailable(value => value)
      const scheduledAvailable = useScheduledAvailable(value => value)
      const pluginsAvailable = usePluginsAvailable(value => value)
      const hubAvailable = useHubAvailable(value => value)
      const [query, setQuery] = React.useState('')
      const [kind, setKind] = React.useState('all')
      const [active, setActive] = React.useState(0)
      const [schedules, setSchedules] = React.useState([])
      const list = React.useRef(null)
      React.useEffect(() => {
        if (!open) return
        setQuery('')
        setKind(initialKind)
        setActive(0)
        let live = true
        const pending = loadSchedules()
        if (pending !== undefined) {
          pending.then((result) => { if (live && result.ok) setSchedules(result.value) },
            (error) => { console.warn('jan-theme: scheduled tasks unavailable to search', error) })
        }
        return () => { live = false }
      }, [open, seq])
      React.useEffect(() => { setActive(0) }, [query, kind])
      React.useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
      }, [active, open])

      const items = React.useMemo(() => {
        if (!open) return null
        const archived = new Set(workspaces.archivedSessionIds)
        const workspaceOf = new Map()
        for (const workspace of workspaces.items) for (const id of workspace.sessionIds) workspaceOf.set(id, workspace.title)
        const chats = []
        const artifacts = []
        for (const id of sessions.ids) {
          const summary = sessions.byId[id]
          if (summary === undefined || summary.origin === 'subagent' || summary.parentId !== undefined || archived.has(id)) continue
          if (!summary.blank) {
            chats.push({
              kind: 'chats', key: `chat:${id}`, title: summary.displayTitle, detail: workspaceOf.get(id),
              time: summary.updatedAt, open: () => { openChat(id) },
            })
          }
          const files = sessions.projectionsBySession[id]?.values?.presentedFiles ?? summary.projectionValues?.presentedFiles ?? []
          for (const file of files) {
            artifacts.push({
              kind: 'artifacts', key: `artifact:${id}:${file.seq}:${file.index}`, title: baseName(file.path),
              detail: summary.displayTitle, keywords: [file.path, file.description ?? ''], time: file.time,
              icon: () => h(FileTypeIcon, { path: file.path, size: 16 }),
              open: () => { openArtifact(id, file.seq, file.index) },
            })
          }
        }
        const projects = workspaces.items.map(workspace => ({
          kind: 'projects', key: `project:${workspace.workspaceId}`, title: workspace.title, detail: workspace.path,
          keywords: [workspace.path], time: Date.parse(workspace.updatedAt), open: () => { openProject(workspace.workspaceId) },
        }))
        const scheduled = schedules.map(task => ({
          kind: 'scheduled', key: `scheduled:${task.id}`, title: task.title, detail: task.prompt,
          keywords: [task.prompt], open: () => { openPanel(SCHEDULED_PANEL) },
        }))
        const panels = [
          ['projects', PROJECTS_PANEL, true],
          ['artifacts', ARTIFACTS_PANEL, artifactsAvailable],
          ['scheduled', SCHEDULED_PANEL, scheduledAvailable],
          ['hub', HUB_PANEL, hubAvailable],
          ['plugins', 'plugins', pluginsAvailable],
        ]
        const actions = [
          ...catalog.filter(row => row.id !== 'session.search' && !PALETTE_COMMANDS.includes(row.id)).map(row => ({
            kind: 'actions', key: `command:${row.id}`, title: row.label, keys: row.keys.length > 0 ? row.keys : undefined,
            keywords: row.aliases, open: () => { runCommand(row.id) },
          })),
          ...panels.filter(([, , available]) => available).map(([label, id]) => ({
            kind: 'actions', key: `panel:${id}`, title: t('palette.goTo', { page: t(label) }),
            open: () => { openPanel(id) },
          })),
        ]
        const settings = settingsTargets.map(target => ({
          kind: 'settings', key: `settings:${target.section}:${target.id}`, title: target.title,
          detail: target.title === target.sectionTitle ? t('palette.settings') : `${t('palette.settings')} › ${target.sectionTitle}`,
          keywords: [target.sectionTitle, target.id], open: () => { openSettings(target.section) },
        }))
        return { chats, artifacts, projects, scheduled, actions, settings }
      }, [open, sessions, workspaces, catalog, schedules, settingsTargets, artifactsAvailable, scheduledAvailable, pluginsAvailable, t])

      if (items === null) return null
      const kindLabel = (group) => group === 'actions' || group === 'settings' || group === 'commands' || group === 'all'
        ? t(`palette.${group}`) : t(group)
      const needle = query.trim()
      const sections = []
      if (kind === 'all') {
        if (needle === '') {
          sections.push({
            id: 'recents', label: t('palette.recents'),
            items: [...items.chats, ...items.artifacts, ...items.projects].sort(byTime).slice(0, RECENTS)
          })
          sections.push({ id: 'actions', label: t('palette.actions'), items: items.actions.slice(0, RESULTS_PER_GROUP) })
        } else {
          for (const group of PALETTE_KINDS) {
            sections.push({ id: group, label: kindLabel(group), items: rankItems(items[group], needle).slice(0, RESULTS_PER_GROUP) })
          }
        }
      } else if (kind === 'commands') {
        for (const group of COMMAND_KINDS) {
          sections.push({ id: group, label: kindLabel(group), items: rankItems(items[group], needle).slice(0, RESULTS_PER_TAB) })
        }
      } else {
        const source = needle === '' ? [...items[kind]].sort(byTime) : rankItems(items[kind], needle)
        sections.push({ id: kind, label: kindLabel(kind), items: source.slice(0, RESULTS_PER_TAB) })
      }
      const visible = sections.filter(section => section.items.length > 0)
      const flat = visible.flatMap(section => section.items)
      const selected = Math.min(active, Math.max(flat.length - 1, 0))
      const choose = (item) => {
        closePalette()
        // The modal restores focus on close; the destination may then take it.
        window.setTimeout(item.open, 0)
      }
      const onKeyDown = (event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (flat.length === 0) return
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActive((selected + step + flat.length) % flat.length)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const item = flat[selected]
          if (item !== undefined) choose(item)
        }
      }
      const tabs = ['all', 'chats', 'artifacts', 'projects', ...(scheduledAvailable || items.scheduled.length > 0 ? ['scheduled'] : []), 'commands']
      let index = -1
      return h(Modal, {
        open, onClose: closePalette, title: t('palette.title'), headless: true, shortcutModal: 'search', className: 'jt-palette',
      }, h('div', { className: 'jt-palette-body' },
        h('div', { className: 'jt-palette-field' },
          h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }),
          h('input', {
            'data-modal-autofocus': '', type: 'text', value: query,
            placeholder: t(kind === 'commands' ? 'palette.commandsPlaceholder' : 'palette.placeholder'),
            'aria-label': t('palette.title'), role: 'combobox', 'aria-expanded': true, 'aria-controls': 'jt-palette-list',
            'aria-activedescendant': flat.length > 0 ? `jt-palette-option-${selected}` : undefined, autoComplete: 'off', spellCheck: false,
            onChange: (event) => { setQuery(event.target.value) }, onKeyDown,
          })),
        h('div', { className: 'jt-palette-tabs', role: 'tablist', 'aria-label': t('palette.filter') }, tabs.map(tab => h('button', {
          key: tab, type: 'button', role: 'tab', className: 'jt-palette-tab', 'aria-selected': kind === tab,
          onMouseDown: (event) => { event.preventDefault() },
          onClick: () => { setKind(tab) },
        }, kindLabel(tab)))),
        h('div', { id: 'jt-palette-list', className: 'jt-palette-list', role: 'listbox', 'aria-label': t('palette.title'), ref: list },
          visible.length === 0
            ? h('p', { className: 'jt-palette-empty' }, needle === '' ? t('palette.nothing') : t('palette.noResults', { query: needle }))
            : visible.map(section => h('div', { key: section.id, role: 'group', 'aria-label': section.label },
              h('div', { className: 'jt-palette-heading', 'aria-hidden': true }, section.label),
              section.items.map((item) => {
                index += 1
                const position = index
                const Glyph = item.icon ?? KIND_ICON[item.kind]
                return h('div', {
                  key: item.key, id: `jt-palette-option-${position}`, role: 'option', 'aria-selected': position === selected,
                  className: 'jt-palette-option',
                  onMouseMove: () => { if (position !== selected) setActive(position) },
                  onMouseDown: (event) => { event.preventDefault() },
                  onClick: () => { choose(item) },
                },
                  h('span', { className: 'jt-palette-glyph', 'aria-hidden': true }, h(Glyph)),
                  h('span', { className: 'jt-palette-text' },
                    h('span', { className: 'jt-palette-name' }, item.title),
                    item.detail && h('span', { className: 'jt-palette-detail' }, item.detail)),
                  item.keys !== undefined && h(ShortcutKeys, { keys: item.keys, className: 'jt-palette-keys' }),
                  position === selected && h(IconRightUpOutlineRegular, { size: 14, className: 'jt-palette-enter', 'aria-hidden': true }))
              })))),
        h('footer', { className: 'jt-palette-footer', 'aria-hidden': true },
          h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), t('palette.navigate')),
          h('span', null, h('kbd', null, '↵'), t('palette.open')),
          h('span', null, h('kbd', null, 'Esc'), t('palette.close')))))
    }

    return {
      name: 'jan-theme',
      inject: ['slots'],
      apply(ctx) {
        applyAppearance(preferences)
        ctx.effect(() => () => { document.documentElement.removeAttribute('data-jt-hide-navigation') }, 'jan-theme: navigation buttons preference')
        // Follow the saved appearance: a profile edit, another window or Plugin Manager can change it after boot.
        ctx.inject(['configForms'], (scope) => {
          const form = scope.configForms.get('jan-theme')
          const sync = () => {
            const saved = form.getSnapshot().value?.appearance
            if (saved === undefined || ['accent', 'coloredUserBubble', 'navigationButtons'].every(key => saved[key] === undefined || saved[key] === preferences[key])) return
            applyAppearance({ ...preferences, ...saved })
          }
          scope.effect(() => form.subscribe(sync), 'jan-theme: saved appearance')
          sync()
        })
        ctx.inject(['locale'], (scope) => {
          const t = scope.locale.bind('jan-theme')
          // Directly under General's theme (10) and font size (11) rows, before the conversation rows at 12.
          scope.slots.inject('settings.general.item', () => scope.slots.register({ name: 'settings.general.item', id: 'jt-accent-color', order: 11.1, locale: 'jan-theme' }, AccentColorRow))
          scope.slots.inject('settings.general.item', () => scope.slots.register({ name: 'settings.general.item', id: 'jt-user-bubble', order: 11.2, locale: 'jan-theme' }, UserBubbleRow))
          scope.slots.inject('settings.general.item', () => scope.slots.register({ name: 'settings.general.item', id: 'jt-appearance-reset', order: 11.3, locale: 'jan-theme' }, AppearanceResetRow))
          scope.slots.inject('settings.general.item', () => scope.slots.register({ name: 'settings.general.item', id: 'jt-navigation-buttons', order: 11.4, locale: 'jan-theme' }, NavigationButtonsRow))
          scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'jt-mcp', order: 30, label: () => t('section.mcp'), locale: 'jan-theme' }, () => h(AgentSettings, { key: 'mcp' })))
          scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'jt-skills', order: 31, label: () => t('section.skills'), locale: 'jan-theme' }, () => h(AgentSettings, { skills: true, key: 'skills' })))
        })
        // Distinct nav glyphs: the settings dialog falls back to the gear for ids it does not know.
        for (const [id, Icon] of [['jt-mcp', IconToolOutlineMedium], ['jt-skills', IconSkillOutlineMedium]]) {
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
              hub: 'Models', customize: 'Customize',
              editSidebar: 'Edit sidebar…', 'editSidebar.title': 'Edit sidebar', 'editSidebar.done': 'Done',
              'editSidebar.lede': 'Choose which items appear in your sidebar. Drag to reorder.', 'editSidebar.close': 'Close',
              'editSidebar.reorder': 'Move {name}', 'editSidebar.reorderHint': 'Drag, or use the up and down arrow keys',
              newArtifact: 'New artifact', createPlugin: 'Create plugin',
              'newArtifact.prompt': 'Create a file for me: ',
              'createPlugin.prompt': 'Create a Jan plugin with a left sidebar entry.',
              'createSkill.prompt': 'Create a skill that ', 'createConnector.prompt': 'Connect Jan to ',
              'projects.lede': 'Each project is a folder. Chats started in it can read and write its files.',
              'project.back': "Back to projects",
              'project.missing': "This project is no longer in Jan.",
              'project.newSession': "New session in {name}",
              'project.composerHint': "Enter starts a session in this project. Shift+Enter adds a line.",
              'project.start': "Start session",
              'project.recents': "Recents",
              'project.noSessions': "No sessions in this project yet.",
              'project.details': "Project details",
              'project.instructions': "Instructions",
              'project.instructions.empty': "Tell the agent how to work in this project.",
              'project.instructions.description': "Every new session in this project reads these instructions first.",
              'project.instructions.note': "Saved as AGENTS.md in the project folder, where other agents can read it too.",
              'project.context': "Context",
              'project.context.empty': "No files in this folder yet.",
              'project.context.more': "Showing the first 300 items.",
              'project.addFiles': "Add files",
              'project.openFolder': "Open folder",
              'project.memory': "Memory",
              'project.memory.empty': "Notes the agent keeps about this project.",
              'project.memory.description': "Private notes every new session in this project reads after its instructions.",
              'project.memory.note': "Saved as AGENTS.local.md in the project folder. Keep it out of version control.",
              'project.scheduled': "Scheduled",
              'project.scheduled.empty': "No scheduled tasks run in this project.",
              'project.add': "Add",
              'project.edit': "Edit",
              'project.save': "Save",
              'project.saving': "Saving…",
              'project.cancel': "Cancel",
              'project.task.title': "New scheduled task",
              'project.task.description': "Each run starts a new session in this project.",
              'project.task.name': "Name",
              'project.task.prompt': "Instructions",
              'project.task.repeat': "Repeat",
              'project.task.time': "Time",
              'project.task.daily': "Every day",
              'project.task.weekdays': "Weekdays",
              'project.task.weekly': "Every week on this weekday",
              'project.task.once': "Once",
              'project.task.note': "Times use {zone}.",
              'project.task.create': "Create task",
              'project.task.missing': "Give the task a name and instructions.",
              'project.task.next': "Next {when}",
              'project.task.paused': "Paused",
              'project.task.manage': "Manage scheduled tasks",
              'projects.search': 'Search projects',
              'projects.empty': 'No projects yet. Create one from a folder on this computer.',
              'projects.chat': '{count} chat', 'projects.chats': '{count} chats',
              'projects.updated': 'updated {ago} ago',
              'projects.addFailed': 'Could not add the project: {reason}',
              'section.mcp': 'MCP Servers', 'section.skills': 'Skills', 'tab.connectors': 'Connectors',
              'palette.title': 'Search', 'palette.placeholder': 'Search chats, artifacts, projects and actions',
              'palette.filter': 'Filter results', 'palette.all': 'All', 'palette.recents': 'Recents', 'palette.actions': 'Actions',
              'palette.goTo': 'Go to {page}', 'palette.nothing': 'Nothing here yet', 'palette.noResults': 'No results for “{query}”',
              'palette.navigate': 'Navigate', 'palette.open': 'Open', 'palette.close': 'Close',
              'palette.commands': 'Commands', 'palette.settings': 'Settings', 'palette.quickOpen': 'Quick open', 'palette.commandPalette': 'Command palette', 'palette.commandsPlaceholder': 'Search actions and settings',
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
              'createSkill.prompt': '创建一个技能，用于', 'createConnector.prompt': '把 Jan 连接到 ',
              'projects.lede': '每个项目对应一个文件夹，在其中开始的对话可以读写该文件夹的文件。',
              'project.back': "返回项目",
              'project.missing': "该项目已不在 Jan 中。",
              'project.newSession': "在{name}中新建会话",
              'project.composerHint': "按 Enter 在此项目中开始会话，Shift+Enter 换行。",
              'project.start': "开始会话",
              'project.recents': "最近",
              'project.noSessions': "此项目还没有会话。",
              'project.details': "项目详情",
              'project.instructions': "说明",
              'project.instructions.empty': "告诉智能体在此项目中如何工作。",
              'project.instructions.description': "此项目中的每个新会话都会先读取这些说明。",
              'project.instructions.note': "保存为项目文件夹中的 AGENTS.md，其他智能体也能读取。",
              'project.context': "上下文",
              'project.context.empty': "此文件夹中还没有文件。",
              'project.context.more': "仅显示前 300 项。",
              'project.addFiles': "添加文件",
              'project.openFolder': "打开文件夹",
              'project.memory': "记忆",
              'project.memory.empty': "智能体为此项目保存的笔记。",
              'project.memory.description': "此项目中的每个新会话在读取说明后都会读取这些私人笔记。",
              'project.memory.note': "保存为项目文件夹中的 AGENTS.local.md，请勿加入版本控制。",
              'project.scheduled': "定时任务",
              'project.scheduled.empty': "此项目中没有定时任务。",
              'project.add': "添加",
              'project.edit': "编辑",
              'project.save': "保存",
              'project.saving': "正在保存…",
              'project.cancel': "取消",
              'project.task.title': "新建定时任务",
              'project.task.description': "每次运行都会在此项目中开始一个新会话。",
              'project.task.name': "名称",
              'project.task.prompt': "说明",
              'project.task.repeat': "重复",
              'project.task.time': "时间",
              'project.task.daily': "每天",
              'project.task.weekdays': "工作日",
              'project.task.weekly': "每周的今天",
              'project.task.once': "一次",
              'project.task.note': "时间采用 {zone}。",
              'project.task.create': "创建任务",
              'project.task.missing': "请填写任务名称和说明。",
              'project.task.next': "下次 {when}",
              'project.task.paused': "已暂停",
              'project.task.manage': "管理定时任务",
              'projects.search': '搜索项目',
              'projects.empty': '还没有项目。从本机的文件夹创建一个。',
              'projects.chat': '{count} 个对话', 'projects.chats': '{count} 个对话',
              'projects.updated': '{ago}前更新',
              'section.mcp': 'MCP 服务器', 'section.skills': '技能', 'tab.connectors': '连接器',
              scheduled: '定时任务', 'palette.title': '搜索', 'palette.placeholder': '搜索对话、成果、项目和操作',
              hub: '模型', customize: '自定义',
              editSidebar: '编辑侧边栏…', 'editSidebar.title': '编辑侧边栏', 'editSidebar.done': '完成',
              'editSidebar.lede': '选择要在侧边栏中显示的项目。', 'editSidebar.close': '关闭',
              'palette.filter': '筛选结果', 'palette.all': '全部', 'palette.recents': '最近', 'palette.actions': '操作',
              'palette.goTo': '前往{page}', 'palette.nothing': '暂无内容', 'palette.noResults': '没有与“{query}”匹配的结果',
              'palette.navigate': '选择', 'palette.open': '打开', 'palette.close': '关闭',
              'palette.commands': '命令', 'palette.settings': '设置', 'palette.quickOpen': '快速打开', 'palette.commandPalette': '命令面板', 'palette.commandsPlaceholder': '搜索操作和设置',
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
              'createSkill.prompt': '次の作業用のスキルを作成してください: ', 'createConnector.prompt': 'Jan を次のサービスに接続してください: ',
              'projects.lede': '各プロジェクトはフォルダーです。その中で始めたチャットは、そのフォルダーのファイルを読み書きできます。',
              'project.back': "プロジェクトに戻る",
              'project.missing': "このプロジェクトは Jan にありません。",
              'project.newSession': "{name} で新しいセッション",
              'project.composerHint': "Enter でこのプロジェクトのセッションを開始、Shift+Enter で改行。",
              'project.start': "セッションを開始",
              'project.recents': "最近",
              'project.noSessions': "このプロジェクトにはまだセッションがありません。",
              'project.details': "プロジェクトの詳細",
              'project.instructions': "指示",
              'project.instructions.empty': "このプロジェクトでの作業方法をエージェントに伝えます。",
              'project.instructions.description': "このプロジェクトの新しいセッションは、最初にこの指示を読みます。",
              'project.instructions.note': "プロジェクトフォルダーの AGENTS.md に保存され、他のエージェントも読めます。",
              'project.context': "コンテキスト",
              'project.context.empty': "このフォルダーにはまだファイルがありません。",
              'project.context.more': "最初の 300 件を表示しています。",
              'project.addFiles': "ファイルを追加",
              'project.openFolder': "フォルダーを開く",
              'project.memory': "メモリー",
              'project.memory.empty': "このプロジェクトについてエージェントが残すメモ。",
              'project.memory.description': "このプロジェクトの新しいセッションが指示の後に読む非公開のメモです。",
              'project.memory.note': "プロジェクトフォルダーの AGENTS.local.md に保存されます。バージョン管理に含めないでください。",
              'project.scheduled': "スケジュール",
              'project.scheduled.empty': "このプロジェクトで実行されるタスクはありません。",
              'project.add': "追加",
              'project.edit': "編集",
              'project.save': "保存",
              'project.saving': "保存中…",
              'project.cancel': "キャンセル",
              'project.task.title': "新しいスケジュールタスク",
              'project.task.description': "実行のたびにこのプロジェクトで新しいセッションを開始します。",
              'project.task.name': "名前",
              'project.task.prompt': "指示",
              'project.task.repeat': "繰り返し",
              'project.task.time': "時刻",
              'project.task.daily': "毎日",
              'project.task.weekdays': "平日",
              'project.task.weekly': "毎週この曜日",
              'project.task.once': "1 回",
              'project.task.note': "時刻は {zone} です。",
              'project.task.create': "タスクを作成",
              'project.task.missing': "タスクの名前と指示を入力してください。",
              'project.task.next': "次回 {when}",
              'project.task.paused': "一時停止中",
              'project.task.manage': "スケジュールタスクを管理",
              'projects.search': 'プロジェクトを検索',
              'projects.empty': 'プロジェクトはまだありません。このコンピューター上のフォルダーから作成してください。',
              'projects.chat': '{count} 件のチャット', 'projects.chats': '{count} 件のチャット',
              'projects.updated': '{ago}前に更新',
              'section.mcp': 'MCP サーバー', 'section.skills': 'スキル', 'tab.connectors': 'コネクタ',
              scheduled: 'スケジュール', 'palette.title': '検索', 'palette.placeholder': 'チャット、成果物、プロジェクト、操作を検索',
              hub: 'モデル', customize: 'カスタマイズ',
              editSidebar: 'サイドバーを編集…', 'editSidebar.title': 'サイドバーを編集', 'editSidebar.done': '完了',
              'editSidebar.lede': 'サイドバーに表示する項目を選びます。', 'editSidebar.close': '閉じる',
              'palette.filter': '結果を絞り込む', 'palette.all': 'すべて', 'palette.recents': '最近', 'palette.actions': '操作',
              'palette.goTo': '{page}へ移動', 'palette.nothing': 'まだ何もありません', 'palette.noResults': '「{query}」に一致する結果はありません',
              'palette.navigate': '移動', 'palette.open': '開く', 'palette.close': '閉じる',
              'palette.commands': 'コマンド', 'palette.settings': '設定', 'palette.quickOpen': 'クイックオープン', 'palette.commandPalette': 'コマンドパレット', 'palette.commandsPlaceholder': '操作と設定を検索',
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
              'createSkill.prompt': 'Crea una habilidad que ', 'createConnector.prompt': 'Conecta Jan a ',
              'projects.lede': 'Cada proyecto es una carpeta. Los chats iniciados en él pueden leer y escribir sus archivos.',
              'project.back': "Volver a proyectos",
              'project.missing': "Este proyecto ya no está en Jan.",
              'project.newSession': "Nueva sesión en {name}",
              'project.composerHint': "Enter inicia una sesión en este proyecto. Mayús+Enter añade una línea.",
              'project.start': "Iniciar sesión",
              'project.recents': "Recientes",
              'project.noSessions': "Este proyecto todavía no tiene sesiones.",
              'project.details': "Detalles del proyecto",
              'project.instructions': "Instrucciones",
              'project.instructions.empty': "Indica al agente cómo trabajar en este proyecto.",
              'project.instructions.description': "Cada sesión nueva de este proyecto lee primero estas instrucciones.",
              'project.instructions.note': "Se guardan como AGENTS.md en la carpeta del proyecto, donde otros agentes también pueden leerlas.",
              'project.context': "Contexto",
              'project.context.empty': "Esta carpeta todavía no tiene archivos.",
              'project.context.more': "Se muestran los primeros 300 elementos.",
              'project.addFiles': "Añadir archivos",
              'project.openFolder': "Abrir carpeta",
              'project.memory': "Memoria",
              'project.memory.empty': "Notas que el agente guarda sobre este proyecto.",
              'project.memory.description': "Notas privadas que cada sesión nueva de este proyecto lee después de sus instrucciones.",
              'project.memory.note': "Se guardan como AGENTS.local.md en la carpeta del proyecto. Déjalas fuera del control de versiones.",
              'project.scheduled': "Programadas",
              'project.scheduled.empty': "No hay tareas programadas en este proyecto.",
              'project.add': "Añadir",
              'project.edit': "Editar",
              'project.save': "Guardar",
              'project.saving': "Guardando…",
              'project.cancel': "Cancelar",
              'project.task.title': "Nueva tarea programada",
              'project.task.description': "Cada ejecución inicia una sesión nueva en este proyecto.",
              'project.task.name': "Nombre",
              'project.task.prompt': "Instrucciones",
              'project.task.repeat': "Repetir",
              'project.task.time': "Hora",
              'project.task.daily': "Todos los días",
              'project.task.weekdays': "Días laborables",
              'project.task.weekly': "Cada semana este día",
              'project.task.once': "Una vez",
              'project.task.note': "Las horas usan {zone}.",
              'project.task.create': "Crear tarea",
              'project.task.missing': "Pon un nombre y unas instrucciones a la tarea.",
              'project.task.next': "Siguiente: {when}",
              'project.task.paused': "En pausa",
              'project.task.manage': "Gestionar tareas programadas",
              'projects.search': 'Buscar proyectos',
              'projects.empty': 'Aún no hay proyectos. Crea uno a partir de una carpeta de este equipo.',
              'projects.chat': '{count} chat', 'projects.chats': '{count} chats',
              'projects.updated': 'actualizado hace {ago}',
              'section.mcp': 'Servidores MCP', 'section.skills': 'Habilidades', 'tab.connectors': 'Conectores',
              scheduled: 'Programadas', 'palette.title': 'Buscar', 'palette.placeholder': 'Buscar chats, artefactos, proyectos y acciones',
              hub: 'Modelos', customize: 'Personalizar',
              editSidebar: 'Editar barra lateral…', 'editSidebar.title': 'Editar barra lateral', 'editSidebar.done': 'Listo',
              'editSidebar.lede': 'Elige qué elementos aparecen en la barra lateral.', 'editSidebar.close': 'Cerrar',
              'palette.filter': 'Filtrar resultados', 'palette.all': 'Todo', 'palette.recents': 'Recientes', 'palette.actions': 'Acciones',
              'palette.goTo': 'Ir a {page}', 'palette.nothing': 'Todavía no hay nada', 'palette.noResults': 'No hay resultados para “{query}”',
              'palette.navigate': 'Navegar', 'palette.open': 'Abrir', 'palette.close': 'Cerrar',
              'palette.commands': 'Comandos', 'palette.settings': 'Configuración', 'palette.quickOpen': 'Apertura rápida', 'palette.commandPalette': 'Paleta de comandos', 'palette.commandsPlaceholder': 'Buscar acciones y configuración',
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
              'createSkill.prompt': 'Crée une compétence qui ', 'createConnector.prompt': 'Connecte Jan à ',
              'projects.lede': 'Chaque projet est un dossier. Les discussions qui y sont lancées peuvent lire et écrire ses fichiers.',
              'project.back': "Retour aux projets",
              'project.missing': "Ce projet n'est plus dans Jan.",
              'project.newSession': "Nouvelle séance dans {name}",
              'project.composerHint': "Entrée lance une séance dans ce projet. Maj+Entrée ajoute une ligne.",
              'project.start': "Lancer la séance",
              'project.recents': "Récents",
              'project.noSessions': "Ce projet n'a pas encore de séance.",
              'project.details': "Détails du projet",
              'project.instructions': "Instructions",
              'project.instructions.empty': "Expliquez à l'agent comment travailler dans ce projet.",
              'project.instructions.description': "Chaque nouvelle séance de ce projet lit d’abord ces instructions.",
              'project.instructions.note': "Enregistrées dans AGENTS.md dans le dossier du projet, que d'autres agents peuvent aussi lire.",
              'project.context': "Contexte",
              'project.context.empty': "Ce dossier n'a pas encore de fichiers.",
              'project.context.more': "Les 300 premiers éléments sont affichés.",
              'project.addFiles': "Ajouter des fichiers",
              'project.openFolder': "Ouvrir le dossier",
              'project.memory': "Mémoire",
              'project.memory.empty': "Notes que l'agent garde sur ce projet.",
              'project.memory.description': "Notes privées que chaque nouvelle séance de ce projet lit après ses instructions.",
              'project.memory.note': "Enregistrées dans AGENTS.local.md dans le dossier du projet. Gardez-les hors du contrôle de version.",
              'project.scheduled': "Planifiées",
              'project.scheduled.empty': "Aucune tâche planifiée dans ce projet.",
              'project.add': "Ajouter",
              'project.edit': "Modifier",
              'project.save': "Enregistrer",
              'project.saving': "Enregistrement…",
              'project.cancel': "Annuler",
              'project.task.title': "Nouvelle tâche planifiée",
              'project.task.description': "Chaque exécution lance une nouvelle séance dans ce projet.",
              'project.task.name': "Nom",
              'project.task.prompt': "Instructions",
              'project.task.repeat': "Répéter",
              'project.task.time': "Heure",
              'project.task.daily': "Tous les jours",
              'project.task.weekdays': "Jours ouvrés",
              'project.task.weekly': "Chaque semaine ce jour-ci",
              'project.task.once': "Une fois",
              'project.task.note': "Les heures suivent {zone}.",
              'project.task.create': "Créer la tâche",
              'project.task.missing': "Donnez un nom et des instructions à la tâche.",
              'project.task.next': "Prochaine : {when}",
              'project.task.paused': "En pause",
              'project.task.manage': "Gérer les tâches planifiées",
              'projects.search': 'Rechercher des projets',
              'projects.empty': 'Aucun projet pour le moment. Créez-en un à partir d’un dossier de cet ordinateur.',
              'projects.chat': '{count} discussion', 'projects.chats': '{count} discussions',
              'projects.updated': 'mis à jour il y a {ago}',
              'section.mcp': 'Serveurs MCP', 'section.skills': 'Compétences', 'tab.connectors': 'Connecteurs',
              scheduled: 'Planifiées', 'palette.title': 'Rechercher', 'palette.placeholder': 'Rechercher des discussions, artefacts, projets et actions',
              hub: 'Modèles', customize: 'Personnaliser',
              editSidebar: 'Modifier la barre latérale…', 'editSidebar.title': 'Modifier la barre latérale', 'editSidebar.done': 'Terminé',
              'editSidebar.lede': 'Choisissez les éléments affichés dans la barre latérale.', 'editSidebar.close': 'Fermer',
              'palette.filter': 'Filtrer les résultats', 'palette.all': 'Tout', 'palette.recents': 'Récents', 'palette.actions': 'Actions',
              'palette.goTo': 'Aller à {page}', 'palette.nothing': 'Rien pour le moment', 'palette.noResults': 'Aucun résultat pour « {query} »',
              'palette.navigate': 'Naviguer', 'palette.open': 'Ouvrir', 'palette.close': 'Fermer',
              'palette.commands': 'Commandes', 'palette.settings': 'Paramètres', 'palette.quickOpen': 'Ouverture rapide', 'palette.commandPalette': 'Palette de commandes', 'palette.commandsPlaceholder': 'Rechercher des actions et des paramètres',
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
              'createSkill.prompt': 'Erstelle einen Skill, der ', 'createConnector.prompt': 'Verbinde Jan mit ',
              'projects.lede': 'Jedes Projekt ist ein Ordner. Darin gestartete Chats können seine Dateien lesen und schreiben.',
              'project.back': "Zurück zu Projekten",
              'project.missing': "Dieses Projekt ist nicht mehr in Jan.",
              'project.newSession': "Neue Sitzung in {name}",
              'project.composerHint': "Eingabe startet eine Sitzung in diesem Projekt. Umschalt+Eingabe fügt eine Zeile ein.",
              'project.start': "Sitzung starten",
              'project.recents': "Zuletzt",
              'project.noSessions': "Dieses Projekt hat noch keine Sitzungen.",
              'project.details': "Projektdetails",
              'project.instructions': "Anweisungen",
              'project.instructions.empty': "Sag dem Agenten, wie er in diesem Projekt arbeiten soll.",
              'project.instructions.description': "Jede neue Sitzung in diesem Projekt liest zuerst diese Anweisungen.",
              'project.instructions.note': "Gespeichert als AGENTS.md im Projektordner, wo auch andere Agenten sie lesen können.",
              'project.context': "Kontext",
              'project.context.empty': "Dieser Ordner enthält noch keine Dateien.",
              'project.context.more': "Die ersten 300 Einträge werden angezeigt.",
              'project.addFiles': "Dateien hinzufügen",
              'project.openFolder': "Ordner öffnen",
              'project.memory': "Gedächtnis",
              'project.memory.empty': "Notizen, die der Agent zu diesem Projekt führt.",
              'project.memory.description': "Private Notizen, die jede neue Sitzung in diesem Projekt nach den Anweisungen liest.",
              'project.memory.note': "Gespeichert als AGENTS.local.md im Projektordner. Nicht in die Versionsverwaltung aufnehmen.",
              'project.scheduled': "Geplant",
              'project.scheduled.empty': "In diesem Projekt laufen keine geplanten Aufgaben.",
              'project.add': "Hinzufügen",
              'project.edit': "Bearbeiten",
              'project.save': "Speichern",
              'project.saving': "Wird gespeichert…",
              'project.cancel': "Abbrechen",
              'project.task.title': "Neue geplante Aufgabe",
              'project.task.description': "Jeder Lauf startet eine neue Sitzung in diesem Projekt.",
              'project.task.name': "Name",
              'project.task.prompt': "Anweisungen",
              'project.task.repeat': "Wiederholen",
              'project.task.time': "Uhrzeit",
              'project.task.daily': "Jeden Tag",
              'project.task.weekdays': "Werktags",
              'project.task.weekly': "Jede Woche an diesem Wochentag",
              'project.task.once': "Einmal",
              'project.task.note': "Uhrzeiten gelten in {zone}.",
              'project.task.create': "Aufgabe erstellen",
              'project.task.missing': "Gib der Aufgabe einen Namen und Anweisungen.",
              'project.task.next': "Nächste: {when}",
              'project.task.paused': "Pausiert",
              'project.task.manage': "Geplante Aufgaben verwalten",
              'projects.search': 'Projekte suchen',
              'projects.empty': 'Noch keine Projekte. Erstelle eines aus einem Ordner auf diesem Computer.',
              'projects.chat': '{count} Chat', 'projects.chats': '{count} Chats',
              'projects.updated': 'vor {ago} aktualisiert',
              'section.mcp': 'MCP-Server', 'section.skills': 'Skills', 'tab.connectors': 'Konnektoren',
              scheduled: 'Geplant', 'palette.title': 'Suchen', 'palette.placeholder': 'Chats, Artefakte, Projekte und Aktionen suchen',
              hub: 'Modelle', customize: 'Anpassen',
              editSidebar: 'Seitenleiste bearbeiten…', 'editSidebar.title': 'Seitenleiste bearbeiten', 'editSidebar.done': 'Fertig',
              'editSidebar.lede': 'Wähle, welche Elemente in der Seitenleiste erscheinen.', 'editSidebar.close': 'Schließen',
              'palette.filter': 'Ergebnisse filtern', 'palette.all': 'Alle', 'palette.recents': 'Zuletzt', 'palette.actions': 'Aktionen',
              'palette.goTo': 'Zu {page}', 'palette.nothing': 'Noch nichts vorhanden', 'palette.noResults': 'Keine Ergebnisse für „{query}“',
              'palette.navigate': 'Auswählen', 'palette.open': 'Öffnen', 'palette.close': 'Schließen',
              'palette.commands': 'Befehle', 'palette.settings': 'Einstellungen', 'palette.quickOpen': 'Schnell öffnen', 'palette.commandPalette': 'Befehlspalette', 'palette.commandsPlaceholder': 'Aktionen und Einstellungen suchen',
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
              'createSkill.prompt': 'Создай навык, который ', 'createConnector.prompt': 'Подключи Jan к ',
              'projects.lede': 'Каждый проект - это папка. Чаты, начатые в нем, могут читать и изменять ее файлы.',
              'project.back': "К проектам",
              'project.missing': "Этого проекта больше нет в Jan.",
              'project.newSession': "Новая сессия в {name}",
              'project.composerHint': "Enter начинает сессию в этом проекте, Shift+Enter добавляет строку.",
              'project.start': "Начать сессию",
              'project.recents': "Недавние",
              'project.noSessions': "В этом проекте пока нет сессий.",
              'project.details': "Сведения о проекте",
              'project.instructions': "Инструкции",
              'project.instructions.empty': "Объясните агенту, как работать в этом проекте.",
              'project.instructions.description': "Каждая новая сессия в этом проекте сначала читает эти инструкции.",
              'project.instructions.note': "Сохраняются в AGENTS.md в папке проекта, их могут читать и другие агенты.",
              'project.context': "Контекст",
              'project.context.empty': "В этой папке пока нет файлов.",
              'project.context.more': "Показаны первые 300 элементов.",
              'project.addFiles': "Добавить файлы",
              'project.openFolder': "Открыть папку",
              'project.memory': "Память",
              'project.memory.empty': "Заметки агента об этом проекте.",
              'project.memory.description': "Личные заметки, которые каждая новая сессия в этом проекте читает после инструкций.",
              'project.memory.note': "Сохраняются в AGENTS.local.md в папке проекта. Не добавляйте их в систему контроля версий.",
              'project.scheduled': "Запланированные",
              'project.scheduled.empty': "В этом проекте нет запланированных задач.",
              'project.add': "Добавить",
              'project.edit': "Изменить",
              'project.save': "Сохранить",
              'project.saving': "Сохранение…",
              'project.cancel': "Отмена",
              'project.task.title': "Новая запланированная задача",
              'project.task.description': "Каждый запуск начинает новую сессию в этом проекте.",
              'project.task.name': "Название",
              'project.task.prompt': "Инструкции",
              'project.task.repeat': "Повтор",
              'project.task.time': "Время",
              'project.task.daily': "Каждый день",
              'project.task.weekdays': "По будням",
              'project.task.weekly': "Каждую неделю в этот день",
              'project.task.once': "Один раз",
              'project.task.note': "Время указано в {zone}.",
              'project.task.create': "Создать задачу",
              'project.task.missing': "Укажите название и инструкции задачи.",
              'project.task.next': "Следующий запуск: {when}",
              'project.task.paused': "Приостановлена",
              'project.task.manage': "Управлять задачами",
              'projects.search': 'Поиск проектов',
              'projects.empty': 'Проектов пока нет. Создайте проект из папки на этом компьютере.',
              'projects.chat': 'Чатов: {count}', 'projects.chats': 'Чатов: {count}',
              'projects.updated': 'обновлено {ago} назад',
              'section.mcp': 'MCP-серверы', 'section.skills': 'Навыки', 'tab.connectors': 'Коннекторы',
              scheduled: 'Запланированные', 'palette.title': 'Поиск', 'palette.placeholder': 'Поиск чатов, артефактов, проектов и действий',
              hub: 'Модели', customize: 'Настроить',
              editSidebar: 'Изменить боковую панель…', 'editSidebar.title': 'Изменить боковую панель', 'editSidebar.done': 'Готово',
              'editSidebar.lede': 'Выберите, какие пункты показывать на боковой панели.', 'editSidebar.close': 'Закрыть',
              'palette.filter': 'Фильтр результатов', 'palette.all': 'Все', 'palette.recents': 'Недавние', 'palette.actions': 'Действия',
              'palette.goTo': 'Перейти: {page}', 'palette.nothing': 'Здесь пока пусто', 'palette.noResults': 'Нет результатов для «{query}»',
              'palette.navigate': 'Выбор', 'palette.open': 'Открыть', 'palette.close': 'Закрыть',
              'palette.commands': 'Команды', 'palette.settings': 'Настройки', 'palette.quickOpen': 'Быстрое открытие', 'palette.commandPalette': 'Палитра команд', 'palette.commandsPlaceholder': 'Поиск действий и настроек',
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
              'createSkill.prompt': 'Crie uma habilidade que ', 'createConnector.prompt': 'Conecte o Jan a ',
              'projects.lede': 'Cada projeto é uma pasta. As conversas iniciadas nele podem ler e gravar seus arquivos.',
              'project.back': "Voltar aos projetos",
              'project.missing': "Este projeto não está mais no Jan.",
              'project.newSession': "Nova sessão em {name}",
              'project.composerHint': "Enter inicia uma sessão neste projeto. Shift+Enter adiciona uma linha.",
              'project.start': "Iniciar sessão",
              'project.recents': "Recentes",
              'project.noSessions': "Este projeto ainda não tem sessões.",
              'project.details': "Detalhes do projeto",
              'project.instructions': "Instruções",
              'project.instructions.empty': "Diga ao agente como trabalhar neste projeto.",
              'project.instructions.description': "Cada nova sessão neste projeto lê estas instruções primeiro.",
              'project.instructions.note': "Salvas como AGENTS.md na pasta do projeto, onde outros agentes também podem lê-las.",
              'project.context': "Contexto",
              'project.context.empty': "Esta pasta ainda não tem arquivos.",
              'project.context.more': "Mostrando os primeiros 300 itens.",
              'project.addFiles': "Adicionar arquivos",
              'project.openFolder': "Abrir pasta",
              'project.memory': "Memória",
              'project.memory.empty': "Anotações que o agente mantém sobre este projeto.",
              'project.memory.description': "Anotações privadas que cada nova sessão neste projeto lê depois das instruções.",
              'project.memory.note': "Salvas como AGENTS.local.md na pasta do projeto. Mantenha-as fora do controle de versão.",
              'project.scheduled': "Agendadas",
              'project.scheduled.empty': "Nenhuma tarefa agendada neste projeto.",
              'project.add': "Adicionar",
              'project.edit': "Editar",
              'project.save': "Salvar",
              'project.saving': "Salvando…",
              'project.cancel': "Cancelar",
              'project.task.title': "Nova tarefa agendada",
              'project.task.description': "Cada execução inicia uma nova sessão neste projeto.",
              'project.task.name': "Nome",
              'project.task.prompt': "Instruções",
              'project.task.repeat': "Repetir",
              'project.task.time': "Horário",
              'project.task.daily': "Todos os dias",
              'project.task.weekdays': "Dias úteis",
              'project.task.weekly': "Toda semana neste dia",
              'project.task.once': "Uma vez",
              'project.task.note': "Horários em {zone}.",
              'project.task.create': "Criar tarefa",
              'project.task.missing': "Dê um nome e instruções à tarefa.",
              'project.task.next': "Próxima: {when}",
              'project.task.paused': "Pausada",
              'project.task.manage': "Gerenciar tarefas agendadas",
              'projects.search': 'Pesquisar projetos',
              'projects.empty': 'Nenhum projeto ainda. Crie um a partir de uma pasta deste computador.',
              'projects.chat': '{count} conversa', 'projects.chats': '{count} conversas',
              'projects.updated': 'atualizado há {ago}',
              'section.mcp': 'Servidores MCP', 'section.skills': 'Habilidades', 'tab.connectors': 'Conectores',
              scheduled: 'Agendadas', 'palette.title': 'Pesquisar', 'palette.placeholder': 'Pesquisar conversas, artefatos, projetos e ações',
              hub: 'Modelos', customize: 'Personalizar',
              editSidebar: 'Editar barra lateral…', 'editSidebar.title': 'Editar barra lateral', 'editSidebar.done': 'Concluído',
              'editSidebar.lede': 'Escolha quais itens aparecem na barra lateral.', 'editSidebar.close': 'Fechar',
              'palette.filter': 'Filtrar resultados', 'palette.all': 'Tudo', 'palette.recents': 'Recentes', 'palette.actions': 'Ações',
              'palette.goTo': 'Ir para {page}', 'palette.nothing': 'Nada aqui ainda', 'palette.noResults': 'Nenhum resultado para “{query}”',
              'palette.navigate': 'Navegar', 'palette.open': 'Abrir', 'palette.close': 'Fechar',
              'palette.commands': 'Comandos', 'palette.settings': 'Configurações', 'palette.quickOpen': 'Abertura rápida', 'palette.commandPalette': 'Paleta de comandos', 'palette.commandsPlaceholder': 'Pesquisar ações e configurações',
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
        let scheduleCatalog
        let scheduleCreate
        ctx.inject(['layout', 'uiWorkspace', 'workspaces', 'locale'], (scope) => {
          const mainKeyAvailable = (key) => ({
            getSnapshot: () => scope.slots.entriesOfSlot('main').some((entry) => entry.options.key === key),
            subscribe: (listener) => scope.slots.subscribe('main', listener),
          })
          // Other plugins' sidebar pages; Edit sidebar can pin them as rows too.
          let otherPanels = []
          const otherPanelsSnapshot = {
            getSnapshot: () => {
              const own = new Set(SIDEBAR_DESTINATIONS.map(({ id }) => id))
              const next = scope.slots.entriesOfSlot('sidebar.panellist')
                .filter(({ options }) => !own.has(options.id))
                .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
                .map(({ options }) => ({ id: options.id, label: (typeof options.label === 'function' ? options.label() : options.label) ?? options.id }))
              const same = next.length === otherPanels.length && next.every((panel, i) => panel.id === otherPanels[i].id && panel.label === otherPanels[i].label)
              if (!same) otherPanels = next
              return otherPanels
            },
            subscribe: (listener) => {
              const offSlots = scope.slots.subscribe('sidebar.panellist', listener)
              const offLocale = scope.locale.subscribe(listener)
              return () => { offSlots(); offLocale() }
            },
          }
          const t = scope.locale.bind('jan-theme')
          const startDraft = (prompt, agentPreset) => {
            scope.layout.selectPanel(null)
            scope.uiWorkspace.startSession(undefined, {
              prompt, whenDraftExists: 'append', ...agentPreset === undefined ? {} : { agentPreset },
            })
          }
          // Creator mode mounts the create-* skills; the leading `/name` attaches the matching one.
          const startCreator = (skill, key) => { startDraft(`/${skill} ${t(key)}`, 'cordis') }
          // Customize groups Plugins, Skills and Connectors as tabs of one page, as Settings keeps them as sections.
          scope.slots.inject('plugins.tab', () => scope.slots.register({ name: 'plugins.tab', id: 'jt-skills', order: 10, label: () => t('section.skills'), locale: 'jan-theme' }, () => h('div', { className: 'jt-customize-tab' }, h(AgentSettings, { skills: true, key: 'skills', onCreate: () => startCreator('create-skill', 'createSkill.prompt') }))))
          scope.slots.inject('plugins.tab', () => scope.slots.register({ name: 'plugins.tab', id: 'jt-connectors', order: 11, label: () => t('tab.connectors'), locale: 'jan-theme' }, () => h('div', { className: 'jt-customize-tab' }, h(AgentSettings, { key: 'mcp', onCreate: () => startCreator('create-connector', 'createConnector.prompt') }))))
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
                hubAvailable: mainKeyAvailable(HUB_PANEL),
                otherPanels: otherPanelsSnapshot,
              },
              openPanel: (id) => scope.layout.selectPanel(id),
              addProject,
              newChat: () => { startDraft(t('newArtifact.prompt')) },
              // Same draft the stock More menu's "Create your plugin" starts.
              createPlugin: () => { startCreator('create-plugin', 'createPlugin.prompt') },
            }),
          }, WorkspaceActions))
          // The More menu's real panel destinations. Registering it also keeps
          // the More trigger present, so no launcher row is hidden without a
          // reachable menu entry.
          scope.slots.inject('sidebar.panellist.actions', () => scope.slots.register({
            name: 'sidebar.panellist.actions', id: 'jt-panel-destinations', order: -100, locale: 'jan-theme',
            inject: () => ({
              hooks: {
                panelInfo: scope.layout.panelInfo,
                pluginsAvailable: mainKeyAvailable('plugins'),
                artifactsAvailable: mainKeyAvailable(ARTIFACTS_PANEL),
                scheduledAvailable: mainKeyAvailable(SCHEDULED_PANEL),
                hubAvailable: mainKeyAvailable(HUB_PANEL),
              },
              openPanel: (id) => scope.layout.selectPanel(id),
            }),
          }, PanelDestinations))
          const openProject = (workspaceId) => {
            currentProject.set(workspaceId)
            scope.layout.selectPanel(PROJECT_PANEL)
          }
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PROJECTS_PANEL, locale: 'jan-theme',
            inject: () => ({
              hooks: { workspaces: scope.workspaces.list },
              openProject: (workspaceId) => { if (scope.uiWorkspace.openProjectSurface?.(workspaceId) !== true) openProject(workspaceId) },
              addProject,
            }),
          }, ProjectsPanel))
          // An older ui-workspace keeps the row click as expand and collapse.
          if (typeof scope.uiWorkspace.registerProjectHandler === 'function') {
            scope.effect(() => scope.uiWorkspace.registerProjectHandler(openProject, PROJECT_PANEL), 'jan-theme: project home')
          }
        })
        ctx.inject(['layout', 'uiWorkspace', 'workspaces', 'sessions', 'locale'], (scope) => {
          const archived = {
            getSnapshot: () => scope.workspaces.list.getSnapshot().archivedSessionIds,
            subscribe: (listener) => scope.workspaces.list.subscribe(listener),
          }
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PROJECT_PANEL, locale: 'jan-theme',
            inject: () => ({
              hooks: { project: currentProject, workspaces: scope.workspaces.list, archived, sessions: scope.sessions.list },
              // The typed text becomes the new Session's draft and is sent from there,
              // so the Session's own composer owns attachments, commands and send checks.
              startSession: (workspaceId, text) => {
                scope.layout.selectPanel(null)
                scope.uiWorkspace.startSession(workspaceId, { prompt: text, whenDraftExists: 'append' })
              },
              openChat: (sessionId) => {
                scope.layout.selectPanel(null)
                scope.uiWorkspace.openSession(sessionId)
              },
              backToProjects: () => { scope.layout.selectPanel(PROJECTS_PANEL) },
              openScheduled: () => { scope.layout.selectPanel(SCHEDULED_PANEL) },
              loadSchedules: () => {
                const read = scheduleCatalog
                return read === undefined ? undefined : Promise.resolve().then(read)
              },
              createSchedule: async (request) => {
                const create = scheduleCreate
                if (create === undefined) throw new Error('Scheduled tasks are not available.')
                const result = await create(request)
                if (!result.ok) throw new Error(result.error.message)
                return result.value
              },
            }),
          }, ProjectHome))
        })
        // Scheduled tasks join the palette and project pages only while the schedule namespace exists.
        ctx.inject(['remote', 'remote.schedule'], (scope) => {
          scheduleCatalog = () => scope.remote.schedule.catalog()
          scheduleCreate = (request) => scope.remote.schedule.create(request)
          scope.effect(() => () => { scheduleCatalog = undefined; scheduleCreate = undefined }, 'jan-theme: schedule source')
        })
        let settingsNavigation
        ctx.inject(['settingsNavigation'], (scope) => {
          settingsNavigation = scope.settingsNavigation
          scope.effect(() => () => { settingsNavigation = undefined }, 'jan-theme: settings search target')
        })
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'jt-startup-notices' }, () => h(StartupNotices, {
          openSettings: (section) => {
            if (settingsNavigation?.open(section) !== true) console.warn(`jan-theme: settings section ${section} is unavailable`)
          },
        })))
        ctx.inject(['layout', 'uiWorkspace', 'workspaces', 'sessions', 'shortcuts', 'locale'], (scope) => {
          // An older ui-workspace keeps its own sidebar search field.
          if (typeof scope.uiWorkspace.registerSearchHandler !== 'function') return
          const mainKeyAvailable = (key) => ({
            getSnapshot: () => scope.slots.entriesOfSlot('main').some((entry) => entry.options.key === key),
            subscribe: (listener) => scope.slots.subscribe('main', listener),
          })
          const closePalette = () => { palette.set(false) }
          scope.effect(() => scope.uiWorkspace.registerSearchHandler(() => { palette.set(true) }), 'jan-theme: universal search')
          scope.effect(() => closePalette, 'jan-theme: close search on unload')
          // VS Code's pair: Mod+P quick-opens anything, Mod+Shift+P lists commands and settings.
          // Browsers keep Mod+P for printing and Web already gives Mod+Alt+P to Files, so Quick open is desktop-only.
          const paletteCommand = (id, kind, label, aliases, desktop, web) => scope.effect(() => scope.shortcuts.register({
            id, label: () => t(label), aliases,
            defaults: Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows']
              .filter(profile => profile.startsWith('desktop') || web !== undefined)
              .map(profile => [profile, { code: 'KeyP', modifiers: profile.startsWith('desktop') ? desktop : web }])),
            regions: ['page', 'editable', 'terminal'], modals: ['search', 'sidebar'],
            resolve: () => ({ status: 'handled', run: () => { palette.set(true, kind) } }),
          }), `jan-theme: ${id}`)
          const t = scope.locale.bind('jan-theme')
          paletteCommand('search.quickOpen', 'all', 'palette.quickOpen', ['quick open', 'go to file', 'search everything'], ['primary'])
          paletteCommand('search.commands', 'commands', 'palette.commandPalette', ['command palette', 'show all commands', 'settings'], ['primary', 'shift'], ['primary', 'shift'])
          // Settings sections and General rows, read from their live slot registrations.
          const labelOf = (entry) => typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label
          let settingsCache
          const settingsTargets = {
            getSnapshot: () => {
              if (settingsCache !== undefined) return settingsCache
              const sections = scope.slots.entriesOfSlot('settings.section').filter(entry => entry.options.id !== undefined)
              const general = sections.find(entry => entry.options.id === 'general')
              const humanize = (id) => id.replace(/[-_.]/g, ' ').replace(/^./, c => c.toUpperCase())
              settingsCache = [
                ...sections.map(entry => {
                  const title = labelOf(entry) ?? humanize(entry.options.id)
                  return { section: entry.options.id, id: entry.options.id, title, sectionTitle: title }
                }),
                ...(general === undefined ? [] : scope.slots.entriesOfSlot('settings.general.item')
                  .filter(entry => entry.options.id !== undefined)
                  .map(entry => ({ section: 'general', id: entry.options.id, title: labelOf(entry) ?? humanize(entry.options.id), sectionTitle: labelOf(general) ?? 'General' }))),
              ]
              return settingsCache
            },
            subscribe: (listener) => {
              const changed = () => { settingsCache = undefined; listener() }
              const stops = [
                scope.slots.subscribe('settings.section', changed),
                scope.slots.subscribe('settings.general.item', changed),
                scope.locale.subscribe(changed),
              ]
              return () => { for (const stop of stops) stop() }
            },
          }
          scope.slots.inject('shell.overlay', () => scope.slots.register({
            name: 'shell.overlay', id: 'jt-search-palette', locale: 'jan-theme',
            inject: () => ({
              hooks: {
                palette,
                sessions: scope.sessions.list,
                workspaces: scope.workspaces.list,
                catalog: scope.shortcuts.catalog,
                artifactsAvailable: mainKeyAvailable(ARTIFACTS_PANEL),
                scheduledAvailable: mainKeyAvailable(SCHEDULED_PANEL),
                hubAvailable: mainKeyAvailable(HUB_PANEL),
                pluginsAvailable: mainKeyAvailable('plugins'),
                settingsTargets,
              },
              closePalette,
              openSettings: (section) => {
                if (settingsNavigation?.open(section) !== true) console.warn(`jan-theme: settings section ${section} is unavailable`)
              },
              // Read on each open: the catalog is small and changes outside this window.
              loadSchedules: () => {
                const read = scheduleCatalog
                return read === undefined ? undefined : Promise.resolve().then(read)
              },
              openChat: (sessionId) => {
                scope.layout.selectPanel(null)
                scope.uiWorkspace.openSession(sessionId)
              },
              openProject: (workspaceId) => {
                scope.layout.selectPanel(null)
                scope.uiWorkspace.startSession(workspaceId)
              },
              openArtifact: (sessionId, seq, index) => {
                const query = new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })
                fetch(`api/present.open?${query}`, { method: 'POST' }).then((response) => {
                  if (response.ok) return
                  console.warn(`jan-theme: artifact open failed (${response.status}); showing its chat`)
                  scope.layout.selectPanel(null)
                  scope.uiWorkspace.openSession(sessionId)
                }, (error) => { console.warn('jan-theme: artifact open failed', error) })
              },
              openPanel: (id) => { scope.layout.selectPanel(id) },
              runCommand: (id) => {
                scope.shortcuts.invoke(id, { target: document.activeElement, region: 'page', modal: null, source: 'menu' })
              },
            }),
          }, SearchPalette))
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
