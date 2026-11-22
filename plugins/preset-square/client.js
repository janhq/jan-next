// Uses the app's shared React and public slots; no client build step is required.
window.__ModuleLoader__.load({
  id: '@janhq/jan-preset-square',
  factory(require) {
    const React = require('react')
    const {
      Button, RiskConfirmation, IconAgentPresetOutlineRegular, Input, SegmentedTabs, Modal, Tag, Toast,
      IconSearchOutlineRegular, IconDownloadOutlineRegular, IconLoadingOutlineRegular, IconWarningOutlineRegular,
    } = require('@janhq/jan-client-ui-primitives')
    const h = React.createElement
    const PANEL_ID = 'preset-square'
    const NS = 'jan-preset-square'

    const COPY = {
      en: {
        title: 'Presets',
        lede: 'Ready-made agent setups from the Preset Square gallery (dshdesktop.com). Each one bundles a role, skills and tools. Installed presets appear in the mode menu of a new chat.',
        'sort.label': 'Sort presets', 'sort.downloads': 'Most downloaded', 'sort.newest': 'Newest',
        loading: 'Loading presets…', empty: 'Preset Square has no presets to show.',
        downloads: 'Downloads: {count}', unknownPublisher: 'unknown',
        search: 'Search presets', 'filter.label': 'Filter presets', 'filter.all': 'All', 'filter.installed': 'Installed', 'filter.available': 'Not installed',
        countAll: '{count} presets', countOf: '{shown} of {count}', noMatch: 'No presets match your search.', clear: 'Clear filters',
        retry: 'Try again', close: 'Close', installedTag: 'Installed', 'error.load': 'Could not load Preset Square.',
        'detail.where': 'After installing, pick it from the mode menu under the message box in a new chat.',
        remove: 'Remove', removing: 'Removing…', install: 'Install', installing: 'Installing…', cancel: 'Cancel',
        conflict: 'Already present', conflictHint: 'A preset with this ID already exists',
        'notice.installed': '{title} is installed. Pick it from the mode menu under the message box in a new chat.',
        'notice.removed': '{title} was removed. Chats that used it keep their history.',
        'confirm.title': 'Install {title}?',
        'confirm.description': 'Community presets are shared by users and are not security reviewed. A preset can run tools and commands with the same permissions as the agent. Install only presets you trust.',
        'confirm.acknowledge': 'I understand this preset can run tools and commands.', 'confirm.close': 'Cancel install',
        'error.invalidResponse': 'Preset Square returned an invalid response (HTTP {status}).', 'error.http': 'HTTP error {status}',
      },
      zh: {
        title: '预设',
        lede: '来自 Preset Square（dshdesktop.com）的现成 Agent 配置。每个预设都包含角色、技能和工具。安装后，可在新对话的模式菜单中选择。',
        'sort.label': '预设排序', 'sort.downloads': '下载最多', 'sort.newest': '最新发布',
        loading: '正在加载预设…', empty: 'Preset Square 暂无可显示的预设。',
        downloads: '下载次数：{count}', unknownPublisher: '未知',
        search: '搜索预设', 'filter.label': '筛选预设', 'filter.all': '全部', 'filter.installed': '已安装', 'filter.available': '未安装',
        countAll: '{count} 个预设', countOf: '{shown} / {count}', noMatch: '没有匹配的预设。', clear: '清除筛选',
        retry: '重试', close: '关闭', installedTag: '已安装', 'error.load': '无法加载 Preset Square。',
        'detail.where': '安装后，在新对话中从消息输入框下方的模式菜单选择它。',
        remove: '移除', removing: '正在移除…', install: '安装', installing: '正在安装…', cancel: '取消',
        conflict: '已存在', conflictHint: '具有此 ID 的预设已存在',
        'notice.installed': '已安装 {title}。在新对话中，可从消息输入框下方的模式菜单选择此预设。',
        'notice.removed': '已移除 {title}。使用过此预设的对话会保留历史记录。',
        'confirm.title': '安装 {title}？',
        'confirm.description': '社区预设由用户分享，未经安全审核。预设可以使用 Agent 的权限运行工具和命令。请仅安装你信任的预设。',
        'confirm.acknowledge': '我了解此预设可以运行工具和命令。', 'confirm.close': '取消安装',
        'error.invalidResponse': 'Preset Square 返回了无效响应（HTTP {status}）。', 'error.http': 'HTTP 错误 {status}',
      },
      ja: {
        title: 'プリセット',
        lede: 'Preset Square（dshdesktop.com）で公開されているエージェントの設定です。役割、スキル、ツールがまとめられています。インストール後は、新しいチャットのモードメニューに表示されます。',
        'sort.label': 'プリセットの並べ替え', 'sort.downloads': 'ダウンロード数順', 'sort.newest': '新着順',
        loading: 'プリセットを読み込み中…', empty: 'Preset Square に表示できるプリセットはありません。',
        downloads: 'ダウンロード数: {count}', unknownPublisher: '不明',
        search: 'プリセットを検索', 'filter.label': 'プリセットを絞り込む', 'filter.all': 'すべて', 'filter.installed': 'インストール済み', 'filter.available': '未インストール',
        countAll: '{count} 件のプリセット', countOf: '{count} 件中 {shown} 件', noMatch: '一致するプリセットはありません。', clear: '絞り込みを解除',
        retry: '再試行', close: '閉じる', installedTag: 'インストール済み', 'error.load': 'Preset Square を読み込めませんでした。',
        'detail.where': 'インストール後、新しいチャットでメッセージ欄の下にあるモードメニューから選択します。',
        remove: '削除', removing: '削除中…', install: 'インストール', installing: 'インストール中…', cancel: 'キャンセル',
        conflict: '登録済み', conflictHint: 'この ID のプリセットはすでに存在します',
        'notice.installed': '{title} をインストールしました。新しいチャットで、メッセージ入力欄の下にあるモードメニューから選べます。',
        'notice.removed': '{title} を削除しました。このプリセットを使ったチャットの履歴は残ります。',
        'confirm.title': '{title} をインストールしますか？',
        'confirm.description': 'コミュニティのプリセットはユーザーが共有したもので、セキュリティ審査は行われていません。プリセットはエージェントと同じ権限でツールやコマンドを実行できます。信頼できるプリセットのみをインストールしてください。',
        'confirm.acknowledge': 'このプリセットがツールやコマンドを実行できることを理解しました。', 'confirm.close': 'インストールをキャンセル',
        'error.invalidResponse': 'Preset Square から無効な応答が返されました（HTTP {status}）。', 'error.http': 'HTTP エラー {status}',
      },
      es: {
        title: 'Ajustes preestablecidos',
        lede: 'Configuraciones de agente listas para usar de la galería Preset Square (dshdesktop.com). Cada una incluye un rol, habilidades y herramientas. Los ajustes instalados aparecen en el menú de modos de un chat nuevo.',
        'sort.label': 'Ordenar ajustes preestablecidos', 'sort.downloads': 'Más descargados', 'sort.newest': 'Más recientes',
        loading: 'Cargando ajustes preestablecidos…', empty: 'Preset Square no tiene ajustes preestablecidos que mostrar.',
        downloads: 'Descargas: {count}', unknownPublisher: 'desconocido',
        search: 'Buscar ajustes preestablecidos', 'filter.label': 'Filtrar ajustes preestablecidos', 'filter.all': 'Todos', 'filter.installed': 'Instalados', 'filter.available': 'No instalados',
        countAll: '{count} ajustes preestablecidos', countOf: '{shown} de {count}', noMatch: 'Ningún ajuste preestablecido coincide con tu búsqueda.', clear: 'Quitar filtros',
        retry: 'Reintentar', close: 'Cerrar', installedTag: 'Instalado', 'error.load': 'No se pudo cargar Preset Square.',
        'detail.where': 'Después de instalarlo, elígelo en el menú de modo debajo del cuadro de mensaje en un chat nuevo.',
        remove: 'Quitar', removing: 'Quitando…', install: 'Instalar', installing: 'Instalando…', cancel: 'Cancelar',
        conflict: 'Ya existe', conflictHint: 'Ya existe un ajuste preestablecido con este ID',
        'notice.installed': 'Se instaló {title}. Puedes elegirlo en el menú de modos, debajo del cuadro de mensaje de un chat nuevo.',
        'notice.removed': 'Se quitó {title}. Los chats que lo usaron conservan su historial.',
        'confirm.title': '¿Instalar {title}?',
        'confirm.description': 'Los usuarios comparten los ajustes preestablecidos de la comunidad y estos no pasan por una revisión de seguridad. Un ajuste preestablecido puede ejecutar herramientas y comandos con los mismos permisos que el agente. Instala solo los que sean de confianza.',
        'confirm.acknowledge': 'Entiendo que este ajuste preestablecido puede ejecutar herramientas y comandos.', 'confirm.close': 'Cancelar instalación',
        'error.invalidResponse': 'Preset Square devolvió una respuesta no válida (HTTP {status}).', 'error.http': 'Error HTTP {status}',
      },
      fr: {
        title: 'Préréglages',
        lede: 'Configurations d’agent prêtes à l’emploi issues de la galerie Preset Square (dshdesktop.com). Chacune comprend un rôle, des compétences et des outils. Une fois installés, les préréglages apparaissent dans le menu des modes d’une nouvelle discussion.',
        'sort.label': 'Trier les préréglages', 'sort.downloads': 'Les plus téléchargés', 'sort.newest': 'Les plus récents',
        loading: 'Chargement des préréglages…', empty: 'Preset Square n’a aucun préréglage à afficher.',
        downloads: 'Téléchargements : {count}', unknownPublisher: 'inconnu',
        search: 'Rechercher des préréglages', 'filter.label': 'Filtrer les préréglages', 'filter.all': 'Tous', 'filter.installed': 'Installés', 'filter.available': 'Non installés',
        countAll: '{count} préréglages', countOf: '{shown} sur {count}', noMatch: 'Aucun préréglage ne correspond à votre recherche.', clear: 'Effacer les filtres',
        retry: 'Réessayer', close: 'Fermer', installedTag: 'Installé', 'error.load': 'Impossible de charger Preset Square.',
        'detail.where': 'Une fois installé, choisissez-le dans le menu de mode sous la zone de message d’une nouvelle discussion.',
        remove: 'Supprimer', removing: 'Suppression…', install: 'Installer', installing: 'Installation…', cancel: 'Annuler',
        conflict: 'Déjà présent', conflictHint: 'Un préréglage avec cet identifiant existe déjà',
        'notice.installed': 'Le préréglage {title} est installé. Sélectionnez-le dans le menu des modes sous le champ de message d’une nouvelle discussion.',
        'notice.removed': 'Le préréglage {title} a été supprimé. Les discussions qui l’utilisaient conservent leur historique.',
        'confirm.title': 'Installer {title} ?',
        'confirm.description': 'Les préréglages de la communauté sont partagés par les utilisateurs et ne font pas l’objet d’un contrôle de sécurité. Un préréglage peut exécuter des outils et des commandes avec les mêmes autorisations que l’agent. N’installez que des préréglages auxquels vous faites confiance.',
        'confirm.acknowledge': 'Je comprends que ce préréglage peut exécuter des outils et des commandes.', 'confirm.close': 'Annuler l’installation',
        'error.invalidResponse': 'Preset Square a renvoyé une réponse non valide (HTTP {status}).', 'error.http': 'Erreur HTTP {status}',
      },
      de: {
        title: 'Voreinstellungen',
        lede: 'Fertige Agentenkonfigurationen aus der Galerie Preset Square (dshdesktop.com). Jede enthält eine Rolle, Skills und Werkzeuge. Installierte Voreinstellungen erscheinen im Modusmenü eines neuen Chats.',
        'sort.label': 'Voreinstellungen sortieren', 'sort.downloads': 'Am häufigsten heruntergeladen', 'sort.newest': 'Neueste',
        loading: 'Voreinstellungen werden geladen…', empty: 'Preset Square hat keine Voreinstellungen zum Anzeigen.',
        downloads: 'Downloads: {count}', unknownPublisher: 'unbekannt',
        search: 'Voreinstellungen suchen', 'filter.label': 'Voreinstellungen filtern', 'filter.all': 'Alle', 'filter.installed': 'Installiert', 'filter.available': 'Nicht installiert',
        countAll: '{count} Voreinstellungen', countOf: '{shown} von {count}', noMatch: 'Keine Voreinstellungen entsprechen deiner Suche.', clear: 'Filter zurücksetzen',
        retry: 'Erneut versuchen', close: 'Schließen', installedTag: 'Installiert', 'error.load': 'Preset Square konnte nicht geladen werden.',
        'detail.where': 'Nach der Installation wählst du es in einem neuen Chat im Modusmenü unter dem Nachrichtenfeld aus.',
        remove: 'Entfernen', removing: 'Wird entfernt…', install: 'Installieren', installing: 'Wird installiert…', cancel: 'Abbrechen',
        conflict: 'Bereits vorhanden', conflictHint: 'Eine Voreinstellung mit dieser ID ist bereits vorhanden',
        'notice.installed': '{title} wurde installiert. Wähle die Voreinstellung im Modusmenü unter dem Nachrichtenfeld eines neuen Chats.',
        'notice.removed': '{title} wurde entfernt. Der Verlauf der Chats, in denen sie verwendet wurde, bleibt erhalten.',
        'confirm.title': '„{title}“ installieren?',
        'confirm.description': 'Voreinstellungen aus der Community werden von Nutzern geteilt und nicht auf Sicherheit geprüft. Eine Voreinstellung kann Werkzeuge und Befehle mit denselben Berechtigungen wie der Agent ausführen. Installiere nur Voreinstellungen, denen du vertraust.',
        'confirm.acknowledge': 'Mir ist bewusst, dass diese Voreinstellung Werkzeuge und Befehle ausführen kann.', 'confirm.close': 'Installation abbrechen',
        'error.invalidResponse': 'Preset Square hat eine ungültige Antwort zurückgegeben (HTTP {status}).', 'error.http': 'HTTP-Fehler {status}',
      },
      ru: {
        title: 'Предустановки',
        lede: 'Готовые настройки агентов из каталога Preset Square (dshdesktop.com). Каждая предустановка включает роль, навыки и инструменты. Установленные предустановки отображаются в меню режимов нового чата.',
        'sort.label': 'Сортировать предустановки', 'sort.downloads': 'По числу загрузок', 'sort.newest': 'Сначала новые',
        loading: 'Загрузка предустановок…', empty: 'В Preset Square нет предустановок для отображения.',
        downloads: 'Загрузок: {count}', unknownPublisher: 'неизвестно',
        search: 'Поиск предустановок', 'filter.label': 'Фильтр предустановок', 'filter.all': 'Все', 'filter.installed': 'Установленные', 'filter.available': 'Не установленные',
        countAll: 'Предустановок: {count}', countOf: '{shown} из {count}', noMatch: 'Нет предустановок, подходящих под запрос.', clear: 'Сбросить фильтры',
        retry: 'Повторить', close: 'Закрыть', installedTag: 'Установлен', 'error.load': 'Не удалось загрузить Preset Square.',
        'detail.where': 'После установки выберите его в меню режима под полем сообщения в новом чате.',
        remove: 'Удалить', removing: 'Удаление…', install: 'Установить', installing: 'Установка…', cancel: 'Отмена',
        conflict: 'Уже существует', conflictHint: 'Предустановка с таким идентификатором уже существует',
        'notice.installed': 'Предустановка {title} установлена. Выберите её в меню режимов под полем сообщения в новом чате.',
        'notice.removed': 'Предустановка {title} удалена. История чатов, в которых она использовалась, сохраняется.',
        'confirm.title': 'Установить {title}?',
        'confirm.description': 'Предустановки сообщества публикуются пользователями и не проходят проверку безопасности. Предустановка может запускать инструменты и команды с теми же правами, что и агент. Устанавливайте только те предустановки, которым доверяете.',
        'confirm.acknowledge': 'Я понимаю, что эта предустановка может запускать инструменты и команды.', 'confirm.close': 'Отменить установку',
        'error.invalidResponse': 'Preset Square вернул недопустимый ответ (HTTP {status}).', 'error.http': 'Ошибка HTTP {status}',
      },
      pt: {
        title: 'Predefinições',
        lede: 'Configurações de agente prontas para usar da galeria Preset Square (dshdesktop.com). Cada uma inclui uma função, habilidades e ferramentas. As predefinições instaladas aparecem no menu de modos de uma nova conversa.',
        'sort.label': 'Ordenar predefinições', 'sort.downloads': 'Mais baixadas', 'sort.newest': 'Mais recentes',
        loading: 'Carregando predefinições…', empty: 'O Preset Square não tem predefinições para exibir.',
        downloads: 'Downloads: {count}', unknownPublisher: 'desconhecido',
        search: 'Pesquisar predefinições', 'filter.label': 'Filtrar predefinições', 'filter.all': 'Todas', 'filter.installed': 'Instaladas', 'filter.available': 'Não instaladas',
        countAll: '{count} predefinições', countOf: '{shown} de {count}', noMatch: 'Nenhuma predefinição corresponde à sua pesquisa.', clear: 'Limpar filtros',
        retry: 'Tentar novamente', close: 'Fechar', installedTag: 'Instalado', 'error.load': 'Não foi possível carregar o Preset Square.',
        'detail.where': 'Depois de instalar, escolha-o no menu de modo abaixo da caixa de mensagem em um novo chat.',
        remove: 'Remover', removing: 'Removendo…', install: 'Instalar', installing: 'Instalando…', cancel: 'Cancelar',
        conflict: 'Já existe', conflictHint: 'Já existe uma predefinição com este ID',
        'notice.installed': 'A predefinição {title} foi instalada. Selecione-a no menu de modos abaixo do campo de mensagem de uma nova conversa.',
        'notice.removed': 'A predefinição {title} foi removida. As conversas que a usaram mantêm o histórico.',
        'confirm.title': 'Instalar {title}?',
        'confirm.description': 'As predefinições da comunidade são compartilhadas por usuários e não passam por uma revisão de segurança. Uma predefinição pode executar ferramentas e comandos com as mesmas permissões do agente. Instale apenas predefinições em que você confia.',
        'confirm.acknowledge': 'Entendo que esta predefinição pode executar ferramentas e comandos.', 'confirm.close': 'Cancelar instalação',
        'error.invalidResponse': 'O Preset Square retornou uma resposta inválida (HTTP {status}).', 'error.http': 'Erro HTTP {status}',
      },
    }

    const CSS = `
.jan-presets{height:100%;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--jan-font-family-text);font-size:14px}
.jan-presets-inner{box-sizing:border-box;max-width:960px;margin:0 auto;padding:48px 32px;display:flex;flex-direction:column;gap:16px}
.jan-presets h1{margin:0;font-size:24px;font-weight:500;line-height:32px;text-wrap:balance}
.jan-presets p{margin:0;text-wrap:pretty}.jan-presets-muted{color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
.jan-presets-head{display:grid;gap:4px;margin-bottom:8px}.jan-presets-head p{font-size:14px;line-height:20px}
.jan-presets-toolbar{display:flex;align-items:center;gap:12px}.jan-presets-toolbar>:first-child{flex:1;min-width:0}
.jan-presets-count{flex:none;font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.jan-presets-chips{display:flex;flex-wrap:wrap;gap:6px}
.jan-presets-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:22px}
.jan-presets-chip[aria-pressed='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
.jan-presets-chip:focus-visible,.jan-presets-tile:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
@media(hover:hover){.jan-presets-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.jan-presets-chip-count{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.jan-presets-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:12px}
.jan-presets-grid>li{display:grid;min-width:0}
.jan-presets-tile{display:grid;gap:8px;align-content:start;justify-items:start;box-sizing:border-box;width:100%;min-width:0;min-height:172px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:start;cursor:pointer;transition:transform .18s cubic-bezier(.2,.8,.2,1),border-color .18s,box-shadow .18s}
.jan-presets-tile:hover{transform:translateY(-2px);border-color:var(--dsw-alias-border-l4);box-shadow:0 8px 20px color-mix(in oklab,hsl(var(--jan-presets-hue) 60% 45%) 18%,transparent)}
.jan-presets-tile>*{max-width:100%;min-width:0}
.jan-presets-art{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex:none;font-size:17px;font-weight:600;color:#fff;background:linear-gradient(135deg,hsl(var(--jan-presets-hue) 70% 55%),hsl(calc(var(--jan-presets-hue) + 60) 70% 42%))}
.jan-presets-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:15px;font-weight:500;line-height:22px}
.jan-presets-publisher{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.jan-presets-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.jan-presets-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.jan-presets-downloads{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}
.jan-presets-skeleton{height:172px;border-radius:12px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1) 0%,var(--dsw-alias-border-l1) 50%,var(--dsw-alias-bg-layer-1) 100%);background-size:200% 100%;animation:jan-presets-skeleton 1.4s ease-in-out infinite}
@keyframes jan-presets-skeleton{from{background-position:100% 0}to{background-position:-100% 0}}
.jan-presets-empty{display:grid;justify-items:center;gap:10px;padding:32px 24px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;text-align:center;color:var(--dsw-alias-label-secondary)}
.jan-presets-empty p{max-width:48ch}
.jan-presets-detail{display:grid;gap:12px}
.jan-presets-detail-head{display:flex;align-items:center;gap:12px;min-width:0}
.jan-presets-detail-head>div{display:grid;gap:2px;min-width:0}
.jan-presets-detail code{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.jan-presets-detail p{line-height:20px;overflow-wrap:anywhere}
.jan-presets-actions{display:flex;justify-content:flex-end;gap:8px}
.jan-presets-actions button{display:inline-flex;align-items:center;gap:6px}
.jan-presets-spin{animation:jan-presets-spin 1s linear infinite}
@keyframes jan-presets-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.jan-presets-tile{transition:none}.jan-presets-tile:hover{transform:none}.jan-presets-skeleton,.jan-presets-spin{animation:none}}
@media(max-width:600px){.jan-presets-inner{padding:24px 16px}}
`

    class HttpError extends Error {
      constructor(key, status) {
        super()
        this.key = key
        this.status = status
      }
    }

    async function api(method, params = {}) {
      const response = await fetch('/jan-api/preset-square', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      let body
      try { body = await response.json() } catch { throw new HttpError('error.invalidResponse', response.status) }
      if (body.error) throw new Error(body.error)
      if (!response.ok) throw new HttpError('error.http', response.status)
      return body.result
    }

    const language = () => document.documentElement.lang || 'en'
    // Stable per-publisher hue (FNV-1a) so one author's presets share a color.
    const hue = (text) => {
      let hash = 0x811c9dc5
      for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0
      return hash % 360
    }
    const FILTERS = { all: () => true, installed: preset => preset.installed, available: preset => !preset.installed }
    const SORT_TABS = [['downloads', 'sort.downloads'], ['newest', 'sort.newest']]

    const Art = ({ preset }) => h('span', { className: 'jan-presets-art', 'aria-hidden': true }, (preset.title || '?').trim().charAt(0).toUpperCase())

    function PresetSquare({ t }) {
      const locale = language()
      const count = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
      const compact = React.useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact' }), [locale])
      const [sort, setSort] = React.useState('downloads')
      const [query, setQuery] = React.useState('')
      const [filterChoice, setFilter] = React.useState('all')
      const [presets, setPresets] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [toast, setToast] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      // An install or remove failure stays in the open dialog: Host refusals are not transient.
      const [actionError, setActionError] = React.useState(null)
      const open = preset => { setDetail(preset); setActionError(null) }
      const message = error => error instanceof HttpError ? t(error.key, { status: error.status }) : error.message
      const load = React.useCallback(async (order = sort) => {
        setLoadError(null)
        const requestedLanguage = language()
        try {
          const { presets } = await api('list', { sort: order, lang: requestedLanguage.toLowerCase().split('-')[0] })
          if (language() === requestedLanguage) setPresets(presets)
        } catch (e) {
          if (language() === requestedLanguage) { setLoadError(e); setPresets([]) }
        }
      }, [sort])
      React.useEffect(() => { void load() }, [load, locale])
      const install = async (preset) => {
        setBusy(preset.slug); setToast(null); setActionError(null)
        try {
          await api('install', { slug: preset.slug })
          setDetail(null)
          setToast({ key: Date.now(), tone: 'success', text: t('notice.installed', { title: preset.title }) })
          await load()
        } catch (e) { setActionError({ slug: preset.slug, text: message(e) }) } finally { setBusy(''); setConfirming(null) }
      }
      const remove = async (preset) => {
        setBusy(preset.slug); setToast(null); setActionError(null)
        try {
          await api('remove', { id: preset.presetId })
          setToast({ key: Date.now(), tone: 'success', text: t('notice.removed', { title: preset.title }) })
          await load()
        } catch (e) { setActionError({ slug: preset.slug, text: message(e) }) } finally { setBusy('') }
      }
      const all = presets ?? []
      const needle = query.trim().toLowerCase()
      // A chip that would show nothing or everything is noise; All stays as the way back.
      const chips = Object.keys(FILTERS).map(id => [id, all.filter(FILTERS[id]).length])
        .filter(([id, n]) => id === 'all' || (n > 0 && n < all.length))
      const filter = chips.some(([id]) => id === filterChoice) ? filterChoice : 'all'
      const shown = all.filter(FILTERS[filter]).filter(preset => needle === ''
        || [preset.title, preset.description, preset.publisher].some(text => (text ?? '').toLowerCase().includes(needle)))
      const narrowed = needle !== '' || filter !== 'all'
      const clear = () => { setQuery(''); setFilter('all') }
      // The open detail follows reloads, so its Installed state and action stay current.
      const current = detail && (all.find(preset => preset.slug === detail.slug) ?? detail)
      const working = current !== null && busy === current?.slug
      const action = current && (current.installed
        ? h(Button, { variant: 'outline', disabled: Boolean(busy), onClick: () => { void remove(current) } },
          working && h(IconLoadingOutlineRegular, { size: 16, className: 'jan-presets-spin', 'aria-hidden': true }), t(working ? 'removing' : 'remove'))
        : h(Button, { variant: 'primary', disabled: Boolean(busy) || current.conflict, title: current.conflict ? t('conflictHint') : undefined, onClick: () => { setConfirming(current); setAcknowledged(false) } },
          working && h(IconLoadingOutlineRegular, { size: 16, className: 'jan-presets-spin', 'aria-hidden': true }), t(working ? 'installing' : current.conflict ? 'conflict' : 'install')))
      return h('section', { className: 'jan-presets', 'aria-label': t('title') },
        h('div', { className: 'jan-presets-inner' },
          h('header', { className: 'jan-presets-head' },
            h('h1', null, t('title')),
            h('p', { className: 'jan-presets-muted' }, t('lede'))),
          h('div', { className: 'jan-presets-toolbar' },
            h(Input, { type: 'search', icon: h(IconSearchOutlineRegular, { size: 16, 'aria-hidden': true }), placeholder: t('search'), 'aria-label': t('search'), value: query, onChange: event => setQuery(event.target.value) }),
            presets !== null && all.length > 0 && h('span', { className: 'jan-presets-count' }, narrowed ? t('countOf', { shown: shown.length, count: all.length }) : t('countAll', { count: all.length })),
            h(SegmentedTabs, {
              size: 'sm', label: t('sort.label'), value: sort, onChange: setSort,
              items: SORT_TABS.map(([value, key]) => ({ value, label: t(key), id: `jan-presets-sort-${value}`, panelId: 'jan-presets-grid' })),
            })),
          chips.length > 1 && h('div', { className: 'jan-presets-chips', role: 'group', 'aria-label': t('filter.label') }, chips.map(([id, n]) =>
            h('button', { key: id, type: 'button', className: 'jan-presets-chip', 'aria-pressed': filter === id, onClick: () => setFilter(id) },
              t(`filter.${id}`), h('span', { className: 'jan-presets-chip-count' }, count.format(n))))),
          presets === null
            ? h('div', { className: 'jan-presets-grid', role: 'status', 'aria-label': t('loading') }, Array.from({ length: 6 }, (_, index) => h('div', { key: index, className: 'jan-presets-skeleton' })))
            : loadError
              ? h('div', { className: 'jan-presets-empty', role: 'alert' },
                h(IconWarningOutlineRegular, { size: 20, 'aria-hidden': true }),
                h('p', null, t('error.load')), h('p', { className: 'jan-presets-muted' }, message(loadError)),
                h(Button, { variant: 'outline', size: 'sm', onClick: () => { setPresets(null); void load() } }, t('retry')))
              : all.length === 0
                ? h('div', { className: 'jan-presets-empty' }, h(IconAgentPresetOutlineRegular, { size: 20, 'aria-hidden': true }), h('p', null, t('empty')))
                : shown.length === 0
                  ? h('div', { className: 'jan-presets-empty' },
                    h(IconSearchOutlineRegular, { size: 20, 'aria-hidden': true }), h('p', null, t('noMatch')),
                    h(Button, { variant: 'outline', size: 'sm', onClick: clear }, t('clear')))
                  : h('ul', { className: 'jan-presets-grid', id: 'jan-presets-grid' }, shown.map(preset => h('li', { key: preset.slug },
                    h('button', { type: 'button', className: 'jan-presets-tile', 'aria-haspopup': 'dialog', style: { '--jan-presets-hue': hue(preset.publisher ?? preset.title) }, onClick: () => open(preset) },
                      h(Art, { preset }),
                      h('span', { className: 'jan-presets-title' }, preset.title),
                      h('span', { className: 'jan-presets-publisher' }, `@${preset.publisher ?? t('unknownPublisher')}`),
                      preset.description && h('span', { className: 'jan-presets-clamp' }, preset.description),
                      h('span', { className: 'jan-presets-foot' },
                        h('span', { className: 'jan-presets-downloads', title: t('downloads', { count: count.format(preset.downloads ?? 0) }) },
                          h(IconDownloadOutlineRegular, { size: 14, 'aria-hidden': true }), compact.format(preset.downloads ?? 0)),
                        preset.installed ? h(Tag, { tone: 'success' }, t('installedTag'))
                          : preset.conflict ? h(Tag, { tone: 'neutral' }, t('conflict')) : null)))))),
        current && h(Modal, {
          open: true, title: current.title, closeLabel: t('close'), onClose: () => { if (!busy) setDetail(null) },
          footer: h('div', { className: 'jan-presets-actions' }, h(Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => setDetail(null) }, t('close')), action),
        },
          h('div', { className: 'jan-presets-detail', style: { '--jan-presets-hue': hue(current.publisher ?? current.title) } },
            h('div', { className: 'jan-presets-detail-head' }, h(Art, { preset: current }),
              h('div', null,
                h('span', { className: 'jan-presets-publisher' }, `@${current.publisher ?? t('unknownPublisher')}`),
                h('span', { className: 'jan-presets-muted' }, t('downloads', { count: count.format(current.downloads ?? 0) })))),
            current.description && h('p', null, current.description),
            h('code', null, current.presetId),
            h('p', { className: 'jan-presets-muted' }, current.conflict && !current.installed ? t('conflictHint') : t('detail.where')),
            actionError?.slug === current.slug && h('p', { className: 'jan-presets-error', role: 'alert' },
              h(IconWarningOutlineRegular, { size: 16, 'aria-hidden': true }), ' ', actionError.text))),
        toast && h(Toast, {
          key: toast.key, text: toast.text, tone: toast.tone, closeLabel: t('close'),
          onDone: () => setToast(previous => previous?.key === toast.key ? null : previous),
        }),
        h(RiskConfirmation, {
          open: Boolean(confirming), title: confirming ? t('confirm.title', { title: confirming.title }) : '',
          description: t('confirm.description'),
          acknowledgeLabel: t('confirm.acknowledge'), cancelLabel: t('cancel'), closeLabel: t('confirm.close'), confirmLabel: t(busy ? 'installing' : 'install'),
          acknowledged, disabled: Boolean(busy), onAcknowledgedChange: setAcknowledged,
          onCancel: () => { if (!busy) setConfirming(null) }, onConfirm: () => { if (confirming) void install(confirming) },
        }))
    }

    return {
      name: '@janhq/jan-preset-square',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@janhq/jan-preset-square'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'preset-square: styles')
        ctx.inject(['locale'], scope => {
          scope.effect(() => scope.locale.register(NS, COPY), 'jan-preset-square: owned copy')
          const t = scope.locale.bind(NS)
          scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PresetSquare))
          scope.slots.inject('sidebar.panellist', () => scope.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('title') }, ({ size }) => h(IconAgentPresetOutlineRegular, { size, 'aria-hidden': true })))
        })
      },
    }
  },
})
