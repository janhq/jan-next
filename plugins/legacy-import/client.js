window.__ModuleLoader__.load({
  id: '@janhq/jan-legacy-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Checkbox, Modal } = require('@janhq/jan-client-ui-primitives')
    async function api(method, params = {}) {
      const response = await fetch('/jan-api/legacy-import', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
    // One line that says what the last run did, from its per-chat results.
    function summaryOf(results) {
      const count = status => results.filter(result => result.status === status).length
      const parts = [`Imported ${plural(count('imported'), 'chat', 'chats')}`]
      if (count('already imported')) parts.push(`${count('already imported')} already here`)
      if (count('skipped')) parts.push(`${count('skipped')} empty skipped`)
      if (count('failed')) parts.push(`${count('failed')} failed - see the list below`)
      return parts.join(' · ')
    }
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
        setError(''); setResults({})
        setJob({ running: true, total: ids.length, done: 0, current: null, results: [] })
        const request = api('import', { folder: listedFolder, ids })
        // Start polling only after the Host has the request, so the first read is this run.
        await new Promise(resolve => setTimeout(resolve, 100))
        const [outcome] = await Promise.allSettled([request, follow()])
        if (outcome.status === 'rejected') setError(outcome.reason.message)
        else {
          showResults(outcome.value.results)
          setJob(previous => ({ ...(previous ?? {}), running: false, results: outcome.value.results }))
          const done = new Set(outcome.value.results.filter(result => result.status !== 'failed').map(result => result.id))
          setThreads(previous => previous.map(thread => done.has(thread.id) ? { ...thread, alreadyImported: true } : thread))
          setSelected(previous => new Set([...previous].filter(id => !done.has(id))))
          if (outcome.value.results.some(result => result.status === 'imported')) await refreshSessions()
        }
      }
      const eligible = threads.filter(importable)
      return {
        folder, setFolder, listedFolder, threads, selected, setSelected, results, scanning, job, error, importing,
        busy: scanning || importing, stale: folder !== listedFolder, eligible, scan, importSelected,
      }
    }
    function ImportProgress({ state: { job, importing } }) {
      if (!job) return null
      const percent = job.total ? Math.round(job.done / job.total * 100) : 0
      return h('div', { className: 'jan-legacy-import-progress' },
        h('progress', { max: job.total || 1, value: job.done, 'aria-label': 'Import progress' }),
        h('p', { role: 'status', 'aria-live': 'polite' }, importing
          ? `Importing ${Math.min(job.done + 1, job.total)} of ${job.total} (${percent}%)${job.current ? ` · ${job.current}` : ''}`
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
    const BRINGS = 'Text, reasoning, tool calls and results, token usage and local images come over. Streaming timing, Jan instructions, tool settings, audio, video and other metadata do not. Each chat lists anything it could not bring.'
    // The Settings page: the folder is always editable here.
    function ImportCard({ refreshSessions }) {
      const state = useJanImport(refreshSessions)
      const { folder, setFolder, listedFolder, threads, selected, scanning, error, importing, busy, stale, scan, importSelected } = state
      return h('section', { className: 'jan-legacy-import', 'aria-label': 'Import from Jan', 'aria-busy': busy },
        h('h2', null, 'Import from Jan'),
        h('p', null, 'Bring your chats and Cowork sessions from the earlier Jan app into the default workspace. Your Jan folder is only read, never changed. Chats you already imported are skipped.'),
        h('label', { htmlFor: 'jan-legacy-import-folder' }, 'Jan data folder'),
        h('div', { className: 'jan-legacy-import-actions' },
          h(Input, { id: 'jan-legacy-import-folder', value: folder, disabled: busy, placeholder: 'Default: Jan’s data folder', onChange: event => setFolder(event.target.value) }),
          h(Button, { disabled: busy, onClick: scan }, scanning ? 'Scanning…' : 'Scan folder')),
        error ? h('p', { role: 'alert' }, error) : null,
        h(ImportProgress, { state }),
        h('p', null, BRINGS),
        listedFolder && stale ? h('p', { role: 'status' }, 'Scan this folder before importing.') : null,
        threads.length ? h(React.Fragment, null,
          h('div', { className: 'jan-legacy-import-actions' },
            h(SelectAll, { state }),
            h(Button, { variant: 'primary', disabled: busy || !selected.size || stale, onClick: importSelected }, importing ? 'Importing…' : selected.size ? `Import ${plural(selected.size, 'chat', 'chats')}` : 'Nothing left to import')),
          h(ThreadRows, { state })) : listedFolder && !busy ? h('p', { role: 'status' }, 'No Jan chats found. Choose another data folder and scan again.') : null)
    }
    // The first-launch dialog: source on top, the list in a fixed scroll area,
    // and the one decision (import or not) in the footer.
    function ImportDialog({ refreshSessions, onClose, onDone }) {
      const state = useJanImport(refreshSessions)
      const { folder, setFolder, listedFolder, threads, selected, scanning, job, error, importing, busy, stale, eligible, scan, importSelected } = state
      const [editing, setEditing] = React.useState(false)
      const finished = job !== null && !importing
      const footer = finished && !selected.size
        ? h(Button, { variant: 'primary', onClick: onDone }, 'Done')
        : h(React.Fragment, null,
          h(Button, { disabled: importing, onClick: onClose }, 'Cancel'),
          h(Button, { variant: 'primary', disabled: busy || !selected.size || stale, onClick: importSelected },
            importing ? `Importing ${Math.min(job.done + 1, job.total)} of ${job.total}…` : selected.size ? `Import ${plural(selected.size, 'chat', 'chats')}` : 'Nothing to import'))
      return h(Modal, {
        open: true, title: 'Import from Jan', closeLabel: 'Close import', onClose: importing ? () => {} : onClose,
        className: 'jan-legacy-import-dialog', footer,
        description: threads.length ? `${plural(threads.length, 'chat', 'chats')} found in the earlier Jan app, ${eligible.length} ready to bring over. Your Jan folder is only read, never changed.` : 'Your Jan folder is only read, never changed.',
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
        h('h2', { id: 'jan-legacy-import-offer-title' }, 'Bring over your Jan chats'),
        h('p', null, `Found ${plural(offer.count, 'chat', 'chats')} from the earlier Jan app. Import them here? Your Jan folder stays unchanged.`),
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
.jan-legacy-import-in-dialog{gap:14px;height:100%;min-height:0}
.jan-legacy-import-in-dialog > *{flex:none}
.jan-legacy-import-source{display:flex;align-items:center;gap:10px;min-width:0}
.jan-legacy-import-source input{flex:1;min-width:0}
.jan-legacy-import-source-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-path{flex:1;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jan-legacy-import-list-head{display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.jan-legacy-import-scroll{flex:1 1 auto;min-height:120px;max-height:400px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg)}
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
