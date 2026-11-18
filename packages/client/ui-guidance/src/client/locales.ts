/** Tour navigation dictionaries; participating features own each step's text. */
const en = { next: 'Next', previous: 'Previous', done: 'Done', close: 'Close tour', progress: '{current} of {total}' }

/** Locale keys owned by the guidance plugin. */
export type GuidanceKey = keyof typeof en

/** Navigation, dismissal, and step position copy in each supported locale. */
export const dictionaries = {
  en,
  zh: { next: '下一步', previous: '上一步', done: '完成', close: '关闭引导', progress: '第 {current} 步，共 {total} 步' },
  ja: { next: '次へ', previous: '前へ', done: '完了', close: 'ツアーを閉じる', progress: '{total} ステップ中 {current}' },
  es: { next: 'Siguiente', previous: 'Anterior', done: 'Finalizar', close: 'Cerrar la visita guiada', progress: '{current} de {total}' },
  fr: { next: 'Suivant', previous: 'Précédent', done: 'Terminer', close: 'Fermer la visite guidée', progress: '{current} sur {total}' },
  de: { next: 'Weiter', previous: 'Zurück', done: 'Fertig', close: 'Tour schließen', progress: '{current} von {total}' },
  ru: { next: 'Далее', previous: 'Назад', done: 'Готово', close: 'Закрыть тур', progress: '{current} из {total}' },
  pt: { next: 'Seguinte', previous: 'Anterior', done: 'Concluir', close: 'Fechar a visita guiada', progress: '{current} de {total}' },
} satisfies Record<string, Record<GuidanceKey, string>>
