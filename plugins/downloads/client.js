window.__ModuleLoader__.load({
  id: '@janhq/jan-downloads',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, RiskConfirmation, IconDownloadOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const PANEL = 'jan-downloads'

    // Decimal units, as Settings -> Models prints sizes.
    const bytes = value => {
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const unit = Math.min(Math.floor(Math.log10(value) / 3), units.length - 1)
      return `${(value / 1000 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`
    }
    const message = error => error instanceof Error ? error.message : String(error)
    const statusOf = item => item.error !== undefined ? 'failed' : item.paused ? 'paused' : item.progress === undefined ? 'queued' : 'downloading'
    const LABELS = { failed: 'Failed', paused: 'Paused', queued: 'Waiting', downloading: 'Downloading' }

    // One reconnecting follower of the Host's local model state; a dropped
    // stream keeps the last list on screen and says it may be stale.
    function follow(remote) {
      const controller = new AbortController()
      const listeners = new Set()
      let snapshot = { downloads: null, error: '' }
      let timer
      const set = next => { snapshot = { ...snapshot, ...next }; for (const listener of listeners) listener() }
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            for await (const state of remote.follow(controller.signal)) set({ downloads: state.downloads, error: '' })
          } catch (error) {
            if (controller.signal.aborted) return
            set({ error: message(error) })
          }
          await new Promise(resolve => { timer = setTimeout(resolve, 1000) })
        }
      })()
      return {
        get: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        dispose: () => { controller.abort(); clearTimeout(timer) },
      }
    }

    function DownloadsPanel({ feed, remote }) {
      const { downloads, error: loadError } = React.useSyncExternalStore(feed.subscribe, feed.get)
      const [action, setAction] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const run = async (item, method) => {
        setConfirm(null)
        setAction({ id: item.id, method })
        setActionError(null)
        try { await remote[method](item.id) }
        catch (error) { setActionError({ id: item.id, message: message(error) }) }
        finally { setAction(null) }
      }
      const button = (item, method, label, busyLabel, onClick) => h(Button, {
        variant: 'outline', size: 'sm', disabled: action !== null,
        onClick: onClick ?? (() => { void run(item, method) }),
      }, action?.id === item.id && action.method === method ? busyLabel : label)
      return h('section', { className: 'jan-downloads', 'aria-labelledby': 'jan-downloads-heading' },
        h('header', { className: 'jan-downloads-head' },
          h('h1', { id: 'jan-downloads-heading' }, 'Downloads'),
          h('p', null, 'Local model downloads on this computer. Pause keeps the partial file so you can resume.')),
        loadError ? h('p', { role: 'alert', className: 'jan-downloads-error' }, loadError, ' The list may be out of date.') : null,
        downloads === null ? h('p', { role: 'status' }, 'Loading downloads...') : downloads.length === 0
          ? h('div', { className: 'jan-downloads-empty' },
            h(IconDownloadOutlineRegular, { size: 32, 'aria-hidden': true }),
            h('h2', null, 'No downloads yet'),
            h('p', null, 'Download a model from Settings -> Models. Its progress will appear here.'))
          : h('ul', { className: 'jan-downloads-list' }, downloads.map(item => {
            const status = statusOf(item)
            const progress = item.progress
            const percent = progress && progress.totalBytes > 0 ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : null
            const failure = actionError?.id === item.id ? actionError.message : item.error
            return h('li', { key: item.id, className: 'jan-downloads-task', 'data-status': status, 'aria-busy': action?.id === item.id },
              h('div', { className: 'jan-downloads-task-head' },
                h('h2', { title: item.name }, item.name),
                h('span', { className: 'jan-downloads-state', role: 'status' }, LABELS[status])),
              h('progress', {
                max: 100, ...(percent === null ? {} : { value: percent }),
                'aria-label': `Download progress for ${item.name}`,
              }),
              h('p', { className: 'jan-downloads-size' }, progress === undefined
                ? (status === 'queued' ? 'Starts when the downloads ahead of it finish' : '0 B transferred')
                : [
                  `${bytes(progress.receivedBytes)} of ${bytes(progress.totalBytes)} (${percent ?? 0}%)`,
                  ...(status === 'downloading' && progress.bytesPerSecond > 0 ? [`${bytes(progress.bytesPerSecond)}/s`] : []),
                ].join(' - ')),
              h('div', { className: 'jan-downloads-actions' },
                (status === 'downloading' || status === 'queued') && button(item, 'pauseDownload', 'Pause', 'Pausing...'),
                status === 'paused' && button(item, 'retryDownload', 'Resume', 'Resuming...'),
                status === 'failed' && button(item, 'retryDownload', 'Retry', 'Retrying...'),
                status === 'failed'
                  ? button(item, 'cancelDownload', 'Dismiss', 'Dismissing...')
                  : button(item, 'cancelDownload', 'Cancel download', 'Cancelling...', () => { setAcknowledged(false); setConfirm(item) })),
              failure ? h('p', { role: 'alert', className: 'jan-downloads-error' }, failure) : null)
          })),
        h(RiskConfirmation, {
          open: confirm !== null,
          title: 'Cancel this download?',
          description: `Cancel the download of ${confirm?.name ?? 'this model'} and discard its partial file. To keep the file, choose Keep download and then Pause.`,
          acknowledgeLabel: 'Discard the partial model file.',
          cancelLabel: 'Keep download', closeLabel: 'Keep download', confirmLabel: 'Discard file',
          acknowledged, disabled: action !== null, onAcknowledgedChange: setAcknowledged,
          onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) void run(confirm, 'cancelDownload') },
        }))
    }

    const CSS = `
      .jan-downloads{box-sizing:border-box;overflow:auto;height:100%;padding:32px;max-width:100%;color:var(--dsw-alias-label-primary)}
      .jan-downloads-head,.jan-downloads-list,.jan-downloads-empty{max-width:800px;margin-inline:auto}
      .jan-downloads h1{font-size:24px;font-weight:600;margin:0 0 8px;text-wrap:balance}
      .jan-downloads h2{font-size:16px;font-weight:600;margin:0;text-wrap:balance}
      .jan-downloads p{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);text-wrap:pretty;margin:8px 0}
      .jan-downloads-list{list-style:none;padding:0;display:flex;flex-direction:column;gap:16px;margin-top:24px}
      .jan-downloads-task{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;min-width:0}
      .jan-downloads-task-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .jan-downloads-task h2{overflow-wrap:anywhere;min-width:0}
      .jan-downloads-state{font-size:13px;color:var(--dsw-alias-label-secondary)}
      .jan-downloads progress{display:block;width:100%;height:8px;margin-top:16px;accent-color:var(--dsw-alias-button-primary-fill)}
      .jan-downloads-size{font-variant-numeric:tabular-nums}
      .jan-downloads-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .jan-downloads .jan-downloads-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));overflow-wrap:anywhere}
      .jan-downloads-empty{padding:48px 0;text-align:center}
      .jan-downloads-empty h2{margin-top:16px}
      @media(max-width:600px){.jan-downloads{padding:20px}}
    `
    return {
      name: 'jan-downloads',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-downloads'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'jan-downloads: styles')
        // ui-settings-local-model mounts the llamaCpp Remote; this page waits for it.
        // Reading `scope.remote` needs the `remote` root service injected too.
        ctx.inject(['remote', 'remote.llamaCpp'], scope => {
          const remote = scope.remote.llamaCpp
          const feed = follow(remote)
          scope.effect(() => () => feed.dispose(), 'jan-downloads: state stream')
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PANEL, inject: () => ({ feed, remote }),
          }, DownloadsPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 20, label: () => 'Downloads',
          }, ({ size }) => h(IconDownloadOutlineRegular, { size, 'aria-hidden': true })))
        })
      },
    }
  },
})
