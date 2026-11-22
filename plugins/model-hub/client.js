window.__ModuleLoader__.load({
  id: '@janhq/jan-model-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Menu, MenuItemButton, RiskConfirmation, IconSearchOutlineRegular, IconAppsAddOutlineRegular, IconChevronDownOutlineRegular } = require('@janhq/jan-client-ui-primitives')

    const PANEL = 'jan-model-hub'
    // The catalog the earlier Jan app's Hub reads: GGUF repositories with their quantized files.
    const CATALOG = 'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
    const FILE = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/([^/?#]+\.gguf)$/i
    const PAGE = 24
    const COPY = {
      en: {
        title: 'Hub',
        getLocal: 'Get local models',
        lede: 'Models that run on this computer with llama.cpp. A downloaded model works offline.',
        search: 'Search models', loading: 'Loading the model catalog...',
        error: 'Could not load the model catalog: {error}', retry: 'Try again',
        empty: 'No matching models', emptyHint: 'Try a different search or remove a filter.', clear: 'Clear filters',
        by: 'by {developer}', downloads: '{count} downloads', results: '{count} results', oneResult: '1 result',
        filters: 'Filter models', tools: 'Tools', vision: 'Vision', installed: 'Installed', fits: 'Fits this computer',
        fitHint: 'Estimated from model size and the computer’s memory. Actual needs vary with context length.',
        sort: 'Sort: {value}', 'sort.downloads': 'Most downloaded', 'sort.name': 'Name', 'sort.size': 'Smallest size',
        'sort.added': 'Recently added', 'sort.updated': 'Recently updated', variant: 'Variant of {name}',
        download: 'Download', preparing: 'Preparing...', downloading: 'Downloading', queued: 'Queued', paused: 'Paused', transferFailed: 'Download failed',
        progressLabel: 'Download progress for {name}', transferSize: '{received} of {total}', speed: '{size}/s',
        pause: 'Pause', resume: 'Resume', cancel: 'Cancel download', cancelTitle: 'Cancel this download?',
        cancelDescription: 'Cancel the download of {name} and discard its partial file. Pause instead to keep the file.',
        discardAcknowledge: 'Discard the partial model file.', keepDownload: 'Keep download', discard: 'Discard file',
        use: 'Use', using: 'Starting...', more: 'Show more',
        failed: 'Could not finish: {error}',
        startFailed: 'The local model could not start: {error}', settings: 'Open Settings -> Models',
      },
      zh: {
        title: '模型中心',
        getLocal: '获取本地模型',
        lede: '在这台电脑上通过 llama.cpp 运行的模型。下载后的模型可离线使用。',
        search: '搜索模型', loading: '正在加载模型目录...',
        error: '无法加载模型目录：{error}', retry: '重试',
        empty: '没有匹配的模型', emptyHint: '请尝试其他搜索词或移除筛选条件', clear: '清除筛选',
        by: '来自 {developer}', downloads: '{count} 次下载', results: '{count} 个结果', oneResult: '1 个结果',
        filters: '筛选模型', tools: '工具', vision: '视觉', installed: '已安装', fits: '适合此电脑',
        fitHint: '根据模型大小和电脑内存估算。实际所需内存取决于上下文长度',
        sort: '排序：{value}', 'sort.downloads': '下载最多', 'sort.name': '名称', 'sort.size': '大小从小到大',
        'sort.added': '最近添加', 'sort.updated': '最近更新', variant: '{name} 的版本',
        download: '下载', preparing: '正在准备...', downloading: '下载中', queued: '排队中', paused: '已暂停', transferFailed: '下载失败',
        progressLabel: '{name} 的下载进度', transferSize: '已下载 {received}，共 {total}', speed: '{size}/秒',
        pause: '暂停', resume: '继续', cancel: '取消下载', cancelTitle: '取消此下载？',
        cancelDescription: '取消下载 {name} 并丢弃已下载的部分。若要保留文件，请暂停下载',
        discardAcknowledge: '丢弃已下载的部分模型文件', keepDownload: '保留下载', discard: '丢弃文件',
        use: '使用', using: '正在启动...', more: '显示更多',
        failed: '未能完成：{error}',
        startFailed: '本地模型无法启动：{error}', settings: '打开设置 -> 模型',
      },
      ja: {
        title: 'ハブ',
        getLocal: 'ローカルモデルを入手',
        lede: 'このコンピューターで llama.cpp により動作するモデルです。ダウンロードしたモデルはオフラインで使えます。',
        search: 'モデルを検索', loading: 'モデルカタログを読み込んでいます...',
        error: 'モデルカタログを読み込めませんでした: {error}', retry: '再試行',
        empty: '一致するモデルがありません', emptyHint: '別のキーワードで検索するか、フィルターを解除してください。', clear: 'フィルターをクリア',
        by: '{developer} 提供', downloads: '{count} 回ダウンロード', results: '{count} 件の結果', oneResult: '1 件の結果',
        filters: 'モデルを絞り込む', tools: 'ツール', vision: '画像', installed: 'インストール済み', fits: 'このコンピューターで動作可能',
        fitHint: 'モデルのサイズとコンピューターのメモリによる推定です。実際の必要容量はコンテキスト長によって異なります。',
        sort: '並べ替え: {value}', 'sort.downloads': 'ダウンロード数順', 'sort.name': '名前順', 'sort.size': 'サイズが小さい順',
        'sort.added': '追加が新しい順', 'sort.updated': '更新が新しい順', variant: '{name} のバリアント',
        download: 'ダウンロード', preparing: '準備中...', downloading: 'ダウンロード中', queued: '待機中', paused: '一時停止中', transferFailed: 'ダウンロードに失敗しました',
        progressLabel: '{name} のダウンロード進捗', transferSize: '{total} 中 {received}', speed: '{size}/秒',
        pause: '一時停止', resume: '再開', cancel: 'ダウンロードをキャンセル', cancelTitle: 'このダウンロードをキャンセルしますか？',
        cancelDescription: '{name} のダウンロードをキャンセルし、途中までのファイルを破棄します。ファイルを残すには一時停止してください。',
        discardAcknowledge: '途中までダウンロードしたモデルファイルを破棄します。', keepDownload: 'ダウンロードを保持', discard: 'ファイルを破棄',
        use: '使用', using: '起動しています...', more: 'さらに表示',
        failed: '完了できませんでした: {error}',
        startFailed: 'ローカルモデルを起動できませんでした: {error}', settings: '設定 -> モデルを開く',
      },
      es: {
        title: 'Hub',
        getLocal: 'Obtener modelos locales',
        lede: 'Modelos que se ejecutan en este equipo con llama.cpp. Un modelo descargado funciona sin conexión.',
        search: 'Buscar modelos', loading: 'Cargando el catálogo de modelos...',
        error: 'No se pudo cargar el catálogo de modelos: {error}', retry: 'Reintentar',
        empty: 'No hay modelos que coincidan', emptyHint: 'Prueba otra búsqueda o elimina un filtro.', clear: 'Borrar filtros',
        by: 'de {developer}', downloads: '{count} descargas', results: '{count} resultados', oneResult: '1 resultado',
        filters: 'Filtrar modelos', tools: 'Herramientas', vision: 'Visión', installed: 'Instalado', fits: 'Cabe en este equipo',
        fitHint: 'Estimación según el tamaño del modelo y la memoria del equipo. Los requisitos reales dependen de la longitud del contexto.',
        sort: 'Ordenar: {value}', 'sort.downloads': 'Más descargados', 'sort.name': 'Nombre', 'sort.size': 'Menor tamaño',
        'sort.added': 'Añadidos recientemente', 'sort.updated': 'Actualizados recientemente', variant: 'Variante de {name}',
        download: 'Descargar', preparing: 'Preparando...', downloading: 'Descargando', queued: 'En cola', paused: 'En pausa', transferFailed: 'Error de descarga',
        progressLabel: 'Progreso de descarga de {name}', transferSize: '{received} de {total}', speed: '{size}/s',
        pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar descarga', cancelTitle: '¿Cancelar esta descarga?',
        cancelDescription: 'Cancela la descarga de {name} y descarta el archivo parcial. Pausa la descarga para conservar el archivo.',
        discardAcknowledge: 'Descartar el archivo parcial del modelo.', keepDownload: 'Conservar descarga', discard: 'Descartar archivo',
        use: 'Usar', using: 'Iniciando...', more: 'Mostrar más',
        failed: 'No se pudo completar: {error}',
        startFailed: 'No se pudo iniciar el modelo local: {error}', settings: 'Abrir Configuración -> Modelos',
      },
      fr: {
        title: 'Hub',
        getLocal: 'Obtenir des modèles locaux',
        lede: 'Des modèles qui tournent sur cet ordinateur avec llama.cpp. Un modèle téléchargé fonctionne hors ligne.',
        search: 'Rechercher des modèles', loading: 'Chargement du catalogue de modèles...',
        error: 'Impossible de charger le catalogue de modèles : {error}', retry: 'Réessayer',
        empty: 'Aucun modèle correspondant', emptyHint: 'Essayez une autre recherche ou retirez un filtre.', clear: 'Effacer les filtres',
        by: 'par {developer}', downloads: '{count} téléchargements', results: '{count} résultats', oneResult: '1 résultat',
        filters: 'Filtrer les modèles', tools: 'Outils', vision: 'Vision', installed: 'Installé', fits: 'Adapté à cet ordinateur',
        fitHint: 'Estimation selon la taille du modèle et la mémoire de l’ordinateur. Les besoins réels dépendent de la longueur du contexte.',
        sort: 'Trier : {value}', 'sort.downloads': 'Les plus téléchargés', 'sort.name': 'Nom', 'sort.size': 'Taille croissante',
        'sort.added': 'Ajoutés récemment', 'sort.updated': 'Mis à jour récemment', variant: 'Variante de {name}',
        download: 'Télécharger', preparing: 'Préparation...', downloading: 'Téléchargement', queued: 'En attente', paused: 'En pause', transferFailed: 'Échec du téléchargement',
        progressLabel: 'Progression du téléchargement de {name}', transferSize: '{received} sur {total}', speed: '{size}/s',
        pause: 'Suspendre', resume: 'Reprendre', cancel: 'Annuler le téléchargement', cancelTitle: 'Annuler ce téléchargement ?',
        cancelDescription: 'Annulez le téléchargement de {name} et supprimez le fichier partiel. Suspendez le téléchargement pour conserver le fichier.',
        discardAcknowledge: 'Supprimer le fichier partiel du modèle.', keepDownload: 'Conserver le téléchargement', discard: 'Supprimer le fichier',
        use: 'Utiliser', using: 'Démarrage...', more: 'Afficher plus',
        failed: 'Impossible de terminer : {error}',
        startFailed: 'Impossible de démarrer le modèle local : {error}', settings: 'Ouvrir Paramètres -> Modèles',
      },
      de: {
        title: 'Hub',
        getLocal: 'Lokale Modelle holen',
        lede: 'Modelle, die mit llama.cpp auf diesem Computer laufen. Ein heruntergeladenes Modell funktioniert offline.',
        search: 'Modelle suchen', loading: 'Modellkatalog wird geladen...',
        error: 'Der Modellkatalog konnte nicht geladen werden: {error}', retry: 'Erneut versuchen',
        empty: 'Keine passenden Modelle', emptyHint: 'Versuche es mit einer anderen Suche oder entferne einen Filter.', clear: 'Filter zurücksetzen',
        by: 'von {developer}', downloads: '{count} Downloads', results: '{count} Ergebnisse', oneResult: '1 Ergebnis',
        filters: 'Modelle filtern', tools: 'Werkzeuge', vision: 'Bilder', installed: 'Installiert', fits: 'Passt auf diesen Computer',
        fitHint: 'Schätzung anhand der Modellgröße und des verfügbaren Speichers. Der tatsächliche Bedarf hängt von der Kontextlänge ab.',
        sort: 'Sortieren: {value}', 'sort.downloads': 'Meiste Downloads', 'sort.name': 'Name', 'sort.size': 'Kleinste zuerst',
        'sort.added': 'Zuletzt hinzugefügt', 'sort.updated': 'Zuletzt aktualisiert', variant: 'Variante von {name}',
        download: 'Herunterladen', preparing: 'Wird vorbereitet...', downloading: 'Wird heruntergeladen', queued: 'Wartet', paused: 'Pausiert', transferFailed: 'Download fehlgeschlagen',
        progressLabel: 'Downloadfortschritt für {name}', transferSize: '{received} von {total}', speed: '{size}/s',
        pause: 'Pausieren', resume: 'Fortsetzen', cancel: 'Download abbrechen', cancelTitle: 'Diesen Download abbrechen?',
        cancelDescription: 'Brich den Download von {name} ab und lösche die unvollständige Datei. Pausiere den Download, um die Datei zu behalten.',
        discardAcknowledge: 'Die unvollständige Modelldatei löschen.', keepDownload: 'Download behalten', discard: 'Datei löschen',
        use: 'Verwenden', using: 'Wird gestartet...', more: 'Mehr anzeigen',
        failed: 'Konnte nicht abgeschlossen werden: {error}',
        startFailed: 'Das lokale Modell konnte nicht starten: {error}', settings: 'Einstellungen -> Modelle öffnen',
      },
      ru: {
        title: 'Хаб',
        getLocal: 'Получить локальные модели',
        lede: 'Модели, которые работают на этом компьютере через llama.cpp. Загруженная модель работает без сети.',
        search: 'Поиск моделей', loading: 'Загрузка каталога моделей...',
        error: 'Не удалось загрузить каталог моделей: {error}', retry: 'Повторить',
        empty: 'Подходящих моделей нет', emptyHint: 'Измените запрос или снимите фильтр.', clear: 'Сбросить фильтры',
        by: 'от {developer}', downloads: 'Загрузок: {count}', results: 'Результатов: {count}', oneResult: '1 результат',
        filters: 'Фильтры моделей', tools: 'Инструменты', vision: 'Изображения', installed: 'Установлено', fits: 'Подходит для этого компьютера',
        fitHint: 'Оценка по размеру модели и памяти компьютера. Фактический объём памяти зависит от длины контекста.',
        sort: 'Сортировка: {value}', 'sort.downloads': 'Популярные', 'sort.name': 'Название', 'sort.size': 'Сначала небольшие',
        'sort.added': 'Недавно добавленные', 'sort.updated': 'Недавно обновлённые', variant: 'Вариант {name}',
        download: 'Загрузить', preparing: 'Подготовка...', downloading: 'Загрузка', queued: 'В очереди', paused: 'На паузе', transferFailed: 'Не удалось загрузить',
        progressLabel: 'Ход загрузки модели {name}', transferSize: '{received} из {total}', speed: '{size}/с',
        pause: 'Приостановить', resume: 'Продолжить', cancel: 'Отменить загрузку', cancelTitle: 'Отменить эту загрузку?',
        cancelDescription: 'Отмените загрузку {name} и удалите частично загруженный файл. Чтобы сохранить файл, приостановите загрузку.',
        discardAcknowledge: 'Удалить частично загруженный файл модели.', keepDownload: 'Сохранить загрузку', discard: 'Удалить файл',
        use: 'Использовать', using: 'Запуск...', more: 'Показать ещё',
        failed: 'Не удалось завершить: {error}',
        startFailed: 'Не удалось запустить локальную модель: {error}', settings: 'Открыть Настройки -> Модели',
      },
      pt: {
        title: 'Hub',
        getLocal: 'Obter modelos locais',
        lede: 'Modelos que rodam neste computador com llama.cpp. Um modelo baixado funciona offline.',
        search: 'Buscar modelos', loading: 'Carregando o catálogo de modelos...',
        error: 'Não foi possível carregar o catálogo de modelos: {error}', retry: 'Tentar novamente',
        empty: 'Nenhum modelo encontrado', emptyHint: 'Tente outra busca ou remova um filtro.', clear: 'Limpar filtros',
        by: 'por {developer}', downloads: '{count} downloads', results: '{count} resultados', oneResult: '1 resultado',
        filters: 'Filtrar modelos', tools: 'Ferramentas', vision: 'Visão', installed: 'Instalado', fits: 'Cabe neste computador',
        fitHint: 'Estimativa com base no tamanho do modelo e na memória do computador. A necessidade real depende do tamanho do contexto.',
        sort: 'Ordenar: {value}', 'sort.downloads': 'Mais baixados', 'sort.name': 'Nome', 'sort.size': 'Menor tamanho',
        'sort.added': 'Adicionados recentemente', 'sort.updated': 'Atualizados recentemente', variant: 'Variante de {name}',
        download: 'Baixar', preparing: 'Preparando...', downloading: 'Baixando', queued: 'Na fila', paused: 'Pausado', transferFailed: 'Falha no download',
        progressLabel: 'Progresso do download de {name}', transferSize: '{received} de {total}', speed: '{size}/s',
        pause: 'Pausar', resume: 'Retomar', cancel: 'Cancelar download', cancelTitle: 'Cancelar este download?',
        cancelDescription: 'Cancele o download de {name} e descarte o arquivo parcial. Pause o download para manter o arquivo.',
        discardAcknowledge: 'Descartar o arquivo parcial do modelo.', keepDownload: 'Manter download', discard: 'Descartar arquivo',
        use: 'Usar', using: 'Iniciando...', more: 'Mostrar mais',
        failed: 'Não foi possível concluir: {error}',
        startFailed: 'Não foi possível iniciar o modelo local: {error}', settings: 'Abrir Configurações -> Modelos',
      },
    }

    const message = error => error instanceof Error ? error.message : String(error)
    async function answer(call) {
      const result = await call
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const stem = file => file.replace(/\.gguf$/i, '')
    const words = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const sizeBytes = size => {
      const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i.exec(size)
      return match ? Number(match[1]) * 1000 ** units.indexOf(match[2].toUpperCase()) : Infinity
    }
    const formatBytes = (bytes, locale) => {
      const unit = bytes < 1000 ? 0 : Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1)
      return `${(bytes / 1000 ** unit).toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`
    }

    // A single insertion, deletion, replacement or adjacent transposition.
    function oneEdit(a, b) {
      if (Math.abs(a.length - b.length) > 1) return false
      if (a.length > b.length) [a, b] = [b, a]
      let i = 0
      while (i < a.length && a[i] === b[i]) i++
      if (a.length !== b.length) return a.slice(i) === b.slice(i + 1)
      return a.slice(i + 1) === b.slice(i + 1)
        || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    }

    function wordScore(needle, word) {
      if (word === needle) return 12
      if (word.startsWith(needle)) return 10
      if (word.includes(needle)) return 8
      if (needle.length < 3 || (needle.length === 3 && needle[0] !== word[0])) return 0
      return oneEdit(needle, word) || (word.length > needle.length && oneEdit(needle, word.slice(0, needle.length))) ? 4 : 0
    }

    function searchScore(item, query) {
      let total = 0
      for (const needle of query) {
        let best = 0
        for (const [terms, weight] of item.search) {
          for (const word of terms) best = Math.max(best, wordScore(needle, word) * weight)
        }
        if (best === 0) return 0
        total += best
      }
      return total
    }

    function memoryBudget(hardware) {
      if (!hardware) return 0
      const acceleratorBytes = hardware.devices.reduce((sum, device) => sum + device.totalMiB * 1024 ** 2, 0)
      const capacity = hardware.backend === 'metal' && acceleratorBytes > 0
        ? Math.min(acceleratorBytes, hardware.memoryBytes)
        : acceleratorBytes || hardware.memoryBytes
      // Weights and projector sizes are estimates; leave headroom for the runtime and context.
      return Math.floor(capacity * 0.8)
    }

    /**
     * Read one catalog row into a Hub card; rows without downloadable GGUF files are dropped.
     * @param row - one `model_catalog_v2.json` entry.
     * @returns the card, or undefined.
     */
    function card(row) {
      const projectors = Array.isArray(row?.mmproj_models) ? row.mmproj_models : []
      const projectorBytes = Math.max(0, ...projectors.map(projector => sizeBytes(projector.file_size)))
      const projectorPaths = new Set(projectors.map(projector => projector.path))
      const quants = (Array.isArray(row?.quants) ? row.quants : []).flatMap(quant => {
        const match = typeof quant?.path === 'string' ? FILE.exec(quant.path) : null
        if (match === null || projectorPaths.has(quant.path)) return []
        const file = decodeURIComponent(match[2])
        if (/mmproj|(?:^|[-_.])imatrix(?=[-_.]|$)|^dflash-|\-draft|-\d{5}-of-\d{5}\.gguf$/i.test(file)) return []
        const name = stem(file)
        return [{ repo: match[1], file, name, size: String(quant.file_size ?? ''), bytes: sizeBytes(quant.file_size) }]
      })
      if (quants.length === 0 || typeof row.model_name !== 'string') return undefined
      // Q4_K_M is the usual size and quality balance; otherwise the catalog's first file.
      const recommended = Math.max(0, quants.findIndex(quant => /[-_.]Q4_K_M$/i.test(quant.name)))
      const smallest = quants.reduce((best, quant, index) => quant.bytes < quants[best].bytes ? index : best, 0)
      const name = row.model_name.replace(/[-_]gguf$/i, '')
      const developer = String(row.developer ?? '')
      const created = Date.parse(row.createdAt) || 0
      const updated = Date.parse(row.updatedAt ?? row.lastModified) || 0
      return {
        key: `${quants[0].repo}/${name}`, name, developer, created, updated,
        search: [[words(name), 4], [words(developer), 3], [[...new Set(quants.flatMap(quant => words(quant.name)))], 2]],
        smallest, bytes: quants[smallest].bytes + projectorBytes, projectorBytes,
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
      let snapshot = { models: [], downloads: [], catalog: [], provider: 'local', hardware: undefined, phase: 'checking', error: undefined }
      let timer
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            for await (const state of remote.follow(controller.signal)) {
              snapshot = state
              for (const listener of listeners) listener()
            }
          } catch {
            if (controller.signal.aborted) return
          }
          const { promise, resolve } = Promise.withResolvers()
          timer = setTimeout(resolve, 1000)
          await promise
        }
      })()
      return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        dispose: () => { controller.abort(); clearTimeout(timer) },
      }
    }

    // The followed state once the local server has finished starting or failed; `starting` and
    // `checking` are transient, and the feed can trail the call that ended them.
    const SETTLE_MS = 10000
    function settled(feed) {
      const done = state => state.phase !== 'starting' && state.phase !== 'checking'
      if (done(feed.getSnapshot())) return Promise.resolve(feed.getSnapshot())
      return new Promise((resolve) => {
        const timeout = setTimeout(() => { stop(); resolve(feed.getSnapshot()) }, SETTLE_MS)
        const stop = feed.subscribe(() => {
          if (!done(feed.getSnapshot())) return
          clearTimeout(timeout)
          stop()
          resolve(feed.getSnapshot())
        })
      })
    }

    const FILTERS = ['tools', 'vision', 'fits', 'installed']

    function sortCatalog(cards, query, sort, locale) {
      const terms = words(query)
      const compareName = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare
      const compare = sort === 'size' ? (a, b) => a.bytes - b.bytes
        : sort === 'updated' ? (a, b) => b.updated - a.updated
          : sort === 'added' ? (a, b) => b.created - a.created
            : sort === 'name' ? (a, b) => compareName(a.name, b.name) : (a, b) => b.downloads - a.downloads
      return cards.map(item => ({ item, score: terms.length ? searchScore(item, terms) : 1 }))
        .filter(result => result.score > 0)
        .sort((a, b) => b.score - a.score || compare(a.item, b.item) || compareName(a.item.name, b.item.name))
        .map(result => result.item)
    }

    function CatalogControls({ t, cards, sort, setSort, filters, toggleFilter, canAssessFit, count }) {
      const [open, setOpen] = React.useState(false)
      const anchor = React.useRef(null)
      const sorts = ['downloads', 'name', 'size']
      if (cards.some(item => item.updated)) sorts.push('updated')
      else if (cards.some(item => item.created)) sorts.push('added')
      return h('div', { className: 'jan-hub-toolbar' },
        h('div', { className: 'jan-hub-filters', role: 'group', 'aria-label': t('filters') }, FILTERS.map(filter =>
          filter === 'fits' && !canAssessFit ? null : h(Button, {
            key: filter, variant: 'outline', size: 'sm', 'aria-pressed': filters.includes(filter),
            onClick: () => toggleFilter(filter), title: filter === 'fits' ? t('fitHint') : undefined,
          }, t(filter)))),
        h(Menu, {
          open, anchorRef: anchor, side: 'bottom', align: 'end', portal: true, autoFocus: true,
          selection: 'check', selectedId: sort, returnFocus: () => anchor.current,
          items: sorts.map(id => ({ id, label: t(`sort.${id}`) })),
          onClose: () => setOpen(false), onSelect: id => { setSort(id); setOpen(false) },
          anchor: h(Button, {
            ref: anchor, variant: 'outline', size: 'sm', 'aria-haspopup': 'menu', 'aria-expanded': open,
            onClick: () => setOpen(value => !value),
          }, t('sort', { value: t(`sort.${sort}`) }), h(IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true })),
        }),
        h('p', { className: 'jan-hub-count', role: 'status' }, count))
    }

    function Transfer({ job, busy, run, cancel, t, locale }) {
      const progress = job.progress
      const percent = progress?.totalBytes > 0 ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : undefined
      const status = job.error !== undefined ? 'transferFailed' : job.paused ? 'paused' : progress ? 'downloading' : 'queued'
      return h('div', { className: 'jan-hub-transfer' },
        h('div', { className: 'jan-hub-transfer-head' },
          h('span', null, t(status)),
          percent !== undefined && h('span', null, (percent / 100).toLocaleString(locale, { style: 'percent' }))),
        h('progress', { max: 100, value: percent, 'aria-label': t('progressLabel', { name: job.name }) }),
        progress && h('div', { className: 'jan-hub-transfer-details' },
          h('span', null, t('transferSize', { received: formatBytes(progress.receivedBytes, locale), total: formatBytes(progress.totalBytes, locale) })),
          status === 'downloading' && progress.bytesPerSecond > 0 && h('span', null, t('speed', { size: formatBytes(progress.bytesPerSecond, locale) }))),
        job.error && h('p', { role: 'alert', className: 'jan-hub-error' }, t('failed', { error: job.error })),
        h('div', { className: 'jan-hub-transfer-actions' },
          job.paused || job.error !== undefined
            ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => run('resume', job) }, t(job.paused ? 'resume' : 'retry'))
            : h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => run('pause', job) }, t('pause')),
          h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => cancel(job) }, t('cancel'))))
    }

    function installedVariant(item, quant, index, installed) {
      return installed.models.get(quant.name)
        ?? (index === item.recommended ? installed.curated.get(quant.repo.toLowerCase()) : undefined)
    }

    function ModelCard({ item, jobs, inventory, act, cancel, busy, failure, engineError, openSettings, fits, installedOnly, smallestFirst, t, locale }) {
      const [requested, setChoice] = React.useState(null)
      const variants = item.quants.map((quant, index) => ({
        quant, index, job: jobs.get(quant.name), installed: installedVariant(item, quant, index, inventory),
      })).filter(({ quant, installed }) => (!fits || quant.bytes + item.projectorBytes <= fits) && (!installedOnly || installed))
      const selected = variants.find(variant => variant.index === requested)
        ?? variants.find(variant => variant.job)
        ?? variants.find(variant => variant.installed)
        ?? variants.find(variant => variant.index === (smallestFirst ? item.smallest : item.recommended))
        ?? variants[0]
      if (!selected) return null
      const { quant, index, installed, job } = selected
      const working = busy?.key === item.key
      // The default model is the one the local server loads; its failed start is this card's to show.
      const engineFailed = installed?.active === true && engineError !== undefined
      const run = (kind, target) => act(kind, item.key, target)
      const size = Number.isFinite(quant.bytes) ? formatBytes(quant.bytes, locale) : quant.size
      return h('li', { className: 'jan-hub-card', 'aria-busy': working },
        h('h2', null, item.name),
        h('p', { className: 'jan-hub-meta' }, [
          item.developer && t('by', { developer: item.developer }),
          t('downloads', { count: item.downloads.toLocaleString(locale) }),
        ].filter(Boolean).join(' - ')),
        item.description && h('p', { className: 'jan-hub-description' }, item.description),
        (item.tools || item.vision || installed) && h('div', { className: 'jan-hub-tags' },
          item.tools && h('span', { className: 'jan-hub-tag' }, t('tools')),
          item.vision && h('span', { className: 'jan-hub-tag' }, t('vision')),
          installed && h('span', { className: 'jan-hub-tag', 'data-installed': '' }, t('installed'))),
        h('div', { className: 'jan-hub-footer' },
          h('div', { className: 'jan-hub-quant' },
            h('select', {
              className: 'jan-hub-variant', value: index, title: quant.name, 'aria-label': t('variant', { name: item.name }),
              onChange: event => setChoice(Number(event.target.value)),
            }, variants.map(({ quant: entry, index: value }) => h('option', { key: entry.file, value }, entry.name))),
            size && h('span', { className: 'jan-hub-size' }, size)),
          job && !installed
            ? h(Transfer, { job, busy: busy !== null, run, cancel: () => cancel({ key: item.key, job }), t, locale })
            : h('div', { className: 'jan-hub-card-action' }, h(Button, {
              variant: installed ? 'primary' : 'outline', size: 'sm', disabled: busy !== null,
              onClick: () => run(installed ? installed.active && installed.status === 'loaded' ? 'chat' : 'use' : 'download', installed ?? quant),
            }, installed ? working ? t('using') : t('use') : working ? t('preparing') : t('download')))),
        engineFailed
          ? h('div', { role: 'alert', className: 'jan-hub-error' },
            h('p', null, t('startFailed', { error: engineError })),
            openSettings && h(Button, { variant: 'outline', size: 'sm', onClick: openSettings }, t('settings')))
          : failure && h('p', { role: 'alert', className: 'jan-hub-error' }, t('failed', { error: failure })))
    }

    function HubPanel({ useLocal, runAction, openSettings, t }) {
      const locale = document.documentElement.lang || undefined
      const local = useLocal(value => value)
      const { cards, error, retry } = useCatalog()
      const [query, setQuery] = React.useState('')
      const [sort, setSort] = React.useState('downloads')
      const [filters, setFilters] = React.useState([])
      const [shown, setShown] = React.useState(PAGE)
      const [busy, setBusy] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const budget = memoryBudget(local.hardware)
      const inventory = React.useMemo(() => {
        const byId = new Map(local.models.map(model => [model.id, model]))
        return {
          models: new Map(local.models.map(model => [model.name, model])),
          // Curated installs in Settings stand for the recommended Hub variant of their repository.
          curated: new Map(local.catalog.filter(entry => entry.installed).map(entry => [entry.repo.toLowerCase(), byId.get(entry.id)])),
        }
      }, [local.models, local.catalog])
      const jobs = React.useMemo(() => new Map(local.downloads.map(job => [job.name, job])), [local.downloads])
      const fits = filters.includes('fits') ? budget : 0
      const installedOnly = filters.includes('installed')
      const ranked = React.useMemo(() => cards === null ? [] : sortCatalog(cards, query, sort, locale), [cards, query, sort, locale])
      const matches = React.useMemo(() => ranked.filter(item => (!filters.includes('tools') || item.tools)
        && (!filters.includes('vision') || item.vision) && (!fits || item.bytes <= fits)
        && (!installedOnly || item.quants.some((quant, index) =>
          (!fits || quant.bytes + item.projectorBytes <= fits) && installedVariant(item, quant, index, inventory)))),
      [ranked, filters, fits, installedOnly, inventory])
      const clear = () => { setQuery(''); setFilters([]); setShown(PAGE) }
      const act = async (kind, key, target) => {
        setBusy({ key })
        setFailure(null)
        try { await runAction(kind, target) }
        catch (failed) { setFailure({ key, message: message(failed) }) }
        finally { setBusy(null) }
      }
      const count = matches.length === 1 ? t('oneResult') : t('results', { count: matches.length.toLocaleString(locale) })
      return h('section', { className: 'jan-hub', 'aria-labelledby': 'jan-hub-heading' },
        h('header', { className: 'jan-hub-head' },
          h('h1', { id: 'jan-hub-heading' }, t('title')),
          h('p', null, t('lede')),
          h(Input, {
            className: 'jan-hub-search', type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'),
            icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }),
            onChange: event => { setQuery(event.target.value); setShown(PAGE) },
          }),
          cards !== null && h(CatalogControls, {
            t, cards, sort, count, filters, canAssessFit: budget > 0,
            setSort: value => { setSort(value); setShown(PAGE) },
            toggleFilter: filter => {
              setFilters(current => current.includes(filter) ? current.filter(value => value !== filter) : [...current, filter]); setShown(PAGE)
            },
          })),
        error
          ? h('div', { className: 'jan-hub-status' },
            h('p', { role: 'alert', className: 'jan-hub-error' }, t('error', { error })),
            h(Button, { variant: 'outline', size: 'sm', onClick: retry }, t('retry')))
          : cards === null
            ? h('p', { role: 'status', className: 'jan-hub-status' }, t('loading'))
            : !matches.length
              ? h('div', { className: 'jan-hub-empty' },
                h(IconSearchOutlineRegular, { size: 24, 'aria-hidden': true }),
                h('h2', null, t('empty')),
                h('p', null, t('emptyHint')),
                h(Button, { variant: 'outline', size: 'sm', onClick: clear }, t('clear')))
              : h(React.Fragment, null,
                h('ul', { className: 'jan-hub-list' }, matches.slice(0, shown).map(item => h(ModelCard, {
                  key: item.key, item, jobs, inventory, busy, t, locale, fits, installedOnly, smallestFirst: sort === 'size', openSettings,
                  engineError: local.phase === 'failed' ? local.error ?? '' : undefined,
                  failure: failure?.key === item.key ? failure.message : '',
                  act: (kind, key, target) => { void act(kind, key, target) },
                  cancel: target => { setAcknowledged(false); setConfirm(target) },
                }))),
                matches.length > shown && h('div', { className: 'jan-hub-more' },
                  h(Button, { variant: 'outline', size: 'sm', onClick: () => { setShown(value => value + PAGE) } }, t('more')))),
        h(RiskConfirmation, {
          open: confirm !== null, title: t('cancelTitle'),
          description: confirm ? t('cancelDescription', { name: confirm.job.name }) : '',
          acknowledgeLabel: t('discardAcknowledge'), cancelLabel: t('keepDownload'), closeLabel: t('keepDownload'), confirmLabel: t('discard'),
          acknowledged, onAcknowledgedChange: setAcknowledged, onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) { setConfirm(null); void act('cancel', confirm.key, confirm.job) } },
        }))
    }

    const CSS = `
      .jan-hub{box-sizing:border-box;overflow:auto;height:100%;padding:32px;max-width:100%;color:var(--dsw-alias-label-primary)}
      .jan-hub-head,.jan-hub-list,.jan-hub-status,.jan-hub-more,.jan-hub-empty{max-width:880px;margin-inline:auto}
      .jan-hub h1{font-size:24px;font-weight:500;margin:0 0 8px;text-wrap:balance}
      .jan-hub-head>p{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:0 0 16px;text-wrap:pretty}
      .jan-hub-search{box-sizing:border-box;width:100%}
      .jan-hub-toolbar{display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px 12px;margin-top:12px}
      .jan-hub-filters,.jan-hub-tags,.jan-hub-transfer-actions{display:flex;flex-wrap:wrap;gap:6px}
      .jan-hub-filters [aria-pressed=true]{background:var(--dsw-alias-bg-selected);--jan-button-outline-color:var(--dsw-alias-border-l4)}
      .jan-hub-count{flex-basis:100%;margin:4px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
      .jan-hub-list{list-style:none;padding:0;margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px}
      .jan-hub-card{background:var(--dsw-alias-settings-card-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
      .jan-hub-card h2,.jan-hub-empty h2{font-size:16px;font-weight:500;margin:0;overflow-wrap:anywhere;min-width:0}
      .jan-hub-tag{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
      .jan-hub-tag[data-installed]{background:var(--dsw-alias-bg-selected);color:var(--dsw-alias-label-primary)}
      .jan-hub-meta,.jan-hub-description{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .jan-hub-description{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .jan-hub-footer{margin-top:auto;padding-top:4px;display:grid;gap:8px}
      .jan-hub-quant{display:flex;gap:8px;align-items:center}
      .jan-hub-size,.jan-hub-transfer-details{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .jan-hub-size{white-space:nowrap}
      .jan-hub-variant{flex:1;width:0;min-width:0;font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;text-overflow:ellipsis}
      .jan-hub-variant:focus-visible,.jan-hub button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .jan-hub-card-action{display:flex;justify-content:flex-end}
      .jan-hub-transfer{display:grid;gap:6px;padding:10px 12px;background:var(--dsw-alias-bg-subtle);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .jan-hub-transfer-head,.jan-hub-transfer-details{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 8px}
      .jan-hub-transfer-head{font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
      .jan-hub-transfer progress{display:block;width:100%;height:8px;accent-color:var(--dsw-alias-button-primary-fill)}
      .jan-hub-transfer progress[value]{appearance:none;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);overflow:hidden}
      .jan-hub-transfer progress[value]::-webkit-progress-bar{background:var(--dsw-alias-border-l3);border-radius:999px}
      .jan-hub-transfer progress[value]::-webkit-progress-value{background:var(--dsw-alias-button-primary-fill);border-radius:999px}
      .jan-hub-transfer progress[value]::-moz-progress-bar{background:var(--dsw-alias-button-primary-fill);border-radius:999px}
      .jan-hub-transfer-actions{margin-top:2px}
      .jan-hub-status{margin-top:24px;font-size:14px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      .jan-hub-empty{box-sizing:border-box;margin-top:12px;padding:44px 12px;text-align:center;display:grid;justify-items:center;gap:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary)}
      .jan-hub-empty h2{color:var(--dsw-alias-label-primary)}
      .jan-hub-empty p{font-size:13px;margin:0 0 4px}
      .jan-hub .jan-hub-error{color:var(--dsw-alias-label-danger,var(--dsw-alias-state-error-primary));overflow-wrap:anywhere;font-size:13px;margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      .jan-hub .jan-hub-error p{margin:0}
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
          const runAction = async (kind, target) => {
            if (kind === 'download') await answer(remote.downloadRepoFile(target.repo, target.file))
            else if (kind === 'resume') await answer(remote.retryDownload(target.id))
            else if (kind === 'pause') await answer(remote.pauseDownload(target.id))
            else if (kind === 'cancel') await answer(remote.cancelDownload(target.id))
            else {
              if (kind === 'use') await answer(remote.setDefaultModel(target.id))
              // setDefaultModel also returns when the worker failed to start; that failure arrives only
              // through the followed state, and a chat opened on a route with no server has no model.
              const after = await settled(feed)
              if (after.phase === 'failed') throw new Error(t('startFailed', { error: after.error ?? '' }))
              await startLocalChat(after.provider)
            }
          }
          const openSettings = () => { ctx.get('settingsNavigation')?.open('models') }
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PANEL, locale: PANEL, inject: () => ({ hooks: { local: feed }, runAction, openSettings }),
          }, HubPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 5, label: () => t('title'),
          }, ({ size }) => h(IconAppsAddOutlineRegular, { size, 'aria-hidden': true })))
          // The composer's model menu offers the Hub beside Manage models.
          scope.slots.inject('conversation.input.model.options', () => scope.slots.register({
            name: 'conversation.input.model.options', id: PANEL, order: 10, locale: PANEL,
          }, ({ dismiss, t: copy }) => h(MenuItemButton, {
            icon: h(IconAppsAddOutlineRegular, { size: 16 }),
            onSelect: () => { dismiss(); scope.layout.selectPanel(PANEL) },
          }, copy('getLocal'))))
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
