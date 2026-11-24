const en = {
  description: 'Ask a quick question without interrupting the chat',
  hint: 'Type a side question',
  title: 'Side question',
  waiting: 'Waiting for an answer…',
  empty: 'The model returned no answer.',
  noModel: 'Choose a chat model before asking a side question.',
  failed: 'Could not answer the side question.',
  copy: 'Copy',
  copied: 'Copied',
  dismiss: 'Dismiss',
  footnotes: 'Footnotes',
}

export type BtwKey = keyof typeof en

export const dictionaries = {
  en,
  zh: {
    description: '提出一个小问题，不打断当前对话', hint: '输入补充问题', title: '补充问题',
    waiting: '正在等待回答…', empty: '模型未返回回答。', noModel: '请先为对话选择模型，再提出补充问题。',
    failed: '无法回答这个补充问题。', copy: '复制', copied: '已复制', dismiss: '关闭', footnotes: '脚注',
  },
  ja: {
    description: 'チャットを中断せずにちょっとした質問をする', hint: '別の質問を入力', title: '別の質問',
    waiting: '回答を待っています…', empty: 'モデルから回答がありませんでした。', noModel: '質問する前にチャットのモデルを選んでください。',
    failed: '質問に回答できませんでした。', copy: 'コピー', copied: 'コピーしました', dismiss: '閉じる', footnotes: '脚注',
  },
  es: {
    description: 'Haz una pregunta rápida sin interrumpir el chat', hint: 'Escribe una pregunta aparte', title: 'Pregunta aparte',
    waiting: 'Esperando una respuesta…', empty: 'El modelo no respondió.', noModel: 'Elige un modelo de chat antes de hacer una pregunta aparte.',
    failed: 'No se pudo responder a la pregunta aparte.', copy: 'Copiar', copied: 'Copiado', dismiss: 'Cerrar', footnotes: 'Notas al pie',
  },
  fr: {
    description: 'Posez une question rapide sans interrompre la discussion', hint: 'Saisissez une question à part', title: 'Question à part',
    waiting: 'En attente d’une réponse…', empty: 'Le modèle n’a pas répondu.', noModel: 'Choisissez un modèle avant de poser une question à part.',
    failed: 'Impossible de répondre à la question à part.', copy: 'Copier', copied: 'Copié', dismiss: 'Fermer', footnotes: 'Notes de bas de page',
  },
  de: {
    description: 'Stelle eine kurze Frage, ohne den Chat zu unterbrechen', hint: 'Gib eine Zwischenfrage ein', title: 'Zwischenfrage',
    waiting: 'Warte auf eine Antwort…', empty: 'Das Modell hat nicht geantwortet.', noModel: 'Wähle zuerst ein Chatmodell aus.',
    failed: 'Die Zwischenfrage konnte nicht beantwortet werden.', copy: 'Kopieren', copied: 'Kopiert', dismiss: 'Schließen', footnotes: 'Fußnoten',
  },
  ru: {
    description: 'Задайте короткий вопрос, не прерывая чат', hint: 'Введите отдельный вопрос', title: 'Отдельный вопрос',
    waiting: 'Ожидание ответа…', empty: 'Модель не ответила.', noModel: 'Сначала выберите модель для чата.',
    failed: 'Не удалось ответить на отдельный вопрос.', copy: 'Копировать', copied: 'Скопировано', dismiss: 'Закрыть', footnotes: 'Сноски',
  },
  pt: {
    description: 'Faça uma pergunta rápida sem interromper o chat', hint: 'Digite uma pergunta à parte', title: 'Pergunta à parte',
    waiting: 'Aguardando uma resposta…', empty: 'O modelo não respondeu.', noModel: 'Escolha um modelo de chat antes de fazer uma pergunta à parte.',
    failed: 'Não foi possível responder à pergunta à parte.', copy: 'Copiar', copied: 'Copiado', dismiss: 'Fechar', footnotes: 'Notas de rodapé',
  },
} satisfies Record<string, Record<BtwKey, string>>
