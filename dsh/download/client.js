window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-download',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, RiskConfirmation, IconDownloadOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const labels = {
      preparing: 'Preparing import', downloading: 'Downloading', validating: 'Validating files',
      importing: 'Finishing import', pausing: 'Pausing', paused: 'Paused',
      cancelling: 'Cancelling', cancelled: 'Cancelled', completed: 'Completed', error: 'Failed',
    }
    const bytes = value => {
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
      return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`
    }
    async function api(method, params = {}, signal) {
      const response = await fetch('/ow-api/download', {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? `Download request failed (${response.status}).`)
      }
      const body = await response.json()
      return body.result
    }
    function DownloadsPanel({ openModels }) {
      const [tasks, setTasks] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const [action, setAction] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const alive = React.useRef(false)
      React.useEffect(() => {
        alive.current = true
        const controller = new AbortController()
        let timer
        const refresh = async () => {
          try {
            const result = await api('list', {}, controller.signal)
            if (alive.current) { setTasks(result); setLoadError('') }
          } catch (error) {
            if (alive.current) setLoadError(error.message)
          } finally {
            if (alive.current) timer = setTimeout(refresh, 1000)
          }
        }
        void refresh()
        return () => { alive.current = false; controller.abort(); clearTimeout(timer) }
      }, [])
      const run = async (task, method) => {
        setConfirm(null)
        setAction({ taskId: task.taskId, method })
        setActionError(null)
        try {
          await api(method, { taskId: task.taskId })
          const result = await api('list')
          if (alive.current) { setTasks(result); setLoadError('') }
        } catch (error) {
          if (alive.current) setActionError({ taskId: task.taskId, message: error.message })
        } finally {
          if (alive.current) setAction(null)
        }
      }
      return h('section', { className: 'ow-downloads', 'aria-labelledby': 'ow-downloads-heading' },
        h('header', { className: 'ow-downloads-head' },
          h('h1', { id: 'ow-downloads-heading' }, 'Downloads'),
          h('p', null, 'Model imports and downloads from this desktop session. Pause keeps partial files so you can resume.')),
        loadError ? h('p', { role: 'alert', className: 'ow-downloads-error' }, loadError, ' The list may be out of date.') : null,
        tasks === null ? h('p', { role: 'status' }, 'Loading downloads...') : tasks.length === 0
          ? h('div', { className: 'ow-downloads-empty' },
            h(IconDownloadOutlineRegular, { size: 32, 'aria-hidden': true }),
            h('h2', null, 'No downloads yet'),
            h('p', null, 'Import a model file or download URL. Its progress will appear here.'),
            h(Button, { variant: 'outline', onClick: openModels }, 'Open Local models'))
          : h('ul', { className: 'ow-downloads-list' }, tasks.map(task => {
            const busy = action?.taskId === task.taskId
            const error = actionError?.taskId === task.taskId ? actionError.message : task.actionError ?? task.error
            const percent = task.total > 0 ? Math.min(100, Math.max(0, task.transferred / task.total * 100)) : null
            return h('li', { key: task.taskId, className: 'ow-downloads-task', 'aria-busy': busy },
              h('div', { className: 'ow-downloads-task-head' },
                h('h2', { title: task.modelId }, task.modelId),
                h('span', { className: 'ow-downloads-state', role: 'status' }, labels[task.status] ?? task.status)),
              h('progress', {
                max: 100, ...(task.status === 'completed' ? { value: 100 } : percent === null ? {} : { value: percent }),
                'aria-label': `Download progress for ${task.modelId}`,
              }),
              h('p', { className: 'ow-downloads-size' },
                task.status === 'completed' && !task.total ? 'Import completed' : `${bytes(task.transferred)}${task.total > 0 ? ` of ${bytes(task.total)} (${Math.floor(percent)}%)` : ' transferred'}`),
              ['paused', 'error'].includes(task.status) && !task.canResume && task.resumeUnavailableReason ? h('p', null, task.resumeUnavailableReason) : null,
              h('div', { className: 'ow-downloads-actions' },
                task.canPause ? h(Button, { variant: 'outline', size: 'sm', disabled: !!action, onClick: () => { void run(task, 'pause') } }, busy ? 'Pausing...' : 'Pause') : null,
                task.canResume ? h(Button, { variant: 'outline', size: 'sm', disabled: !!action, onClick: () => { void run(task, 'resume') } }, busy ? 'Resuming...' : 'Resume') : null,
                task.canCancel ? h(Button, { variant: 'outline', size: 'sm', disabled: !!action, onClick: () => { setAcknowledged(false); setConfirm(task) } }, 'Cancel download') : null),
              error ? h('p', { role: 'alert', className: 'ow-downloads-error' }, error) : null)
          })),
        h(RiskConfirmation, {
          open: confirm !== null,
          title: 'Cancel this download?',
          description: `Cancel the import of ${confirm?.modelId ?? 'this model'} and discard its partial files. To keep the files, choose Keep download and then Pause.`,
          acknowledgeLabel: 'Discard the partial model files.',
          cancelLabel: 'Keep download', closeLabel: 'Keep download', confirmLabel: 'Discard files',
          acknowledged, disabled: !!action, onAcknowledgedChange: setAcknowledged,
          onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) void run(confirm, 'cancel') },
        }))
    }
    const CSS = `
      .ow-downloads{box-sizing:border-box;overflow:auto;height:100%;padding:32px;max-width:100%;color:var(--dsw-alias-label-primary)}
      .ow-downloads-head,.ow-downloads-list,.ow-downloads-empty{max-width:800px;margin-inline:auto}
      .ow-downloads h1{font-size:24px;font-weight:600;margin:0 0 8px;text-wrap:balance}
      .ow-downloads h2{font-size:16px;font-weight:600;margin:0;text-wrap:balance}
      .ow-downloads p{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);text-wrap:pretty;margin:8px 0}
      .ow-downloads-list{list-style:none;padding:0;display:flex;flex-direction:column;gap:16px;margin-top:24px}
      .ow-downloads-task{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;min-width:0}
      .ow-downloads-task-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .ow-downloads-task h2{overflow-wrap:anywhere;min-width:0}
      .ow-downloads-state{font-size:13px;color:var(--dsw-alias-label-secondary)}
      .ow-downloads progress{display:block;width:100%;height:8px;margin-top:16px;accent-color:var(--dsw-alias-button-primary-fill)}
      .ow-downloads-size{font-variant-numeric:tabular-nums}
      .ow-downloads-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .ow-downloads .ow-downloads-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));overflow-wrap:anywhere}
      .ow-downloads-empty{padding:48px 0;text-align:center}
      .ow-downloads-empty h2{margin-top:16px}
      @media(max-width:600px){.ow-downloads{padding:20px}}
    `
    return {
      name: 'ow-download',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@open-waifu/dsh-download'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'ow-download: styles')
        ctx.inject(['layout'], scope => {
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: 'ow-downloads',
            inject: () => ({ openModels: () => scope.layout.selectPanel('ow-models') }),
          }, DownloadsPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: 'ow-downloads', order: 20, label: () => 'Downloads',
          }, ({ size }) => h(IconDownloadOutlineRegular, { size, 'aria-hidden': true })))
        })
      },
    }
  },
})
