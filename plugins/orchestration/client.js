/** The right-sidebar task list and worker chat actions for the current conversation. */
window.__ModuleLoader__.load({
  id: '@janhq/jan-orchestration',
  factory(require) {
    const { createElement: h, Fragment, useCallback, useEffect, useId, useState } = require('react')
    const { Button, IconChecklistOutlineMedium } = require('@janhq/jan-client-ui-primitives')
    const PANEL = 'jan-orchestration'
    const PATH = new URL('jan-api/orchestration', document.baseURI).href
    const HOSTS_PATH = new URL('jan-api/hosts', document.baseURI).href
    const TERMINAL = new Set(['completed', 'failed', 'stopped'])
    const dictionary = {
      en: {
        title: 'Orchestration', empty: 'No worker chats yet. Ask this chat to split work into tasks.',
        pending: 'Pending', dispatched: 'Dispatched', completed: 'Completed', failed: 'Failed', stopped: 'Stopped',
        stop: 'Stop', openRemote: 'Open on that computer', waiting: '{n} waiting', shared: 'Shared',
        loading: 'Loading worker chats', loadFailed: 'Could not load worker chats.',
        openFailed: 'Could not open the worker chat.', stopFailed: 'Could not confirm that the task stopped.',
      },
      zh: {
        title: '任务编排', empty: '暂无工作对话。请让当前对话将工作拆分为多个任务。',
        pending: '待处理', dispatched: '已分派', completed: '已完成', failed: '失败', stopped: '已停止',
        stop: '停止', openRemote: '在那台电脑上打开', waiting: '{n} 条待送达', shared: '共享',
        loading: '正在加载工作对话', loadFailed: '无法加载工作对话',
        openFailed: '无法打开工作对话', stopFailed: '无法确认任务是否已停止',
      },
      ja: {
        title: 'オーケストレーション', empty: 'まだ作業チャットがありません。このチャットに作業をタスクに分けるよう依頼してください。',
        pending: '保留中', dispatched: '割り当て済み', completed: '完了', failed: '失敗', stopped: '停止済み',
        stop: '停止', openRemote: 'そのコンピューターで開く', waiting: '{n} 件が配信待ち', shared: '共有',
        loading: '作業チャットを読み込み中', loadFailed: '作業チャットを読み込めませんでした。',
        openFailed: '作業チャットを開けませんでした。', stopFailed: 'タスクが停止したことを確認できませんでした。',
      },
      es: {
        title: 'Orquestación', empty: 'Aún no hay chats de trabajo. Pide a este chat que divida el trabajo en tareas.',
        pending: 'Pendiente', dispatched: 'Asignada', completed: 'Completada', failed: 'Fallida', stopped: 'Detenida',
        stop: 'Detener', openRemote: 'Abrir en ese equipo', waiting: '{n} sin entregar', shared: 'Compartido',
        loading: 'Cargando chats de trabajo', loadFailed: 'No se pudieron cargar los chats de trabajo.',
        openFailed: 'No se pudo abrir el chat de trabajo.', stopFailed: 'No se pudo confirmar que la tarea se haya detenido.',
      },
      fr: {
        title: 'Orchestration', empty: 'Aucun chat de travail pour le moment. Demandez à ce chat de répartir le travail en tâches.',
        pending: 'En attente', dispatched: 'Attribuée', completed: 'Terminée', failed: 'Échec', stopped: 'Arrêtée',
        stop: 'Arrêter', openRemote: 'Ouvrir sur cet ordinateur', waiting: '{n} à remettre', shared: 'Partagé',
        loading: 'Chargement des chats de travail', loadFailed: 'Impossible de charger les chats de travail.',
        openFailed: 'Impossible d’ouvrir le chat de travail.', stopFailed: 'Impossible de confirmer l’arrêt de la tâche.',
      },
      de: {
        title: 'Orchestrierung', empty: 'Noch keine Arbeitschats. Bitte diesen Chat, die Arbeit in Aufgaben aufzuteilen.',
        pending: 'Ausstehend', dispatched: 'Zugewiesen', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', stopped: 'Gestoppt',
        stop: 'Stoppen', openRemote: 'Auf diesem Computer öffnen', waiting: '{n} noch nicht zugestellt', shared: 'Geteilt',
        loading: 'Arbeitschats werden geladen', loadFailed: 'Arbeitschats konnten nicht geladen werden.',
        openFailed: 'Der Arbeitschat konnte nicht geöffnet werden.', stopFailed: 'Es konnte nicht bestätigt werden, dass die Aufgabe gestoppt wurde.',
      },
      ru: {
        title: 'Оркестрация', empty: 'Пока нет рабочих чатов. Попросите этот чат разделить работу на задачи.',
        pending: 'Ожидает', dispatched: 'Назначена', completed: 'Завершена', failed: 'Не выполнена', stopped: 'Остановлена',
        stop: 'Остановить', openRemote: 'Открыть на том компьютере', waiting: '{n} не доставлено', shared: 'Общая папка',
        loading: 'Загрузка рабочих чатов', loadFailed: 'Не удалось загрузить рабочие чаты.',
        openFailed: 'Не удалось открыть рабочий чат.', stopFailed: 'Не удалось подтвердить остановку задачи.',
      },
      pt: {
        title: 'Orquestração', empty: 'Ainda não há chats de trabalho. Peça a este chat que divida o trabalho em tarefas.',
        pending: 'Pendente', dispatched: 'Atribuída', completed: 'Concluída', failed: 'Com falha', stopped: 'Interrompida',
        stop: 'Interromper', openRemote: 'Abrir nesse computador', waiting: '{n} por entregar', shared: 'Compartilhado',
        loading: 'Carregando chats de trabalho', loadFailed: 'Não foi possível carregar os chats de trabalho.',
        openFailed: 'Não foi possível abrir o chat de trabalho.', stopFailed: 'Não foi possível confirmar que a tarefa foi interrompida.',
      },
    }

    const CSS = `
.jor-panel { flex: 1; min-height: 0; min-width: 0; overflow: auto; scrollbar-gutter: stable;
  padding: 8px 12px; color: var(--dsw-alias-label-primary); }
.jor-state { margin: 12px 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jor-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.jor-row { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
.jor-row .jor-main { display: block; flex: 1; min-width: 0; height: auto; padding: 0 8px;
  text-align: start; border-radius: var(--dsw-radius-md); }
.jor-row button.jor-main { transition: background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.jor-main:focus-visible { outline-offset: -2px; }
.jor-heading { display: flex; align-items: center; flex-wrap: wrap; column-gap: 8px; min-height: 32px; }
.jor-title { flex: 1 1 auto; min-width: 0; font-size: 13px; line-height: 18px; font-weight: 500; overflow-wrap: anywhere; }
.jor-chip { max-width: 100%; padding: 2px 6px; border-radius: var(--dsw-radius-xs);
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); font-size: 12px; line-height: 16px; }
.jor-chip[data-status='failed'] { color: var(--dsw-alias-state-error-primary); }
.jor-meta, .jor-message, .jor-open-remote { display: block; font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
.jor-meta { display: flex; flex-wrap: wrap; gap: 2px 8px; color: var(--dsw-alias-label-secondary); }
.jor-message, .jor-open-remote { margin-top: 4px; }
.jor-message { white-space: pre-wrap; color: var(--dsw-alias-label-secondary); }
.jor-details { display: block; padding-bottom: 8px; }
.jor-row .jor-stop { flex: none; margin-top: 2px; }
.jor-error { color: var(--dsw-alias-state-error-primary); }
.jor-skeleton { border-radius: var(--dsw-radius-md); margin: 0 8px; height: 32px; background: var(--dsw-alias-bg-layer-2); }
@media (prefers-reduced-motion: reduce) { .jor-row button.jor-main { transition: none; } }
`

    async function call(path, method, params, signal) {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }), signal })
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    function TaskRow({ task, t, openSession, signal, refresh }) {
      const id = useId()
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const { dispatch, isolation, lastMessage } = task
      const localSessionId = dispatch?.qualifiedSessionId ?? (dispatch?.host === 'local' ? dispatch.sessionId : undefined)
      const openRemote = localSessionId === undefined && dispatch?.sessionId !== undefined
      const canOpen = localSessionId !== undefined || openRemote

      async function open() {
        setError(null)
        try {
          if (localSessionId !== undefined) { openSession(localSessionId); return }
          setBusy(true)
          const { url } = await call(HOSTS_PATH, 'open', { id: dispatch.host }, signal)
          if (!signal.aborted) window.open(url, '_blank', 'noopener')
        } catch (error) {
          if (!signal.aborted) setError('openFailed')
        } finally {
          if (!signal.aborted && openRemote) setBusy(false)
        }
      }

      async function stop() {
        setBusy(true)
        setError(null)
        try {
          await call(PATH, 'uiStop', { taskId: task.taskId }, signal)
          if (!signal.aborted) refresh()
        } catch (error) {
          if (!signal.aborted) setError('stopFailed')
        } finally {
          if (!signal.aborted) setBusy(false)
        }
      }

      const content = h(Fragment, null,
        h('span', { className: 'jor-heading' }, h('span', { className: 'jor-title', id }, task.title),
          h('span', { className: 'jor-chip', id: `${id}-status`, 'data-status': task.status }, t(task.status))),
        h('span', { className: 'jor-details', id: `${id}-details` },
          h('span', { className: 'jor-meta' }, h('span', null, task.hostName),
            isolation && h('span', null, isolation.kind === 'worktree' ? isolation.branch : t('shared')),
            task.undelivered > 0 && h('span', null, t('waiting', { n: task.undelivered }))),
          lastMessage?.body && h('span', { className: 'jor-message' }, lastMessage.body),
          openRemote && h('span', { className: 'jor-open-remote', id: `${id}-remote` }, t('openRemote'))))
      return h('li', null,
        h('div', { className: 'jor-row' },
          canOpen ? h(Button, { className: 'jor-main', variant: 'ghost', size: 'sm', onClick: open, disabled: busy,
            'aria-labelledby': openRemote ? `${id}-remote ${id}` : id, 'aria-describedby': `${id}-status ${id}-details` }, content)
            : h('div', { className: 'jor-main' }, content),
          !TERMINAL.has(task.status) && h(Button, { className: 'jor-stop', variant: 'ghost', size: 'sm', disabled: busy,
            onClick: stop, 'aria-labelledby': `${id}-stop ${id}` }, h('span', { id: `${id}-stop` }, t('stop')))),
        error && h('p', { role: 'alert', className: 'jor-state jor-error' }, t(error)))
    }

    function TaskList({ sessionId, visible, signal, t, openSession }) {
      const [tasks, setTasks] = useState(null)
      const [failed, setFailed] = useState(false)
      const [revision, setRevision] = useState(0)
      const refresh = useCallback(() => setRevision(value => value + 1), [])
      useEffect(() => {
        if (!visible) return
        let timer, request

        function pause() {
          clearTimeout(timer)
          request?.abort()
          request = undefined
        }

        async function poll() {
          if (document.visibilityState !== 'visible') return
          const current = new AbortController()
          request = current
          try {
            const result = await call(PATH, 'uiTasks', { coordinatorSessionId: sessionId }, current.signal)
            if (!current.signal.aborted) {
              setTasks(result.tasks)
              setFailed(false)
            }
          } catch (error) {
            if (!current.signal.aborted) setFailed(true)
          } finally {
            if (!current.signal.aborted && document.visibilityState === 'visible') timer = setTimeout(poll, 2000)
          }
        }

        function syncSelection() {
          pause()
          if (document.visibilityState === 'visible') void poll()
        }

        document.addEventListener('visibilitychange', syncSelection)
        syncSelection()
        return () => {
          document.removeEventListener('visibilitychange', syncSelection)
          pause()
        }
      }, [sessionId, visible, revision])

      return h('section', { className: 'jor-panel', 'aria-label': t('title') },
        failed && h('p', { role: 'alert', className: 'jor-state jor-error' }, t('loadFailed')),
        tasks === null ? !failed && h('div', { className: 'jor-list', role: 'status', 'aria-label': t('loading') },
          h('div', { className: 'jor-skeleton', 'aria-hidden': true }), h('div', { className: 'jor-skeleton', 'aria-hidden': true }))
          : tasks.length === 0 ? !failed && h('p', { className: 'jor-state' }, t('empty'))
            : h('ul', { className: 'jor-list' }, tasks.map(task => h(TaskRow, {
              key: task.taskId, task, t, openSession, signal, refresh,
            }))))
    }

    function Panel({ useTabInfo, sessionId, t, openSession }) {
      // The session seat supplies the coordinator, and visibility excludes background conversations.
      const { tab } = useTabInfo()
      return h(TaskList, { key: sessionId, sessionId, visible: tab.visible, signal: tab.signal, t, openSession })
    }

    function PanelTitle({ t }) {
      return h(Fragment, null, h(IconChecklistOutlineMedium, { size: 16, 'aria-hidden': true }), t('title'))
    }

    return { name: PANEL, inject: ['slots', 'locale', 'uiWorkspace', 'sidebarRightTabs'], apply(ctx) {
      ctx.effect(() => ctx.locale.register(PANEL, dictionary))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      })
      const t = ctx.locale.bind(PANEL)
      const title = () => t('title')
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: PANEL, kind: 'orchestration', priority: 'builtin', title,
        guide: [{ id: PANEL, order: 40, title, icon: IconChecklistOutlineMedium }] }))
      const openSession = id => ctx.uiWorkspace.openSession(id)
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: PANEL, locale: PANEL, inject: () => ({ openSession }),
      }, Panel)))
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title', key: PANEL, locale: PANEL,
      }, PanelTitle)))
    } }
  },
})
