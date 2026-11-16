window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-jan-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Checkbox } = require('@deepseek-ai/dsh-client-ui-primitives')
    async function api(method, params = {}) {
      const response = await fetch('/ow-api/jan-import', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }
    // Imported sessions bypass live creation, so the Chats list learns of them
    // only through a fresh baseline pull.
    function ImportCard({ refreshSessions }) {
      const [folder, setFolder] = React.useState('')
      const [listedFolder, setListedFolder] = React.useState('')
      const [threads, setThreads] = React.useState([])
      const [selected, setSelected] = React.useState(new Set())
      const [results, setResults] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const scan = async () => {
        setBusy(true); setError('')
        try {
          const value = await api('list', { folder })
          setFolder(value.folder); setListedFolder(value.folder); setThreads(value.threads); setSelected(new Set()); setResults({})
        } catch (error) { setError(error.message) } finally { setBusy(false) }
      }
      React.useEffect(() => { scan() }, [])
      const importSelected = async () => {
        setBusy(true); setError('')
        try {
          const value = await api('import', { folder: listedFolder, ids: [...selected] })
          setResults(Object.fromEntries(value.results.map(result => [result.id, result])))
          if (value.results.some(result => result.status === 'imported')) await refreshSessions()
        } catch (error) { setError(error.message) } finally { setBusy(false) }
      }
      const eligible = threads.filter(thread => !thread.error && !thread.alreadyImported)
      return h('section', { className: 'ow-jan-import', 'aria-label': 'Import from Jan', 'aria-busy': busy },
        h('h2', null, 'Import from Jan'),
        h('p', null, 'Copy Jan chats into native DSH sessions in the default workspace. Jan files are read only. Existing sessions are skipped.'),
        h('label', { htmlFor: 'ow-jan-import-folder' }, 'Jan data folder'),
        h('div', { className: 'ow-jan-import-actions' },
          h(Input, { id: 'ow-jan-import-folder', value: folder, disabled: busy, placeholder: 'Default: this app’s Jan data folder', onChange: event => setFolder(event.target.value) }),
          h(Button, { disabled: busy, onClick: scan }, busy ? 'Working…' : 'Scan folder')),
        error ? h('p', { role: 'alert' }, error) : null,
        h('p', null, 'Text, reasoning, paired tools, token usage and available local images are imported. Original streaming timing, Jan instructions, tool configuration, audio, video and arbitrary metadata are not migrated. Each result lists additional losses.'),
        listedFolder && folder !== listedFolder ? h('p', { role: 'status' }, 'Scan this folder before importing.') : null,
        threads.length ? h(React.Fragment, null,
          h('div', { className: 'ow-jan-import-actions' },
            h(Checkbox, { label: 'Select all', disabled: busy || folder !== listedFolder || !eligible.length, checked: eligible.length > 0 && eligible.every(thread => selected.has(thread.id)), onChange: checked => setSelected(new Set(checked ? eligible.map(thread => thread.id) : [])) }),
            h(Button, { disabled: busy || !selected.size || folder !== listedFolder, onClick: importSelected }, `Import selected (${selected.size})`)),
          h('ul', null, threads.map(thread => {
            const result = results[thread.id]
            return h('li', { key: thread.id },
              h(Checkbox, { label: thread.title, disabled: busy || Boolean(thread.error) || thread.alreadyImported || folder !== listedFolder, checked: selected.has(thread.id), onChange: checked => setSelected(previous => { const next = new Set(previous); checked ? next.add(thread.id) : next.delete(thread.id); return next }) }),
              h('div', { className: 'ow-jan-import-detail' }, `${thread.messageCount} messages${thread.updated ? ` · ${new Date(thread.updated).toLocaleString()}` : ''}`),
              h('div', { role: 'status', className: 'ow-jan-import-detail' }, result ? `${result.status}${result.reason ? `: ${result.reason}` : ''}` : thread.error ? `Failed: ${thread.error}` : thread.alreadyImported ? 'Already imported' : ''),
              result?.losses?.length ? h('ul', null, result.losses.map(loss => h('li', { key: loss }, loss))) : null)
          }))) : listedFolder && !busy ? h('p', { role: 'status' }, 'No Jan chats found. Choose another data folder and scan again.') : null)
    }
    return {
      name: '@open-waifu/dsh-jan-import',
      inject: ['slots', 'sessions'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = '.ow-jan-import{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}.ow-jan-import h2{margin:0;text-wrap:balance}.ow-jan-import p{margin:0;text-wrap:pretty;color:var(--dsw-alias-label-secondary)}.ow-jan-import-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ow-jan-import-actions input:not([type=checkbox]){min-width:240px;flex:1}.ow-jan-import ul{list-style:none;margin:0;padding:0}.ow-jan-import li{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.ow-jan-import-detail{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);margin-top:4px}.ow-jan-import li ul{font-size:13px;padding-inline-start:16px}'
          document.head.appendChild(style)
          return () => style.remove()
        }, 'Jan import settings styles')
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'jan-import', order: 100, label: () => 'Import from Jan' }, () => h(ImportCard, { refreshSessions: () => ctx.sessions.refresh() })))
      },
    }
  },
})
