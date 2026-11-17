/** Copy for the two Models page policy cards. */

/** Locale namespace. */
export const NS = 'settings.modelPolicy' as const
/** English dictionary. */
export const en = {
  fallbackTitle: 'Fallback models',
  fallbackDescription: 'If your model is rate-limited, out of quota or refuses, Jan continues on the next model in this list and switches back later.',
  fallbackEmpty: 'Fallback is off until you add a model.',
  addFallback: 'Add fallback model',
  moveUp: 'Move up', moveDown: 'Move down', remove: 'Remove',
  cooldown: 'Try your model again after',
  minute1: '1 min', minute5: '5 min', minute15: '15 min', hour1: '1 hour', seconds: 's',
  switchBack: 'Switch back when context is below',
  switchBackHint: 'Switching models drops the prompt cache, so Jan waits until the conversation is small.',
  always: 'Always',
  contextTitle: 'Context',
  autoCompact: 'Auto-compact',
  autoCompactHint: 'Jan trims large tool outputs, then summarizes older messages. Recent messages stay word for word. /compact works anytime.',
  threshold: 'Compact at',
  summaryModel: 'Summary model',
  sameModel: 'Same as the chat model',
  contextLength: 'Context length',
  contextLengthHint: 'Set it per model: Edit a provider above, open Customized settings, then expand the model to find Context window.',
  readOnly: 'Settings are read-only.',
  catalogError: 'Could not load models.',
  retry: 'Try again',
  unavailable: 'Settings are unavailable.',
} as const
/** Dictionary keys. */
export type ModelPolicyKey = keyof typeof en

