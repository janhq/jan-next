/** Copy dictionaries for the plugin translation Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件翻译',
  intro: '用默认模型把插件的界面文案和工具标题翻译成{language}，结果只保存在这台电脑上。',
  globalLabel: '翻译所有插件的工具标题',
  globalHint: '文字使用其他文字系统的工具标题会发送给{model}翻译。默认关闭。',
  modelDefault: '默认模型',
  loading: '正在读取插件…',
  error: '暂时无法读取插件翻译。',
  retry: '重试',
  empty: '没有已安装的插件。',
  machineTag: '机器翻译',
  notTranslated: '尚未翻译成{language}',
  translated: '已由{model}翻译成{language}，共 {count} 条',
  translatedKept: '已由{model}翻译成{language}，共 {count} 条，另有 {kept} 条保留原文',
  running: '正在翻译… {done} / {total}',
  failed: '翻译失败：{reason}',
  actionTranslate: '翻译',
  actionRerun: '重新翻译',
  actionClear: '清除',
} as const

/** Plugin translation locale key union. */
export type PluginI18nLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Translations',
  intro: 'Translate plugin text and tool titles into {language} with your default model. Results stay on this computer.',
  globalLabel: 'Translate tool titles of every plugin',
  globalHint: 'Tool titles written in another script are sent to {model} to be translated. Off by default.',
  modelDefault: 'the default model',
  loading: 'Reading plugins...',
  error: 'Plugin translations could not be read.',
  retry: 'Retry',
  empty: 'No installed plugins.',
  machineTag: 'Machine translated',
  notTranslated: 'Not translated into {language}',
  translated: 'Translated into {language} by {model} - {count} strings',
  translatedKept: 'Translated into {language} by {model} - {count} strings, {kept} kept in the original',
  running: 'Translating... {done} of {total}',
  failed: 'Translation failed: {reason}',
  actionTranslate: 'Translate',
  actionRerun: 'Run again',
  actionClear: 'Clear',
} satisfies Record<PluginI18nLocaleKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  tab: 'プラグイン翻訳',
  intro: '既定のモデルでプラグインの文言とツールのタイトルを{language}に翻訳します。結果はこのコンピュータにのみ保存されます。',
  globalLabel: 'すべてのプラグインのツールタイトルを翻訳',
  globalHint: '別の文字で書かれたツールタイトルは、翻訳のため{model}に送信されます。初期設定ではオフです。',
  modelDefault: '既定のモデル',
  loading: 'プラグインを読み込んでいます...',
  error: 'プラグイン翻訳を読み込めませんでした。',
  retry: '再試行',
  empty: 'インストール済みのプラグインはありません。',
  machineTag: '機械翻訳',
  notTranslated: '{language}には未翻訳です',
  translated: '{model}で{language}に翻訳済み - {count} 件',
  translatedKept: '{model}で{language}に翻訳済み - {count} 件、{kept} 件は原文のまま',
  running: '翻訳中... {done} / {total}',
  failed: '翻訳に失敗しました: {reason}',
  actionTranslate: '翻訳',
  actionRerun: 'もう一度翻訳',
  actionClear: '消去',
} satisfies Record<PluginI18nLocaleKey, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  tab: 'Traducciones',
  intro: 'Traduce el texto de los plugins y los títulos de sus herramientas a {language} con tu modelo predeterminado. Los resultados se quedan en este equipo.',
  globalLabel: 'Traducir los títulos de herramientas de todos los plugins',
  globalHint: 'Los títulos de herramientas escritos en otro alfabeto se envían a {model} para traducirlos. Desactivado por defecto.',
  modelDefault: 'el modelo predeterminado',
  loading: 'Leyendo plugins...',
  error: 'No se pudieron leer las traducciones de plugins.',
  retry: 'Reintentar',
  empty: 'No hay plugins instalados.',
  machineTag: 'Traducción automática',
  notTranslated: 'Sin traducir a {language}',
  translated: 'Traducido a {language} por {model} - {count} cadenas',
  translatedKept: 'Traducido a {language} por {model} - {count} cadenas, {kept} se dejaron en el original',
  running: 'Traduciendo... {done} de {total}',
  failed: 'La traducción falló: {reason}',
  actionTranslate: 'Traducir',
  actionRerun: 'Volver a traducir',
  actionClear: 'Borrar',
} satisfies Record<PluginI18nLocaleKey, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  tab: 'Traductions',
  intro: 'Traduit le texte des plugins et les titres de leurs outils en {language} avec votre modèle par défaut. Les résultats restent sur cet ordinateur.',
  globalLabel: 'Traduire les titres d\'outils de tous les plugins',
  globalHint: 'Les titres d\'outils écrits dans une autre écriture sont envoyés à {model} pour être traduits. Désactivé par défaut.',
  modelDefault: 'le modèle par défaut',
  loading: 'Lecture des plugins...',
  error: 'Impossible de lire les traductions des plugins.',
  retry: 'Réessayer',
  empty: 'Aucun plugin installé.',
  machineTag: 'Traduction automatique',
  notTranslated: 'Non traduit en {language}',
  translated: 'Traduit en {language} par {model} - {count} chaînes',
  translatedKept: 'Traduit en {language} par {model} - {count} chaînes, {kept} laissées dans l\'original',
  running: 'Traduction... {done} sur {total}',
  failed: 'La traduction a échoué : {reason}',
  actionTranslate: 'Traduire',
  actionRerun: 'Traduire à nouveau',
  actionClear: 'Effacer',
} satisfies Record<PluginI18nLocaleKey, string>

