// Browser half of Wall of Quotes, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-wall-of-quotes',
  factory(require) {
    const { createElement: h, useEffect, useId, useMemo, useRef, useState } = require('react')
    const { Button, Switch } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-wall-of-quotes'
    const HEADLINE_SLOT = 'conversation.hero.headline'
    const SETTINGS_SLOT = 'plugins.item'
    const ACTIONS_SLOT = 'plugins.detail.actions'
    const THEME_HEADLINE = 'hero.headline'
    const EMPTY_QUOTES = []
    const readForm = snapshot => snapshot
    const readPreferences = snapshot => snapshot.status === 'ready' ? snapshot.value : undefined

    const dictionaries = {
      en: {
        title: 'Wall of Quotes', summary: 'Show a random quote on each new chat.', master: 'Show quotes on new chats',
        lists: 'Lists', builtIn: 'Built-in quotes ({count})', builtInLoading: 'Built-in quotes', custom: 'Your quotes ({count})',
        addQuote: 'Add a quote', quote: 'Quote', author: 'Author (optional)', add: 'Add', remove: 'Remove',
        removeQuote: 'Remove quote: {quote}', saveFailed: 'Could not save your change. Try again.',
        loadFailed: 'Could not load the built-in quotes.', readOnly: 'These settings are read-only.',
      },
      zh: {
        title: 'Wall of Quotes', summary: '为每个新对话显示一条随机语录。', master: '在新对话中显示语录',
        lists: '列表', builtIn: '内置语录（{count}）', builtInLoading: '内置语录', custom: '你的语录（{count}）',
        addQuote: '添加语录', quote: '语录', author: '作者（可选）', add: '添加', remove: '移除',
        removeQuote: '移除语录：{quote}', saveFailed: '无法保存更改，请重试',
        loadFailed: '无法加载内置语录', readOnly: '这些设置为只读',
      },
      ja: {
        title: 'Wall of Quotes', summary: '新しいチャットにランダムな名言を表示します。', master: '新しいチャットに名言を表示',
        lists: 'リスト', builtIn: '組み込みの名言（{count}）', builtInLoading: '組み込みの名言', custom: '自分の名言（{count}）',
        addQuote: '名言を追加', quote: '名言', author: '著者（任意）', add: '追加', remove: '削除',
        removeQuote: '名言を削除：{quote}', saveFailed: '変更を保存できませんでした。もう一度お試しください。',
        loadFailed: '組み込みの名言を読み込めませんでした。', readOnly: 'これらの設定は読み取り専用です。',
      },
      es: {
        title: 'Wall of Quotes', summary: 'Muestra una cita al azar en cada chat nuevo.', master: 'Mostrar citas en chats nuevos',
        lists: 'Listas', builtIn: 'Citas incluidas ({count})', builtInLoading: 'Citas incluidas', custom: 'Tus citas ({count})',
        addQuote: 'Añadir una cita', quote: 'Cita', author: 'Autor (opcional)', add: 'Añadir', remove: 'Eliminar',
        removeQuote: 'Eliminar cita: {quote}', saveFailed: 'No se pudo guardar el cambio. Inténtalo de nuevo.',
        loadFailed: 'No se pudieron cargar las citas incluidas.', readOnly: 'Estos ajustes son de solo lectura.',
      },
      fr: {
        title: 'Wall of Quotes', summary: 'Affiche une citation au hasard dans chaque nouveau chat.', master: 'Afficher des citations dans les nouveaux chats',
        lists: 'Listes', builtIn: 'Citations intégrées ({count})', builtInLoading: 'Citations intégrées', custom: 'Vos citations ({count})',
        addQuote: 'Ajouter une citation', quote: 'Citation', author: 'Auteur (facultatif)', add: 'Ajouter', remove: 'Supprimer',
        removeQuote: 'Supprimer la citation : {quote}', saveFailed: 'Impossible d’enregistrer la modification. Réessayez.',
        loadFailed: 'Impossible de charger les citations intégrées.', readOnly: 'Ces paramètres sont en lecture seule.',
      },
      de: {
        title: 'Wall of Quotes', summary: 'Zeigt in jedem neuen Chat ein zufälliges Zitat.', master: 'Zitate in neuen Chats anzeigen',
        lists: 'Listen', builtIn: 'Integrierte Zitate ({count})', builtInLoading: 'Integrierte Zitate', custom: 'Deine Zitate ({count})',
        addQuote: 'Zitat hinzufügen', quote: 'Zitat', author: 'Autor (optional)', add: 'Hinzufügen', remove: 'Entfernen',
        removeQuote: 'Zitat entfernen: {quote}', saveFailed: 'Die Änderung konnte nicht gespeichert werden. Versuche es erneut.',
        loadFailed: 'Die integrierten Zitate konnten nicht geladen werden.', readOnly: 'Diese Einstellungen sind schreibgeschützt.',
      },
      ru: {
        title: 'Wall of Quotes', summary: 'Показывает случайную цитату в каждом новом чате.', master: 'Показывать цитаты в новых чатах',
        lists: 'Списки', builtIn: 'Встроенные цитаты ({count})', builtInLoading: 'Встроенные цитаты', custom: 'Ваши цитаты ({count})',
        addQuote: 'Добавить цитату', quote: 'Цитата', author: 'Автор (необязательно)', add: 'Добавить', remove: 'Удалить',
        removeQuote: 'Удалить цитату: {quote}', saveFailed: 'Не удалось сохранить изменение. Попробуйте ещё раз.',
        loadFailed: 'Не удалось загрузить встроенные цитаты.', readOnly: 'Эти настройки доступны только для чтения.',
      },
      pt: {
        title: 'Wall of Quotes', summary: 'Mostra uma citação aleatória em cada nova conversa.', master: 'Mostrar citações em novas conversas',
        lists: 'Listas', builtIn: 'Citações integradas ({count})', builtInLoading: 'Citações integradas', custom: 'As suas citações ({count})',
        addQuote: 'Adicionar uma citação', quote: 'Citação', author: 'Autor (opcional)', add: 'Adicionar', remove: 'Remover',
        removeQuote: 'Remover citação: {quote}', saveFailed: 'Não foi possível guardar a alteração. Tente novamente.',
        loadFailed: 'Não foi possível carregar as citações integradas.', readOnly: 'Estas definições são só de leitura.',
      },
    }

    const CSS = `
.woq-title { width: 100%; margin: 0 0 16px; font-family: 'StudioFeixenSans', 'Inter', sans-serif; font-size: 24px; font-weight: 500; line-height: 32px; color: var(--dsw-alias-label-primary); text-align: center; text-wrap: balance; overflow-wrap: anywhere; }
.woq-author { display: block; font-size: 14px; font-weight: 400; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.woq-section-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.woq-section + .woq-section { margin-top: 32px; }
.woq-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.woq-row-title { min-width: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.woq-row > button { flex: none; }
.woq-form { display: flex; flex-direction: column; align-items: flex-start; }
.woq-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; width: 100%; }
.woq-field + .woq-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.woq-field-label { font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.woq-input { min-width: 0; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.woq-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.woq-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.woq-quotes { list-style: none; margin: 0; padding: 0; }
.woq-settings-author { display: block; margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.woq-notice { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.woq-error { color: var(--dsw-alias-state-error-primary); }
.woq-master { display: flex; align-items: center; gap: 8px; }
.woq-master > button { flex: none; }
`

    function useQuotes(needed, loadedQuotes, loadQuotes) {
      const [result, setResult] = useState(loadedQuotes)
      useEffect(() => {
        if (!needed || result !== undefined) return
        let active = true
        void loadQuotes().then(chunk => { if (active) setResult(chunk) })
        return () => { active = false }
      }, [needed, result, loadQuotes])
      return result
    }

    function QuoteHeadline({ headline, preferences, chunk, readLast, remember }) {
      const [sample] = useState(Math.random)
      const [previous] = useState(readLast)
      const { builtIn, custom, quotes } = preferences
      const quote = useMemo(() => chunk.pickQuote({ builtIn, custom, quotes }, chunk.builtInQuotes, () => sample, previous),
        [chunk, builtIn, custom, quotes, sample, previous])
      useEffect(() => { if (quote) remember(quote) }, [quote, remember])
      return h('h1', { className: 'woq-title' }, quote?.text ?? headline,
        quote?.author ? h('span', { className: 'woq-author' }, `- ${quote.author}`) : null)
    }

    function HeroHeadline({ headline, useQuoteSettings, loadedQuotes, loadQuotes, readLast, remember, fixedHeadline }) {
      const preferences = useQuoteSettings(readPreferences)
      const needed = preferences?.enabled === true
        && (preferences.builtIn || (preferences.custom && preferences.quotes.length > 0))
      const chunk = useQuotes(needed, loadedQuotes, loadQuotes)
      if (needed && chunk) return h(QuoteHeadline, { headline, preferences, chunk, readLast, remember })
      // Before the profile is ready, use the fixed greeting rather than assuming the plugin is on.
      return h('h1', { className: 'woq-title' }, preferences?.enabled === true ? headline : fixedHeadline(headline))
    }

    function useSave() {
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)
      const saving = useRef(false)
      async function save(write) {
        if (saving.current) return false
        saving.current = true
        setBusy(true)
        setFailed(false)
        try {
          const saved = await write()
          setFailed(!saved)
          return saved
        } catch (_transportError) {
          setFailed(true)
          return false
        } finally {
          saving.current = false
          setBusy(false)
        }
      }
      return { busy, failed, save }
    }

    function MasterSwitch({ t, useQuoteSettings, setPreference }) {
      const snapshot = useQuoteSettings(readForm)
      const { busy, failed, save } = useSave()
      return h('div', { className: 'woq-master' },
        failed && h('p', { className: 'woq-notice woq-error', role: 'alert' }, t('saveFailed')),
        h(Switch, { label: t('master'), checked: snapshot.value?.enabled === true,
          disabled: busy || snapshot.status !== 'ready' || !snapshot.writable,
          onChange: next => { void save(() => setPreference('enabled', next)) } }))
    }

    function MasterAction({ subject, ...props }) {
      return subject.kind === 'item' && subject.id === NS ? h(MasterSwitch, props) : null
    }

    function ListSwitch({ label, checked, disabled, onChange }) {
      return h('div', { className: 'woq-row' }, h('span', { className: 'woq-row-title' }, label),
        h(Switch, { label, checked, disabled, onChange }))
    }

    function QuoteField({ label, value, onChange, disabled, required }) {
      const id = useId()
      return h('div', { className: 'woq-field' },
        h('label', { className: 'woq-field-label', htmlFor: id }, label),
        h('input', { className: 'woq-input', id, type: 'text', value, disabled, required,
          onChange: event => onChange(event.target.value) }))
    }

    function QuoteSettings({ t, useQuoteSettings, loadedQuotes, loadQuotes, setPreference, setQuotes }) {
      const snapshot = useQuoteSettings(readForm)
      const chunk = useQuotes(true, loadedQuotes, loadQuotes)
      const { busy, failed, save } = useSave()
      const [text, setText] = useState('')
      const [author, setAuthor] = useState('')
      const listsId = useId()
      const addId = useId()
      const ready = snapshot.status === 'ready'
      const disabled = busy || !ready || !snapshot.writable
      const preferences = snapshot.value
      const quotes = preferences?.quotes ?? EMPTY_QUOTES
      const builtInLabel = chunk ? t('builtIn', { count: chunk.builtInQuotes.length }) : t('builtInLoading')
      const toggle = (field, next) => { void save(() => setPreference(field, next)) }
      const add = async event => {
        event.preventDefault()
        const trimmed = text.trim()
        if (disabled || !trimmed) return
        if (await save(() => setQuotes([...quotes, { text: trimmed, author: author.trim() }], snapshot.revision))) {
          setText('')
          setAuthor('')
        }
      }
      const remove = index => {
        void save(() => setQuotes(quotes.filter((_, i) => i !== index), snapshot.revision))
      }
      const customList = quotes.length > 0 && h('ul', { className: 'woq-quotes' },
        quotes.map(({ text, author }, index) => h('li', { className: 'woq-row', key: index },
          h('span', { className: 'woq-row-title' }, text,
            author && h('span', { className: 'woq-settings-author' }, `- ${author}`)),
          h(Button, { variant: 'outline', size: 'sm', disabled, 'aria-label': t('removeQuote', { quote: text }),
            onClick: () => remove(index) }, t('remove')))))

      return h('div', null,
        h('section', { className: 'woq-section', 'aria-labelledby': listsId },
          h('h4', { className: 'woq-section-title', id: listsId }, t('lists')),
          h(ListSwitch, { label: builtInLabel, checked: preferences?.builtIn === true, disabled,
            onChange: next => toggle('builtIn', next) }),
          h(ListSwitch, { label: t('custom', { count: quotes.length }), checked: preferences?.custom === true, disabled,
            onChange: next => toggle('custom', next) }),
          chunk === null && h('p', { className: 'woq-notice woq-error', role: 'status' }, t('loadFailed')),
          ready && !snapshot.writable && h('p', { className: 'woq-notice', role: 'status' }, t('readOnly'))),
        h('section', { className: 'woq-section', 'aria-labelledby': addId },
          h('h4', { className: 'woq-section-title', id: addId }, t('addQuote')),
          h('form', { className: 'woq-form', onSubmit: add },
            h(QuoteField, { label: t('quote'), value: text, onChange: setText, disabled, required: true }),
            h(QuoteField, { label: t('author'), value: author, onChange: setAuthor, disabled }),
            h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: disabled || !text.trim() }, t('add'))),
          failed && h('p', { className: 'woq-notice woq-error', role: 'alert' }, t('saveFailed')),
          customList))
    }

    function SettingsItem({ view, ...props }) {
      return view === 'summary' ? props.t('summary') : h(QuoteSettings, props)
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(NS)
        const t = ctx.locale.bind(NS)
        const themed = ctx.locale.bind('jan-theme')
        const logger = ctx.logger(NS)
        const hooks = { quoteSettings: form }
        let lastQuote
        let chunk
        let loading
        const loadedQuotes = () => chunk
        const loadQuotes = () => loading ??= require.async('./client.quotes.js').then(
          quotes => { chunk = quotes; return quotes },
          error => { logger.error(error); chunk = null; return null },
        )
        const fixedHeadline = headline => {
          const localized = themed(THEME_HEADLINE)
          return localized === THEME_HEADLINE ? headline : localized
        }
        const setPreference = (field, value) => form.set(field, value)
        const setQuotes = (value, revision) => form.mutate([{ op: 'set', path: ['quotes'], value }], revision)

        ctx.effect(() => ctx.locale.register(NS, dictionaries))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@janhq/jan-wall-of-quotes'
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        })

        ctx.slots.inject(HEADLINE_SLOT, () => ctx.slots.register({
          name: HEADLINE_SLOT, priority: -2,
          inject: () => ({ hooks, loadedQuotes, loadQuotes, fixedHeadline,
            readLast: () => lastQuote, remember: quote => { lastQuote = quote } }),
        }, HeroHeadline))
        ctx.effect(() => ctx.configForms.whileServed([NS], () => {
          const clearItem = ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
            name: SETTINGS_SLOT, id: NS, order: 50, label: () => t('title'), locale: NS,
            inject: () => ({ hooks, loadedQuotes, loadQuotes, setPreference, setQuotes }),
          }, SettingsItem))
          const clearActions = ctx.slots.inject(ACTIONS_SLOT, () => ctx.slots.register({
            name: ACTIONS_SLOT, id: NS, locale: NS, inject: () => ({ hooks, setPreference }),
          }, MasterAction))
          return () => { clearActions(); clearItem() }
        }))
      },
    }
  },
})
