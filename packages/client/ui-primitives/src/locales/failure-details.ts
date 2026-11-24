type Labels = readonly [details: string, copy: string, show: string, copied: string, copyFailed: string]

/** Failure action copy selected from the document language, like Toast's close control. */
const LABELS: Readonly<Record<string, Labels>> & { en: Labels } = {
  en: ['Details', 'Copy details', 'Show log', 'Details copied', 'Could not copy details. Select the text to copy it.'],
  zh: ['详情', '复制详情', '显示日志', '已复制详情', '无法复制详情，请选择文本后手动复制'],
  ja: ['詳細', '詳細をコピー', 'ログを表示', '詳細をコピーしました', '詳細をコピーできませんでした。テキストを選択してコピーしてください。'],
  es: ['Detalles', 'Copiar detalles', 'Mostrar registro', 'Detalles copiados', 'No se pudieron copiar los detalles. Selecciona el texto para copiarlo.'],
  fr: ['Détails', 'Copier les détails', 'Afficher le journal', 'Détails copiés', 'Impossible de copier les détails. Sélectionnez le texte pour le copier.'],
  de: ['Details', 'Details kopieren', 'Protokoll anzeigen', 'Details kopiert', 'Die Details konnten nicht kopiert werden. Wählen Sie den Text zum Kopieren aus.'],
  ru: ['Подробности', 'Копировать подробности', 'Показать журнал', 'Подробности скопированы', 'Не удалось скопировать подробности. Выделите текст, чтобы скопировать его.'],
  pt: ['Detalhes', 'Copiar detalhes', 'Mostrar registro', 'Detalhes copiados', 'Não foi possível copiar os detalhes. Selecione o texto para copiá-lo.'],
}

/**
 * Select failure action labels by language.
 * @param language - Document language tag.
 * @returns The shipped labels, using English when the language is not shipped.
 */
export function failureLabels(language: string): Labels {
  return LABELS[language.toLowerCase().split('-')[0] ?? ''] ?? LABELS.en
}
