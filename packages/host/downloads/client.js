window.__ModuleLoader__.load({
  id: '@janhq/jan-downloads',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Button, RiskConfirmation, Tooltip, IconDownloadOutlineRegular, IconTrashOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const { createPortal } = require('react-dom')
    const { MenuSurface, useDismissOnOutsidePointer, isBehindModal, IconCloseOutlineRegular, IconPauseOutlineRegular,
      IconPlayOutlineRegular, IconRefreshOutlineRegular, IconDatabaseOutlineRegular, IconSettingsOutlineRegular,
      IconCordisPluginOutlineRegular, IconMicrophoneOutlineRegular, IconDeliverDocRegular, IconLinkOutlineRegular,
      IconFolderOpenOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const KIND_ICONS = { model: IconDatabaseOutlineRegular, update: IconDownloadOutlineRegular, backend: IconSettingsOutlineRegular,
      plugin: IconCordisPluginOutlineRegular, voice: IconMicrophoneOutlineRegular, file: IconDeliverDocRegular }
    const ACTION_ICONS = { cancel: IconCloseOutlineRegular, pause: IconPauseOutlineRegular, resume: IconPlayOutlineRegular,
      retry: IconRefreshOutlineRegular, open: IconLinkOutlineRegular, reveal: IconFolderOpenOutlineRegular }
    const API = new URL('api/downloads.inbox', document.baseURI)
    const PANEL = 'jan-downloads'

    const COPY = {
      en: {
        title: 'Downloads',
        activeProgress: 'Downloads: {percent} downloaded', activeTransfer: 'Downloads: Download in progress',
        inboxEmpty: 'Your download progress will appear here', clearFinished: 'Clear finished', manage: 'Manage downloads',
        unread: 'Downloads: New activity', inboxError: 'Download activity is temporarily unavailable', actionError: 'Could not complete the download action. {error}',
        'status.done': 'Done', 'status.cancelled': 'Cancelled', open: 'Open', reveal: 'Show in folder', eta: '{duration} left',
        'kind.model': 'Model', 'kind.update': 'App update', 'kind.backend': 'Backend', 'kind.plugin': 'Plugin', 'kind.voice': 'Voice', 'kind.file': 'File',
        byteFraction: '{received} / {total}',
        lede: 'Local model downloads on this computer. Pause keeps the partial file so you can resume.',
        stale: '{error} The list may be out of date.',
        loading: 'Loading downloads...',
        empty: 'No downloads yet',
        emptyHint: 'Download a model from Settings -> Models. Its progress will appear here.',
        'status.failed': 'Failed', 'status.paused': 'Paused', 'status.queued': 'Waiting', 'status.downloading': 'Downloading',
        progressLabel: 'Download progress for {name}',
        queuedHint: 'Starts when the downloads ahead of it finish',
        transferred: '{size} transferred', progress: '{received} of {total} ({percent})', speed: '{size}/s',
        pause: 'Pause', pausing: 'Pausing...', resume: 'Resume', resuming: 'Resuming...',
        retry: 'Retry', retrying: 'Retrying...', dismiss: 'Dismiss', dismissing: 'Dismissing...',
        cancel: 'Cancel download', cancelling: 'Cancelling...',
        'confirm.title': 'Cancel this download?',
        'confirm.description': 'Cancel the download of {name} and discard its partial file. To keep the file, choose Keep download and then Pause.',
        'confirm.acknowledge': 'Discard the partial model file.',
        'confirm.keep': 'Keep download', 'confirm.discard': 'Discard file',
        'storage.title': 'On this computer',
        'storage.total': '{size} used',
        'storage.loading': 'Checking what Jan has downloaded...',
        'storage.empty': 'Nothing stored on this computer yet.',
        'storage.error': 'Could not check downloads on disk: {error}',
        'storage.deleteError': 'Could not delete {name}: {error}',
        'storage.kind.model': 'Model', 'storage.kind.partial': 'Partial download', 'storage.kind.cache': 'Cache',
        'storage.delete': 'Delete', 'storage.deleteLabel': 'Delete {name}', 'storage.deleting': 'Deleting...',
        'storage.confirmTitle': 'Delete this download?',
        'storage.confirmModel': 'Delete {name} ({size}) from this computer. You will need to download it again to use it.',
        'storage.confirmPartial': 'Delete {name} ({size}) from this computer. Jan will need to download these bytes again.',
        'storage.confirmCache': 'Delete {name} ({size}) from this computer. Jan may download it again when needed.',
        'storage.acknowledge': 'I understand this removes the file from this computer.',
      },
      zh: {
        title: '下载',
        activeProgress: '下载：已完成 {percent}', activeTransfer: '下载：正在下载',
        inboxEmpty: '下载进度将在此显示', clearFinished: '清除已结束的下载', manage: '管理下载',
        unread: '下载：有新动态', inboxError: '暂时无法查看下载动态', actionError: '无法完成下载操作：{error}',
        'status.done': '已完成', 'status.cancelled': '已取消', open: '打开', reveal: '在文件夹中显示', eta: '剩余 {duration}',
        'kind.model': '模型', 'kind.update': '应用更新', 'kind.backend': '后端', 'kind.plugin': '插件', 'kind.voice': '语音', 'kind.file': '文件',
        byteFraction: '{received} / {total}',
        lede: '此电脑上的本地模型下载。暂停会保留已下载的部分，以便稍后继续。',
        stale: '{error} 列表可能不是最新的。',
        loading: '正在加载下载列表...',
        empty: '暂无下载',
        emptyHint: '在设置 -> 模型中下载模型，下载进度会显示在这里。',
        'status.failed': '失败', 'status.paused': '已暂停', 'status.queued': '等待中', 'status.downloading': '下载中',
        progressLabel: '{name}的下载进度',
        queuedHint: '前面的下载完成后开始',
        transferred: '已传输 {size}', progress: '已下载 {received}，共 {total}（{percent}）', speed: '{size}/秒',
        pause: '暂停', pausing: '正在暂停...', resume: '继续', resuming: '正在恢复...',
        retry: '重试', retrying: '正在重试...', dismiss: '关闭', dismissing: '正在关闭...',
        cancel: '取消下载', cancelling: '正在取消...',
        'confirm.title': '取消此下载？',
        'confirm.description': '取消下载 {name}，并丢弃已下载的部分。如需保留文件，请先选择「保留下载」，再选择「暂停」。',
        'confirm.acknowledge': '丢弃已下载的部分模型文件。',
        'confirm.keep': '保留下载', 'confirm.discard': '丢弃文件',
      },
      ja: {
        title: 'ダウンロード',
        activeProgress: 'ダウンロード: {percent} 完了', activeTransfer: 'ダウンロード: 進行中',
        inboxEmpty: 'ダウンロードの進捗がここに表示されます', clearFinished: '終了した項目を消去', manage: 'ダウンロードを管理',
        unread: 'ダウンロード: 新しいアクティビティ', inboxError: 'ダウンロード状況を一時的に表示できません', actionError: 'ダウンロード操作を完了できませんでした。{error}',
        'status.done': '完了', 'status.cancelled': 'キャンセル済み', open: '開く', reveal: 'フォルダーに表示', eta: '残り {duration}',
        'kind.model': 'モデル', 'kind.update': 'アプリの更新', 'kind.backend': 'バックエンド', 'kind.plugin': 'プラグイン', 'kind.voice': '音声', 'kind.file': 'ファイル',
        byteFraction: '{received} / {total}',
        lede: 'このコンピューターでのローカルモデルのダウンロードです。一時停止すると途中までのファイルが残り、後で再開できます。',
        stale: '{error} 一覧が最新でない可能性があります。',
        loading: 'ダウンロード一覧を読み込み中...',
        empty: 'ダウンロードはまだありません',
        emptyHint: '設定 -> モデルでモデルをダウンロードすると、ここに進捗が表示されます。',
        'status.failed': '失敗', 'status.paused': '一時停止中', 'status.queued': '待機中', 'status.downloading': 'ダウンロード中',
        progressLabel: '{name}のダウンロード進捗',
        queuedHint: '先のダウンロードが完了すると開始します',
        transferred: '{size} 転送済み', progress: '{total} 中 {received}（{percent}）', speed: '{size}/秒',
        pause: '一時停止', pausing: '一時停止しています...', resume: '再開', resuming: '再開中...',
        retry: '再試行', retrying: '再試行中...', dismiss: '閉じる', dismissing: '閉じています...',
        cancel: 'ダウンロードをキャンセル', cancelling: 'キャンセル中...',
        'confirm.title': 'このダウンロードをキャンセルしますか？',
        'confirm.description': '{name} のダウンロードをキャンセルし、途中までのファイルを破棄します。ファイルを残すには「ダウンロードを保持」を選び、続けて「一時停止」を選んでください。',
        'confirm.acknowledge': '途中までダウンロードしたモデルファイルを破棄します。',
        'confirm.keep': 'ダウンロードを保持', 'confirm.discard': 'ファイルを破棄',
      },
      es: {
        title: 'Descargas',
        activeProgress: 'Descargas: {percent} completado', activeTransfer: 'Descargas: Descarga en curso',
        inboxEmpty: 'Aquí aparecerá el progreso de tus descargas', clearFinished: 'Borrar finalizadas', manage: 'Gestionar descargas',
        unread: 'Descargas: actividad nueva', inboxError: 'La actividad de descarga no está disponible temporalmente', actionError: 'No se pudo completar la acción de descarga. {error}',
        'status.done': 'Finalizada', 'status.cancelled': 'Cancelada', open: 'Abrir', reveal: 'Mostrar en carpeta', eta: 'Quedan {duration}',
        'kind.model': 'Modelo', 'kind.update': 'Actualización de la app', 'kind.backend': 'Motor', 'kind.plugin': 'Complemento', 'kind.voice': 'Voz', 'kind.file': 'Archivo',
        byteFraction: '{received} / {total}',
        lede: 'Descargas de modelos locales en este equipo. Al pausar una descarga, se conserva el archivo parcial para que puedas reanudarla.',
        stale: '{error} Es posible que la lista no esté actualizada.',
        loading: 'Cargando descargas...',
        empty: 'Aún no hay descargas',
        emptyHint: 'Descarga un modelo desde Configuración -> Modelos. El progreso aparecerá aquí.',
        'status.failed': 'Fallida', 'status.paused': 'Pausada', 'status.queued': 'En espera', 'status.downloading': 'Descargando',
        progressLabel: 'Progreso de descarga de {name}',
        queuedHint: 'Comenzará cuando terminen las descargas anteriores',
        transferred: '{size} transferidos', progress: '{received} de {total} ({percent})', speed: '{size}/s',
        pause: 'Pausar', pausing: 'Pausando...', resume: 'Reanudar', resuming: 'Reanudando...',
        retry: 'Reintentar', retrying: 'Reintentando...', dismiss: 'Cerrar', dismissing: 'Cerrando...',
        cancel: 'Cancelar descarga', cancelling: 'Cancelando...',
        'confirm.title': '¿Cancelar esta descarga?',
        'confirm.description': 'Cancela la descarga de {name} y descarta el archivo parcial. Para conservar el archivo, elige Conservar descarga y luego Pausar.',
        'confirm.acknowledge': 'Descartar el archivo parcial del modelo.',
        'confirm.keep': 'Conservar descarga', 'confirm.discard': 'Descartar archivo',
      },
      fr: {
        title: 'Téléchargements',
        activeProgress: 'Téléchargements : {percent} terminé', activeTransfer: 'Téléchargements : Téléchargement en cours',
        inboxEmpty: 'La progression de vos téléchargements apparaîtra ici', clearFinished: 'Effacer les téléchargements terminés', manage: 'Gérer les téléchargements',
        unread: 'Téléchargements : nouvelle activité', inboxError: 'L’activité des téléchargements est temporairement indisponible', actionError: 'Impossible de terminer l’action de téléchargement. {error}',
        'status.done': 'Terminé', 'status.cancelled': 'Annulé', open: 'Ouvrir', reveal: 'Afficher dans le dossier', eta: 'Encore {duration}',
        'kind.model': 'Modèle', 'kind.update': 'Mise à jour de l’application', 'kind.backend': 'Moteur', 'kind.plugin': 'Extension', 'kind.voice': 'Voix', 'kind.file': 'Fichier',
        byteFraction: '{received} / {total}',
        lede: 'Téléchargements de modèles locaux sur cet ordinateur. La mise en pause conserve le fichier partiel pour permettre la reprise.',
        stale: '{error} La liste n’est peut-être pas à jour.',
        loading: 'Chargement des téléchargements...',
        empty: 'Aucun téléchargement pour le moment',
        emptyHint: 'Téléchargez un modèle depuis Paramètres -> Modèles. La progression s’affichera ici.',
        'status.failed': 'Échec', 'status.paused': 'En pause', 'status.queued': 'En attente', 'status.downloading': 'Téléchargement',
        progressLabel: 'Progression du téléchargement de {name}',
        queuedHint: 'Commencera à la fin des téléchargements précédents',
        transferred: '{size} transférés', progress: '{received} sur {total} ({percent})', speed: '{size}/s',
        pause: 'Suspendre', pausing: 'Mise en pause...', resume: 'Reprendre', resuming: 'Reprise...',
        retry: 'Réessayer', retrying: 'Nouvelle tentative...', dismiss: 'Fermer', dismissing: 'Fermeture...',
        cancel: 'Annuler le téléchargement', cancelling: 'Annulation...',
        'confirm.title': 'Annuler ce téléchargement ?',
        'confirm.description': 'Annulez le téléchargement de {name} et supprimez le fichier partiel. Pour garder ce fichier, choisissez « Conserver le téléchargement », puis « Suspendre ».',
        'confirm.acknowledge': 'Supprimer le fichier partiel du modèle.',
        'confirm.keep': 'Conserver le téléchargement', 'confirm.discard': 'Supprimer le fichier',
      },
      de: {
        title: 'Downloads',
        activeProgress: 'Downloads: {percent} heruntergeladen', activeTransfer: 'Downloads: Download läuft',
        inboxEmpty: 'Hier erscheint der Fortschritt deiner Downloads', clearFinished: 'Beendete Downloads entfernen', manage: 'Downloads verwalten',
        unread: 'Downloads: Neue Aktivität', inboxError: 'Downloadaktivität ist vorübergehend nicht verfügbar', actionError: 'Die Downloadaktion konnte nicht abgeschlossen werden. {error}',
        'status.done': 'Fertig', 'status.cancelled': 'Abgebrochen', open: 'Öffnen', reveal: 'Im Ordner anzeigen', eta: 'Noch {duration}',
        'kind.model': 'Modell', 'kind.update': 'App-Update', 'kind.backend': 'Backend', 'kind.plugin': 'Erweiterung', 'kind.voice': 'Sprache', 'kind.file': 'Datei',
        byteFraction: '{received} / {total}',
        lede: 'Downloads lokaler Modelle auf diesem Computer. Beim Pausieren bleibt die unvollständige Datei erhalten, damit du den Download fortsetzen kannst.',
        stale: '{error} Die Liste ist möglicherweise nicht aktuell.',
        loading: 'Downloads werden geladen...',
        empty: 'Noch keine Downloads',
        emptyHint: 'Lade ein Modell unter Einstellungen -> Modelle herunter. Der Fortschritt wird hier angezeigt.',
        'status.failed': 'Fehlgeschlagen', 'status.paused': 'Pausiert', 'status.queued': 'Wartet', 'status.downloading': 'Wird heruntergeladen',
        progressLabel: 'Downloadfortschritt für {name}',
        queuedHint: 'Startet, sobald die vorherigen Downloads abgeschlossen sind',
        transferred: '{size} übertragen', progress: '{received} von {total} ({percent})', speed: '{size}/s',
        pause: 'Pausieren', pausing: 'Wird pausiert...', resume: 'Fortsetzen', resuming: 'Wird fortgesetzt...',
        retry: 'Erneut versuchen', retrying: 'Erneuter Versuch...', dismiss: 'Schließen', dismissing: 'Wird geschlossen...',
        cancel: 'Download abbrechen', cancelling: 'Wird abgebrochen...',
        'confirm.title': 'Diesen Download abbrechen?',
        'confirm.description': 'Der Download von {name} wird abgebrochen und die unvollständige Datei gelöscht. Um die Datei zu behalten, wähle „Download behalten“ und dann „Pausieren“.',
        'confirm.acknowledge': 'Die unvollständige Modelldatei löschen.',
        'confirm.keep': 'Download behalten', 'confirm.discard': 'Datei löschen',
      },
      ru: {
        title: 'Загрузки',
        activeProgress: 'Загрузки: загружено {percent}', activeTransfer: 'Загрузки: идёт загрузка',
        inboxEmpty: 'Здесь будет отображаться ход загрузок', clearFinished: 'Убрать завершённые', manage: 'Управление загрузками',
        unread: 'Загрузки: новая активность', inboxError: 'Сведения о загрузках временно недоступны', actionError: 'Не удалось выполнить действие с загрузкой. {error}',
        'status.done': 'Готово', 'status.cancelled': 'Отменено', open: 'Открыть', reveal: 'Показать в папке', eta: 'Осталось {duration}',
        'kind.model': 'Модель', 'kind.update': 'Обновление приложения', 'kind.backend': 'Сервер', 'kind.plugin': 'Плагин', 'kind.voice': 'Голос', 'kind.file': 'Файл',
        byteFraction: '{received} / {total}',
        lede: 'Загрузки локальных моделей на этом компьютере. При паузе частично загруженный файл сохраняется, чтобы можно было продолжить загрузку.',
        stale: '{error} Возможно, список устарел.',
        loading: 'Загрузка списка...',
        empty: 'Загрузок пока нет',
        emptyHint: 'Загрузите модель в разделе Настройки -> Модели. Здесь будет отображаться ход загрузки.',
        'status.failed': 'Не удалось', 'status.paused': 'Приостановлена', 'status.queued': 'Ожидает', 'status.downloading': 'Загрузка',
        progressLabel: 'Ход загрузки модели {name}',
        queuedHint: 'Начнётся после завершения предыдущих загрузок',
        transferred: 'Передано {size}', progress: '{received} из {total} ({percent})', speed: '{size}/с',
        pause: 'Приостановить', pausing: 'Приостановка...', resume: 'Возобновить', resuming: 'Возобновление...',
        retry: 'Повторить', retrying: 'Повторная попытка...', dismiss: 'Закрыть', dismissing: 'Закрытие...',
        cancel: 'Отменить загрузку', cancelling: 'Отмена...',
        'confirm.title': 'Отменить эту загрузку?',
        'confirm.description': 'Загрузка модели {name} будет отменена, а частично загруженный файл удалён. Чтобы сохранить файл, выберите «Сохранить загрузку», а затем «Приостановить».',
        'confirm.acknowledge': 'Удалить частично загруженный файл модели.',
        'confirm.keep': 'Сохранить загрузку', 'confirm.discard': 'Удалить файл',
      },
      pt: {
        title: 'Downloads',
        activeProgress: 'Downloads: {percent} concluído', activeTransfer: 'Downloads: Download em andamento',
        inboxEmpty: 'O progresso dos seus downloads aparecerá aqui', clearFinished: 'Limpar finalizados', manage: 'Gerenciar downloads',
        unread: 'Downloads: nova atividade', inboxError: 'A atividade de download está temporariamente indisponível', actionError: 'Não foi possível concluir a ação de download. {error}',
        'status.done': 'Concluído', 'status.cancelled': 'Cancelado', open: 'Abrir', reveal: 'Mostrar na pasta', eta: 'Restam {duration}',
        'kind.model': 'Modelo', 'kind.update': 'Atualização do aplicativo', 'kind.backend': 'Backend', 'kind.plugin': 'Plugin', 'kind.voice': 'Voz', 'kind.file': 'Arquivo',
        byteFraction: '{received} / {total}',
        lede: 'Downloads de modelos locais neste computador. Ao pausar, o arquivo parcial é mantido para que você possa retomar o download.',
        stale: '{error} A lista pode estar desatualizada.',
        loading: 'Carregando downloads...',
        empty: 'Nenhum download ainda',
        emptyHint: 'Baixe um modelo em Configurações -> Modelos. O progresso aparecerá aqui.',
        'status.failed': 'Falha', 'status.paused': 'Pausado', 'status.queued': 'Na fila', 'status.downloading': 'Baixando',
        progressLabel: 'Progresso do download de {name}',
        queuedHint: 'Começa quando os downloads anteriores terminarem',
        transferred: '{size} transferidos', progress: '{received} de {total} ({percent})', speed: '{size}/s',
        pause: 'Pausar', pausing: 'Pausando...', resume: 'Retomar', resuming: 'Retomando...',
        retry: 'Tentar novamente', retrying: 'Tentando novamente...', dismiss: 'Fechar', dismissing: 'Fechando...',
        cancel: 'Cancelar download', cancelling: 'Cancelando...',
        'confirm.title': 'Cancelar este download?',
        'confirm.description': 'Cancele o download de {name} e descarte o arquivo parcial. Para manter o arquivo, escolha Manter download e depois Pausar.',
        'confirm.acknowledge': 'Descartar o arquivo parcial do modelo.',
        'confirm.keep': 'Manter download', 'confirm.discard': 'Descartar arquivo',
      },
    }

    // Decimal units, as Settings -> Models prints sizes.
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const bytes = (value, locale) => {
      const size = Number.isFinite(value) && value > 0 ? value : 0
      const unit = size < 1000 ? 0 : Math.min(Math.floor(Math.log10(size) / 3), units.length - 1)
      return `${(size / 1000 ** unit).toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`
    }
    const message = error => error instanceof Error ? error.message : String(error)
    async function answer(call) {
      const result = await call
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const statusOf = item => item.error !== undefined ? 'failed' : item.paused ? 'paused' : item.progress === undefined ? 'queued' : 'downloading'
    const percentOf = progress => progress?.totalBytes > 0 ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : null
    const formatPercent = (percent, locale) => (percent / 100).toLocaleString(locale, { style: 'percent' })

    // One reconnecting follower of the Host's local model state; a dropped
    // stream keeps the last list on screen and says it may be stale.
    function follow(remote) {
      const controller = new AbortController()
      const listeners = new Set()
      let snapshot = { downloads: null, models: null, error: '', storageRevision: 0 }
      let timer
      const set = next => { snapshot = { ...snapshot, ...next }; for (const listener of listeners) listener() }
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            for await (const state of remote.follow(controller.signal)) {
              const previous = snapshot.downloads
              const changed = snapshot.error !== '' || previous === null || previous.length !== state.downloads.length || state.downloads.some((item, index) =>
                item.id !== previous[index].id || statusOf(item) !== statusOf(previous[index]))
              const models = state.models ?? []
              const modelsChanged = snapshot.models === null || models.length !== snapshot.models.length || models.some((model, index) =>
                model.id !== snapshot.models[index].id || model.status !== snapshot.models[index].status)
              set({ downloads: state.downloads, models, error: '', storageRevision: snapshot.storageRevision + Number(changed || modelsChanged) })
            }
          } catch (error) {
            if (controller.signal.aborted) return
            set({ error: message(error) })
          }
          const { promise, resolve } = Promise.withResolvers()
          timer = setTimeout(resolve, 1000)
          await promise
        }
      })()
      return {
        get: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        dispose: () => { controller.abort(); clearTimeout(timer) },
      }
    }

    function createInboxFeed() {
      const controller = new AbortController(), { signal } = controller
      const listeners = new Set()
      let snapshot = { items: [], active: { count: 0, percent: null }, unseen: null, loading: true, unavailable: false }
      const set = next => { snapshot = next; for (const listener of listeners) listener() }
      void (async () => {
        while (!signal.aborted) {
          try {
            const response = await fetch(API, { signal })
            if (!response.ok || !response.body) throw new Error(`Downloads feed: ${response.status}`)
            let pending = ''
            for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
              pending += text
              let end
              while ((end = pending.indexOf('\n')) >= 0) {
                set({ ...JSON.parse(pending.slice(0, end)), loading: false, unavailable: false })
                pending = pending.slice(end + 1)
              }
            }
          } catch { if (signal.aborted) return }
          if (signal.aborted) return
          set({ ...snapshot, loading: false, unavailable: true })
          const { promise, resolve } = Promise.withResolvers()
          const timer = setTimeout(resolve, 1000)
          signal.addEventListener('abort', resolve, { once: true })
          await promise
          clearTimeout(timer)
          signal.removeEventListener('abort', resolve)
        }
      })()
      return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        dispose: () => controller.abort(),
        async request(method, args) {
          const response = await fetch(API, { signal, method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method, ...args }) })
          if (!response.ok) throw new Error((await response.json())?.error ?? `HTTP ${response.status}`)
        },
      }
    }

    function StoredDownloads({ remote, t, locale, storageRevision }) {
      const [items, setItems] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const [deleteError, setDeleteError] = React.useState('')
      const [refresh, setRefresh] = React.useState(0)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [deleting, setDeleting] = React.useState(null)
      React.useEffect(() => {
        let current = true
        const load = async () => {
          try {
            const next = await answer(remote.listStoredDownloads())
            if (current) { setItems(next); setLoadError('') }
          } catch (error) {
            if (current) setLoadError(message(error))
          }
        }
        void load()
        return () => { current = false }
      }, [remote, storageRevision, refresh])

      const remove = async item => {
        setConfirm(null)
        setDeleting(item.path)
        setDeleteError('')
        try { await answer(remote.deleteStoredDownload(item.path)) }
        catch (error) { setDeleteError(t('storage.deleteError', { name: item.name, error: message(error) })) }
        finally { setRefresh(value => value + 1); setDeleting(null) }
      }
      const total = items?.reduce((sum, item) => sum + item.bytes, 0)
      return h('section', { className: 'jan-downloads-storage', 'aria-labelledby': 'jan-downloads-storage-heading' },
        h('div', { className: 'jan-downloads-task-head' },
          h('h2', { id: 'jan-downloads-storage-heading' }, t('storage.title')),
          total === undefined ? null : h('span', { className: 'jan-downloads-state jan-downloads-size' }, t('storage.total', { size: bytes(total, locale) }))),
        loadError ? h('p', { role: 'alert', className: 'jan-downloads-error' }, t('storage.error', { error: loadError })) : null,
        deleteError ? h('p', { role: 'alert', className: 'jan-downloads-error' }, deleteError) : null,
        items === null ? (loadError ? null : h('p', { role: 'status' }, t('storage.loading')))
          : items.length === 0 ? h('p', null, t('storage.empty'))
            : h('ul', { className: 'jan-downloads-stored-list' }, items.map(item => h('li', {
              key: item.path, className: 'jan-downloads-stored-row', 'aria-busy': deleting === item.path,
            }, h('div', { className: 'jan-downloads-stored-info' },
              h('h3', { title: item.path }, item.name),
              h('p', { className: 'jan-downloads-size' }, `${t(`storage.kind.${item.kind}`)} - ${bytes(item.bytes, locale)}`),
              item.inUse ? h('p', null, item.inUse) : null),
            h(Button, { variant: 'outline', size: 'sm', disabled: deleting !== null || Boolean(item.inUse),
              'aria-label': t('storage.deleteLabel', { name: item.name }),
              onClick: () => { setAcknowledged(false); setConfirm(item) },
            }, h(IconTrashOutlineRegular, { size: 16, 'aria-hidden': true }), deleting === item.path ? t('storage.deleting') : t('storage.delete'))))),
        h(RiskConfirmation, {
          open: confirm !== null,
          title: t('storage.confirmTitle'),
          description: confirm === null ? '' : t(confirm.kind === 'model' ? 'storage.confirmModel' : confirm.kind === 'partial' ? 'storage.confirmPartial' : 'storage.confirmCache',
            { name: confirm.name, size: bytes(confirm.bytes, locale) }),
          acknowledgeLabel: t('storage.acknowledge'),
          cancelLabel: t('confirm.keep'), closeLabel: t('confirm.keep'), confirmLabel: t('storage.delete'),
          acknowledged, disabled: deleting !== null, onAcknowledgedChange: setAcknowledged,
          onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) void remove(confirm) },
        }))
    }

    function DownloadsPanel({ feed, remote, t }) {
      const locale = document.documentElement.lang || undefined
      const { downloads, error: loadError, storageRevision } = React.useSyncExternalStore(feed.subscribe, feed.get)
      const [action, setAction] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const run = async (item, method) => {
        setConfirm(null)
        setAction({ id: item.id, method })
        setActionError(null)
        try { await answer(remote[method](item.id)) }
        catch (error) { setActionError({ id: item.id, message: message(error) }) }
        finally { setAction(null) }
      }
      const button = (item, method, label, busyLabel, onClick) => h(Button, {
        variant: 'outline', size: 'sm', disabled: action !== null,
        onClick: onClick ?? (() => { void run(item, method) }),
      }, action?.id === item.id && action.method === method ? busyLabel : label)
      return h('section', { className: 'jan-downloads', 'aria-labelledby': 'jan-downloads-heading' },
        h('header', { className: 'jan-downloads-head' },
          h('h1', { id: 'jan-downloads-heading' }, t('title')),
          h('p', null, t('lede'))),
        loadError ? h('p', { role: 'alert', className: 'jan-downloads-error' }, t('stale', { error: loadError })) : null,
        downloads === null ? h('p', { role: 'status' }, t('loading')) : downloads.length === 0
          ? h('div', { className: 'jan-downloads-empty' },
            h(IconDownloadOutlineRegular, { size: 32, 'aria-hidden': true }),
            h('h2', null, t('empty')),
            h('p', null, t('emptyHint')))
          : h('ul', { className: 'jan-downloads-list' }, downloads.map(item => {
            const status = statusOf(item)
            const progress = item.progress
            const percent = percentOf(progress)
            const failure = actionError?.id === item.id ? actionError.message : item.error
            return h('li', { key: item.id, className: 'jan-downloads-task', 'data-status': status, 'aria-busy': action?.id === item.id },
              h('div', { className: 'jan-downloads-task-head' },
                h('h2', { title: item.name }, item.name),
                h('span', { className: 'jan-downloads-state', role: 'status' }, t(`status.${status}`))),
              h('progress', {
                max: 100, ...(percent === null ? {} : { value: percent }),
                'aria-label': t('progressLabel', { name: item.name }),
              }),
              h('p', { className: 'jan-downloads-size' }, progress === undefined
                ? (status === 'queued' ? t('queuedHint') : t('transferred', { size: bytes(0, locale) }))
                : [
                  t('progress', {
                    received: bytes(progress.receivedBytes, locale), total: bytes(progress.totalBytes, locale),
                    percent: formatPercent(percent ?? 0, locale),
                  }),
                  ...(status === 'downloading' && progress.bytesPerSecond > 0 ? [t('speed', { size: bytes(progress.bytesPerSecond, locale) })] : []),
                ].join(' - ')),
              h('div', { className: 'jan-downloads-actions' },
                (status === 'downloading' || status === 'queued') && button(item, 'pauseDownload', t('pause'), t('pausing')),
                status === 'paused' && button(item, 'retryDownload', t('resume'), t('resuming')),
                status === 'failed' && button(item, 'retryDownload', t('retry'), t('retrying')),
                status === 'failed'
                  ? button(item, 'cancelDownload', t('dismiss'), t('dismissing'))
                  : button(item, 'cancelDownload', t('cancel'), t('cancelling'), () => { setAcknowledged(false); setConfirm(item) })),
              failure ? h('p', { role: 'alert', className: 'jan-downloads-error' }, failure) : null)
          })),
        h(StoredDownloads, { remote, t, locale, storageRevision }),
        h(RiskConfirmation, {
          open: confirm !== null,
          title: t('confirm.title'),
          description: confirm ? t('confirm.description', { name: confirm.name }) : '',
          acknowledgeLabel: t('confirm.acknowledge'),
          cancelLabel: t('confirm.keep'), closeLabel: t('confirm.keep'), confirmLabel: t('confirm.discard'),
          acknowledged, disabled: action !== null, onAcknowledgedChange: setAcknowledged,
          onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) void run(confirm, 'cancelDownload') },
        }))
    }

    function InboxRow({ item, t, locale, run, busy, failure, onCancel }) {
      const icon = KIND_ICONS[item.kind] ?? IconDownloadOutlineRegular
      const active = item.state === 'downloading' || item.state === 'queued'
      const percent = item.percent === undefined ? '' : formatPercent(item.percent, locale)
      let transfer = ''
      if (item.totalBytes > 0 && item.receivedBytes !== undefined) {
        transfer = t('byteFraction', { received: bytes(item.receivedBytes, locale), total: bytes(item.totalBytes, locale) })
      } else if (item.receivedBytes !== undefined) transfer = t('transferred', { size: bytes(item.receivedBytes, locale) })
      const rate = item.state === 'downloading' && item.bytesPerSecond >= 1 ? item.bytesPerSecond : 0
      const remaining = rate && item.totalBytes > item.receivedBytes ? (item.totalBytes - item.receivedBytes) / rate : 0
      const unit = remaining >= 3600 ? 'hour' : remaining >= 60 ? 'minute' : 'second'
      const duration = remaining > 0 ? new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' })
        .format(Math.ceil(remaining / (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1))) : ''
      return h('li', { className: 'jan-inbox-row', 'data-state': item.state },
        h('div', { className: 'jan-inbox-item-heading' },
          h('div', { className: 'jan-inbox-item-name', title: item.name }, h(icon, { size: 16, 'aria-hidden': true }), h('span', null, item.name)),
          item.actions.map(action => {
            const actionIcon = ACTION_ICONS[action]
            const label = t(action)
            return h(Tooltip, { key: action, label }, h('button', { type: 'button', className: 'jan-inbox-action', 'aria-label': label,
              disabled: busy, onClick: () => action === 'cancel' && item.kind === 'model' ? onCancel(item) : run(item.id, action),
            }, h(actionIcon, { size: 16, 'aria-hidden': true })))
          })),
        h('div', { className: 'jan-inbox-metadata' }, h('span', null, t(`kind.${item.kind}`)), h('span', null, t(`status.${item.state}`))),
        (active || item.percent !== undefined || transfer) && h('div', { className: 'jan-inbox-track', role: 'progressbar',
          'aria-label': t('progressLabel', { name: item.name }), 'aria-valuenow': item.percent,
          'data-indeterminate': item.state === 'downloading' && item.percent === undefined ? '' : undefined },
          h('span', { className: 'jan-inbox-fill', style: { '--jan-inbox-progress': `${item.percent ?? 0}%` } }),
          h('span', { className: 'jan-inbox-track-labels' }, h('span', null, percent), h('span', null, transfer))),
        rate > 0 && h('div', { className: 'jan-inbox-metadata' }, h('span', null, t('speed', { size: bytes(rate, locale) })),
          duration && h('span', null, t('eta', { duration }))),
        item.error && h('p', { className: 'jan-inbox-error' }, item.error),
        failure && h('p', { className: 'jan-inbox-error', role: 'alert' }, failure))
    }

    function DownloadsButton({ className, iconSize, tooltipSide, portal, openPanel, useInbox, request, t }) {
      const { items, active, unseen, loading, unavailable } = useInbox(value => value)
      const [open, setOpen] = React.useState(false)
      const [mounted, setMounted] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const trigger = React.useRef(null), panel = React.useRef(null)
      const id = React.useId()
      const anchorName = `--jan-downloads-${id.replaceAll(':', '')}`
      const locale = document.documentElement.lang || undefined
      const label = active.count ? (active.percent === null ? t('activeTransfer') : t('activeProgress', { percent: formatPercent(active.percent, locale) }))
        : t(unseen ? 'unread' : 'title')
      useDismissOnOutsidePointer(trigger, open && confirm === null, setOpen, panel)
      React.useLayoutEffect(() => { if (open) panel.current?.focus() }, [open])
      React.useEffect(() => {
        if (!open || unseen === null) return
        void request('markSeen', { sequence: unseen.sequence }).catch(() => { /* The badge survives a lost connection. */ })
      }, [open, unseen?.sequence, request])
      React.useEffect(() => {
        if (!open || confirm !== null) return
        const dismiss = event => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || isBehindModal(panel.current)) return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
        const leave = event => {
          if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', dismiss, true)
        document.addEventListener('focusin', leave)
        return () => {
          document.removeEventListener('keydown', dismiss, true)
          document.removeEventListener('focusin', leave)
        }
      }, [open, confirm])
      const run = async (id, action) => {
        setConfirm(null)
        setBusy(id)
        setFailure(null)
        try { await request('act', { id, action }) }
        catch (error) { setFailure({ id, text: t('actionError', { error: message(error) }) }) }
        finally { setBusy(null) }
      }
      const hasFinished = items.some(item => item.state === 'done' || item.state === 'failed' || item.state === 'cancelled')
      const clear = async () => {
        setFailure(null)
        panel.current?.focus()
        try { await request('clearFinished') }
        catch (error) { setFailure({ id: null, text: t('actionError', { error: message(error) }) }) }
      }
      return h(React.Fragment, null,
        h(Tooltip, { label, delayMs: 500, disabled: open, side: tooltipSide, portal }, h('button', {
          ref: trigger, type: 'button', className: [className, 'jan-downloads-trigger'].filter(Boolean).join(' '),
          style: { anchorName }, 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
          onClick: () => { if (!open) { setMounted(true); setOpen(true) } else setOpen(false) },
        }, h('span', { className: 'jan-downloads-trigger-icon', 'aria-hidden': true },
          h(IconDownloadOutlineRegular, { size: iconSize }),
          active.count > 0 && h('span', { className: 'jan-downloads-badge', 'data-indeterminate': active.percent === null ? '' : undefined,
            style: { '--jan-download-percent': `${active.percent ?? 30}%` } }),
          unseen && h('span', { className: 'jan-downloads-unseen', 'data-failed': unseen.failed ? '' : undefined })))),
        mounted && createPortal(h(MenuSurface, { ref: panel, id, role: 'dialog', tabIndex: -1, className: 'jan-downloads-inbox',
          'aria-label': t('title'), 'aria-hidden': !open || undefined, inert: !open ? '' : undefined,
          'data-open': open, style: { positionAnchor: anchorName },
          onAnimationEnd: event => { if (event.currentTarget === event.target && !open) setMounted(false) },
        }, loading ? h('p', { className: 'jan-inbox-empty', role: 'status' }, t('loading')) :
          items.length === 0 ? h('div', { className: 'jan-inbox-empty' }, h(IconDownloadOutlineRegular, { size: 24, 'aria-hidden': true }),
            h('p', null, t(unavailable ? 'inboxError' : 'inboxEmpty'))) : h(React.Fragment, null,
            h('h2', { className: 'jan-inbox-title' }, t(active.count ? 'status.downloading' : 'title')),
            unavailable && h('p', { className: 'jan-inbox-error', role: 'status' }, t('inboxError')),
            h('ul', { className: 'jan-inbox-list' }, items.map(item => h(InboxRow, {
              key: item.id, item, t, locale, run, busy: busy === item.id, failure: failure?.id === item.id ? failure.text : null,
              onCancel: value => { setAcknowledged(false); setConfirm(value) },
            }))),
            h('div', { className: 'jan-inbox-footer' },
              openPanel && h(Button, { variant: 'ghost', size: 'sm', onClick: () => { setOpen(false); openPanel(PANEL) } }, t('manage')),
              hasFinished && h(Button, { variant: 'ghost', size: 'sm', onClick: () => { void clear() } }, t('clearFinished'))),
            failure?.id === null && h('p', { className: 'jan-inbox-error', role: 'alert' }, failure.text))), document.body),
        h(RiskConfirmation, { open: confirm !== null, title: t('confirm.title'),
          description: confirm ? t('confirm.description', { name: confirm.name }) : '', acknowledgeLabel: t('confirm.acknowledge'),
          cancelLabel: t('confirm.keep'), closeLabel: t('confirm.keep'), confirmLabel: t('confirm.discard'), acknowledged,
          onAcknowledgedChange: setAcknowledged, onCancel: () => setConfirm(null),
          onConfirm: () => { if (confirm) void run(confirm.id, 'cancel') },
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
      .jan-downloads-storage{max-width:800px;margin:20px auto 0;padding-top:24px;border-top:1px solid var(--dsw-alias-border-l1)}
      .jan-downloads-stored-list{list-style:none;margin:12px 0 0;padding:0}
      .jan-downloads-stored-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .jan-downloads-stored-info{min-width:0;overflow-wrap:anywhere}
      .jan-downloads-stored-info h3{margin:0;font-size:14px;font-weight:600}
      .jan-downloads-stored-info p{margin:4px 0 0;font-size:13px}
      .jan-downloads-stored-row button{flex-shrink:0}
      .jan-downloads-trigger { transition: background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); -webkit-app-region: no-drag; }
      .jan-downloads-trigger[aria-expanded='true'], .jan-downloads-trigger:active { background-color: var(--dsw-alias-interactive-bg-active); }
      .jan-downloads-trigger:focus-visible, .jan-inbox-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .jan-downloads-trigger-icon { position: relative; display: flex; }
      .jan-downloads-badge { position: absolute; inset: -5px; border-radius: 50%; pointer-events: none;
        background: conic-gradient(var(--dsw-alias-brand-primary) var(--jan-download-percent), var(--dsw-alias-border-l2) 0);
        mask: radial-gradient(farthest-side, transparent calc(100% - 2px), currentColor 0); }
      .jan-downloads-badge[data-indeterminate] { animation: jan-inbox-spin var(--ds-transition-duration-loop) linear infinite; }
      .jan-downloads-unseen { position: absolute; inset-block-start: -5px; inset-inline-end: -6px; width: 6px; height: 6px;
        border-radius: 50%; background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1); pointer-events: none; }
      .jan-downloads-unseen[data-failed] { background: var(--dsw-alias-state-error-primary); }
      .jan-downloads-inbox { --jan-inbox-padding: 8px; --jan-inbox-gap: 8px; --jan-inbox-edge: 12px;
        position: fixed; z-index: 1100; width: min(296px, calc(100vw - 2 * var(--jan-inbox-edge))); box-sizing: border-box;
        top: max(var(--jan-frame-overlay-top, 0px), calc(anchor(bottom, 32px) + var(--jan-inbox-gap)));
        left: clamp(var(--jan-inbox-edge), anchor(left, 12px), max(var(--jan-inbox-edge), calc(100vw - 296px - var(--jan-inbox-edge))));
        max-height: calc(100dvh - anchor(bottom, 32px) - var(--jan-inbox-gap) - var(--jan-inbox-edge));
        overflow: auto; overscroll-behavior: contain; outline: none; padding: var(--jan-inbox-padding);
        border: 1px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-elevation-panel);
        color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 18px; }
      .jan-downloads-inbox[data-open='true'] { animation: jan-inbox-in var(--ds-transition-duration) var(--ds-ease-out); }
      .jan-downloads-inbox[data-open='false'] { animation: jan-inbox-out var(--ds-transition-duration-fast) var(--ds-ease-in) both; pointer-events: none; }
      .jan-inbox-empty { box-sizing: border-box; min-height: 120px; margin: 0; padding: 20px; display: grid; align-content: center;
        justify-items: center; gap: var(--jan-inbox-gap); text-align: center; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
      .jan-inbox-empty p { margin: 0; max-width: 23ch; text-wrap: balance; }
      .jan-inbox-empty svg { color: var(--dsw-alias-label-tertiary); }
      .jan-inbox-title { margin: 0; padding: 2px 4px 8px; font-size: 14px; font-weight: 500; line-height: 20px; }
      .jan-inbox-list { display: grid; gap: var(--jan-inbox-gap); list-style: none; margin: 0; padding: 0; }
      .jan-inbox-row { min-width: 0; display: grid; gap: 4px; padding: var(--jan-inbox-padding);
        border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover);
        animation: jan-inbox-in var(--ds-transition-duration) var(--ds-ease-out); }
      .jan-inbox-item-heading, .jan-inbox-item-name { display: flex; align-items: center; gap: 4px; min-width: 0; }
      .jan-inbox-item-name { flex: 1; gap: 6px; font-weight: 500; }
      .jan-inbox-item-name > svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary); }
      .jan-inbox-item-name > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .jan-inbox-action { width: 24px; height: 24px; display: grid; place-items: center; flex: none; padding: 0; border: 0;
        border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer;
        transition: background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
      @media (hover: hover) { .jan-inbox-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
      .jan-inbox-action:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .jan-inbox-action:disabled { cursor: default; opacity: .5; }
      .jan-inbox-metadata, .jan-inbox-track-labels { display: flex; justify-content: space-between; gap: 4px; font-variant-numeric: tabular-nums; }
      .jan-inbox-metadata { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 16px; }
      .jan-inbox-track { position: relative; overflow: hidden; min-height: 24px; isolation: isolate; border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-interactive-bg-active); }
      .jan-inbox-track-labels { padding: 4px 8px; font-size: 12px; line-height: 16px; }
      .jan-inbox-fill { position: absolute; z-index: -1; inset-block: 0; inset-inline-start: 0; width: var(--jan-inbox-progress);
        opacity: .4; background: var(--dsw-alias-brand-primary); transition: width var(--ds-transition-duration) var(--ds-ease-in-out); }
      .jan-inbox-track[data-indeterminate] .jan-inbox-fill { width: 25%; animation: jan-inbox-scan var(--ds-transition-duration-ambient) var(--ds-ease-in-out) infinite alternate; }
      .jan-inbox-footer { display: flex; justify-content: flex-end; gap: var(--jan-inbox-gap); flex-wrap: wrap; margin-top: 4px; }
      .jan-inbox-error { margin: 0; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; white-space: pre-wrap; }
      @keyframes jan-inbox-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes jan-inbox-out { from { opacity: 1; } to { opacity: 0; } }
      @keyframes jan-inbox-spin { to { transform: rotate(1turn); } }
      @keyframes jan-inbox-scan { to { transform: translateX(300%); } }
      @media (prefers-reduced-motion: reduce) {
        .jan-downloads-badge[data-indeterminate], .jan-inbox-track[data-indeterminate] .jan-inbox-fill { animation: none; }
      }
      @media(max-width:600px){.jan-downloads{padding:20px}}
    `
    return {
      name: 'jan-downloads',
      inject: ['slots', 'locale'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-downloads'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'jan-downloads: styles')
        ctx.effect(() => ctx.locale.register(PANEL, COPY), 'jan-downloads: owned copy')
        ctx.effect(() => {
          const inbox = createInboxFeed()
          const dispose = ctx.slots.inject('sidebar.toggle.actions', () => ctx.slots.register({
            name: 'sidebar.toggle.actions', id: PANEL, locale: PANEL,
            inject: () => ({ hooks: { inbox }, request: inbox.request }),
          }, DownloadsButton))
          return () => { inbox.dispose(); return dispose() }
        }, 'jan-downloads: inbox')
        // ui-settings-local-model mounts the llamaCpp Remote; this page waits for it.
        // Reading `scope.remote` needs the `remote` root service injected too.
        ctx.inject(['remote', 'remote.llamaCpp'], scope => {
          const t = scope.locale.bind(PANEL)
          const remote = scope.remote.llamaCpp
          const feed = follow(remote)
          scope.effect(() => () => feed.dispose(), 'jan-downloads: state stream')
          scope.slots.inject('main', () => scope.slots.register({
            name: 'main', key: PANEL, locale: PANEL, inject: () => ({ feed, remote }),
          }, DownloadsPanel))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 20, label: () => t('title'),
          }, ({ size }) => h(IconDownloadOutlineRegular, { size, 'aria-hidden': true })))
        })
      },
    }
  },
})
