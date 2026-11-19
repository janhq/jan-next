window.__ModuleLoader__.load({
  id: '@janhq/jan-model-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, IconSearchOutlineRegular, IconAppsAddOutlineRegular } = require('@janhq/jan-client-ui-primitives')

    const PANEL = 'jan-model-hub'
    // The catalog the earlier Jan app's Hub reads: GGUF repositories with their quantized files.
    const CATALOG = 'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
    const FILE = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/([^/?#]+\.gguf)$/i
    const PAGE = 24
    const COPY = {
      en: {
        title: 'Hub',
        lede: 'Models that run on this computer with llama.cpp. A downloaded model works offline.',
        search: 'Search models', loading: 'Loading the model catalog...',
        error: 'Could not load the model catalog: {error}', retry: 'Try again',
        empty: 'No model matches "{query}".', by: 'by {developer}', downloads: '{count} downloads',
        tools: 'Tools', vision: 'Vision', variant: 'Variant of {name}',
        download: 'Download', downloading: 'Downloading {percent}', queued: 'Queued', resume: 'Resume',
        use: 'Use', using: 'Starting...', active: 'In use', more: 'Show more',
        failed: 'Could not finish: {error}',
      },
      zh: {
        title: '模型中心',
        lede: '在这台电脑上通过 llama.cpp 运行的模型。下载后的模型可离线使用。',
        search: '搜索模型', loading: '正在加载模型目录...',
        error: '无法加载模型目录：{error}', retry: '重试',
        empty: '没有与“{query}”匹配的模型。', by: '来自 {developer}', downloads: '{count} 次下载',
        tools: '工具', vision: '视觉', variant: '{name} 的版本',
        download: '下载', downloading: '下载中 {percent}', queued: '排队中', resume: '继续',
        use: '使用', using: '正在启动...', active: '使用中', more: '显示更多',
        failed: '未能完成：{error}',
      },
      ja: {
        title: 'ハブ',
        lede: 'このコンピューターで llama.cpp により動作するモデルです。ダウンロードしたモデルはオフラインで使えます。',
        search: 'モデルを検索', loading: 'モデルカタログを読み込んでいます...',
        error: 'モデルカタログを読み込めませんでした: {error}', retry: '再試行',
        empty: '「{query}」に一致するモデルはありません。', by: '{developer} 提供', downloads: '{count} 回ダウンロード',
        tools: 'ツール', vision: '画像', variant: '{name} のバリアント',
        download: 'ダウンロード', downloading: 'ダウンロード中 {percent}', queued: '待機中', resume: '再開',
        use: '使用', using: '起動しています...', active: '使用中', more: 'さらに表示',
        failed: '完了できませんでした: {error}',
      },
      es: {
        title: 'Hub',
        lede: 'Modelos que se ejecutan en este equipo con llama.cpp. Un modelo descargado funciona sin conexión.',
        search: 'Buscar modelos', loading: 'Cargando el catálogo de modelos...',
        error: 'No se pudo cargar el catálogo de modelos: {error}', retry: 'Reintentar',
        empty: 'Ningún modelo coincide con "{query}".', by: 'de {developer}', downloads: '{count} descargas',
        tools: 'Herramientas', vision: 'Visión', variant: 'Variante de {name}',
        download: 'Descargar', downloading: 'Descargando {percent}', queued: 'En cola', resume: 'Reanudar',
        use: 'Usar', using: 'Iniciando...', active: 'En uso', more: 'Mostrar más',
        failed: 'No se pudo completar: {error}',
      },
      fr: {
        title: 'Hub',
        lede: 'Des modèles qui tournent sur cet ordinateur avec llama.cpp. Un modèle téléchargé fonctionne hors ligne.',
        search: 'Rechercher des modèles', loading: 'Chargement du catalogue de modèles...',
        error: 'Impossible de charger le catalogue de modèles : {error}', retry: 'Réessayer',
        empty: 'Aucun modèle ne correspond à « {query} ».', by: 'par {developer}', downloads: '{count} téléchargements',
        tools: 'Outils', vision: 'Vision', variant: 'Variante de {name}',
        download: 'Télécharger', downloading: 'Téléchargement {percent}', queued: 'En attente', resume: 'Reprendre',
        use: 'Utiliser', using: 'Démarrage...', active: 'En cours d’utilisation', more: 'Afficher plus',
        failed: 'Impossible de terminer : {error}',
      },
      de: {
        title: 'Hub',
        lede: 'Modelle, die mit llama.cpp auf diesem Computer laufen. Ein heruntergeladenes Modell funktioniert offline.',
        search: 'Modelle suchen', loading: 'Modellkatalog wird geladen...',
        error: 'Der Modellkatalog konnte nicht geladen werden: {error}', retry: 'Erneut versuchen',
        empty: 'Kein Modell passt zu „{query}“.', by: 'von {developer}', downloads: '{count} Downloads',
        tools: 'Werkzeuge', vision: 'Bilder', variant: 'Variante von {name}',
        download: 'Herunterladen', downloading: 'Wird geladen {percent}', queued: 'Wartet', resume: 'Fortsetzen',
        use: 'Verwenden', using: 'Wird gestartet...', active: 'In Verwendung', more: 'Mehr anzeigen',
        failed: 'Konnte nicht abgeschlossen werden: {error}',
      },
      ru: {
        title: 'Хаб',
        lede: 'Модели, которые работают на этом компьютере через llama.cpp. Загруженная модель работает без сети.',
        search: 'Поиск моделей', loading: 'Загрузка каталога моделей...',
        error: 'Не удалось загрузить каталог моделей: {error}', retry: 'Повторить',
        empty: 'Нет моделей по запросу «{query}».', by: 'от {developer}', downloads: 'Загрузок: {count}',
        tools: 'Инструменты', vision: 'Изображения', variant: 'Вариант {name}',
        download: 'Загрузить', downloading: 'Загрузка {percent}', queued: 'В очереди', resume: 'Продолжить',
        use: 'Использовать', using: 'Запуск...', active: 'Используется', more: 'Показать ещё',
        failed: 'Не удалось завершить: {error}',
      },
      pt: {
        title: 'Hub',
        lede: 'Modelos que rodam neste computador com llama.cpp. Um modelo baixado funciona offline.',
        search: 'Buscar modelos', loading: 'Carregando o catálogo de modelos...',
        error: 'Não foi possível carregar o catálogo de modelos: {error}', retry: 'Tentar novamente',
        empty: 'Nenhum modelo corresponde a "{query}".', by: 'por {developer}', downloads: '{count} downloads',
        tools: 'Ferramentas', vision: 'Visão', variant: 'Variante de {name}',
        download: 'Baixar', downloading: 'Baixando {percent}', queued: 'Na fila', resume: 'Retomar',
        use: 'Usar', using: 'Iniciando...', active: 'Em uso', more: 'Mostrar mais',
        failed: 'Não foi possível concluir: {error}',
      },
    }

    const message = error => error instanceof Error ? error.message : String(error)
    async function answer(call) {
      const result = await call
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const stem = file => file.replace(/\.gguf$/i, '')

    /**
     * Read one catalog row into a Hub card; rows without downloadable GGUF files are dropped.
     * @param row - one `model_catalog_v2.json` entry.
     * @returns the card, or undefined.
     */
    function card(row) {
      const quants = (Array.isArray(row?.quants) ? row.quants : []).flatMap((quant) => {
        const match = typeof quant?.path === 'string' ? FILE.exec(quant.path) : null
        return match === null ? [] : [{ repo: match[1], file: decodeURIComponent(match[2]), size: String(quant.file_size ?? '') }]
      })
      if (quants.length === 0 || typeof row.model_name !== 'string') return undefined
      // Q4_K_M is the usual size and quality balance; otherwise the catalog's first file.
      const recommended = Math.max(0, quants.findIndex(quant => /[-_.]Q4_K_M$/i.test(stem(quant.file))))
      return {
        key: `${quants[0].repo}`, name: row.model_name.replace(/[-_]gguf$/i, ''), developer: String(row.developer ?? ''),
        // Catalog descriptions are README excerpts; the card shows them as plain text.
        description: typeof row.description === 'string' ? row.description.replace(/[*_`#]+/g, '').trim() : '',
        downloads: Number.isFinite(row.downloads) ? row.downloads : 0,
        tools: row.tools === true, vision: Number(row.num_mmproj) > 0, quants, recommended,
      }
    }

    // One catalog read per page visit; a failure keeps its message for the retry.
    function useCatalog() {
      const [state, setState] = React.useState({ cards: null, error: '' })
      const [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        const controller = new AbortController()
        setState(previous => ({ ...previous, error: '' }))
        void (async () => {
          try {
            const response = await fetch(CATALOG, { signal: controller.signal, cache: 'no-cache' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const rows = await response.json()
            if (!Array.isArray(rows)) throw new Error('unexpected catalog format')
            const cards = rows.map(card).filter(Boolean)
            // Jan's own models first, then by popularity.
            cards.sort((a, b) => Number(b.developer === 'janhq') - Number(a.developer === 'janhq') || b.downloads - a.downloads)
            setState({ cards, error: '' })
          } catch (error) {
            if (!controller.signal.aborted) setState({ cards: null, error: message(error) })
          }
        })()
        return () => { controller.abort() }
      }, [attempt])
      return { ...state, retry: () => setAttempt(value => value + 1) }
    }

    // One reconnecting follower of the Host's local model state.
    function follow(remote) {
      const controller = new AbortController()
      const listeners = new Set()
      let snapshot = { models: [], downloads: [], catalog: [], provider: 'local' }
      let timer
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            for await (const state of remote.follow(controller.signal)) {
              snapshot = { models: state.models ?? [], downloads: state.downloads ?? [], catalog: state.catalog ?? [], provider: state.provider }
              for (const listener of listeners) listener()
            }
          } catch {
            if (controller.signal.aborted) return
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

    function ModelCard({ item, local, act, busy, failure, t, locale }) {
      const [choice, setChoice] = React.useState(item.recommended)
      const quant = item.quants[choice]
      const name = stem(quant.file)
      // A Hub download installs under its file name; a curated install from Settings
      // (one file of the same repository) stands for the card's default variant.
      const curated = choice === item.recommended
        ? local.catalog.find(entry => entry.installed && entry.repo.toLowerCase() === quant.repo.toLowerCase())
        : undefined
      const installed = local.models.find(model => model.name === name || model.id === curated?.id)
      const job = local.downloads.find(download => download.name === name)
      const working = busy === name
      const percent = job?.progress && job.progress.totalBytes > 0
        ? (Math.min(1, job.progress.receivedBytes / job.progress.totalBytes)).toLocaleString(locale, { style: 'percent' })
        : null
      const action = installed !== undefined
        ? (installed.active && installed.status === 'loaded'
          ? h(Button, { variant: 'outline', size: 'sm', onClick: () => { act('chat', name, installed) } }, t('active'))
          : h(Button, { variant: 'primary', size: 'sm', disabled: busy !== null, onClick: () => { act('use', name, installed) } },
            working ? t('using') : t('use')))
        : job !== undefined
          ? (job.error !== undefined || job.paused
            ? h(Button, { variant: 'outline', size: 'sm', disabled: busy !== null, onClick: () => { act('resume', name, job) } }, t('resume'))
            : h(Button, { variant: 'outline', size: 'sm', disabled: true }, percent === null ? t('queued') : t('downloading', { percent })))
          : h(Button, { variant: 'outline', size: 'sm', disabled: busy !== null, onClick: () => { act('download', name, quant) } },
            t('download'))
      return h('li', { className: 'jan-hub-card', 'aria-busy': working },
        h('div', { className: 'jan-hub-card-head' },
          h('h2', { title: item.name }, item.name),
          h('div', { className: 'jan-hub-tags' },
            item.tools && h('span', { className: 'jan-hub-tag' }, t('tools')),
            item.vision && h('span', { className: 'jan-hub-tag' }, t('vision')))),
        h('p', { className: 'jan-hub-meta' }, [
          item.developer && t('by', { developer: item.developer }),
          t('downloads', { count: item.downloads.toLocaleString(locale) }),
        ].filter(Boolean).join(' - ')),
        item.description && h('p', { className: 'jan-hub-description' }, item.description),
        h('div', { className: 'jan-hub-actions' },
          h('select', {
            className: 'jan-hub-variant', value: choice, 'aria-label': t('variant', { name: item.name }),
            onChange: (event) => { setChoice(Number(event.target.value)) },
          }, item.quants.map((entry, index) => h('option', { key: entry.file, value: index },
            `${stem(entry.file)}${entry.size ? ` - ${entry.size}` : ''}`))),
          action),
        failure && h('p', { role: 'alert', className: 'jan-hub-error' }, t('failed', { error: failure })))
    }

    function HubPanel({ feed, remote, startLocalChat, t }) {
      const locale = document.documentElement.lang || undefined
      const local = React.useSyncExternalStore(feed.subscribe, feed.get)
      const { cards, error, retry } = useCatalog()
      const [query, setQuery] = React.useState('')
      const [shown, setShown] = React.useState(PAGE)
      const [busy, setBusy] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const needle = query.trim().toLowerCase()
      const matches = cards === null ? [] : cards.filter(item => needle === ''
        || item.name.toLowerCase().includes(needle) || item.developer.toLowerCase().includes(needle))
      const act = async (kind, name, target) => {
        setBusy(name)
        setFailure(null)
        try {
          if (kind === 'download') await answer(remote.downloadRepoFile(target.repo, target.file))
          else if (kind === 'resume') await answer(remote.retryDownload(target.id))
          else {
            if (kind === 'use') await answer(remote.setDefaultModel(target.id))
            await startLocalChat(feed.get().provider)
          }
        } catch (failed) {
          setFailure({ name, message: message(failed) })
        } finally {
          setBusy(null)
        }
      }
      return h('section', { className: 'jan-hub', 'aria-labelledby': 'jan-hub-heading' },
        h('header', { className: 'jan-hub-head' },
          h('h1', { id: 'jan-hub-heading' }, t('title')),
          h('p', null, t('lede')),
          h(Input, {
            type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'),
            icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }),
            onChange: (event) => { setQuery(event.target.value); setShown(PAGE) },
          })),
        error
          ? h('div', { className: 'jan-hub-status' },
            h('p', { role: 'alert', className: 'jan-hub-error' }, t('error', { error })),
            h(Button, { variant: 'outline', size: 'sm', onClick: retry }, t('retry')))
          : cards === null
            ? h('p', { role: 'status', className: 'jan-hub-status' }, t('loading'))
            : matches.length === 0
              ? h('p', { className: 'jan-hub-status' }, t('empty', { query: query.trim() }))
              : h(React.Fragment, null,
                h('ul', { className: 'jan-hub-list' }, matches.slice(0, shown).map(item => h(ModelCard, {
                  key: item.key, item, local, busy, t, locale,
                  failure: failure !== null && item.quants.some(quant => stem(quant.file) === failure.name) ? failure.message : '',
                  act: (kind, name, target) => { void act(kind, name, target) },
                }))),
                matches.length > shown && h('div', { className: 'jan-hub-more' },
                  h(Button, { variant: 'outline', size: 'sm', onClick: () => { setShown(value => value + PAGE) } }, t('more')))))
    }

    const CSS = `
      .jan-hub{box-sizing:border-box;overflow:auto;height:100%;padding:32px;max-width:100%;color:var(--dsw-alias-label-primary)}
      .jan-hub-head,.jan-hub-list,.jan-hub-status,.jan-hub-more{max-width:880px;margin-inline:auto}
      .jan-hub h1{font-size:24px;font-weight:600;margin:0 0 8px;text-wrap:balance}
      .jan-hub-head>p{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:0 0 16px;text-wrap:pretty}
      .jan-hub-list{list-style:none;padding:0;margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
      .jan-hub-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
      .jan-hub-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
      .jan-hub-card h2{font-size:15px;font-weight:600;margin:0;overflow-wrap:anywhere;min-width:0}
      .jan-hub-tags{display:flex;gap:4px;flex-shrink:0}
      .jan-hub-tag{font-size:12px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-secondary,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-secondary)}
      .jan-hub-meta{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .jan-hub-description{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .jan-hub-actions{display:flex;gap:8px;align-items:center;margin-top:auto;padding-top:4px}
      .jan-hub-variant{flex:1;min-width:0;font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit}
      .jan-hub-actions button{flex-shrink:0}
      .jan-hub-status{margin-top:24px;font-size:14px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      .jan-hub .jan-hub-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));overflow-wrap:anywhere;font-size:13px;margin:0}
      .jan-hub-more{display:flex;justify-content:center;margin-top:16px}
      @media(max-width:600px){.jan-hub{padding:20px}}
    `
    return {
      name: 'jan-model-hub',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-model-hub'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'jan-model-hub: styles')
        // ui-settings-local-model mounts the llamaCpp Remote; the Hub waits for it.
        ctx.inject(['locale', 'layout', 'sessions', 'uiWorkspace', 'remote', 'remote.llamaCpp', 'remote.session'], (scope) => {
          scope.effect(() => scope.locale.register(PANEL, COPY), 'jan-model-hub: owned copy')
          const t = scope.locale.bind(PANEL)
          const remote = scope.remote.llamaCpp
          const feed = follow(remote)
          scope.effect(() => () => feed.dispose(), 'jan-model-hub: local model state')
          const mainBlank = () => Object.values(scope.sessions.list.getSnapshot().byId)
            .find(session => session.blank && (session.retainedBy.mainView ?? 0) > 0)
          // Open the main blank chat and route it to the local model the Host just made default.
          const startLocalChat = async (provider) => {
            scope.layout.selectPanel(null)
            scope.uiWorkspace.startSession()
            const blank = mainBlank() ?? await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { stop(); reject(new Error('the new chat did not open')) }, 10000)
              const stop = scope.sessions.list.subscribe(() => {
                const found = mainBlank()
                if (found === undefined) return
                clearTimeout(timeout)
                stop()
                resolve(found)
              })
            })
            await answer(scope.remote.session.selectModel({ sessionId: blank.id, provider, model: 'local' }))
          }
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PANEL, locale: PANEL, inject: () => ({ feed, remote, startLocalChat }),
          }, HubPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 5, label: () => t('title'),
          }, ({ size }) => h(IconAppsAddOutlineRegular, { size, 'aria-hidden': true })))
          // A one-shot request from the desktop welcome flow to open the Hub.
          const requested = () => {
            if (sessionStorage.getItem('jan:open-panel') !== PANEL) return
            sessionStorage.removeItem('jan:open-panel')
            scope.layout.selectPanel(PANEL)
          }
          requested()
          window.addEventListener('jan:open-panel', requested)
          scope.effect(() => () => window.removeEventListener('jan:open-panel', requested), 'jan-model-hub: open requests')
        })
      },
    }
  },
})