/** Simplified Chinese. */
export const zh: Record<ModelPolicyKey, string> = {
  fallbackTitle: '备用模型', fallbackDescription: '当所选模型限流、配额用尽或拒绝回答时，Jan 会依次尝试列表中的模型，稍后再切回。',
  fallbackEmpty: '添加模型后才会启用备用模型。', addFallback: '添加备用模型', moveUp: '上移', moveDown: '下移', remove: '移除',
  cooldown: '多久后重试原模型', switchBack: '上下文低于多少时切回', switchBackHint: '切换模型会丢失提示缓存，因此 Jan 会等待对话变短。', always: '始终',
  minute1: '1 分钟', minute5: '5 分钟', minute15: '15 分钟', hour1: '1 小时', seconds: '秒',
  contextTitle: '上下文', autoCompact: '自动压缩', autoCompactHint: 'Jan 会先裁剪过长的工具输出，再总结较早的消息。最近的消息保持原文。随时可以使用 /compact。',
  threshold: '压缩阈值', summaryModel: '总结模型', sameModel: '与聊天模型相同', contextLength: '上下文长度',
  contextLengthHint: '按模型设置：在上方提供商处点击“编辑”，展开“自定义设置”，再展开模型即可看到“上下文窗口”。', readOnly: '设置为只读。', catalogError: '无法加载模型。', retry: '重试', unavailable: '设置不可用。',
}
/** Japanese. */
export const ja: Record<ModelPolicyKey, string> = {
  fallbackTitle: '代替モデル', fallbackDescription: '選択したモデルが制限、クォータ超過、回答拒否になった場合、Jan はリストの次のモデルで続け、後で元に戻します。',
  fallbackEmpty: 'モデルを追加するまで代替は無効です。', addFallback: '代替モデルを追加', moveUp: '上へ', moveDown: '下へ', remove: '削除',
  cooldown: '元のモデルを再試行するまで', switchBack: 'コンテキストが次より少ないとき戻す', switchBackHint: 'モデルの切り替えでプロンプトキャッシュが失われるため、会話が短くなるまで待ちます。', always: '常に',
  minute1: '1 分', minute5: '5 分', minute15: '15 分', hour1: '1 時間', seconds: '秒',
  contextTitle: 'コンテキスト', autoCompact: '自動圧縮', autoCompactHint: '長いツール出力を縮め、古いメッセージを要約します。最近のメッセージはそのまま残ります。/compact はいつでも使えます。',
  threshold: '圧縮する割合', summaryModel: '要約モデル', sameModel: 'チャットと同じモデル', contextLength: 'コンテキスト長',
  contextLengthHint: 'モデルごとに設定します。上のプロバイダーで「編集」を押し、「カスタマイズされた設定」を開いてモデルを展開すると「コンテキストウィンドウ」があります。', readOnly: '設定は読み取り専用です。', catalogError: 'モデルを読み込めません。', retry: '再試行', unavailable: '設定を利用できません。',
}
/** Spanish. */
export const es: Record<ModelPolicyKey, string> = {
  fallbackTitle: 'Modelos alternativos', fallbackDescription: 'Si tu modelo tiene límites, agota la cuota o rechaza responder, Jan sigue con el siguiente modelo de la lista y vuelve después.',
  fallbackEmpty: 'La alternativa está desactivada hasta que añadas un modelo.', addFallback: 'Añadir modelo alternativo', moveUp: 'Subir', moveDown: 'Bajar', remove: 'Quitar',
  cooldown: 'Volver a probar tu modelo después de', switchBack: 'Volver cuando el contexto esté por debajo de', switchBackHint: 'Cambiar de modelo borra la caché del prompt; Jan espera a que la conversación sea corta.', always: 'Siempre',
  minute1: '1 min', minute5: '5 min', minute15: '15 min', hour1: '1 hora', seconds: 's',
  contextTitle: 'Contexto', autoCompact: 'Compactar automáticamente', autoCompactHint: 'Jan recorta las salidas largas de herramientas y resume mensajes antiguos. Los recientes quedan intactos. /compact funciona siempre.',
  threshold: 'Compactar al', summaryModel: 'Modelo de resumen', sameModel: 'El mismo modelo del chat', contextLength: 'Longitud del contexto',
  contextLengthHint: 'Se ajusta por modelo: pulsa Editar en un proveedor de arriba, abre «Configuraciones personalizadas» y despliega el modelo para ver «ventana contextual».', readOnly: 'Configuración de solo lectura.', catalogError: 'No se pudieron cargar los modelos.', retry: 'Reintentar', unavailable: 'Configuración no disponible.',
}
/** French. */
export const fr: Record<ModelPolicyKey, string> = {
  fallbackTitle: 'Modèles de secours', fallbackDescription: 'Si votre modèle est limité, sans quota ou refuse de répondre, Jan continue avec le suivant dans la liste, puis revient plus tard.',
  fallbackEmpty: 'Le secours reste désactivé tant que vous n’ajoutez pas de modèle.', addFallback: 'Ajouter un modèle de secours', moveUp: 'Monter', moveDown: 'Descendre', remove: 'Retirer',
  cooldown: 'Réessayer votre modèle après', switchBack: 'Revenir si le contexte est inférieur à', switchBackHint: 'Changer de modèle vide le cache de prompt ; Jan attend que la conversation soit courte.', always: 'Toujours',
  minute1: '1 min', minute5: '5 min', minute15: '15 min', hour1: '1 heure', seconds: 's',
  contextTitle: 'Contexte', autoCompact: 'Compacter automatiquement', autoCompactHint: 'Jan réduit les grandes sorties d’outils, puis résume les anciens messages. Les récents restent inchangés. /compact fonctionne à tout moment.',
  threshold: 'Compacter à', summaryModel: 'Modèle de résumé', sameModel: 'Même modèle que le chat', contextLength: 'Longueur du contexte',
  contextLengthHint: 'Se règle par modèle : cliquez sur Modifier pour un fournisseur ci-dessus, ouvrez « Paramètres personnalisés », puis dépliez le modèle pour voir « Fenêtre contextuelle ».', readOnly: 'Paramètres en lecture seule.', catalogError: 'Impossible de charger les modèles.', retry: 'Réessayer', unavailable: 'Paramètres indisponibles.',
}
/** German. */
export const de: Record<ModelPolicyKey, string> = {
  fallbackTitle: 'Ersatzmodelle', fallbackDescription: 'Wenn dein Modell limitiert ist, das Kontingent aufgebraucht hat oder ablehnt, setzt Jan mit dem nächsten Modell der Liste fort und kehrt später zurück.',
  fallbackEmpty: 'Ohne ein hinzugefügtes Modell bleibt der Ersatz aus.', addFallback: 'Ersatzmodell hinzufügen', moveUp: 'Nach oben', moveDown: 'Nach unten', remove: 'Entfernen',
  cooldown: 'Dein Modell erneut versuchen nach', switchBack: 'Zurückwechseln, wenn der Kontext unter', switchBackHint: 'Ein Modellwechsel verwirft den Prompt-Cache. Jan wartet daher, bis die Unterhaltung kurz ist.', always: 'Immer',
  minute1: '1 Min.', minute5: '5 Min.', minute15: '15 Min.', hour1: '1 Stunde', seconds: 's',
  contextTitle: 'Kontext', autoCompact: 'Automatisch verdichten', autoCompactHint: 'Jan kürzt große Tool-Ausgaben und fasst ältere Nachrichten zusammen. Die neuesten bleiben unverändert. /compact funktioniert jederzeit.',
  threshold: 'Verdichten bei', summaryModel: 'Modell für Zusammenfassungen', sameModel: 'Wie das Chatmodell', contextLength: 'Kontextlänge',
  contextLengthHint: 'Pro Modell festlegen: oben bei einem Anbieter auf Bearbeiten klicken, „Benutzerdefinierte Einstellungen“ öffnen und das Modell aufklappen, um „Kontextfenster“ zu sehen.', readOnly: 'Einstellungen sind schreibgeschützt.', catalogError: 'Modelle konnten nicht geladen werden.', retry: 'Erneut versuchen', unavailable: 'Einstellungen nicht verfügbar.',
}
/** Russian. */
export const ru: Record<ModelPolicyKey, string> = {
  fallbackTitle: 'Запасные модели', fallbackDescription: 'Если выбранная модель ограничена, исчерпала квоту или отказывает, Jan продолжит ответ следующей моделью из списка и позже вернётся к исходной.',
  fallbackEmpty: 'Запасные модели выключены, пока вы не добавите модель.', addFallback: 'Добавить запасную модель', moveUp: 'Вверх', moveDown: 'Вниз', remove: 'Удалить',
  cooldown: 'Повторить исходную модель через', switchBack: 'Вернуться, если контекст меньше', switchBackHint: 'При смене модели кэш промпта теряется, поэтому Jan ждёт, пока диалог сократится.', always: 'Всегда',
  minute1: '1 мин', minute5: '5 мин', minute15: '15 мин', hour1: '1 час', seconds: 'с',
  contextTitle: 'Контекст', autoCompact: 'Автоматическое сжатие', autoCompactHint: 'Jan сокращает большие ответы инструментов и пересказывает старые сообщения. Последние сообщения остаются без изменений. /compact работает всегда.',
  threshold: 'Сжимать при', summaryModel: 'Модель для пересказа', sameModel: 'Та же, что в чате', contextLength: 'Длина контекста',
  contextLengthHint: 'Задаётся для каждой модели: нажмите «Редактировать» у провайдера выше, откройте «Индивидуальные настройки» и разверните модель, чтобы увидеть «Контекстное окно».', readOnly: 'Настройки только для чтения.', catalogError: 'Не удалось загрузить модели.', retry: 'Повторить', unavailable: 'Настройки недоступны.',
}
/** Brazilian Portuguese. */
export const pt: Record<ModelPolicyKey, string> = {
  fallbackTitle: 'Modelos alternativos', fallbackDescription: 'Se o modelo escolhido sofrer limite, esgotar a cota ou recusar, Jan continua com o próximo da lista e volta ao original mais tarde.',
  fallbackEmpty: 'A alternativa fica desligada até você adicionar um modelo.', addFallback: 'Adicionar modelo alternativo', moveUp: 'Subir', moveDown: 'Descer', remove: 'Remover',
  cooldown: 'Tentar seu modelo novamente após', switchBack: 'Voltar quando o contexto estiver abaixo de', switchBackHint: 'Trocar de modelo perde o cache do prompt; Jan espera a conversa ficar curta.', always: 'Sempre',
  minute1: '1 min', minute5: '5 min', minute15: '15 min', hour1: '1 hora', seconds: 's',
  contextTitle: 'Contexto', autoCompact: 'Compactação automática', autoCompactHint: 'Jan reduz saídas grandes de ferramentas e resume mensagens antigas. As recentes permanecem iguais. /compact funciona a qualquer momento.',
  threshold: 'Compactar em', summaryModel: 'Modelo de resumo', sameModel: 'Igual ao modelo do chat', contextLength: 'Tamanho do contexto',
  contextLengthHint: 'Defina por modelo: clique em Editar em um provedor acima, abra "Configurações personalizadas" e expanda o modelo para ver "Janela de contexto".', readOnly: 'Configurações somente leitura.', catalogError: 'Não foi possível carregar os modelos.', retry: 'Tentar novamente', unavailable: 'Configurações indisponíveis.',
}

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.modelPolicy': ModelPolicyKey
  }
}
