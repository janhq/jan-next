window.__ModuleLoader__.load({
  id: '@janhq/jan-legacy-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Checkbox, Modal } = require('@janhq/jan-client-ui-primitives')
    async function call(feature, method, params = {}) {
      const response = await fetch(`/jan-api/${feature}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }
    const api = (method, params) => call('legacy-import', method, params)
    // MCP servers go through the MCP settings import, which stores their
    // secrets as credentials and adds each one turned off.
    async function importMcp(folder) {
      const document = await api('mcpDocument', { folder })
      const servers = JSON.parse(document.text).mcpServers
      const existing = new Set((await call('agent-settings', 'list')).servers.map(server => server.name))
      const fresh = Object.fromEntries(Object.entries(servers).filter(([name]) => !existing.has(name)))
      if (Object.keys(fresh).length) await call('agent-settings', 'importServers', { text: JSON.stringify({ mcpServers: fresh }), confirmed: true })
      return { imported: Object.keys(fresh).length, already: Object.keys(servers).length - Object.keys(fresh).length, skipped: document.skipped }
    }
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
    const listOf = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    // One line that says what the last run did, from its per-chat results.
    function summaryOf(results) {
      if (!results.length) return 'Settings brought over - see below'
      const count = status => results.filter(result => result.status === status).length
      const parts = [`Imported ${plural(count('imported'), 'chat', 'chats')}`]
      if (count('already imported')) parts.push(`${count('already imported')} already here`)
      if (count('skipped')) parts.push(`${count('skipped')} empty skipped`)
      if (count('failed')) parts.push(`${count('failed')} failed - see the list below`)
      return parts.join(' · ')
    }
    const NO_EXTRAS = { providers: false, mcp: false, assistants: false }
    const anyExtra = extras => extras.providers || extras.mcp || extras.assistants
    const importLabel = (count, extras) => count && anyExtra(extras) ? `Import ${plural(count, 'chat', 'chats')} and settings`
      : count ? `Import ${plural(count, 'chat', 'chats')}` : anyExtra(extras) ? 'Import settings' : 'Nothing to import'
    const importable = thread => !thread.error && !thread.alreadyImported && thread.messageCount > 0
    const shortDate = time => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    // State and actions of one import view; the Host owns the run itself.
    // Imported sessions bypass live creation, so the Chats list learns of them
    // only through a fresh baseline pull.
    function useJanImport(refreshSessions) {
      const [folder, setFolder] = React.useState('')
      const [listedFolder, setListedFolder] = React.useState('')
      const [threads, setThreads] = React.useState([])
      const [selected, setSelected] = React.useState(new Set())
      const [results, setResults] = React.useState({})
      const [scanning, setScanning] = React.useState(false)
      // The Host's import run: { running, total, done, current, results }.
      const [job, setJob] = React.useState(null)
      const [error, setError] = React.useState('')
      // Jan's providers, MCP servers and assistants, which ones to bring, and what the last run did with them.
      const [janSettings, setJanSettings] = React.useState(null)
      const [extras, setExtras] = React.useState(NO_EXTRAS)
      const [settingsResults, setSettingsResults] = React.useState(null)
      const importing = job?.running === true
      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])
      const showResults = list => setResults(Object.fromEntries(list.map(result => [result.id, result])))
      // Polls the Host until its run ends, so the bar also resumes when the
      // page is reopened mid-import.
      const follow = async () => {
        for (;;) {
          const value = await api('progress')
          if (!alive.current) return null
          setJob(value)
          if (value) showResults(value.results)
          if (!value?.running) return value
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
      const scan = async () => {
        setScanning(true); setError('')
        try {
          const value = await api('list', { folder })
          setFolder(value.folder); setListedFolder(value.folder); setThreads(value.threads); setResults({})
          // Moving from Jan means bringing everything: start with every chat that can come over.
          setSelected(new Set(value.threads.filter(importable).map(thread => thread.id)))
          setJanSettings(value.settings); setSettingsResults(null)
          setExtras({ providers: value.settings.providers.length > 0, mcp: value.settings.mcp.names.length > 0, assistants: value.settings.assistants.some(item => !item.alreadyImported) })
        } catch (error) { setError(error.message) } finally { setScanning(false) }
      }
      React.useEffect(() => {
        scan().then(async () => {
          const value = await api('progress')
          if (value?.running) { setJob(value); await follow(); await refreshSessions() }
        }).catch(error => setError(error.message))
      }, [])
      const importSelected = async () => {
        const ids = [...selected]
        const chosen = extras
        setError(''); setResults({}); setSettingsResults(null)
        setJob({ running: true, total: ids.length, done: 0, current: chosen.mcp ? 'MCP servers' : null, results: [] })
        let mcp
        if (chosen.mcp) { try { mcp = await importMcp(listedFolder) } catch (error) { mcp = { error: error.message } } }
        if (!ids.length && !chosen.providers && !chosen.assistants) {
          setSettingsResults({ mcp }); setExtras(NO_EXTRAS)
          setJob({ running: false, total: 0, done: 0, current: null, results: [] })
          return
        }
        const request = api('import', { folder: listedFolder, ids, providers: chosen.providers, assistants: chosen.assistants })
        // Start polling only after the Host has the request, so the first read is this run.
        await new Promise(resolve => setTimeout(resolve, 100))
        const [outcome] = await Promise.allSettled([request, follow()])
        if (outcome.status === 'rejected') setError(outcome.reason.message)
        else {
          showResults(outcome.value.results)
          setJob(previous => ({ ...(previous ?? {}), running: false, results: outcome.value.results }))
          setSettingsResults({ mcp, ...outcome.value.settings }); setExtras(NO_EXTRAS)
          setJanSettings(previous => previous && { ...previous, assistants: previous.assistants.map(item => ({ ...item, alreadyImported: item.alreadyImported || outcome.value.settings.assistants.some(row => row.id === item.id && row.status !== 'failed') })) })
          const done = new Set(outcome.value.results.filter(result => result.status !== 'failed').map(result => result.id))
          setThreads(previous => previous.map(thread => done.has(thread.id) ? { ...thread, alreadyImported: true } : thread))
          setSelected(previous => new Set([...previous].filter(id => !done.has(id))))
          if (outcome.value.results.some(result => result.status === 'imported')) await refreshSessions()
        }
      }
      const eligible = threads.filter(importable)
      return {
        folder, setFolder, listedFolder, threads, selected, setSelected, results, scanning, job, error, importing,
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
      return h(Checkbox, { label: 'Select all', disabled: busy || stale || !eligible.length, checked: eligible.length > 0 && eligible.every(thread => selected.has(thread.id)), onChange: checked => setSelected(new Set(checked ? eligible.map(thread => thread.id) : [])) })
    }
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
            thread.kind === 'cowork' ? h('span', { className: 'jan-legacy-import-tag' }, 'Cowork') : null,
            plural(thread.messageCount, 'message', 'messages'),
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
        providers.length ? { key: 'providers', label: `${plural(providers.length, 'model provider', 'model providers')} with API keys: ${providers.map(row => row.id).join(', ')}`,
          hint: 'Your system may ask you to allow access to each key Jan saved.' } : null,
        mcp.names.length ? { key: 'mcp', label: `${plural(mcp.names.length, 'MCP server', 'MCP servers')}: ${mcp.names.join(', ')}`,
          hint: 'Added turned off. Turn on the ones you use in Settings -> MCP.' } : null,
        assistants.length ? { key: 'assistants', label: `${plural(assistants.length, 'assistant', 'assistants')}: ${assistants.map(item => item.name).join(', ')}`,
          hint: pending.length ? 'Each becomes an agent preset with its instructions, and chats that used it keep it. Sampling settings stay behind.' : 'Already here as agent presets.', done: !pending.length } : null,
      ].filter(Boolean)
      if (!groups.length) return null
      const resultOf = key => {
        if (!settingsResults) return null
        if (key === 'providers' && settingsResults.providers?.length) return settingsResults.providers.map(providerLine)
        if (key === 'mcp' && settingsResults.mcp) return [settingsResults.mcp.error ? `Could not add MCP servers: ${settingsResults.mcp.error}`
          : `Added ${plural(settingsResults.mcp.imported, 'server', 'servers')}, turned off${settingsResults.mcp.already ? `; ${settingsResults.mcp.already} already here` : ''}`]
        if (key === 'assistants' && settingsResults.assistantsError) return [`Could not add assistants: ${settingsResults.assistantsError}`]
        if (key === 'assistants' && settingsResults.assistants?.length) return settingsResults.assistants.map(row => `${row.name}: ${row.status === 'imported' ? 'added as a preset' : row.status === 'already here' ? 'already here' : `could not add - ${row.reason}`}`)
        return null
      }
      return h('fieldset', { className: 'jan-legacy-import-settings' },
        h('legend', null, 'Also bring over'),
        groups.map(group => {
          const lines = resultOf(group.key)
          return h('div', { key: group.key, className: 'jan-legacy-import-setting' },
            h(Checkbox, { label: group.label, title: group.label, disabled: busy || stale || group.done, checked: extras[group.key], onChange: checked => setExtras(previous => ({ ...previous, [group.key]: checked })) }),
            h('p', { className: 'jan-legacy-import-meta' }, group.hint),
            lines ? h('ul', { role: 'status', className: 'jan-legacy-import-row-state' }, lines.map(line => h('li', { key: line }, line))) : null)
        }),
        mcp.skipped.length ? h('p', { className: 'jan-legacy-import-meta' }, `Left behind: ${mcp.skipped.map(row => `${row.sourceName} (${row.reason})`).join('; ')}`) : null)
    }
    const BRINGS = 'Text, reasoning, tool calls and results, token usage and local images come over. Streaming timing, per-chat tool settings, audio, video and other metadata do not. Each chat lists anything it could not bring.'
    // The Settings page: the folder is always editable here.
    function ImportCard({ refreshSessions }) {
      const state = useJanImport(refreshSessions)
      const { folder, setFolder, listedFolder, threads, selected, scanning, error, importing, busy, stale, canImport, extras, scan, importSelected } = state
      return h('section', { className: 'jan-legacy-import', 'aria-label': 'Import from Jan', 'aria-busy': busy },
        h('h2', null, 'Import from Jan'),
        h('p', null, 'Bring your chats, Cowork sessions, model providers, MCP servers and assistants from the earlier Jan app. Chats go into the default workspace. Your Jan folder is only read, never changed. Anything you already imported is skipped.'),
        h('label', { htmlFor: 'jan-legacy-import-folder' }, 'Jan data folder'),
        h('div', { className: 'jan-legacy-import-actions' },
          h(Input, { id: 'jan-legacy-import-folder', value: folder, disabled: busy, placeholder: 'Default: Jan’s data folder', onChange: event => setFolder(event.target.value) }),
          h(Button, { disabled: busy, onClick: scan }, scanning ? 'Scanning…' : 'Scan folder')),
        error ? h('p', { role: 'alert' }, error) : null,
        h(ImportProgress, { state }),
        h('p', null, BRINGS),
        listedFolder && stale ? h('p', { role: 'status' }, 'Scan this folder before importing.') : null,
        h(SettingsChoices, { state }),
        threads.length || canImport ? h(React.Fragment, null,
          h('div', { className: 'jan-legacy-import-actions' },
            threads.length ? h(SelectAll, { state }) : null,
            h(Button, { variant: 'primary', disabled: busy || !canImport || stale, onClick: importSelected }, importing ? 'Importing…' : importLabel(selected.size, extras))),
          h(ThreadRows, { state })) : listedFolder && !busy ? h('p', { role: 'status' }, 'No Jan chats found. Choose another data folder and scan again.') : null)
    }
    // The first-launch dialog: source on top, the list in a fixed scroll area,
    // and the one decision (import or not) in the footer.
    function ImportDialog({ refreshSessions, onClose, onDone }) {
      const state = useJanImport(refreshSessions)
      const { folder, setFolder, listedFolder, threads, selected, scanning, job, error, importing, busy, stale, eligible, canImport, extras, scan, importSelected } = state
      const [editing, setEditing] = React.useState(false)
      const finished = job !== null && !importing
      const footer = finished && !canImport
        ? h(Button, { variant: 'primary', onClick: onDone }, 'Done')
        : h(React.Fragment, null,
          h(Button, { disabled: importing, onClick: onClose }, 'Cancel'),
          h(Button, { variant: 'primary', disabled: busy || !canImport || stale, onClick: importSelected },
            importing ? `Importing ${Math.round(job.done / Math.max(job.total, 1) * 100)}%…` : importLabel(selected.size, extras)))
      return h(Modal, {
        open: true, title: 'Import from Jan', closeLabel: 'Close import', onClose: importing ? () => {} : onClose,
        className: 'jan-legacy-import-dialog', footer,
        description: !threads.length ? 'Your Jan folder is only read, never changed.'
          : eligible.length ? `${plural(threads.length, 'chat', 'chats')} found in the earlier Jan app, ${eligible.length} ready to bring over. Your Jan folder is only read, never changed.`
          : 'Every chat from the earlier Jan app is here. Your Jan folder was only read, never changed.',
      },
        h('div', { className: 'jan-legacy-import jan-legacy-import-in-dialog', 'aria-busy': busy },
          h('div', { className: 'jan-legacy-import-source' },
            h('span', { className: 'jan-legacy-import-source-label' }, 'From'),
            editing
              ? h(React.Fragment, null,
                h(Input, { 'aria-label': 'Jan data folder', value: folder, disabled: busy, placeholder: 'Jan’s data folder', onChange: event => setFolder(event.target.value) }),
                h(Button, { disabled: busy, onClick: async () => { await scan(); setEditing(false) } }, scanning ? 'Scanning…' : 'Scan'))
              : h(React.Fragment, null,
                h('code', { className: 'jan-legacy-import-path', title: listedFolder }, listedFolder || 'Scanning…'),
                h(Button, { disabled: busy, onClick: () => setEditing(true) }, 'Change'))),
          error ? h('p', { role: 'alert' }, error) : null,
          h(ImportProgress, { state }),
          h(SettingsChoices, { state }),
          threads.length ? h(React.Fragment, null,
            h('div', { className: 'jan-legacy-import-list-head' },
              job && !importing && !selected.size ? h('span', null, `${plural(threads.length, 'chat', 'chats')}`) : h(SelectAll, { state }),
              h('span', null, job && !importing && !selected.size ? 'All done' : `${selected.size} of ${eligible.length} selected`)),
            h('div', { className: 'jan-legacy-import-scroll' }, h(ThreadRows, { state }))) : listedFolder && !busy ? h('p', { role: 'status' }, 'No Jan chats found. Change the folder and scan again.') : null,
          h('p', { className: 'jan-legacy-import-detail' }, BRINGS)))
    }
    // First-launch offer: a card in the shell overlay layer, so it stays under
    // Desktop onboarding (a fixed surface above this layer) until that closes.
    function ImportOffer({ refreshSessions }) {
      const [offer, setOffer] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [error, setError] = React.useState('')
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
      const dismiss = async () => {
        try { await api('dismissOffer'); setOffer(null); setOpen(false) } catch (error) { setError(error.message) }
      }
      if (!offer?.show) return null
      if (open) return h(ImportDialog, { refreshSessions, onClose: () => setOpen(false), onDone: dismiss })
      return h('section', { className: 'jan-legacy-import-offer', role: 'dialog', 'aria-labelledby': 'jan-legacy-import-offer-title' },
        h('h2', { id: 'jan-legacy-import-offer-title' }, offer.extras?.length ? 'Bring over your Jan chats and settings' : 'Bring over your Jan chats'),
        h('p', null, `Found ${plural(offer.count, 'chat', 'chats')}${offer.extras?.length ? ` plus your ${listOf(offer.extras)}` : ''} from the earlier Jan app. Import them here? Your Jan folder stays unchanged.`),
        error ? h('p', { role: 'alert' }, error) : null,
        h('div', { className: 'jan-legacy-import-actions' },
          h(Button, { variant: 'primary', onClick: () => setOpen(true) }, 'Review and import'),
          h(Button, { onClick: dismiss }, 'Not now')),
        h('p', { className: 'jan-legacy-import-detail' }, 'You can import later from Settings -> Built-in plugins -> Import from Jan.'))
    }
    return {
      name: '@janhq/jan-legacy-import',
      inject: ['slots', 'sessions'],
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
.jan-legacy-import-dialog{width:min(720px,100%);max-height:100%}
.jan-legacy-import-dialog > :first-child,.jan-legacy-import-dialog > :first-child > :last-child{flex:1 1 auto;min-height:0}
.jan-legacy-import-dialog > :first-child > :last-child{overflow-y:auto;overscroll-behavior:contain}
.jan-legacy-import-in-dialog{gap:14px;height:100%;min-height:0}
.jan-legacy-import-in-dialog > *{flex:none}
.jan-legacy-import-source{display:flex;align-items:center;gap:10px;min-width:0}
.jan-legacy-import-source input{flex:1;min-width:0}
.jan-legacy-import-source-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-path{flex:1;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-list-head{display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-scroll{flex:1 1 auto;min-height:120px;max-height:400px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg)}
.jan-legacy-import-settings{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);min-width:0}
.jan-legacy-import-settings legend{padding:0 4px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-setting{display:flex;flex-direction:column;gap:2px;min-width:0}
.jan-legacy-import-setting > label{min-width:0}
.jan-legacy-import-setting > label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-setting .jan-legacy-import-meta{padding-inline-start:26px;white-space:normal}
.jan-legacy-import .jan-legacy-import-setting .jan-legacy-import-row-state{padding-inline-start:26px;margin:2px 0 0;list-style:disc;padding-left:40px}
.jan-legacy-import-offer{position:absolute;top:56px;right:16px;width:min(360px,calc(100% - 32px));display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px rgb(0 0 0 / 0.12);color:var(--dsw-alias-label-primary)}
.jan-legacy-import-offer h2{margin:0;font-size:15px;text-wrap:balance}
.jan-legacy-import-offer p{margin:0;text-wrap:pretty;color:var(--dsw-alias-label-secondary)}
@media (max-width:560px){.jan-legacy-import-row{grid-template-columns:minmax(0,1fr)}.jan-legacy-import-meta{padding-inline-start:26px}}
`
          document.head.appendChild(style)
          return () => style.remove()
        }, 'Jan import settings styles')
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'jan-import', order: 100, label: () => 'Import from Jan' }, () => h(ImportCard, { refreshSessions: () => ctx.sessions.refresh() })))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'jan-import-offer' }, () => h(ImportOffer, { refreshSessions: () => ctx.sessions.refresh() })))
      },
    }
  },
})
