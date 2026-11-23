window.__ModuleLoader__.load({
  id: '@janhq/jan-legacy-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Checkbox, IconCloseOutlineRegular, NotificationPortal } = require('@janhq/jan-client-ui-primitives')
    async function api(method, params = {}) {
      const response = await fetch(new URL('jan-api/legacy-import', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }
    const RECENT_DAYS = 30
    const SOURCES = [['jan', 'Jan'], ['orca', 'Orca'], ['claude', 'Claude Code'], ['codex', 'Codex'], ['omp', 'OMP']]
    const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', omp: 'OMP' }
    const sourceName = source => SOURCES.find(([key]) => key === source)[1]
    const sizeOf = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
    const projectOf = path => String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
    const listOf = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    // One line that says what the last run did, from its per-chat results.
    function summaryOf(results) {
      if (!results.length) return 'Settings brought over - each one lists what happened'
      const count = status => results.filter(result => result.status === status).length
      const parts = [`Imported ${plural(count('imported'), 'chat', 'chats')}`]
      if (count('already imported')) parts.push(`${count('already imported')} already here`)
      if (count('skipped')) parts.push(`${count('skipped')} empty skipped`)
      if (count('failed')) parts.push(`${count('failed')} failed - see the chat list`)
      return parts.join(' · ')
    }
    const NO_EXTRAS = { providers: false, mcp: false, assistants: false }
    const anyExtra = extras => extras.providers || extras.mcp || extras.assistants
    const importLabel = (count, extras) => count && anyExtra(extras) ? `Import ${plural(count, 'chat', 'chats')} and settings`
      : count ? `Import ${plural(count, 'chat', 'chats')}` : anyExtra(extras) ? 'Import settings' : 'Nothing to import'
    const importable = thread => !thread.error && !thread.alreadyImported && thread.messageCount !== 0
    const shortDate = time => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    // State and actions of one import view; the Host owns the run itself.
    // Imported sessions bypass live creation, so the Chats list learns of them
    // only through a fresh baseline pull.
    function useJanImport(refreshSessions) {
      const [source, setSource] = React.useState('jan')
      const [folder, setFolder] = React.useState('')
      const [listedFolder, setListedFolder] = React.useState('')
      const [threads, setThreads] = React.useState([])
      const [selected, setSelected] = React.useState(new Set())
      const [results, setResults] = React.useState({})
      const [scanning, setScanning] = React.useState(false)
      // The Host's import run: { running, total, done, current, results }.
      const [job, setJob] = React.useState(null)
      const [error, setError] = React.useState('')
      const [missing, setMissing] = React.useState(false)
      // Agent lists start with the last 30 days; listing every session reads every file.
      const [allTime, setAllTime] = React.useState(false)
      const [older, setOlder] = React.useState(0)
      // How many workspaces Orca reported, shown in place of a folder for the Orca source.
      const [orcaWorkspaces, setOrcaWorkspaces] = React.useState(undefined)
      // Jan's providers, MCP servers and assistants, which ones to bring, and what the last run did with them.
      const [janSettings, setJanSettings] = React.useState(null)
      const [extras, setExtras] = React.useState(NO_EXTRAS)
      const [settingsResults, setSettingsResults] = React.useState(null)
      const importing = job?.running === true
      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])
      const showResults = list => setResults(Object.fromEntries(list.map(result => [result.id, result])))
      // A finished run's sessions stop being selectable, whichever view started it.
      const settle = results => {
        const done = new Set(results.filter(result => result.status !== 'failed').map(result => result.id))
        setThreads(previous => previous.map(thread => done.has(thread.id) ? { ...thread, alreadyImported: true } : thread))
        setSelected(previous => new Set([...previous].filter(id => !done.has(id))))
      }
      // Polls the Host until its run ends, so the bar also resumes when the
      // page is reopened mid-import. The Chats list refreshes every few
      // imported sessions, so new rows appear while the run continues.
      // With `run`, only that run's progress counts: a request refused before it starts leaves the
      // previous run's job on the Host, which must not stand in for this one.
      const follow = async (run) => {
        let shown = 0
        for (; ;) {
          const polled = await api('progress')
          if (!alive.current) return null
          const value = run === undefined || polled?.runId === run.id ? polled : null
          if (value === null && run !== undefined) {
            if (run.settled) return null
            await new Promise(resolve => setTimeout(resolve, 300))
            continue
          }
          setJob(value)
          if (value) showResults(value.results)
          const imported = value?.results.filter(result => result.status === 'imported').length ?? 0
          if (value?.running && imported >= shown + 5) { shown = imported; refreshSessions().catch(() => { }) }
          if (!value?.running) return value
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
      // Only the latest scan may write: choosing another source while one is still reading must not let the slower reply win.
      const latestScan = React.useRef(0)
      const scan = async (next = source, nextFolder = folder, everything = allTime) => {
        const mine = ++latestScan.current
        setScanning(true); setError('')
        try {
          const value = await api('list', { source: next, folder: nextFolder, ...(next === 'jan' || everything ? {} : { since: Date.now() - RECENT_DAYS * 86400000 }) })
          if (mine !== latestScan.current || !alive.current) return
          setFolder(value.folder); setListedFolder(value.folder); setOrcaWorkspaces(value.workspaces); setThreads(value.threads); setResults({}); setMissing(value.missing === true); setOlder(value.older ?? 0)
          // Moving from Jan means bringing everything. A coding agent keeps months of sessions, so the person picks.
          setSelected(new Set(next === 'jan' ? value.threads.filter(importable).map(thread => thread.id) : []))
          setJanSettings(value.settings ? { ...value.settings, scanId: value.scanId } : null); setSettingsResults(null)
          setExtras(value.settings ? { providers: value.settings.providers.length > 0, mcp: value.settings.mcp.names.length > 0, assistants: value.settings.assistants.some(item => !item.alreadyImported) } : NO_EXTRAS)
        } catch (error) { if (mine === latestScan.current) setError(error.message) } finally { if (mine === latestScan.current) setScanning(false) }
      }
      React.useEffect(() => {
        scan().then(async () => {
          const value = await api('progress')
          if (value?.running) { setJob(value); const last = await follow(); if (last) settle(last.results); await refreshSessions() }
        }).catch(error => setError(error.message))
      }, [])
      const importSelected = async () => {
        const ids = [...selected]
        const chosen = source === 'jan' ? extras : NO_EXTRAS
        setError(''); setResults({}); setSettingsResults(null)
        setJob({ running: true, total: ids.length, done: 0, current: chosen.mcp ? 'MCP servers' : null, results: [] })
        // Not crypto.randomUUID: a device reaching this Host over plain LAN HTTP is not a secure context.
        const run = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, settled: false }
        const request = api('import', { source, folder: listedFolder, ids, ...chosen, ...(chosen.mcp ? { scanId: janSettings?.scanId } : {}), runId: run.id })
        void request.finally(() => { run.settled = true }).catch(() => { })
        // Start polling only after the Host has the request, so the first read is this run.
        await new Promise(resolve => setTimeout(resolve, 100))
        const [outcome, followed] = await Promise.allSettled([request, follow(run)])
        if (outcome.status === 'rejected') {
          // A long run can outlive the request while the Host finishes it; its last progress still lists what landed.
          const last = followed.status === 'fulfilled' ? followed.value : null
          // A run the Host refused before starting has no progress: drop the optimistic job so the form is free again.
          setJob(last)
          if (last?.results.length) {
            settle(last.results)
            if (last.results.some(result => result.status === 'imported')) await refreshSessions()
          }
          if (!last?.results.length || last.error) setError(last?.error ?? outcome.reason.message)
        } else {
          showResults(outcome.value.results)
          setJob(previous => ({ ...(previous ?? {}), running: false, results: outcome.value.results }))
          setSettingsResults(outcome.value.settings); setExtras(NO_EXTRAS)
          setJanSettings(previous => previous && { ...previous, assistants: previous.assistants.map(item => ({ ...item, alreadyImported: item.alreadyImported || outcome.value.settings.assistants.some(row => row.id === item.id && row.status !== 'failed') })) })
          settle(outcome.value.results)
          if (outcome.value.results.some(result => result.status === 'imported')) await refreshSessions()
        }
      }
      const eligible = threads.filter(importable)
      return {
        source, setSource, setJob, missing, allTime, setAllTime, older, orcaWorkspaces, folder, setFolder, listedFolder, threads, selected, setSelected, results, scanning, job, error, importing,
        janSettings, extras, setExtras, settingsResults, canImport: selected.size > 0 || anyExtra(extras),
        busy: scanning || importing, stale: folder !== listedFolder, eligible, scan, importSelected,
      }
    }
    function ImportProgress({ state: { job, importing } }) {
      if (!job) return null
      const percent = job.total ? Math.round(job.done / job.total * 100) : 0
      return h('div', { className: 'jan-legacy-import-progress' },
        h('progress', { max: job.total || 1, value: job.done, 'aria-label': 'Import progress' }),
        h('p', { role: 'status', 'aria-live': 'polite' }, importing
          ? `Importing item ${Math.min(job.done + 1, job.total)} of ${job.total} (${percent}%)${job.current ? ` · ${job.current}` : ''}`
          : summaryOf(job.results ?? [])))
    }
    function SelectAll({ state: { busy, stale, eligible, selected, setSelected } }) {
      return h(Checkbox, { label: 'Select all chats', disabled: busy || stale || !eligible.length, checked: eligible.length > 0 && eligible.every(thread => selected.has(thread.id)), onChange: checked => setSelected(new Set(checked ? eligible.map(thread => thread.id) : [])) })
    }
    // The chats come first: a heading with the selection count, then one row per chat.
    function ChatList({ state }) {
      const { threads, selected, eligible, job, importing } = state
      // Done only when no chat is left to bring; a chat left unticked keeps the choice open.
      const settled = job && !importing && !eligible.length
      const rows = h(ThreadRows, { state })
      return h('section', { className: 'jan-legacy-import-group', 'aria-labelledby': 'jan-legacy-import-chats' },
        h('div', { className: 'jan-legacy-import-list-head' },
          h('h3', { id: 'jan-legacy-import-chats' }, `${state.source === 'jan' ? 'Chats' : 'Sessions'} (${threads.length})`),
          h('span', null, settled ? 'All imported' : `${selected.size} of ${eligible.length} selected`)),
        settled ? null : h(SelectAll, { state }),
        rows)
    }
    // What an import keeps and leaves behind, folded so it does not crowd the choices.
    const WhatComesOver = ({ source }) => h('details', { className: 'jan-legacy-import-detail' },
      h('summary', null, 'What comes over'),
      h('p', null, source === 'jan' ? BRINGS : AGENT_BRINGS))
    // One row per Jan thread: title and checkbox, then what it is and when, then
    // its import state and anything it could not bring.
    function ThreadRows({ state: { threads, results, selected, setSelected, busy, stale } }) {
      const stateOf = thread => {
        const result = results[thread.id]
        if (result) return result.status === 'imported' ? 'Imported' : result.status === 'already imported' ? 'Already imported' : result.status === 'skipped' ? 'Empty chat, nothing to import' : `Could not import: ${result.reason}`
        if (thread.error) return `Could not read: ${thread.error}`
        if (thread.alreadyImported) return 'Already imported'
        if (thread.messageCount === 0) return 'Empty chat, nothing to import'
        return ''
      }
      return h('ul', { className: 'jan-legacy-import-rows' }, threads.map(thread => {
        const losses = results[thread.id]?.losses ?? []
        const status = stateOf(thread)
        return h('li', { key: thread.id, className: 'jan-legacy-import-row' },
          h(Checkbox, { label: thread.title, title: thread.title, disabled: busy || !importable(thread) || stale, checked: selected.has(thread.id), onChange: checked => setSelected(previous => { const next = new Set(previous); checked ? next.add(thread.id) : next.delete(thread.id); return next }) }),
          h('span', { className: 'jan-legacy-import-meta' },
            thread.kind === 'cowork' ? h('span', { className: 'jan-legacy-import-tag', title: 'A Cowork session from Jan' }, 'Cowork') : null,
            thread.workspace ? h('span', { className: 'jan-legacy-import-tag', title: thread.project }, thread.projectName && thread.projectName !== thread.workspace ? `${thread.projectName} · ${thread.workspace}` : thread.workspace)
              : thread.project ? h('span', { className: 'jan-legacy-import-tag', title: thread.project }, projectOf(thread.project)) : null,
            thread.agent ? h('span', { className: 'jan-legacy-import-tag' }, AGENT_NAMES[thread.agent]) : null,
            thread.size !== undefined ? sizeOf(thread.size) : plural(thread.messageCount, 'message', 'messages'),
            thread.updated ? h('time', { dateTime: new Date(thread.updated).toISOString() }, shortDate(thread.updated)) : null),
          status || losses.length ? h('div', { role: 'status', className: 'jan-legacy-import-row-state' },
            status,
            losses.length ? h('details', null,
              h('summary', null, `${plural(losses.length, 'detail', 'details')} not carried over`),
              h('ul', null, losses.map(loss => h('li', { key: loss }, loss)))) : null) : null)
      }))
    }
    const providerLine = row => row.status === 'failed' ? `${row.id}: could not add - ${row.reason}`
      : `${row.id}: ${row.status === 'imported' ? 'added' : 'already here'}${row.key === 'imported' ? ', key brought over' : row.key === 'kept' ? ', kept the key already set here' : row.key === 'not read' ? `, key not brought over - ${row.reason}` : ''}`
    // Jan's providers, MCP servers and assistants: one checkbox each, and after
    // a run what happened to every item.
    function SettingsChoices({ state: { janSettings, extras, setExtras, settingsResults, busy, stale } }) {
      if (!janSettings) return null
      const { providers, mcp, assistants } = janSettings
      const pending = assistants.filter(item => !item.alreadyImported)
      const groups = [
        providers.length ? {
          key: 'providers', label: `Model providers and their API keys: ${providers.map(row => row.id).join(', ')}`,
          hint: 'Your computer may ask permission to read each key Jan saved.'
        } : null,
        mcp.names.length ? {
          key: 'mcp', label: `Tool servers (MCP): ${mcp.names.join(', ')}`,
          hint: 'Added turned off. Turn on the ones you use in Settings -> MCP Servers.'
        } : null,
        assistants.length ? {
          key: 'assistants', label: `Assistants: ${assistants.map(item => item.name).join(', ')}`,
          hint: pending.length ? 'Each becomes an agent preset with its instructions; chats that used it keep it.' : 'Already here as agent presets.', done: !pending.length
        } : null,
      ].filter(Boolean)
      if (!groups.length) return null
      const resultOf = key => {
        if (!settingsResults) return null
        if (key === 'providers' && settingsResults.providers?.length) return settingsResults.providers.map(providerLine)
        if (key === 'mcp' && settingsResults.mcp) {
          const { error, imported, already } = settingsResults.mcp
          if (error) return [`Could not add MCP servers: ${error}`]
          // Name only what happened: a rerun that added nothing just says what was already here.
          return [[imported ? `Added ${plural(imported, 'server', 'servers')}, turned off` : '', already ? `${already} already here` : ''].filter(Boolean).join('; ') || 'Nothing to add']
        }
        if (key === 'assistants' && settingsResults.assistantsError) return [`Could not add assistants: ${settingsResults.assistantsError}`]
        if (key === 'assistants' && settingsResults.assistants?.length) return settingsResults.assistants.map(row => `${row.name}: ${row.status === 'imported' ? 'added as a preset' : row.status === 'already here' ? 'already here' : `could not add - ${row.reason}`}`)
        return null
      }
      return h('section', { className: 'jan-legacy-import-group', 'aria-labelledby': 'jan-legacy-import-settings' },
        h('h3', { id: 'jan-legacy-import-settings' }, 'Settings from Jan'),
        h('div', { className: 'jan-legacy-import-settings' },
          groups.map(group => {
            const lines = resultOf(group.key)
            // A group this run brought over reads as done, not as an unticked choice; a failure stays a choice to retry.
            const settled = lines !== null && !extras[group.key] && !lines.some(line => /could not/i.test(line))
            return h('div', { key: group.key, className: 'jan-legacy-import-setting' },
              settled
                ? h('p', { className: 'jan-legacy-import-setting-done' }, `✓ ${group.label}`)
                : h(Checkbox, { label: group.label, title: group.label, disabled: busy || stale || group.done, checked: extras[group.key], onChange: checked => setExtras(previous => ({ ...previous, [group.key]: checked })) }),
              settled ? null : h('p', { className: 'jan-legacy-import-meta' }, group.hint),
              lines ? h('ul', { role: 'status', className: 'jan-legacy-import-row-state' }, lines.map(line => h('li', { key: line }, line))) : null)
          }),
          mcp.skipped.length ? h('p', { className: 'jan-legacy-import-meta' }, `Left behind: ${mcp.skipped.map(row => `${row.sourceName} (${row.reason})`).join('; ')}`) : null))
    }
    const BRINGS = 'Message text, reasoning, tool calls and their results, token counts and local images. Audio, video, per-chat tool settings and streaming timing stay behind. Chats are imported into the default project when available, or without a project. After the import, each chat lists anything it could not bring.'
    const AGENT_BRINGS = 'Your messages, the assistant’s replies and reasoning, tool calls with their results, and token counts. Images, sub-agent side conversations and encrypted reasoning stay behind. If the original folder still exists, Jan registers it as a project for the imported chat. Otherwise, the chat uses the default project when available, or is imported without a project. After the import, each chat lists anything it could not bring.'
    const emptyMessage = ({ source, missing, listedFolder }) => source === 'orca' ? 'No Claude Code, Codex or OMP session ran in an Orca workspace in this range.' : missing
      ? `${sourceName(source)} has no sessions folder at ${listedFolder}. Choose Change if it lives somewhere else.`
      : source === 'jan' ? 'No Jan chats found. Change the folder and scan again.' : `No ${sourceName(source)} sessions in this range.`
    // The source folder as one short line; the path is editable only after Change.
    // Which sessions the agent list covers, and the switch between recent and all.
    function Range({ state: { source, allTime, setAllTime, older, busy, scan, folder, threads } }) {
      if (source === 'jan') return null
      const toggle = () => { const next = !allTime; setAllTime(next); scan(source, folder, next) }
      return h('p', { className: 'jan-legacy-import-range', role: 'status' },
        allTime ? `Showing all ${plural(threads.length, 'session', 'sessions')}.` : `Showing the last ${RECENT_DAYS} days${older ? `; ${plural(older, 'older session is', 'older sessions are')} hidden` : ''}.`,
        allTime || older ? h('button', { type: 'button', className: 'jan-legacy-import-link', disabled: busy, onClick: toggle },
          allTime ? `Last ${RECENT_DAYS} days only` : 'Show all (reads every file, can take a while)') : null)
    }
    function SourcePicker({ state: { source, setSource, busy, scan, setFolder, setJob, allTime } }) {
      return h('div', { className: 'jan-legacy-import-picker', role: 'radiogroup', 'aria-label': 'Import from' },
        SOURCES.map(([key, label]) => h('button', {
          key, type: 'button', role: 'radio', 'aria-checked': source === key, disabled: busy, className: 'jan-legacy-import-choice',
          onClick: () => { if (key === source) return; setSource(key); setFolder(''); setJob(null); scan(key, '', allTime) },
        }, label)))
    }
    function Source({ state }) {
      const { source, folder, setFolder, listedFolder, scanning, busy, scan } = state
      const [editing, setEditing] = React.useState(false)
      if (source === 'orca') return h('div', { className: 'jan-legacy-import-source' },
        h('span', { className: 'jan-legacy-import-source-label' }, 'From'),
        h('span', { className: 'jan-legacy-import-path' }, scanning ? 'Asking Orca for its workspaces…' : state.orcaWorkspaces === undefined ? 'Orca' : `${plural(state.orcaWorkspaces, 'Orca workspace', 'Orca workspaces')} on this computer`))
      return h('div', { className: 'jan-legacy-import-source' },
        h('span', { className: 'jan-legacy-import-source-label' }, 'From'),
        editing
          ? h(React.Fragment, null,
            h(Input, { 'aria-label': `${sourceName(source)} folder`, value: folder, disabled: busy, placeholder: `${sourceName(source)} folder`, onChange: event => setFolder(event.target.value) }),
            h(Button, { disabled: busy, onClick: async () => { await scan(source, folder); setEditing(false) } }, scanning ? 'Scanning…' : 'Scan'))
          : h(React.Fragment, null,
            h('code', { className: 'jan-legacy-import-path', title: listedFolder }, listedFolder || `Looking for ${sourceName(source)}…`),
            h(Button, { disabled: busy, onClick: () => setEditing(true) }, 'Change')))
    }
    // The label of the one import action, including the finished state.
    const actionLabel = ({ job, importing, canImport, eligible, selected, extras }) => importing
      ? `Importing ${Math.round(job.done / Math.max(job.total, 1) * 100)}%…`
      : job && !canImport && !eligible.length ? 'All imported' : importLabel(selected.size, extras)
    // The Settings page: the one action and its progress sit right under the source, in view
    // before the long lists; the label names what the choices below add up to.
    function ImportCard({ refreshSessions }) {
      const state = useJanImport(refreshSessions)
      const { listedFolder, threads, error, busy, stale, canImport, importSelected } = state
      return h('section', { className: 'jan-legacy-import', 'aria-label': 'Import sessions', 'aria-busy': busy },
        h('h2', null, 'Import sessions'),
        h('p', null, state.source === 'jan'
          ? 'Bring your chats and settings from the earlier Jan app. Your Jan folder is only read, never changed, and anything already imported is skipped.'
          : state.source === 'orca'
            ? 'Bring the Claude Code, Codex and OMP sessions you ran in Orca into Jan. Each opens in a Jan workspace named after its Orca workspace. Nothing in Orca or the agents’ folders is changed, and anything already imported is skipped.'
            : `Bring sessions from ${sourceName(state.source)} into Jan. The ${sourceName(state.source)} folder is only read, never changed, and anything already imported is skipped.`),
        h(SourcePicker, { state }),
        h(Source, { state }),
        h(Range, { state }),
        threads.length || canImport || state.job ? h('div', { className: 'jan-legacy-import-actions jan-legacy-import-footer' },
          h(Button, { variant: 'primary', disabled: busy || !canImport || stale, onClick: importSelected }, actionLabel(state)),
          h(ImportProgress, { state })) : null,
        error ? h('p', { role: 'alert' }, error) : null,
        listedFolder && stale ? h('p', { role: 'status' }, 'Scan this folder before importing.') : null,
        threads.length ? h(ChatList, { state }) : listedFolder && !busy ? h('p', { role: 'status' }, emptyMessage(state)) : null,
        h(SettingsChoices, { state }),
        h(WhatComesOver, { source: state.source }))
    }
    // First-launch offer: a card in the shared bottom-right notification stack,
    // hidden while Desktop onboarding covers the window.
    function ImportOffer({ startMigrate }) {
      const [offer, setOffer] = React.useState(null)
      const [error, setError] = React.useState('')
      const [details, setDetails] = React.useState(false)
      // On first launch the client can mount before the Host route is up; ask
      // again a few times before giving up for this launch.
      React.useEffect(() => {
        let cancelled = false
        const ask = async attempt => {
          try { const value = await api('offer'); if (!cancelled) setOffer(value) } catch (error) {
            if (cancelled) return
            if (attempt < 5) setTimeout(() => ask(attempt + 1), 1000 * attempt)
            else console.warn('Jan import offer unavailable:', error.message)
          }
        }
        ask(1)
        return () => { cancelled = true }
      }, [])
      // Don't show again (and handing the import to a /migrate chat) is
      // remembered; Not now hides the card only until the next launch.
      const dismiss = async () => {
        try { await api('dismissOffer'); setOffer(null) } catch (error) { setError(error.message) }
      }
      if (!offer?.show) return null
      const migrate = () => { startMigrate(); void dismiss() }
      // Compact by design, in the shared Coachmark shape: a title with a close
      // button (Not now), one short line, and Details, Don't show again / Import.
      // What else was found, the read-only promise and where to import later sit
      // behind Details.
      return h(NotificationPortal, null, h('section', { className: 'jan-legacy-import-offer', role: 'dialog', 'aria-labelledby': 'jan-legacy-import-offer-title' },
        h('div', { className: 'jan-legacy-import-offer-head' },
          h('h2', { id: 'jan-legacy-import-offer-title' }, 'Import your chats from Jan'),
          h(Button, { size: 'sm', className: 'jan-legacy-import-offer-close', 'aria-label': 'Not now', title: 'Not now', icon: h(IconCloseOutlineRegular), onClick: () => setOffer(null) })),
        h('p', null, `${plural(offer.count, 'chat', 'chats')}${offer.extras?.length ? ' and settings' : ''} found.`),
        details ? h('p', { id: 'jan-legacy-import-offer-details' }, `${offer.extras?.length ? `Settings means your ${listOf(offer.extras)}. ` : ''}Your Jan folder stays unchanged. Import opens a chat where Jan finds what to bring and asks before importing. You can also type /migrate in any chat.`) : null,
        error ? h('p', { role: 'alert' }, error) : null,
        h('div', { className: 'jan-legacy-import-offer-foot' },
          h('div', { className: 'jan-legacy-import-offer-quiet' },
            h(Button, { size: 'sm', 'aria-expanded': details, 'aria-controls': 'jan-legacy-import-offer-details', onClick: () => setDetails(value => !value) }, details ? 'Hide details' : 'Details'),
            h(Button, { size: 'sm', onClick: dismiss }, "Don't show again")),
          h(Button, { size: 'sm', variant: 'primary', onClick: migrate }, 'Import'))))
    }
    // The Settings page starts the same agent-led import, above the manual picker.
    function MigrateCard({ startMigrate }) {
      return h('section', { className: 'jan-legacy-import', 'aria-labelledby': 'jan-legacy-migrate-title' },
        h('h2', { id: 'jan-legacy-migrate-title' }, 'Migrate in a chat'),
        h('p', null, 'Jan looks for chats and settings from the earlier Jan app, Claude Code, Codex and OMP, asks what to bring, and imports after you approve.'),
        h('div', { className: 'jan-legacy-import-actions' }, h(Button, { variant: 'primary', onClick: startMigrate }, 'Start /migrate')))
    }
    return {
      name: '@janhq/jan-legacy-import',
      inject: ['slots', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = `
.jan-legacy-import{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.jan-legacy-import h2{margin:0;text-wrap:balance}
.jan-legacy-import p{margin:0;text-wrap:pretty;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.jan-legacy-import-actions input:not([type=checkbox]){min-width:240px;flex:1}
.jan-legacy-import ul{list-style:none;margin:0;padding:0}
.jan-legacy-import-detail{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-progress{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg)}
.jan-legacy-import-progress progress{display:block;width:100%;height:8px;accent-color:var(--dsw-alias-button-primary-fill)}
.jan-legacy-import-progress p{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:16px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.jan-legacy-import-row:last-child{border-bottom:0}
.jan-legacy-import-row > label{min-width:0}
.jan-legacy-import-row > label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-meta{display:flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.jan-legacy-import-meta time{min-width:84px;text-align:right}
.jan-legacy-import-tag{padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.jan-legacy-import .jan-legacy-import-row-state{grid-column:1 / -1;padding-inline-start:26px;margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.jan-legacy-import-row-state summary{cursor:pointer;width:fit-content}
.jan-legacy-import .jan-legacy-import-row-state ul{margin-top:4px;padding-inline-start:12px;list-style:disc}
.jan-legacy-import h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.jan-legacy-import-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.jan-legacy-import-group .jan-legacy-import-list-head{padding:0}
.jan-legacy-import-group > label{padding:0 12px}
.jan-legacy-import > .jan-legacy-import-group > ul{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg)}
.jan-legacy-import .jan-legacy-import-setting-done{margin:0;font-size:14px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import > p{font-size:14px;line-height:20px}
.jan-legacy-import-footer{padding-top:4px}
.jan-legacy-import-footer .jan-legacy-import-progress{flex:1;min-width:240px;padding:8px 12px}
.jan-legacy-import details.jan-legacy-import-detail summary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import details.jan-legacy-import-detail p{margin-top:6px;font-size:13px}
.jan-legacy-import .jan-legacy-import-range{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:13px}
.jan-legacy-import-link{padding:0;border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.jan-legacy-import-link:disabled{opacity:.5;cursor:default}
.jan-legacy-import-picker{display:flex;flex-wrap:wrap;gap:6px}
.jan-legacy-import-choice{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.jan-legacy-import-choice[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-primary)}
.jan-legacy-import-choice:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.jan-legacy-import-choice:disabled{opacity:.5;cursor:default}
.jan-legacy-import-source{display:flex;align-items:center;gap:10px;min-width:0}
.jan-legacy-import-source input{flex:1;min-width:0}
.jan-legacy-import-source-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-path{flex:1;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-list-head{display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-settings{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);min-width:0}
.jan-legacy-import-settings legend{padding:0 4px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-setting{display:flex;flex-direction:column;gap:2px;min-width:0}
.jan-legacy-import-setting > label{min-width:0}
.jan-legacy-import-setting > label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-setting .jan-legacy-import-meta{padding-inline-start:26px;white-space:normal}
.jan-legacy-import .jan-legacy-import-setting .jan-legacy-import-row-state{padding-inline-start:26px;margin:2px 0 0;list-style:disc;padding-left:40px}
.jan-legacy-import-offer{box-sizing:border-box;width:min(300px,calc(100vw - 40px));animation:jan-legacy-import-offer-in 180ms ease-out;display:flex;flex-direction:column;gap:4px;padding:16px;border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
body:has([data-onboarding-overlay]) .jan-legacy-import-offer{display:none}
@keyframes jan-legacy-import-offer-in{from{opacity:0;transform:translateX(16px)}}
@media (prefers-reduced-motion:reduce){.jan-legacy-import-offer{animation:none}}
.jan-legacy-import-offer-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:-6px}
.jan-legacy-import-offer h2{margin:0;font-size:14px;line-height:20px;font-weight:500}
.jan-legacy-import-offer-close{flex:none;width:28px;padding:0;margin-inline-end:-6px}
.jan-legacy-import-offer p{margin:0;font-size:13px;line-height:18px;text-wrap:pretty;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-offer-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
.jan-legacy-import-offer-quiet{display:flex;align-items:center;gap:4px;margin-inline-start:-10px}
.jan-legacy-import-offer-quiet > *{color:var(--dsw-alias-label-secondary)}
@media (max-width:560px){.jan-legacy-import-row{grid-template-columns:minmax(0,1fr)}.jan-legacy-import-meta{padding-inline-start:26px}}
`
          document.head.appendChild(style)
          return () => style.remove()
        }, 'Jan import settings styles')
        // Both entries hand the import to the /migrate skill in a fresh chat; the user only presses Enter.
        const startMigrate = () => {
          ctx.get('layout')?.selectPanel(null)
          ctx.uiWorkspace.startSession(undefined, { prompt: '/migrate', whenDraftExists: 'replace' })
        }
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'jan-import', order: 100, label: () => 'Import sessions' }, () => h(React.Fragment, null,
          h(MigrateCard, { startMigrate }),
          h(ImportCard, { refreshSessions: () => ctx.sessions.refresh() }))))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'jan-import-offer' }, () => h(ImportOffer, { startMigrate })))
      },
    }
  },
})
