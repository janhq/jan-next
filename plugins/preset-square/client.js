// Uses the app's shared React and public slots; no client build step is required.
window.__ModuleLoader__.load({
  id: '@janhq/jan-preset-square',
  factory(require) {
    const React = require('react')
    const { Button, RiskConfirmation, IconAgentPresetOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const h = React.createElement
    const PANEL_ID = 'preset-square'
    const NS = 'jan-preset-square'

    const COPY = {
      en: {
        title: 'Presets',
        lede: 'Ready-made agent setups from the Preset Square gallery (dshdesktop.com). Each one bundles a role, skills and tools. Installed presets appear in the mode menu of a new chat.',
        'sort.label': 'Sort presets', 'sort.downloads': 'Most downloaded', 'sort.newest': 'Newest',
        loading: 'Loading presets…', empty: 'Preset Square has no presets to show.',
        meta: '@{publisher} · Downloads: {count} · {id}', unknownPublisher: 'unknown',
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
        meta: '@{publisher} · 下载次数：{count} · {id}', unknownPublisher: '未知',
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
        meta: '@{publisher} · ダウンロード数: {count} · {id}', unknownPublisher: '不明',
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
        meta: '@{publisher} · Descargas: {count} · {id}', unknownPublisher: 'desconocido',
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
        meta: '@{publisher} · Téléchargements : {count} · {id}', unknownPublisher: 'inconnu',
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
        meta: '@{publisher} · Downloads: {count} · {id}', unknownPublisher: 'unbekannt',
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
        meta: '@{publisher} · Загрузок: {count} · {id}', unknownPublisher: 'неизвестно',
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
        meta: '@{publisher} · Downloads: {count} · {id}', unknownPublisher: 'desconhecido',
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
.jan-presets-inner{max-width:960px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.jan-presets h1,.jan-presets h2{margin:0;text-wrap:balance;font-weight:600}.jan-presets h1{font-size:24px}.jan-presets h2{font-size:15px}
.jan-presets p{margin:0;text-wrap:pretty}.jan-presets .jan-presets-muted{color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
.jan-presets-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px}
.jan-presets-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.jan-presets-card{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;display:grid;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.jan-presets-row{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.jan-presets-name{min-width:0;display:grid;gap:4px;overflow-wrap:anywhere}
.jan-presets-meta{font-variant-numeric:tabular-nums}
.jan-presets-error{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
@media(max-width:600px){.jan-presets-inner{padding:16px}.jan-presets-row{flex-direction:column}}
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

    function PresetSquare({ t }) {
      const locale = language()
      const count = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
      const [sort, setSort] = React.useState('downloads')
      const [presets, setPresets] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const load = React.useCallback(async (order = sort) => {
        setError(null)
        const requestedLanguage = language()
        try {
          const { presets } = await api('list', { sort: order, lang: requestedLanguage.toLowerCase().split('-')[0] })
          if (language() === requestedLanguage) setPresets(presets)
        } catch (e) {
          if (language() === requestedLanguage) { setError(e); setPresets([]) }
        }
      }, [sort])
      React.useEffect(() => { void load() }, [load, locale])
      const install = async (preset) => {
        setBusy(preset.slug); setError(null); setNotice(null)
        try {
          await api('install', { slug: preset.slug })
          setConfirming(null)
          setNotice({ key: 'notice.installed', title: preset.title })
          await load()
        } catch (e) { setError(e) } finally { setBusy(''); setConfirming(null) }
      }
      const remove = async (preset) => {
        setBusy(preset.slug); setError(null); setNotice(null)
        try {
          await api('remove', { id: preset.presetId })
          setNotice({ key: 'notice.removed', title: preset.title })
          await load()
        } catch (e) { setError(e) } finally { setBusy('') }
      }
      return h('section', { className: 'jan-presets', 'aria-label': t('title') },
        h('div', { className: 'jan-presets-inner' },
          h('div', { className: 'jan-presets-name' },
            h('h1', null, t('title')),
            h('p', { className: 'jan-presets-muted' }, t('lede'))),
          h('div', { className: 'jan-presets-bar', role: 'group', 'aria-label': t('sort.label') },
            h(Button, { variant: sort === 'downloads' ? 'primary' : 'outline', onClick: () => setSort('downloads'), 'aria-pressed': sort === 'downloads' }, t('sort.downloads')),
            h(Button, { variant: sort === 'newest' ? 'primary' : 'outline', onClick: () => setSort('newest'), 'aria-pressed': sort === 'newest' }, t('sort.newest'))),
          error ? h('p', { role: 'alert', className: 'jan-presets-error' }, error instanceof HttpError ? t(error.key, { status: error.status }) : error.message) : null,
          notice ? h('p', { role: 'status' }, t(notice.key, { title: notice.title })) : null,
          presets === null ? h('p', { className: 'jan-presets-muted', role: 'status' }, t('loading')) : presets.length === 0 && !error ? h('p', { className: 'jan-presets-muted' }, t('empty')) : null,
          presets?.length ? h('ul', { className: 'jan-presets-list' }, presets.map(preset => h('li', { key: preset.slug, className: 'jan-presets-card' },
            h('div', { className: 'jan-presets-row' },
              h('div', { className: 'jan-presets-name' },
                h('h2', null, preset.title),
                h('p', { className: 'jan-presets-muted jan-presets-meta' }, t('meta', {
                  publisher: preset.publisher ?? t('unknownPublisher'), count: count.format(preset.downloads ?? 0), id: preset.presetId,
                }))),
              preset.installed
                ? h(Button, { variant: 'outline', disabled: Boolean(busy), onClick: () => remove(preset) }, t(busy === preset.slug ? 'removing' : 'remove'))
                : h(Button, { variant: 'primary', disabled: Boolean(busy) || preset.conflict, title: preset.conflict ? t('conflictHint') : undefined, onClick: () => { setConfirming(preset); setAcknowledged(false) } }, t(busy === preset.slug ? 'installing' : preset.conflict ? 'conflict' : 'install'))),
            h('p', { className: 'jan-presets-muted' }, preset.description)))) : null),
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
