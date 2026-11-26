window.__ModuleLoader__.load({
  id: '@janhq/jan-model-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      Button, Input, Menu, MenuItemButton, Modal, RiskConfirmation, SegmentedTabs, Tag, Toast, IconSearchOutlineRegular,
      IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconSparkleRegular,
      IconToolOutlineRegular, IconImageOutlineRegular, IconCheckCircleFillRegular,
    } = require('@janhq/jan-client-ui-primitives')

    const PANEL = 'jan-model-hub'
    // The Models cube jan-theme draws for this page's sidebar row, so the composer's Get local models
    // entry names the same place (the apps glyph belongs to the sidebar's More).
    const ModelsGlyph = ({ size }) => h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1, strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M8 1.5L14 4.75V11.25L8 14.5L2 11.25V4.75L8 1.5Z' }), h('path', { d: 'M2 4.75L8 8L14 4.75' }),
      h('path', { d: 'M8 8V14.5' }))
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
        progressLabel: 'Download progress for {name}', transferSize: '{received} of {total}', speed: '{size}/s', speedLeft: '{speed} · {duration} left',
        pause: 'Pause', resume: 'Resume', cancel: 'Cancel download', cancelTitle: 'Cancel this download?',
        cancelDescription: 'Cancel the download of {name} and discard its partial file. Pause instead to keep the file.',
        discardAcknowledge: 'Discard the partial model file.', keepDownload: 'Keep download', discard: 'Discard file',
        use: 'Use', using: 'Starting...', more: 'Show more',
        failed: 'Could not finish: {error}',
        startFailed: 'The local model could not start: {error}',
        downloadingForChat: 'Downloading {name}. This chat switches to it when it’s ready.', readyInChat: '{name} is ready in this chat.', downloadFailedForChat: '{name} didn’t download: {error}', openChat: 'Open chat', settings: 'Open Settings -> Models',
        explore: 'Explore', allModels: 'All models', views: 'Hub views', featured: 'Featured', details: 'See details',
        position: '{index} of {total}', previous: 'Previous', next: 'Next', seeAll: 'See all', close: 'Close',
        scrollBack: 'Scroll {name} back', scrollForward: 'Scroll {name} forward',
        'shelf.library': 'Your models', 'shelf.fits': 'Runs well on this computer', 'shelf.tools': 'Can use tools',
        'shelf.vision': 'Understands images', 'shelf.fresh': 'New in the catalog', 'shelf.small': 'Small and quick',
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
        progressLabel: '{name} 的下载进度', transferSize: '已下载 {received}，共 {total}', speed: '{size}/秒', speedLeft: '{speed} · 剩余 {duration}',
        pause: '暂停', resume: '继续', cancel: '取消下载', cancelTitle: '取消此下载？',
        cancelDescription: '取消下载 {name} 并丢弃已下载的部分。若要保留文件，请暂停下载',
        discardAcknowledge: '丢弃已下载的部分模型文件', keepDownload: '保留下载', discard: '丢弃文件',
        use: '使用', using: '正在启动...', more: '显示更多',
        failed: '未能完成：{error}',
        startFailed: '本地模型无法启动：{error}',
        downloadingForChat: '正在下载 {name}，完成后此对话会切换到它。', readyInChat: '{name} 已在此对话中就绪。', downloadFailedForChat: '{name} 下载失败：{error}', openChat: '打开对话', settings: '打开设置 -> 模型',
        explore: '探索', allModels: '全部模型', views: '模型中心视图', featured: '精选', details: '查看详情',
        position: '第 {index} 个，共 {total} 个', previous: '上一个', next: '下一个', seeAll: '查看全部', close: '关闭',
        scrollBack: '向后滚动{name}', scrollForward: '向前滚动{name}',
        'shelf.library': '你的模型', 'shelf.fits': '可在这台电脑上流畅运行', 'shelf.tools': '可使用工具',
        'shelf.vision': '能理解图片', 'shelf.fresh': '目录新增', 'shelf.small': '小巧快速',
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
        progressLabel: '{name} のダウンロード進捗', transferSize: '{total} 中 {received}', speed: '{size}/秒', speedLeft: '{speed} · 残り {duration}',
        pause: '一時停止', resume: '再開', cancel: 'ダウンロードをキャンセル', cancelTitle: 'このダウンロードをキャンセルしますか？',
        cancelDescription: '{name} のダウンロードをキャンセルし、途中までのファイルを破棄します。ファイルを残すには一時停止してください。',
        discardAcknowledge: '途中までダウンロードしたモデルファイルを破棄します。', keepDownload: 'ダウンロードを保持', discard: 'ファイルを破棄',
        use: '使用', using: '起動しています...', more: 'さらに表示',
        failed: '完了できませんでした: {error}',
        startFailed: 'ローカルモデルを起動できませんでした: {error}',
        downloadingForChat: '{name} をダウンロードしています。完了するとこのチャットで使われます。', readyInChat: '{name} をこのチャットで使えるようになりました。', downloadFailedForChat: '{name} をダウンロードできませんでした: {error}', openChat: 'チャットを開く', settings: '設定 -> モデルを開く',
        explore: '探索', allModels: 'すべてのモデル', views: 'Hub の表示', featured: 'おすすめ', details: '詳細を見る',
        position: '{total} 件中 {index} 件目', previous: '前へ', next: '次へ', seeAll: 'すべて表示', close: '閉じる',
        scrollBack: '{name}を戻る', scrollForward: '{name}を進む',
        'shelf.library': 'あなたのモデル', 'shelf.fits': 'このコンピューターで快適に動作', 'shelf.tools': 'ツールを使える',
        'shelf.vision': '画像を理解できる', 'shelf.fresh': 'カタログの新着', 'shelf.small': '小さくて速い',
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
        progressLabel: 'Progreso de descarga de {name}', transferSize: '{received} de {total}', speed: '{size}/s', speedLeft: '{speed} · quedan {duration}',
        pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar descarga', cancelTitle: '¿Cancelar esta descarga?',
        cancelDescription: 'Cancela la descarga de {name} y descarta el archivo parcial. Pausa la descarga para conservar el archivo.',
        discardAcknowledge: 'Descartar el archivo parcial del modelo.', keepDownload: 'Conservar descarga', discard: 'Descartar archivo',
        use: 'Usar', using: 'Iniciando...', more: 'Mostrar más',
        failed: 'No se pudo completar: {error}',
        startFailed: 'No se pudo iniciar el modelo local: {error}',
        downloadingForChat: 'Descargando {name}. Este chat lo usará cuando esté listo.', readyInChat: '{name} está listo en este chat.', downloadFailedForChat: 'No se pudo descargar {name}: {error}', openChat: 'Abrir chat', settings: 'Abrir Configuración -> Modelos',
        explore: 'Explorar', allModels: 'Todos los modelos', views: 'Vistas del Hub', featured: 'Destacado', details: 'Ver detalles',
        position: '{index} de {total}', previous: 'Anterior', next: 'Siguiente', seeAll: 'Ver todo', close: 'Cerrar',
        scrollBack: 'Desplazar {name} hacia atrás', scrollForward: 'Desplazar {name} hacia delante',
        'shelf.library': 'Tus modelos', 'shelf.fits': 'Funcionan bien en este equipo', 'shelf.tools': 'Pueden usar herramientas',
        'shelf.vision': 'Entienden imágenes', 'shelf.fresh': 'Novedades del catálogo', 'shelf.small': 'Pequeños y rápidos',
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
        progressLabel: 'Progression du téléchargement de {name}', transferSize: '{received} sur {total}', speed: '{size}/s', speedLeft: '{speed} · encore {duration}',
        pause: 'Suspendre', resume: 'Reprendre', cancel: 'Annuler le téléchargement', cancelTitle: 'Annuler ce téléchargement ?',
        cancelDescription: 'Annulez le téléchargement de {name} et supprimez le fichier partiel. Suspendez le téléchargement pour conserver le fichier.',
        discardAcknowledge: 'Supprimer le fichier partiel du modèle.', keepDownload: 'Conserver le téléchargement', discard: 'Supprimer le fichier',
        use: 'Utiliser', using: 'Démarrage...', more: 'Afficher plus',
        failed: 'Impossible de terminer : {error}',
        startFailed: 'Impossible de démarrer le modèle local : {error}',
        downloadingForChat: 'Téléchargement de {name}. Ce chat l’utilisera dès qu’il sera prêt.', readyInChat: '{name} est prêt dans ce chat.', downloadFailedForChat: 'Échec du téléchargement de {name} : {error}', openChat: 'Ouvrir le chat', settings: 'Ouvrir Paramètres -> Modèles',
        explore: 'Explorer', allModels: 'Tous les modèles', views: 'Vues du Hub', featured: 'À la une', details: 'Voir les détails',
        position: '{index} sur {total}', previous: 'Précédent', next: 'Suivant', seeAll: 'Tout voir', close: 'Fermer',
        scrollBack: 'Faire défiler {name} vers l’arrière', scrollForward: 'Faire défiler {name} vers l’avant',
        'shelf.library': 'Vos modèles', 'shelf.fits': 'Fonctionnent bien sur cet ordinateur', 'shelf.tools': 'Utilisent des outils',
        'shelf.vision': 'Comprennent les images', 'shelf.fresh': 'Nouveautés du catalogue', 'shelf.small': 'Petits et rapides',
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
        progressLabel: 'Downloadfortschritt für {name}', transferSize: '{received} von {total}', speed: '{size}/s', speedLeft: '{speed} · noch {duration}',
        pause: 'Pausieren', resume: 'Fortsetzen', cancel: 'Download abbrechen', cancelTitle: 'Diesen Download abbrechen?',
        cancelDescription: 'Brich den Download von {name} ab und lösche die unvollständige Datei. Pausiere den Download, um die Datei zu behalten.',
        discardAcknowledge: 'Die unvollständige Modelldatei löschen.', keepDownload: 'Download behalten', discard: 'Datei löschen',
        use: 'Verwenden', using: 'Wird gestartet...', more: 'Mehr anzeigen',
        failed: 'Konnte nicht abgeschlossen werden: {error}',
        startFailed: 'Das lokale Modell konnte nicht starten: {error}',
        downloadingForChat: '{name} wird geladen. Dieser Chat wechselt dazu, sobald es bereit ist.', readyInChat: '{name} ist in diesem Chat bereit.', downloadFailedForChat: '{name} konnte nicht geladen werden: {error}', openChat: 'Chat öffnen', settings: 'Einstellungen -> Modelle öffnen',
        explore: 'Entdecken', allModels: 'Alle Modelle', views: 'Hub-Ansichten', featured: 'Empfohlen', details: 'Details ansehen',
        position: '{index} von {total}', previous: 'Zurück', next: 'Weiter', seeAll: 'Alle anzeigen', close: 'Schließen',
        scrollBack: '{name} zurückblättern', scrollForward: '{name} weiterblättern',
        'shelf.library': 'Deine Modelle', 'shelf.fits': 'Laufen gut auf diesem Computer', 'shelf.tools': 'Können Werkzeuge nutzen',
        'shelf.vision': 'Verstehen Bilder', 'shelf.fresh': 'Neu im Katalog', 'shelf.small': 'Klein und schnell',
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
        progressLabel: 'Ход загрузки модели {name}', transferSize: '{received} из {total}', speed: '{size}/с', speedLeft: '{speed} · осталось {duration}',
        pause: 'Приостановить', resume: 'Продолжить', cancel: 'Отменить загрузку', cancelTitle: 'Отменить эту загрузку?',
        cancelDescription: 'Отмените загрузку {name} и удалите частично загруженный файл. Чтобы сохранить файл, приостановите загрузку.',
        discardAcknowledge: 'Удалить частично загруженный файл модели.', keepDownload: 'Сохранить загрузку', discard: 'Удалить файл',
        use: 'Использовать', using: 'Запуск...', more: 'Показать ещё',
        failed: 'Не удалось завершить: {error}',
        startFailed: 'Не удалось запустить локальную модель: {error}',
        downloadingForChat: 'Загружается {name}. Этот чат переключится на неё, когда она будет готова.', readyInChat: '{name} готова в этом чате.', downloadFailedForChat: 'Не удалось загрузить {name}: {error}', openChat: 'Открыть чат', settings: 'Открыть Настройки -> Модели',
        explore: 'Обзор', allModels: 'Все модели', views: 'Режимы хаба', featured: 'Рекомендуем', details: 'Подробнее',
        position: '{index} из {total}', previous: 'Назад', next: 'Вперёд', seeAll: 'Показать все', close: 'Закрыть',
        scrollBack: 'Прокрутить «{name}» назад', scrollForward: 'Прокрутить «{name}» вперёд',
        'shelf.library': 'Ваши модели', 'shelf.fits': 'Хорошо работают на этом компьютере', 'shelf.tools': 'Умеют использовать инструменты',
        'shelf.vision': 'Понимают изображения', 'shelf.fresh': 'Новое в каталоге', 'shelf.small': 'Маленькие и быстрые',
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
        progressLabel: 'Progresso do download de {name}', transferSize: '{received} de {total}', speed: '{size}/s', speedLeft: '{speed} · restam {duration}',
        pause: 'Pausar', resume: 'Retomar', cancel: 'Cancelar download', cancelTitle: 'Cancelar este download?',
        cancelDescription: 'Cancele o download de {name} e descarte o arquivo parcial. Pause o download para manter o arquivo.',
        discardAcknowledge: 'Descartar o arquivo parcial do modelo.', keepDownload: 'Manter download', discard: 'Descartar arquivo',
        use: 'Usar', using: 'Iniciando...', more: 'Mostrar mais',
        failed: 'Não foi possível concluir: {error}',
        startFailed: 'Não foi possível iniciar o modelo local: {error}',
        downloadingForChat: 'Baixando {name}. Este chat passa a usá-lo quando estiver pronto.', readyInChat: '{name} está pronto neste chat.', downloadFailedForChat: 'Não foi possível baixar {name}: {error}', openChat: 'Abrir chat', settings: 'Abrir Configurações -> Modelos',
        explore: 'Explorar', allModels: 'Todos os modelos', views: 'Visualizações do Hub', featured: 'Destaque', details: 'Ver detalhes',
        position: '{index} de {total}', previous: 'Anterior', next: 'Próximo', seeAll: 'Ver tudo', close: 'Fechar',
        scrollBack: 'Rolar {name} para trás', scrollForward: 'Rolar {name} para frente',
        'shelf.library': 'Seus modelos', 'shelf.fits': 'Rodam bem neste computador', 'shelf.tools': 'Usam ferramentas',
        'shelf.vision': 'Entendem imagens', 'shelf.fresh': 'Novidades do catálogo', 'shelf.small': 'Pequenos e rápidos',
      },
    }

    const message = error => error instanceof Error ? error.message : String(error)
    async function answer(call) {
      const result = await call
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const stem = file => file.replace(/\.gguf$/i, '')
    // A downloaded file's identity: its repository plus its GGUF stem. Two repositories can publish the same
    // stem as different installs, so a stem alone can match another repository's model or download.
    const artifact = (repo, name) => `${repo.toLowerCase()}/${name}`
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
    // Speed, plus the time left while the total is known; whole hours, minutes or
    // seconds rounded up, so the estimate never reads 0 before the end.
    const transferRate = (progress, t, locale) => {
      const speed = t('speed', { size: formatBytes(progress.bytesPerSecond, locale) })
      const seconds = progress.totalBytes > progress.receivedBytes ? (progress.totalBytes - progress.receivedBytes) / progress.bytesPerSecond : 0
      if (!(seconds > 0) || !Number.isFinite(seconds)) return speed
      const unit = seconds >= 3600 ? 'hour' : seconds >= 60 ? 'minute' : 'second'
      const duration = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' })
        .format(Math.ceil(seconds / (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1)))
      return t('speedLeft', { speed, duration })
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
        // One badly escaped catalog path drops only its own file.
        let file
        try { file = decodeURIComponent(match[2]) } catch { return [] }
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
        key: `${quants[0].repo}/${name}`, name, developer, created, updated, owner: quants[0].repo.split('/')[0],
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
          // Disposal settles the wait too, so the loop ends instead of hanging on a cleared timer.
          await new Promise((resolve) => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, 1000)
            controller.signal.addEventListener('abort', done, { once: true })
          })
        }
      })()
      return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        dispose: () => controller.abort(),
      }
    }

    // The followed state once the local server has finished starting `id` or failed; `starting` and
    // `checking` are transient, and the feed can trail the call that ended them, so a state still naming
    // the previous default is not settled yet. Loading a large model into memory can take a minute; past
    // this the start counts as unfinished.
    const SETTLE_MS = 120000
    function settled(feed, id) {
      const done = state => state.phase === 'failed'
        || (state.phase !== 'starting' && state.phase !== 'checking' && state.model?.id === id)
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
          filter === 'fits' && !canAssessFit ? null : h('button', {
            key: filter, type: 'button', className: 'jan-hub-chip', 'aria-pressed': filters.includes(filter),
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
          status === 'downloading' && progress.bytesPerSecond > 0 && h('span', null, transferRate(progress, t, locale))),
        job.error && h('p', { role: 'alert', className: 'jan-hub-error' }, t('failed', { error: job.error })),
        h('div', { className: 'jan-hub-transfer-actions' },
          job.paused || job.error !== undefined
            ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => run('resume', job) }, t(job.paused ? 'resume' : 'retry'))
            : h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => run('pause', job) }, t('pause')),
          h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => cancel(job) }, t('cancel'))))
    }

    function installedVariant(item, quant, index, installed) {
      return installed.models.get(artifact(quant.repo, quant.name))
        ?? (index === item.recommended ? installed.curated.get(quant.repo.toLowerCase()) : undefined)
    }

    function ModelCard({ item, jobs, inventory, act, cancel, busy, failure, engineError, openSettings, fits, installedOnly, smallestFirst, detail = false, t, locale }) {
      const [requested, setChoice] = React.useState(null)
      const variants = item.quants.map((quant, index) => ({
        quant, index, job: jobs.get(artifact(quant.repo, quant.name)), installed: installedVariant(item, quant, index, inventory),
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
      return h(detail ? 'div' : 'li', { className: 'jan-hub-card', 'aria-busy': working, 'data-detail': detail ? '' : undefined },
        !detail && h('h2', null, item.name),
        h('p', { className: 'jan-hub-meta' }, [
          item.developer && t('by', { developer: item.developer }),
          t('downloads', { count: item.downloads.toLocaleString(locale) }),
        ].filter(Boolean).join(' - ')),
        item.description && h('p', { className: 'jan-hub-description' }, item.description),
        h(Chips, { item, installed: installed !== undefined, t }),
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

    const SHELF_SIZE = 12
    // Publishers of Jan's own models; they are featured ahead of everything else.
    const HOUSE = new Set(['janhq', 'menlo'])
    const hue = text => [...text].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 360, 7)
    // Each developer keeps one hue, so a model's art and its glow read as the same family everywhere;
    // once the publisher's picture is known, its own colours replace the hue.
    const art = (item, tint) => ({ '--jan-hub-hue': hue(item.developer || item.name), ...(tint && { '--jan-hub-a': tint.a, '--jan-hub-b': tint.b }) })
    const hex = (r, g, b) => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`
    // A picture's colours as { a, b }: its two strongest hues weighted by how vivid and how large they
    // are, or its average colour when it is nearly grey. Returns undefined when the pixels are unreadable.
    function tintOf(img) {
      const SIZE = 32
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = SIZE
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return undefined
      let data
      try { context.drawImage(img, 0, 0, SIZE, SIZE); data = context.getImageData(0, 0, SIZE, SIZE).data } catch { return undefined }
      const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
      let opaque = 0, vivid = 0, r = 0, g = 0, b = 0
      for (let at = 0; at < data.length; at += 4) {
        if (data[at + 3] < 128) continue
        const [pr, pg, pb] = [data[at], data[at + 1], data[at + 2]]
        opaque += 1; r += pr; g += pg; b += pb
        const max = Math.max(pr, pg, pb), chroma = max - Math.min(pr, pg, pb)
        if (max < 40 || chroma / max < 0.25) continue
        vivid += 1
        const h6 = max === pr ? ((pg - pb) / chroma + 6) % 6 : max === pg ? (pb - pr) / chroma + 2 : (pr - pg) / chroma + 4
        const bin = bins[Math.floor(h6 * 4) % 24]
        const weight = chroma / 255
        bin.weight += weight; bin.r += pr * weight; bin.g += pg * weight; bin.b += pb * weight
      }
      if (opaque === 0) return undefined
      if (vivid / opaque < 0.06) { const grey = hex(r / opaque, g / opaque, b / opaque); return { a: grey, b: grey } }
      const [first, second] = [...bins].sort((x, y) => y.weight - x.weight)
      const colour = bin => hex(bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight)
      return { a: colour(first), b: second.weight >= first.weight * 0.25 ? colour(second) : colour(first) }
    }
    const initial = item => (item.developer || item.name).trim().charAt(0).toUpperCase()

    // Hugging Face profile pictures of the account that publishes each model. The API sends
    // CORS headers, so the page asks it directly; one lookup per account is shared by every
    // tile, a few run at a time, and answers persist in localStorage so a revisit draws them at once.
    const avatars = (() => {
      const KEY = 'jan-model-hub.avatars.v1'
      const HIT_MS = 7 * 86_400_000
      const MISS_MS = 86_400_000
      const RETRY_MS = 60_000
      const PARALLEL = 4
      const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
      let storage
      try { storage = window.localStorage } catch { storage = undefined }
      let saved = {}
      try { saved = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {} } catch { saved = {} }
      // owner -> picture URL, or null when the account has none Jan shows; owner -> the picture's tint.
      const known = new Map()
      const tints = new Map()
      for (const [owner, entry] of Object.entries(saved)) {
        if (entry && Date.now() - entry.at < (entry.url ? HIT_MS : MISS_MS)) { known.set(owner, entry.url ?? null); if (entry.tint) tints.set(owner, entry.tint) }
        else delete saved[owner]
      }
      const tintListeners = new Map()
      const failedAt = new Map()
      const listeners = new Map()
      const queue = []
      let running = 0
      let saving = false
      const save = () => {
        if (saving || !storage) return
        saving = true
        setTimeout(() => {
          saving = false
          try { storage.setItem(KEY, JSON.stringify(saved)) } catch { /* full or blocked storage keeps the session cache only */ }
        }, 1000)
      }
      // Listeners are notified once; a later watch after a failed lookup queues a fresh one.
      const settle = (owner, url, persist) => {
        known.set(owner, url)
        if (persist) { saved[owner] = { url, at: Date.now() }; save() }
        const waiting = listeners.get(owner)
        listeners.delete(owner)
        for (const listener of waiting ?? []) listener(url)
      }
      // Default pictures (huggingface.co/avatars/*.svg) are generic, so the monogram reads better.
      const usable = url => typeof url === 'string' && /^https:\/\/cdn-avatars\.huggingface\.co\//.test(url) ? url : null
      async function lookup(owner) {
        for (const kind of ['organizations', 'users']) {
          const response = await fetch(`https://huggingface.co/api/${kind}/${encodeURIComponent(owner)}/avatar`)
          if (response.status === 404) continue
          if (!response.ok) throw new Error(`avatar ${response.status}`)
          return usable((await response.json())?.avatarUrl)
        }
        return null
      }
      function pump() {
        while (running < PARALLEL && queue.length > 0) {
          const owner = queue.shift()
          running += 1
          lookup(owner).then(url => settle(owner, url, true), () => { failedAt.set(owner, Date.now()); settle(owner, null, false); known.delete(owner) })
            .finally(() => { running -= 1; pump() })
        }
      }
      return {
        /** The cached answer: a URL, null for none, or undefined when not known yet. */
        peek: owner => known.get(owner),
        /** Call `listener` with the owner's picture once known; returns the unsubscribe. */
        watch(owner, listener) {
          if (!owner || !OWNER.test(owner)) return () => {}
          if (known.has(owner)) { listener(known.get(owner)); return () => {} }
          let set = listeners.get(owner)
          if (!set) {
            listeners.set(owner, set = new Set())
            if (!(Date.now() - (failedAt.get(owner) ?? -Infinity) < RETRY_MS)) { queue.push(owner); pump() }
          }
          set.add(listener)
          return () => { set.delete(listener); if (set.size === 0 && listeners.get(owner) === set) { listeners.delete(owner); const at = queue.indexOf(owner); if (at >= 0) queue.splice(at, 1) } }
        },
        /** A picture that failed to load is dropped, so the next session asks again. */
        broken(owner) { delete saved[owner]; tints.delete(owner); save(); settle(owner, null, false) },
        peekTint: owner => tints.get(owner),
        /** Call `listener` whenever the owner's tint is learned; returns the unsubscribe. */
        watchTint(owner, listener) {
          let set = tintListeners.get(owner)
          if (!set) tintListeners.set(owner, set = new Set())
          set.add(listener)
          return () => set.delete(listener)
        },
        /** Reads a decoded picture's colours once per account and keeps them with the picture's URL. */
        learnTint(owner, img) {
          if (!owner || tints.has(owner)) return
          const tint = tintOf(img)
          if (!tint) return
          tints.set(owner, tint)
          if (saved[owner]) { saved[owner].tint = tint; save() }
          for (const listener of tintListeners.get(owner) ?? []) listener(tint)
        },
      }
    })()
    function useAvatar(owner) {
      const [url, setUrl] = React.useState(() => avatars.peek(owner))
      React.useEffect(() => { setUrl(avatars.peek(owner)); return avatars.watch(owner, setUrl) }, [owner])
      return url
    }
    function useTint(owner) {
      const [tint, setTint] = React.useState(() => avatars.peekTint(owner))
      React.useEffect(() => { setTint(avatars.peekTint(owner)); return avatars.watchTint(owner, setTint) }, [owner])
      return tint
    }
    // The monogram stays underneath until the picture has decoded, so tiles never flash empty.
    // `crossOrigin` keeps the pixels readable (the CDN allows any origin) so the tint can be sampled.
    function Art({ item, className }) {
      const url = useAvatar(item.owner)
      return h('span', { className, 'aria-hidden': true }, initial(item),
        url && h('img', {
          src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: false, referrerPolicy: 'no-referrer', crossOrigin: 'anonymous',
          onLoad: event => { event.currentTarget.dataset.loaded = ''; avatars.learnTint(item.owner, event.currentTarget) },
          onError: () => avatars.broken(item.owner),
        }))
    }
    const owns = (item, inventory) => item.quants.some((quant, index) => installedVariant(item, quant, index, inventory) !== undefined)
    const transferOf = (item, jobs) => item.quants.map(quant => jobs.get(artifact(quant.repo, quant.name))).find(Boolean)
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

    // Tags read the same on tiles, the spotlight and full cards.
    function Chips({ item, installed, t }) {
      if (!item.tools && !item.vision && !installed) return null
      return h('span', { className: 'jan-hub-tags' },
        item.tools && h(Tag, { className: 'jan-hub-tag' }, h(IconToolOutlineRegular, { size: 12 }), t('tools')),
        item.vision && h(Tag, { className: 'jan-hub-tag' }, h(IconImageOutlineRegular, { size: 12 }), t('vision')),
        installed && h(Tag, { tone: 'success', className: 'jan-hub-tag' }, h(IconCheckCircleFillRegular, { size: 12 }), t('installed')))
    }

    function Tile({ item, inventory, jobs, open, t, locale }) {
      const quant = item.quants[item.recommended]
      const job = transferOf(item, jobs)
      const progress = job?.progress
      const percent = progress?.totalBytes > 0 ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : undefined
      const size = Number.isFinite(quant.bytes) ? formatBytes(quant.bytes + item.projectorBytes, locale) : quant.size
      return h('li', { className: 'jan-hub-tile' },
        h('button', { type: 'button', className: 'jan-hub-tile-button', style: art(item, useTint(item.owner)), onClick: () => open(item.key) },
          h(Art, { item, className: 'jan-hub-art' }),
          h('span', { className: 'jan-hub-tile-name' }, item.name),
          h('span', { className: 'jan-hub-tile-meta' }, [item.developer, size, item.downloads > 0 && t('downloads', { count: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(item.downloads) })].filter(Boolean).join(' - ')),
          h(Chips, { item, installed: owns(item, inventory), t }),
          job && h('progress', { className: 'jan-hub-tile-progress', max: 100, value: percent, 'aria-label': t('progressLabel', { name: job.name }) })))
    }

    // One themed row of tiles that scrolls sideways; "See all" opens the matching full list.
    function Shelf({ id, items, seeAll, t, ...tile }) {
      const row = React.useRef(null)
      if (items.length === 0) return null
      const title = t(`shelf.${id}`)
      const scroll = (direction) => {
        const list = row.current
        list?.scrollBy?.({ left: direction * list.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
      return h('section', { className: 'jan-hub-shelf', 'aria-labelledby': `jan-hub-shelf-${id}` },
        h('div', { className: 'jan-hub-shelf-head' },
          h('h2', { id: `jan-hub-shelf-${id}` }, title),
          h('div', { className: 'jan-hub-shelf-actions' },
            h(Button, { variant: 'ghost', size: 'sm', onClick: seeAll }, t('seeAll')),
            h(Button, {
              variant: 'ghost', size: 'sm', 'aria-label': t('scrollBack', { name: title }),
              icon: h(IconChevronLeftOutlineRegular, { size: 16 }), onClick: () => scroll(-1),
            }),
            h(Button, {
              variant: 'ghost', size: 'sm', 'aria-label': t('scrollForward', { name: title }),
              icon: h(IconChevronRightOutlineRegular, { size: 16 }), onClick: () => scroll(1),
            }))),
        h('ul', { ref: row, className: 'jan-hub-shelf-row' }, items.map(item => h(Tile, { key: item.key, item, t, ...tile }))))
    }

    function Spotlight({ items, inventory, open, t, locale }) {
      const [at, setAt] = React.useState(0)
      const index = at % items.length
      const item = items[index]
      const step = delta => setAt(value => (value % items.length + delta + items.length) % items.length)
      const tint = useTint(item.owner)
      return h('section', { className: 'jan-hub-spotlight', style: art(item, tint), 'aria-roledescription': 'carousel', 'aria-label': t('featured') },
        h('div', { className: 'jan-hub-spotlight-body', key: item.key },
          h('p', { className: 'jan-hub-eyebrow' }, h(IconSparkleRegular, { size: 14 }), t('featured')),
          h('h2', null, item.name),
          h('p', { className: 'jan-hub-meta' }, [
            item.developer && t('by', { developer: item.developer }),
            t('downloads', { count: item.downloads.toLocaleString(locale) }),
          ].filter(Boolean).join(' - ')),
          item.description && h('p', { className: 'jan-hub-description' }, item.description),
          h(Chips, { item, installed: owns(item, inventory), t }),
          h('div', { className: 'jan-hub-spotlight-actions' },
            h(Button, { variant: 'primary', size: 'sm', onClick: () => open(item.key) }, t('details')))),
        h(Art, { item, className: 'jan-hub-spotlight-art' }),
        items.length > 1 && h('div', { className: 'jan-hub-spotlight-nav' },
          h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('previous'), icon: h(IconChevronLeftOutlineRegular, { size: 16 }), onClick: () => step(-1) }),
          h('span', null, t('position', { index: (index + 1).toLocaleString(locale), total: items.length.toLocaleString(locale) })),
          h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('next'), icon: h(IconChevronRightOutlineRegular, { size: 16 }), onClick: () => step(1) })))
    }

    /**
     * The Hub's front page: a featured model and themed shelves, each leading into the full list.
     * @param props.seeAll - open the full list with `{ filters?, sort? }` applied.
     * @param props.open - show one model's details by card key.
     */
    function Explore({ cards, budget, inventory, jobs, open, seeAll, t, locale }) {
      const { spotlight, shelves } = React.useMemo(() => {
        const popular = sortCatalog(cards, '', 'downloads', locale)
        const fits = budget > 0 ? popular.filter(item => item.bytes <= budget) : []
        const fresh = cards.some(item => item.updated) ? 'updated' : cards.some(item => item.created) ? 'added' : undefined
        const pool = (fits.length ? fits : popular).filter(item => !owns(item, inventory))
        // Jan's own models (janhq, Menlo) lead the spotlight, then the most popular that suit this computer.
        const house = popular.filter(item => HOUSE.has(item.owner?.toLowerCase()))
        return {
          spotlight: [...new Set([...house, ...(pool.length ? pool : popular)])].slice(0, 5),
          shelves: [
            { id: 'library', items: popular.filter(item => owns(item, inventory) || transferOf(item, jobs)), filters: ['installed'] },
            { id: 'fits', items: fits, filters: ['fits'] },
            { id: 'tools', items: popular.filter(item => item.tools), filters: ['tools'] },
            { id: 'vision', items: popular.filter(item => item.vision), filters: ['vision'] },
            fresh && { id: 'fresh', items: sortCatalog(cards, '', fresh, locale), sort: fresh },
            { id: 'small', items: popular.filter(item => item.bytes <= 3e9).sort((a, b) => a.bytes - b.bytes), sort: 'size' },
          ].filter(Boolean),
        }
      }, [cards, budget, inventory, jobs, locale])
      return h('div', { className: 'jan-hub-explore' },
        spotlight.length > 0 && h(Spotlight, { items: spotlight, inventory, open, t, locale }),
        shelves.map(shelf => h(Shelf, {
          key: shelf.id, id: shelf.id, items: shelf.items.slice(0, SHELF_SIZE), inventory, jobs, open, t, locale,
          seeAll: () => seeAll({ filters: shelf.filters ?? [], sort: shelf.sort }),
        })))
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
      const [view, setView] = React.useState('explore')
      const scroller = React.useRef(null)
      // Switching views starts the new view at its top, not at the old view's scroll offset.
      React.useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [view])
      const [detail, setDetail] = React.useState(null)
      const budget = memoryBudget(local.hardware)
      const inventory = React.useMemo(() => {
        const byId = new Map(local.models.map(model => [model.id, model]))
        return {
          models: new Map(local.models.filter(model => model.repo !== undefined).map(model => [artifact(model.repo, model.name), model])),
          // Curated installs in Settings stand for the recommended Hub variant of their repository.
          curated: new Map(local.catalog.filter(entry => entry.installed).map(entry => [entry.repo.toLowerCase(), byId.get(entry.id)])),
        }
      }, [local.models, local.catalog])
      const jobs = React.useMemo(() => new Map(local.downloads.map(job => [artifact(job.repo, job.name), job])), [local.downloads])
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
      const seeAll = ({ filters: next, sort: order }) => {
        setFilters(next)
        if (order) setSort(order)
        setShown(PAGE)
        setView('all')
      }
      const opened = detail === null || cards === null ? undefined : cards.find(item => item.key === detail)
      const cardProps = item => ({
        item, jobs, inventory, busy, t, locale, fits, installedOnly, smallestFirst: sort === 'size', openSettings,
        engineError: local.phase === 'failed' ? local.error ?? '' : undefined,
        failure: failure?.key === item.key ? failure.message : '',
        act: (kind, key, target) => { void act(kind, key, target) },
        cancel: target => { setAcknowledged(false); setConfirm(target) },
      })
      return h('section', { className: 'jan-hub', 'aria-labelledby': 'jan-hub-heading' },
        h('header', { className: 'jan-hub-head', 'data-window-drag': '' },
          h('h1', { id: 'jan-hub-heading' }, t('title')),
          h('p', null, t('lede'))),
        h('div', { ref: scroller, className: 'jan-hub-scroll' }, h('div', { className: 'jan-hub-column' },
          h(SegmentedTabs, {
            className: 'jan-hub-views', size: 'sm', label: t('views'), value: view, onChange: setView,
            items: [
              { value: 'explore', label: t('explore'), id: 'jan-hub-tab-explore', panelId: 'jan-hub-panel' },
              { value: 'all', label: t('allModels'), id: 'jan-hub-tab-all', panelId: 'jan-hub-panel' },
            ],
          }),
          h(Input, {
            className: 'jan-hub-search', type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'),
            icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }),
            onChange: (event) => {
              setQuery(event.target.value)
              setShown(PAGE)
              if (event.target.value.trim()) setView('all')
            },
          }),
          view === 'all' && cards !== null && h(CatalogControls, {
            t, cards, sort, count, filters, canAssessFit: budget > 0,
            setSort: value => { setSort(value); setShown(PAGE) },
            toggleFilter: filter => {
              setFilters(current => current.includes(filter) ? current.filter(value => value !== filter) : [...current, filter]); setShown(PAGE)
            },
          }),
        h('div', { id: 'jan-hub-panel', role: 'tabpanel', className: 'jan-hub-body', 'aria-labelledby': `jan-hub-tab-${view}` }, error
          ? h('div', { className: 'jan-hub-status' },
            h('p', { role: 'alert', className: 'jan-hub-error' }, t('error', { error })),
            h(Button, { variant: 'outline', size: 'sm', onClick: retry }, t('retry')))
          : cards === null
            ? h('p', { role: 'status', className: 'jan-hub-status' }, t('loading'))
            : view === 'explore'
              ? h(Explore, { cards, budget, inventory, jobs, open: setDetail, seeAll, t, locale })
            : !matches.length
              ? h('div', { className: 'jan-hub-empty' },
                h(IconSearchOutlineRegular, { size: 24, 'aria-hidden': true }),
                h('h2', null, t('empty')),
                h('p', null, t('emptyHint')),
                h(Button, { variant: 'outline', size: 'sm', onClick: clear }, t('clear')))
              : h(React.Fragment, null,
                h('ul', { className: 'jan-hub-list' }, matches.slice(0, shown).map(item => h(ModelCard, { key: item.key, ...cardProps(item) }))),
                matches.length > shown && h('div', { className: 'jan-hub-more' },
                  h(Button, { variant: 'outline', size: 'sm', onClick: () => { setShown(value => value + PAGE) } }, t('more'))))))),
        h(Modal, {
          open: opened !== undefined, onClose: () => setDetail(null), title: opened?.name ?? '', closeLabel: t('close'),
          contentClassName: 'jan-hub-detail',
        }, opened && h(ModelCard, { ...cardProps(opened), fits: 0, installedOnly: false, detail: true })),
        h(RiskConfirmation, {
          open: confirm !== null, title: t('cancelTitle'),
          description: confirm ? t('cancelDescription', { name: confirm.job.name }) : '',
          acknowledgeLabel: t('discardAcknowledge'), cancelLabel: t('keepDownload'), closeLabel: t('keepDownload'), confirmLabel: t('discard'),
          acknowledged, onAcknowledgedChange: setAcknowledged, onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) { setConfirm(null); void act('cancel', confirm.key, confirm.job) } },
        }))
    }

    const CSS = `
      .jan-hub{--jan-hub-inset:clamp(24px,4vw,48px);box-sizing:border-box;display:flex;flex-direction:column;height:100%;color:var(--dsw-alias-label-primary)}
      @media(max-width:767px){.jan-hub{--jan-hub-inset:20px}}
      .jan-hub-head,.jan-hub-column{box-sizing:border-box;width:100%;max-width:calc(960px + 2 * var(--jan-hub-inset));margin:0 auto;padding-inline:var(--jan-hub-inset)}
      .jan-hub-head{flex:none;padding-top:calc(28px + var(--jan-frame-top-clearance,0px))}
      .jan-hub h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
      .jan-hub-head>p{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);text-wrap:pretty}
      .jan-hub-scroll{flex:1;min-height:0;overflow-x:hidden;overflow-y:auto}
      .jan-hub-column{display:flex;flex-direction:column;gap:16px;padding-top:24px;padding-bottom:48px}
      .jan-hub-views{align-self:flex-start;min-width:220px}
      .jan-hub-search{box-sizing:border-box;width:100%}
      .jan-hub-search input::placeholder{color:var(--dsw-alias-label-tertiary)}
      .jan-hub-toolbar{display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px 12px}
      .jan-hub-filters,.jan-hub-tags,.jan-hub-transfer-actions{display:flex;flex-wrap:wrap;gap:6px}
      .jan-hub-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:22px}
      .jan-hub-chip[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
      @media(hover:hover){.jan-hub-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
      .jan-hub-count{flex-basis:100%;margin:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .jan-hub-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px}
      .jan-hub-card{background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
      .jan-hub-card h2,.jan-hub-empty h2{font-size:14px;font-weight:500;line-height:20px;margin:0;overflow-wrap:anywhere;min-width:0}
      .jan-hub-tag{display:inline-flex;align-items:center;gap:4px}
      .jan-hub-meta,.jan-hub-description{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .jan-hub-description{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .jan-hub-footer{margin-top:auto;padding-top:4px;display:grid;gap:8px}
      .jan-hub-quant{display:flex;gap:8px;align-items:center}
      .jan-hub-size,.jan-hub-transfer-details{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .jan-hub-size{white-space:nowrap}
      .jan-hub-variant{flex:1;width:0;min-width:0;font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;text-overflow:ellipsis}
      .jan-hub-variant:focus-visible,.jan-hub-chip:focus-visible,.jan-hub-tile-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
      .jan-hub-card-action{display:flex;justify-content:flex-end}
      .jan-hub-transfer{display:grid;gap:6px;padding:10px 12px;background:var(--dsw-alias-bg-subtle);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px}
      .jan-hub-transfer-head,.jan-hub-transfer-details{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 8px}
      .jan-hub-option-progress{margin-left:auto;padding-left:8px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
      .jan-hub-transfer-head{font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
      .jan-hub-transfer progress{display:block;width:100%;height:8px;accent-color:var(--dsw-alias-button-primary-fill)}
      .jan-hub-transfer progress[value]{appearance:none;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);overflow:hidden}
      .jan-hub-transfer progress[value]::-webkit-progress-bar{background:var(--dsw-alias-border-l3);border-radius:999px}
      .jan-hub-transfer progress[value]::-webkit-progress-value{background:var(--dsw-alias-button-primary-fill);border-radius:999px}
      .jan-hub-transfer progress[value]::-moz-progress-bar{background:var(--dsw-alias-button-primary-fill);border-radius:999px}
      .jan-hub-transfer-actions{margin-top:2px}
      .jan-hub-status{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      .jan-hub-empty{box-sizing:border-box;padding:64px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;border:0.5px dashed var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
      .jan-hub-empty h2{color:var(--dsw-alias-label-primary)}
      .jan-hub-empty p{margin:0}
      .jan-hub .jan-hub-error{color:var(--dsw-alias-label-danger,var(--dsw-alias-state-error-primary));overflow-wrap:anywhere;font-size:13px;margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      .jan-hub .jan-hub-error p{margin:0}
      .jan-hub-more{display:flex;justify-content:center}
      .jan-hub-explore{display:grid;gap:28px}
      .jan-hub-spotlight{--jan-hub-a:hsl(var(--jan-hub-hue) 70% 55%);--jan-hub-b:hsl(calc(var(--jan-hub-hue) + 60) 70% 45%);position:relative;overflow:hidden;border-radius:var(--dsw-radius-lg,12px);padding:24px;min-height:200px;display:flex;flex-direction:column;justify-content:space-between;gap:16px;border:0.5px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,color-mix(in oklab,var(--jan-hub-a) 22%,var(--dsw-alias-settings-card-fill)),color-mix(in oklab,var(--jan-hub-b) 8%,var(--dsw-alias-settings-card-fill)))}
      .jan-hub-spotlight-body{position:relative;z-index:1;display:grid;justify-items:start;gap:8px;max-width:min(520px,100%);animation:jan-hub-rise var(--ds-transition-duration-slow) var(--ds-ease-out)}
      .jan-hub-spotlight h2{font-size:20px;font-weight:500;line-height:28px;margin:0;text-wrap:balance;overflow-wrap:anywhere}
      .jan-hub-eyebrow{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
      .jan-hub-spotlight-art{position:absolute;right:-8px;bottom:-48px;font-size:220px;font-weight:700;line-height:1;color:color-mix(in oklab,var(--jan-hub-a) 30%,transparent);user-select:none;pointer-events:none}
      .jan-hub-spotlight-art img{position:absolute;right:48px;bottom:88px;width:120px;height:120px;border-radius:28px;object-fit:cover;background:#fff;box-shadow:0 12px 32px color-mix(in oklab,var(--jan-hub-a) 35%,transparent);opacity:0;transition:opacity var(--ds-transition-duration) var(--ds-ease-out)}
      .jan-hub-spotlight-art:has(img[data-loaded]){color:transparent}
      .jan-hub-spotlight-actions{display:flex;gap:8px;margin-top:4px}
      .jan-hub-spotlight-nav{position:relative;z-index:1;display:flex;align-items:center;gap:4px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
      .jan-hub-shelf{display:grid;gap:8px;min-width:0}
      .jan-hub-shelf-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .jan-hub-shelf h2{font-size:14px;font-weight:500;line-height:20px;margin:0}
      .jan-hub-shelf-actions{display:flex;align-items:center;gap:2px}
      .jan-hub-shelf-row{list-style:none;margin:0;padding:4px 2px 10px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(180px,200px);gap:12px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:thin}
      .jan-hub-tile{scroll-snap-align:start;min-width:0}
      .jan-hub-tile-button{all:unset;box-sizing:border-box;width:100%;height:100%;display:grid;align-content:start;gap:6px;padding:12px;border-radius:var(--dsw-radius-lg,12px);cursor:pointer;background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-border-l2);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
      .jan-hub-tile-button:hover{transform:translateY(-2px);border-color:var(--dsw-alias-border-l4);box-shadow:0 8px 20px color-mix(in oklab,var(--jan-hub-a,hsl(var(--jan-hub-hue) 60% 45%)) 20%,transparent)}
      .jan-hub-tile-button:active{transform:scale(.98)}
      .jan-hub-art{position:relative;overflow:hidden;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;font-size:18px;font-weight:600;color:#fff;background:linear-gradient(135deg,hsl(var(--jan-hub-hue) 70% 55%),hsl(calc(var(--jan-hub-hue) + 60) 70% 42%))}
      .jan-hub-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff;opacity:0;transition:opacity var(--ds-transition-duration) var(--ds-ease-out)}
      .jan-hub-art img[data-loaded],.jan-hub-spotlight-art img[data-loaded]{opacity:1}
      @media (prefers-reduced-motion: reduce){.jan-hub-art img,.jan-hub-spotlight-art img{transition:none}}
      .jan-hub-tile-name{font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .jan-hub-tile-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
      .jan-hub-tile-progress{appearance:none;display:block;width:100%;height:4px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);overflow:hidden}
      .jan-hub-tile-progress::-webkit-progress-bar{background:var(--dsw-alias-border-l3)}
      .jan-hub-tile-progress::-webkit-progress-value{background:var(--dsw-alias-button-primary-fill)}
      .jan-hub-card[data-detail]{background:none;border:0;padding:0}
      .jan-hub-card[data-detail] .jan-hub-description{display:block;-webkit-line-clamp:unset}
      @keyframes jan-hub-rise{from{opacity:0;transform:translateY(6px)}}
      @media(prefers-reduced-motion:reduce){.jan-hub-spotlight-body{animation:none}.jan-hub-tile-button{transition:none}.jan-hub-tile-button:hover,.jan-hub-tile-button:active{transform:none}}
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
          // Open a new chat and resolve with the Session that request opened, not whichever blank is showing.
          const openBlank = () => new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { reject(new Error('the new chat did not open')) }, 10000)
            scope.layout.selectPanel(null)
            scope.uiWorkspace.startSession(undefined, { onOpen: id => { clearTimeout(timeout); resolve({ id }) } })
          })
          // The local server once it is serving the new default; a failed or unfinished start is an error, so
          // the Hub never leaves for a chat whose route has no server.
          const started = async (id) => {
            const after = await settled(feed, id)
            if (after.phase !== 'running' || after.model?.id !== id) throw new Error(t('startFailed', { error: after.error ?? after.phase }))
            return after
          }
          // Chats name the clicked model by its id; the route's `local` alias follows whichever model is
          // default later, which would switch this chat behind the user's back.
          const selectLocal = (sessionId, provider, id) => answer(scope.remote.session.selectModel({ sessionId, provider, model: id }))
          // Open a new chat on the local model the Host just made default.
          const startLocalChat = async (provider, id) => {
            const blank = await openBlank()
            await selectLocal(blank.id, provider, id)
          }
          // The chat whose model menu opened the Hub; Use and Download return to it. Leaving the Hub, or
          // opening it any other way, forgets it.
          let origin = null, fromPicker = false
          scope.effect(() => {
            let was = scope.layout.panelInfo.getSnapshot().activePanelId
            return scope.layout.panelInfo.subscribe(() => {
              const now = scope.layout.panelInfo.getSnapshot().activePanelId
              if (now === was) return
              if (was === PANEL || (now === PANEL && !fromPicker)) origin = null
              fromPicker = false
              was = now
            })
          }, 'jan-model-hub: origin chat')
          const exists = sessionId => scope.sessions.list.getSnapshot().byId[sessionId] !== undefined
          let showToast, serial = 0
          const notify = toast => showToast?.({ key: ++serial, ...toast })
          const returnToChat = async (provider, sessionId, id) => {
            scope.layout.selectPanel(null)
            scope.uiWorkspace.openSession(sessionId)
            await selectLocal(sessionId, provider, id)
          }
          // Downloads started for a chat: model id -> { sessionId, name, seen }. Memory only; after a reload the
          // download continues in Downloads but the chat is not switched.
          const pending = new Map()
          const pendingListeners = new Set()
          const publishPending = () => { for (const listener of pendingListeners) listener() }
          const finishForChat = async (id, entry) => {
            try {
              await answer(remote.setDefaultModel(id))
              const after = await started(id)
              if (exists(entry.sessionId)) await selectLocal(entry.sessionId, after.provider, id)
              notify({ text: t('readyInChat', { name: entry.name }), sessionId: entry.sessionId })
            } catch (error) {
              // The file is installed; only starting or selecting it failed, and the error says which.
              notify({ text: message(error), sessionId: entry.sessionId })
            }
          }
          // A small file can finish before the download call returns, so a new entry is checked at once; a
          // job missing from the feed counts as stopped only after the feed has shown it.
          const checkPending = () => {
            const state = feed.getSnapshot()
            for (const [id, entry] of pending) {
              const job = state.downloads.find(download => download.id === id)
              if (state.models.some(model => model.id === id)) {
                pending.delete(id)
                void finishForChat(id, entry)
              } else if (job !== undefined && job.error === undefined) {
                entry.seen = true
              } else if (job !== undefined || entry.seen) {
                pending.delete(id)
                notify({ text: t('downloadFailedForChat', { name: entry.name, error: job?.error ?? '' }), sessionId: entry.sessionId })
              }
            }
            // Progress changes the percent beside Get local models.
            publishPending()
          }
          scope.effect(() => feed.subscribe(checkPending), 'jan-model-hub: downloads for chats')
          const runAction = async (kind, target) => {
            if (kind === 'download') {
              const modelId = await answer(remote.downloadRepoFile(target.repo, target.file))
              const back = origin
              if (back !== null && exists(back)) {
                const name = target.name ?? target.file
                pending.set(modelId, { sessionId: back, name, seen: false })
                scope.layout.selectPanel(null)
                scope.uiWorkspace.openSession(back)
                notify({ text: t('downloadingForChat', { name }), sessionId: back })
                checkPending()
              }
            } else if (kind === 'resume') await answer(remote.retryDownload(target.id))
            else if (kind === 'pause') await answer(remote.pauseDownload(target.id))
            else if (kind === 'cancel') await answer(remote.cancelDownload(target.id))
            else {
              if (kind === 'use') await answer(remote.setDefaultModel(target.id))
              // setDefaultModel also returns when the worker failed to start; that failure arrives only
              // through the followed state, and a chat opened on a route with no server has no model.
              const after = await started(target.id)
              const back = origin
              if (back !== null && exists(back)) await returnToChat(after.provider, back, target.id)
              else await startLocalChat(after.provider, target.id)
            }
          }
          const openSettings = () => { ctx.get('settingsNavigation')?.open('models') }
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PANEL, locale: PANEL, inject: () => ({ hooks: { local: feed }, runAction, openSettings }),
          }, HubPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 5, label: () => t('title'),
          }, ModelsGlyph))
          // The composer's model menu offers the Hub beside Manage models.
          scope.slots.inject('conversation.input.model.options', () => scope.slots.register({
            name: 'conversation.input.model.options', id: PANEL, order: 10, locale: PANEL,
          }, ({ dismiss, sessionId, t: copy }) => h(MenuItemButton, {
            icon: h(ModelsGlyph, { size: 16 }),
            onSelect: () => { dismiss(); fromPicker = true; scope.layout.selectPanel(PANEL); origin = sessionId },
          }, copy('getLocal'), h(PendingPercent, { sessionId }))))
          // Progress of a download this chat is waiting for, beside Get local models.
          function PendingPercent({ sessionId }) {
            const percent = React.useSyncExternalStore(listener => { pendingListeners.add(listener); return () => pendingListeners.delete(listener) }, () => percentFor(sessionId))
            if (percent === '') return null
            return h('span', { className: 'jan-hub-option-progress' }, percent)
          }
          // The percent text for the chat's pending download, or '' when it waits for none.
          function percentFor(sessionId) {
            for (const [id, entry] of pending) {
              if (entry.sessionId !== sessionId) continue
              const progress = feed.getSnapshot().downloads.find(download => download.id === id)?.progress
              if (!(progress?.totalBytes > 0)) return '…'
              return `${Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100))}%`
            }
            return ''
          }
          function HubToasts() {
            const [toast, setToast] = React.useState(null)
            React.useEffect(() => {
              showToast = setToast
              return () => { if (showToast === setToast) showToast = undefined }
            }, [])
            return toast && h(Toast, { key: toast.key, text: toast.text, holdMs: 7000,
              actions: exists(toast.sessionId) ? [{ label: t('openChat'), onClick: () => { setToast(null); scope.uiWorkspace.openSession(toast.sessionId) } }] : [],
              onDone: () => { setToast(null) } })
          }
          scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: `${PANEL}.toasts` }, HubToasts))
          // A one-shot request from the desktop welcome flow to open the Hub.
          const requested = () => {
            if (sessionStorage.getItem('jan:open-panel') !== PANEL) return
            sessionStorage.removeItem('jan:open-panel')
            scope.layout.selectPanel(PANEL)
          }
          requested()
          window.addEventListener('jan:open-panel', requested)
          scope.effect(() => () => window.removeEventListener('jan:open-panel', requested), 'jan-model-hub: open requests')
          // A one-shot request from onboarding: a new chat on a local model. An installed model is used at
          // once; otherwise the chat opens right away and follows the download like any chat that asked for one.
          const chatRequested = () => {
            const raw = sessionStorage.getItem('jan:local-model-chat')
            if (raw === null) return
            sessionStorage.removeItem('jan:local-model-chat')
            let target
            try { target = JSON.parse(raw) } catch { return }
            void chatOn(target).catch(error => { notify({ text: message(error) }) })
          }
          const chatOn = async target => {
            if (target.installed) {
              await answer(remote.setDefaultModel(target.id))
              const after = await started(target.id)
              return startLocalChat(after.provider, target.id)
            }
            const modelId = target.file !== undefined ? await answer(remote.downloadRepoFile(target.repo, target.file))
              : (await answer(remote.downloadModel(target.id)), target.id)
            const blank = await openBlank()
            pending.set(modelId, { sessionId: blank.id, name: target.name, seen: false })
            notify({ text: t('downloadingForChat', { name: target.name }), sessionId: blank.id })
            checkPending()
          }
          chatRequested()
          window.addEventListener('jan:local-model-chat', chatRequested)
          scope.effect(() => () => window.removeEventListener('jan:local-model-chat', chatRequested), 'jan-model-hub: local chat requests')
        })
      },
    }
  },
})
