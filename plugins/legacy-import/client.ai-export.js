window.__ModuleLoader__.load({
  id: '@janhq/jan-legacy-import', chunk: 'client.ai-export.js',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const { Button, Checkbox } = require('@janhq/jan-client-ui-primitives')
    const MAX_BYTES = 1024 * 1024
    const MAX_DOCUMENTS = 64
    const failures = new Set(['invalid-export', 'unsupported-export', 'export-credentials', 'export-too-large', 'bots-unavailable', 'preview-expired'])
    const displayReason = (t, row) => `${row.name || t(row.kind)}: ${t(row.reason)}`

    function ImportReport({ report, t }) {
      const outcome = (row, key) => h('li', { key }, `${row.name}: ${t(row.status)}${row.reason ? ` - ${t(row.reason)}` : ''}`,
        row.routines?.length ? h('ul', { className: 'jan-import-export-meta' }, row.routines.map((routine, index) => outcome(routine, routine.id ?? index))) : null)
      return h('section', { className: 'jan-legacy-import-group', 'aria-live': 'polite' },
        h('h3', null, t('importReport')),
        ['bots', 'skills', 'apps'].map(kind => report[kind].length ? h('div', { key: kind, className: 'jan-legacy-import-group' },
          h('h3', null, t(kind)), h('ul', { className: 'jan-import-export-rows' }, report[kind].map(row => outcome(row, row.id)))) : null),
        report.skipped.length ? h('div', { className: 'jan-legacy-import-group' }, h('h3', null, t('notImported')),
          h('ul', { className: 'jan-import-export-rows' }, report.skipped.map((row, index) => h('li', { key: index }, displayReason(t, row))))) : null)
    }

    function AiExportPanel({ api, t }) {
      const fileInput = useRef(null)
      const [text, setText] = useState(''), [files, setFiles] = useState([])
      const [preview, setPreview] = useState(null), [bots, setBots] = useState([]), [addApps, setAddApps] = useState(false)
      const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('')
      const [available, setAvailable] = useState(null), [copied, setCopied] = useState(0)
      const [statusRun, setStatusRun] = useState(0)
      useEffect(() => {
        let live = true
        void api('aiExportStatus').then(({ bots }) => { if (live) setAvailable(bots) }, () => { if (live) setAvailable('error') })
        return () => { live = false }
      }, [api, statusRun])
      useEffect(() => {
        if (!copied) return
        const timeout = setTimeout(() => setCopied(0), 1800)
        return () => clearTimeout(timeout)
      }, [copied])
      const invalidate = () => { setPreview(null); setBots([]); setAddApps(false); setError('') }
      const retryStatus = () => { setAvailable(null); setStatusRun(value => value + 1) }
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(t('exportPrompt'))
          setCopied(value => value + 1)
          setError(value => value === 'copyFailed' ? '' : value)
        } catch {
          setCopied(0)
          setError('copyFailed')
        }
      }
      async function getPreview() {
        setBusy('preview')
        invalidate()
        setReport(null)
        try {
          const pasted = text.trim() ? text : null
          if (files.length + Number(Boolean(pasted)) > MAX_DOCUMENTS
            || files.reduce((size, file) => size + file.size, 0) + (pasted?.length ?? 0) > MAX_BYTES) throw new Error('export-too-large')
          if (files.some(file => !/\.(?:json|txt|md)$/iu.test(file.name))) throw new Error('fileType')
          let documents
          try {
            documents = await Promise.all(files.map(async file => new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())))
          } catch { throw new Error('fileRead') }
          if (pasted) documents.unshift(pasted)
          const params = { documents, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          if (new TextEncoder().encode(JSON.stringify({ method: 'previewAiExport', params })).byteLength > MAX_BYTES) throw new Error('export-too-large')
          const value = await api('previewAiExport', params)
          setPreview(value); setBots(value.bots.map(row => row.id))
        } catch (failure) {
          setError(failures.has(failure.message) || ['fileRead', 'fileType'].includes(failure.message) ? failure.message : 'previewFailed')
        } finally { setBusy('') }
      }
      const eligibleApps = preview?.apps.filter(row => row.botIds.some(id => bots.includes(id))) ?? []
      async function confirm() {
        const { previewId } = preview
        setPreview(null); setBusy('import'); setError('')
        try {
          setReport(await api('importAiExport', { previewId, botIds: bots, appIds: addApps ? eligibleApps.map(row => row.id) : [] }))
        } catch (failure) { setError(failures.has(failure.message) ? failure.message : 'confirmFailed') }
        finally { setBusy('') }
      }
      const byId = new Map(preview?.bots.map(bot => [bot.id, bot.name]))
      return h('section', { className: 'jan-legacy-import', 'aria-label': t('aiTab'), 'aria-busy': Boolean(busy) },
        h('p', { className: 'jan-import-export-intro' }, t('aiIntro')),
        available === null ? h('p', { role: 'status' }, t('loading')) : null,
        available === false ? h('div', { className: 'jan-legacy-import-actions' }, h('p', { role: 'status' }, t('bots-unavailable')),
          h(Button, { onClick: retryStatus }, t('retry'))) : null,
        available === 'error' ? h('div', { className: 'jan-legacy-import-actions' }, h('p', { role: 'alert' }, t('previewFailed')),
          h(Button, { onClick: retryStatus }, t('retry'))) : null,
        h('div', { className: 'jan-legacy-import-actions' },
          h(Button, { size: 'sm', variant: 'outline', onClick: copy }, t('copyPrompt')),
          h('p', { className: 'jan-import-export-feedback', role: 'status' }, copied ? t('copied') : null)),
        h('label', { className: 'jan-import-export-field' }, t('pasteExport'),
          h('textarea', { value: text, disabled: Boolean(busy), spellCheck: false,
            onChange: event => { setText(event.target.value); invalidate() } })),
        h('input', { ref: fileInput, type: 'file', hidden: true, multiple: true, accept: '.json,.txt,.md', disabled: Boolean(busy),
          onChange: event => { setFiles(Array.from(event.target.files ?? [])); invalidate() } }),
        h('div', { className: 'jan-legacy-import-actions' },
          h(Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => fileInput.current?.click() }, t('chooseFiles')),
          h('p', { className: 'jan-import-export-feedback jan-import-export-files', role: 'status' }, files.map(file => file.name).join(', '))),
        error ? h('p', { role: 'alert' }, t(error)) : null,
        h('div', { className: 'jan-legacy-import-actions' },
          h(Button, { variant: preview || report ? 'outline' : 'primary', disabled: available !== true || Boolean(busy) || !text.trim() && !files.length, onClick: getPreview },
            t(busy === 'preview' ? 'previewing' : 'previewImport')),
          busy === 'import' ? h('p', { role: 'status' }, t('importing')) : null),
        preview && h('section', { className: 'jan-legacy-import-group' },
          h('h3', null, t('review')),
          preview.bots.some(bot => bot.routines.some(routine => !routine.paused)) ? h('p', null, t('activeWarning')) : null,
          h('ul', { className: 'jan-import-export-rows' }, preview.bots.map(bot => h('li', { key: bot.id, className: 'jan-legacy-import-setting' },
            h(Checkbox, { label: bot.name, checked: bots.includes(bot.id), onChange: checked => setBots(value => checked ? [...value, bot.id] : value.filter(id => id !== bot.id)) }),
            bot.routines.length || bot.skills.length ? h('div', { className: 'jan-import-export-meta' },
              bot.routines.map(row => h('p', { key: row.id }, `${row.name}: `, h('code', null, row.expression), ` (${row.timeZone}) - ${t(row.paused ? 'paused' : 'active')}`)),
              bot.skills.length ? h('p', null, `${t('skills')}: ${bot.skills.join(', ')}`) : null) : null))),
          eligibleApps.length ? h('div', { className: 'jan-legacy-import-setting' },
            h(Checkbox, { label: t('addApps'), checked: addApps, onChange: setAddApps }),
            h('p', { className: 'jan-legacy-import-meta' }, eligibleApps.map(row => row.name).join(', '))) : null,
          preview.skipped.length ? h('section', { className: 'jan-legacy-import-group' }, h('h3', null, t('notImported')),
            h('ul', { className: 'jan-import-export-rows' }, preview.skipped.map((row, index) => h('li', { key: index },
              `${byId.has(row.botId) ? `${byId.get(row.botId)} / ` : ''}${displayReason(t, row)}`)))) : null,
          h('div', { className: 'jan-legacy-import-actions' }, h(Button, { variant: 'primary', disabled: !bots.length, onClick: confirm }, t('importBots')))),
        report ? h(ImportReport, { report, t }) : null)
    }
    return { AiExportPanel }
  },
})