/** German dictionary, checked against the English keys. */
export const de = {
  tab: 'Übersetzungen',
  intro: 'Übersetzt Plugin-Texte und Werkzeugtitel mit Ihrem Standardmodell ins {language}. Die Ergebnisse bleiben auf diesem Computer.',
  globalLabel: 'Werkzeugtitel aller Plugins übersetzen',
  globalHint: 'Werkzeugtitel in einer anderen Schrift werden zum Übersetzen an {model} gesendet. Standardmäßig aus.',
  modelDefault: 'das Standardmodell',
  loading: 'Plugins werden gelesen...',
  error: 'Die Plugin-Übersetzungen konnten nicht gelesen werden.',
  retry: 'Erneut versuchen',
  empty: 'Keine Plugins installiert.',
  machineTag: 'Maschinell übersetzt',
  notTranslated: 'Nicht ins {language} übersetzt',
  translated: 'Von {model} ins {language} übersetzt - {count} Texte',
  translatedKept: 'Von {model} ins {language} übersetzt - {count} Texte, {kept} im Original belassen',
  running: 'Übersetzung läuft... {done} von {total}',
  failed: 'Übersetzung fehlgeschlagen: {reason}',
  actionTranslate: 'Übersetzen',
  actionRerun: 'Erneut übersetzen',
  actionClear: 'Löschen',
} satisfies Record<PluginI18nLocaleKey, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  tab: 'Переводы',
  intro: 'Переводит тексты плагинов и заголовки инструментов на язык «{language}» с помощью модели по умолчанию. Результаты остаются на этом компьютере.',
  globalLabel: 'Переводить заголовки инструментов всех плагинов',
  globalHint: 'Заголовки инструментов, написанные другим письмом, отправляются на перевод в {model}. По умолчанию выключено.',
  modelDefault: 'модель по умолчанию',
  loading: 'Чтение плагинов...',
  error: 'Не удалось прочитать переводы плагинов.',
  retry: 'Повторить',
  empty: 'Нет установленных плагинов.',
  machineTag: 'Машинный перевод',
  notTranslated: 'Не переведено на язык «{language}»',
  translated: 'Переведено на язык «{language}» моделью {model} - строк: {count}',
  translatedKept: 'Переведено на язык «{language}» моделью {model} - строк: {count}, в оригинале оставлено: {kept}',
  running: 'Перевод... {done} из {total}',
  failed: 'Не удалось перевести: {reason}',
  actionTranslate: 'Перевести',
  actionRerun: 'Перевести заново',
  actionClear: 'Очистить',
} satisfies Record<PluginI18nLocaleKey, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  tab: 'Traduções',
  intro: 'Traduz o texto dos plugins e os títulos das ferramentas para {language} com o seu modelo padrão. Os resultados ficam neste computador.',
  globalLabel: 'Traduzir os títulos de ferramentas de todos os plugins',
  globalHint: 'Os títulos de ferramentas escritos em outro alfabeto são enviados a {model} para tradução. Desativado por padrão.',
  modelDefault: 'o modelo padrão',
  loading: 'Lendo plugins...',
  error: 'Não foi possível ler as traduções dos plugins.',
  retry: 'Tentar de novo',
  empty: 'Nenhum plugin instalado.',
  machineTag: 'Tradução automática',
  notTranslated: 'Não traduzido para {language}',
  translated: 'Traduzido para {language} por {model} - {count} textos',
  translatedKept: 'Traduzido para {language} por {model} - {count} textos, {kept} mantidos no original',
  running: 'Traduzindo... {done} de {total}',
  failed: 'A tradução falhou: {reason}',
  actionTranslate: 'Traduzir',
  actionRerun: 'Traduzir de novo',
  actionClear: 'Limpar',
} satisfies Record<PluginI18nLocaleKey, string>
