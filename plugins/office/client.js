// Browser half of the Office plugin, hand-written for the client module loader.
window.__ModuleLoader__.load({
  id: '@janhq/jan-office',
  factory(require) {
    const { createElement: h, useId, useRef, useState } = require('react')
    const { Switch } = require('@janhq/jan-client-ui-primitives')
    const NS = 'jan-office'
    const SETTINGS_SLOT = 'plugins.item'
    const ACTIONS_SLOT = 'plugins.detail.actions'
    const readForm = snapshot => snapshot

    const dictionaries = {
      en: {
        title: 'Office', summary: 'Word, PowerPoint and Excel skills, and LibreOffice Kit operations.', master: 'Offer Office skills',
        formats: 'Documents', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Render pages, recalculate formulas and export PDF',
        note: 'Turned-off skills leave every chat\'s skill list. New chats and the next message in open chats use the change.',
        saveFailed: 'Could not save your change. Try again.', readOnly: 'These settings are read-only.',
      },
      zh: {
        title: 'Office', summary: 'Word、PowerPoint、Excel 技能与 LibreOffice Kit 操作。', master: '提供 Office 技能',
        formats: '文档', word: 'Word（.docx）', powerpoint: 'PowerPoint（.pptx）', excel: 'Excel（.xlsx）',
        tools: 'LibreOffice Kit', operations: '渲染页面、重算公式并导出 PDF',
        note: '关闭的技能会从所有对话的技能列表中移除。新对话和已打开对话的下一条消息会使用此更改。',
        saveFailed: '无法保存更改，请重试', readOnly: '这些设置为只读',
      },
      ja: {
        title: 'Office', summary: 'Word、PowerPoint、Excel のスキルと LibreOffice Kit の操作。', master: 'Office スキルを提供',
        formats: 'ドキュメント', word: 'Word（.docx）', powerpoint: 'PowerPoint（.pptx）', excel: 'Excel（.xlsx）',
        tools: 'LibreOffice Kit', operations: 'ページの描画、数式の再計算、PDF への書き出し',
        note: 'オフにしたスキルはすべてのチャットのスキル一覧から外れます。新しいチャットと開いているチャットの次のメッセージから反映されます。',
        saveFailed: '変更を保存できませんでした。もう一度お試しください。', readOnly: 'これらの設定は読み取り専用です。',
      },
      es: {
        title: 'Office', summary: 'Habilidades de Word, PowerPoint y Excel, y operaciones de LibreOffice Kit.', master: 'Ofrecer habilidades de Office',
        formats: 'Documentos', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Renderizar páginas, recalcular fórmulas y exportar a PDF',
        note: 'Las habilidades desactivadas salen de la lista de cada chat. Los chats nuevos y el siguiente mensaje de los abiertos usan el cambio.',
        saveFailed: 'No se pudo guardar el cambio. Inténtalo de nuevo.', readOnly: 'Estos ajustes son de solo lectura.',
      },
      fr: {
        title: 'Office', summary: 'Compétences Word, PowerPoint et Excel, et opérations LibreOffice Kit.', master: 'Proposer les compétences Office',
        formats: 'Documents', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Rendre les pages, recalculer les formules et exporter en PDF',
        note: 'Les compétences désactivées quittent la liste de chaque chat. Les nouveaux chats et le prochain message des chats ouverts utilisent le changement.',
        saveFailed: 'Impossible d’enregistrer la modification. Réessayez.', readOnly: 'Ces paramètres sont en lecture seule.',
      },
      de: {
        title: 'Office', summary: 'Word-, PowerPoint- und Excel-Skills sowie LibreOffice-Kit-Vorgänge.', master: 'Office-Skills anbieten',
        formats: 'Dokumente', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Seiten rendern, Formeln neu berechnen und als PDF exportieren',
        note: 'Ausgeschaltete Skills verschwinden aus der Skill-Liste jedes Chats. Neue Chats und die nächste Nachricht offener Chats nutzen die Änderung.',
        saveFailed: 'Die Änderung konnte nicht gespeichert werden. Versuche es erneut.', readOnly: 'Diese Einstellungen sind schreibgeschützt.',
      },
      ru: {
        title: 'Office', summary: 'Навыки Word, PowerPoint и Excel и операции LibreOffice Kit.', master: 'Предлагать навыки Office',
        formats: 'Документы', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Отрисовка страниц, пересчёт формул и экспорт в PDF',
        note: 'Выключенные навыки исчезают из списка навыков каждого чата. Новые чаты и следующее сообщение в открытых чатах используют изменение.',
        saveFailed: 'Не удалось сохранить изменение. Попробуйте ещё раз.', readOnly: 'Эти настройки доступны только для чтения.',
      },
      pt: {
        title: 'Office', summary: 'Habilidades de Word, PowerPoint e Excel, e operações do LibreOffice Kit.', master: 'Oferecer habilidades do Office',
        formats: 'Documentos', word: 'Word (.docx)', powerpoint: 'PowerPoint (.pptx)', excel: 'Excel (.xlsx)',
        tools: 'LibreOffice Kit', operations: 'Renderizar páginas, recalcular fórmulas e exportar PDF',
        note: 'As habilidades desligadas saem da lista de cada chat. Chats novos e a próxima mensagem dos chats abertos usam a alteração.',
        saveFailed: 'Não foi possível salvar a alteração. Tente novamente.', readOnly: 'Estas configurações são somente leitura.',
      },
    }

    const CSS = `
.jof-section-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.jof-section + .jof-section { margin-top: 32px; }
.jof-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.jof-row-title { min-width: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.jof-row[data-off] .jof-row-title { color: var(--dsw-alias-label-tertiary); }
.jof-notice { margin: 12px 0 0; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.jof-error { color: var(--dsw-alias-state-error-primary); }
`

    function useSave() {
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)
      const saving = useRef(false)
      async function save(write) {
        if (saving.current) return
        saving.current = true
        setBusy(true)
        setFailed(false)
        try { setFailed(!(await write())) } catch (_transportError) { setFailed(true) } finally {
          saving.current = false
          setBusy(false)
        }
      }
      return { busy, failed, save }
    }

    function Row({ label, checked, disabled, onChange }) {
      return h('div', { className: 'jof-row', 'data-off': disabled || undefined },
        h('span', { className: 'jof-row-title' }, label),
        h(Switch, { label, checked, disabled, onChange }))
    }

    function OfficeSettings({ t, useOfficeSettings, setPreference }) {
      const snapshot = useOfficeSettings(readForm)
      const { busy, failed, save } = useSave()
      const formatsId = useId()
      const toolsId = useId()
      const ready = snapshot.status === 'ready'
      const value = snapshot.value
      // Parts stay visible while the plugin is off so the next switch-on keeps the chosen set.
      const disabled = busy || !ready || !snapshot.writable || value?.enabled !== true
      const row = field => h(Row, { label: t(field), checked: value?.[field] === true, disabled,
        onChange: next => { void save(() => setPreference(field, next)) } })
      return h('div', null,
        h('section', { className: 'jof-section', 'aria-labelledby': formatsId },
          h('h4', { className: 'jof-section-title', id: formatsId }, t('formats')),
          row('word'), row('powerpoint'), row('excel')),
        h('section', { className: 'jof-section', 'aria-labelledby': toolsId },
          h('h4', { className: 'jof-section-title', id: toolsId }, t('tools')),
          row('operations')),
        h('p', { className: 'jof-notice' }, t('note')),
        failed && h('p', { className: 'jof-notice jof-error', role: 'alert' }, t('saveFailed')),
        ready && !snapshot.writable && h('p', { className: 'jof-notice', role: 'status' }, t('readOnly')))
    }

    function SettingsItem({ view, ...props }) {
      return view === 'summary' ? props.t('summary') : h(OfficeSettings, props)
    }

    function MasterSwitch({ t, useOfficeSettings, setPreference }) {
      const snapshot = useOfficeSettings(readForm)
      const { busy, failed, save } = useSave()
      return h('div', null,
        failed && h('p', { className: 'jof-notice jof-error', role: 'alert' }, t('saveFailed')),
        h(Switch, { label: t('master'), checked: snapshot.value?.enabled === true,
          disabled: busy || snapshot.status !== 'ready' || !snapshot.writable,
          onChange: next => { void save(() => setPreference('enabled', next)) } }))
    }

    function MasterAction({ subject, ...props }) {
      return subject.kind === 'item' && subject.id === NS ? h(MasterSwitch, props) : null
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(NS)
        const t = ctx.locale.bind(NS)
        const hooks = { officeSettings: form }
        const setPreference = (field, value) => form.set(field, value)
        ctx.effect(() => ctx.locale.register(NS, dictionaries))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@janhq/jan-office'
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        })
        ctx.effect(() => ctx.configForms.whileServed([NS], () => {
          const clearItem = ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
            name: SETTINGS_SLOT, id: NS, order: 40, label: () => t('title'), locale: NS,
            inject: () => ({ hooks, setPreference }),
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
