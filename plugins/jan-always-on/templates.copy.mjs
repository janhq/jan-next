/** Display copy for templates.mjs: [name, role, card summary] per template and locale. */
const IDS = ['chief-of-staff', 'news-briefing', 'repo-triage', 'bug-reproducer', 'competitive-watch', 'support-triage', 'weekly-status', 'study-coach']

const ROWS = {
  en: [
    ['Chief of Staff', 'Morning brief and next steps', 'Each weekday morning, a short read-out of what changed and what to do about it.'],
    ['News Briefing', 'Daily digest on your topics', 'Only the stories that matter to you, every morning, with sources.'],
    ['Repo Triage', 'Triages GitHub issues and pull requests', 'Watches a repository, flags duplicates and missing details, and sums up the week.'],
    ['Bug Reproducer', 'Turns bug reports into repro packs', 'Follows the reported path and writes exact steps, expected vs actual and evidence.'],
    ['Competitor Watch', 'Weekly competitive intelligence', 'Checks your competitors every Monday and reports only shifts that matter.'],
    ['Support Triage', 'Drafts replies for your support channel', 'Watches a Discord or Slack channel and drafts grounded answers for you to send.'],
    ['Weekly Status', 'Keeps your to-dos and status report', 'Tracks what you commit to in chat and drafts your Friday report.'],
    ['Study Coach', 'Explains and quizzes you daily', 'Explains step by step and sends a short spaced-repetition quiz each evening.'],
  ],
  zh: [
    ['幕僚长', '晨间简报与下一步', '每个工作日早上，简要说明有什么变化以及该怎么做。'],
    ['新闻简报', '你关注话题的每日摘要', '每天早上只推送对你重要的新闻，并附来源。'],
    ['仓库分拣', '分拣 GitHub 议题和拉取请求', '关注一个仓库，标出重复和缺失信息，并做每周总结。'],
    ['问题复现员', '把问题报告整理成复现包', '按报告的路径操作，写出精确步骤、预期与实际结果和证据。'],
    ['竞品观察', '每周竞品情报', '每周一检查竞品，只报告真正重要的变化。'],
    ['支持分拣', '为支持频道起草回复', '关注 Discord 或 Slack 频道，起草有依据的回答供你发送。'],
    ['每周进展', '管理待办和进展报告', '记录你在聊天中的承诺，并起草周五报告。'],
    ['学习教练', '讲解并每日小测', '逐步讲解，每晚发送一次间隔重复小测。'],
  ],
  ja: [
    ['チーフ・オブ・スタッフ', '朝のブリーフィングと次の一手', '平日の朝、何が変わり何をすべきかを短くまとめます。'],
    ['ニュースブリーフィング', '関心テーマの毎日のダイジェスト', 'あなたに関係のあるニュースだけを、出典付きで毎朝届けます。'],
    ['リポジトリ・トリアージ', 'GitHub の Issue と PR を仕分け', 'リポジトリを見守り、重複や不足情報を指摘し、週次でまとめます。'],
    ['バグ再現係', 'バグ報告を再現パックに', '報告どおりに操作し、正確な手順・期待値と実際・証拠をまとめます。'],
    ['競合ウォッチ', '週次の競合インテリジェンス', '毎週月曜に競合を確認し、重要な変化だけを報告します。'],
    ['サポート・トリアージ', 'サポートチャンネルの返信を下書き', 'Discord や Slack のチャンネルを見守り、根拠のある回答を下書きします。'],
    ['週次ステータス', 'ToDo とステータス報告を管理', 'チャットでの約束を記録し、金曜の報告を下書きします。'],
    ['学習コーチ', '解説と毎日の小テスト', '段階的に解説し、毎晩、間隔反復の小テストを送ります。'],
  ],
  es: [
    ['Jefe de gabinete', 'Resumen matinal y próximos pasos', 'Cada mañana laborable, un breve resumen de qué cambió y qué hacer al respecto.'],
    ['Resumen de noticias', 'Resumen diario de tus temas', 'Solo las noticias que te importan, cada mañana y con fuentes.'],
    ['Triaje de repositorio', 'Clasifica issues y pull requests de GitHub', 'Vigila un repositorio, señala duplicados y datos que faltan y resume la semana.'],
    ['Reproductor de errores', 'Convierte informes de errores en paquetes de reproducción', 'Sigue el camino descrito y escribe pasos exactos, resultado esperado y real, y pruebas.'],
    ['Vigilancia de competidores', 'Inteligencia competitiva semanal', 'Revisa a tus competidores cada lunes e informa solo de los cambios relevantes.'],
    ['Triaje de soporte', 'Redacta respuestas para tu canal de soporte', 'Vigila un canal de Discord o Slack y redacta respuestas fundamentadas para que las envíes.'],
    ['Estado semanal', 'Lleva tus tareas y tu informe de estado', 'Anota lo que te comprometes a hacer en el chat y redacta tu informe del viernes.'],
    ['Tutor de estudio', 'Explica y te pone a prueba a diario', 'Explica paso a paso y envía cada tarde un breve test de repetición espaciada.'],
  ],
  fr: [
    ['Chef de cabinet', 'Point du matin et prochaines étapes', 'Chaque matin de semaine, un court point sur ce qui a changé et quoi faire.'],
    ['Revue de presse', 'Résumé quotidien de vos sujets', 'Uniquement les actualités qui comptent pour vous, chaque matin, avec leurs sources.'],
    ['Tri de dépôt', 'Trie les issues et pull requests GitHub', 'Surveille un dépôt, repère les doublons et les informations manquantes, et résume la semaine.'],
    ['Reproducteur de bugs', 'Transforme les rapports de bug en dossiers de reproduction', 'Suit le parcours signalé et rédige étapes exactes, résultat attendu et obtenu, et preuves.'],
    ['Veille concurrentielle', 'Veille concurrentielle hebdomadaire', 'Vérifie vos concurrents chaque lundi et ne signale que les changements importants.'],
    ['Tri du support', 'Rédige des réponses pour votre canal de support', 'Surveille un canal Discord ou Slack et rédige des réponses sourcées que vous envoyez.'],
    ['Point hebdo', 'Tient vos tâches et votre rapport d’avancement', 'Note vos engagements dans la conversation et rédige votre rapport du vendredi.'],
    ['Coach d’étude', 'Explique et vous interroge chaque jour', 'Explique pas à pas et envoie chaque soir un court quiz en répétition espacée.'],
  ],
  de: [
    ['Stabschef', 'Morgenbriefing und nächste Schritte', 'An jedem Werktagmorgen eine kurze Übersicht, was sich geändert hat und was zu tun ist.'],
    ['Nachrichtenbriefing', 'Tägliche Übersicht zu deinen Themen', 'Nur die Meldungen, die für dich zählen, jeden Morgen mit Quellen.'],
    ['Repo-Triage', 'Sortiert GitHub-Issues und Pull Requests', 'Beobachtet ein Repository, markiert Duplikate und fehlende Angaben und fasst die Woche zusammen.'],
    ['Bug-Reproduzierer', 'Macht aus Fehlerberichten Repro-Pakete', 'Folgt dem gemeldeten Weg und schreibt genaue Schritte, Soll und Ist sowie Belege auf.'],
    ['Wettbewerbsbeobachtung', 'Wöchentliche Wettbewerbsanalyse', 'Prüft jeden Montag deine Wettbewerber und meldet nur relevante Veränderungen.'],
    ['Support-Triage', 'Entwirft Antworten für deinen Support-Kanal', 'Beobachtet einen Discord- oder Slack-Kanal und entwirft belegte Antworten zum Senden.'],
    ['Wochenstatus', 'Führt deine Aufgaben und deinen Statusbericht', 'Hält fest, was du im Chat zusagst, und entwirft deinen Freitagsbericht.'],
    ['Lerncoach', 'Erklärt und fragt dich täglich ab', 'Erklärt Schritt für Schritt und schickt jeden Abend ein kurzes Wiederholungsquiz.'],
  ],
  ru: [
    ['Руководитель аппарата', 'Утренняя сводка и следующие шаги', 'Каждое рабочее утро коротко: что изменилось и что с этим делать.'],
    ['Новостная сводка', 'Ежедневная сводка по вашим темам', 'Только важные для вас новости, каждое утро и с источниками.'],
    ['Разбор репозитория', 'Разбирает задачи и pull request на GitHub', 'Следит за репозиторием, отмечает дубликаты и недостающие данные и подводит итоги недели.'],
    ['Воспроизводитель ошибок', 'Превращает отчёты об ошибках в пакеты воспроизведения', 'Повторяет описанный путь и записывает точные шаги, ожидаемый и фактический результат и доказательства.'],
    ['Наблюдение за конкурентами', 'Еженедельная конкурентная разведка', 'Каждый понедельник проверяет конкурентов и сообщает только о важных изменениях.'],
    ['Разбор поддержки', 'Готовит ответы для канала поддержки', 'Следит за каналом Discord или Slack и готовит обоснованные ответы, которые отправляете вы.'],
    ['Недельный статус', 'Ведёт задачи и отчёт о статусе', 'Записывает обещания из чата и готовит черновик отчёта к пятнице.'],
    ['Учебный наставник', 'Объясняет и ежедневно проверяет', 'Объясняет шаг за шагом и каждый вечер присылает короткий тест с интервальным повторением.'],
  ],
  pt: [
    ['Chefe de gabinete', 'Resumo da manhã e próximos passos', 'Toda manhã de dia útil, um resumo curto do que mudou e do que fazer.'],
    ['Resumo de notícias', 'Resumo diário dos seus temas', 'Só as notícias que importam para você, toda manhã, com fontes.'],
    ['Triagem de repositório', 'Faz a triagem de issues e pull requests do GitHub', 'Acompanha um repositório, aponta duplicados e dados faltando e resume a semana.'],
    ['Reprodutor de bugs', 'Transforma relatos de bugs em pacotes de reprodução', 'Segue o caminho relatado e escreve passos exatos, resultado esperado e real, e evidências.'],
    ['Radar de concorrentes', 'Inteligência competitiva semanal', 'Verifica seus concorrentes toda segunda-feira e relata só as mudanças relevantes.'],
    ['Triagem de suporte', 'Rascunha respostas para seu canal de suporte', 'Acompanha um canal do Discord ou Slack e rascunha respostas fundamentadas para você enviar.'],
    ['Status semanal', 'Cuida das suas tarefas e do relatório de status', 'Registra o que você promete no chat e rascunha seu relatório de sexta-feira.'],
    ['Tutor de estudos', 'Explica e testa você todo dia', 'Explica passo a passo e envia toda noite um teste curto de repetição espaçada.'],
  ],
}

/** Per-locale copy keyed by template ID: { name, role, summary }. */
export const TEMPLATE_COPY = Object.fromEntries(Object.entries(ROWS).map(([locale, rows]) => [locale,
  Object.fromEntries(IDS.map((id, index) => [id, { name: rows[index][0], role: rows[index][1], summary: rows[index][2] }]))]))

const ROUTINE_KEYS = ['brief', 'digest', 'weekly', 'due', 'report', 'quiz']
const ROUTINE_ROWS = {
  en: ['Morning brief', 'Daily digest', 'Weekly check', 'Due today', 'Weekly status report', 'Review quiz'],
  zh: ['晨间简报', '每日摘要', '每周检查', '今日到期', '每周进展报告', '复习小测'],
  ja: ['朝のブリーフィング', '毎日のダイジェスト', '週次チェック', '今日の期限', '週次ステータス報告', '復習クイズ'],
  es: ['Resumen matinal', 'Resumen diario', 'Revisión semanal', 'Vence hoy', 'Informe de estado semanal', 'Test de repaso'],
  fr: ['Point du matin', 'Résumé quotidien', 'Vérification hebdomadaire', 'À faire aujourd’hui', 'Rapport d’avancement hebdomadaire', 'Quiz de révision'],
  de: ['Morgenbriefing', 'Tägliche Übersicht', 'Wöchentliche Prüfung', 'Heute fällig', 'Wöchentlicher Statusbericht', 'Wiederholungsquiz'],
  ru: ['Утренняя сводка', 'Ежедневная сводка', 'Еженедельная проверка', 'Срок сегодня', 'Еженедельный отчёт о статусе', 'Тест на повторение'],
  pt: ['Resumo da manhã', 'Resumo diário', 'Verificação semanal', 'Vence hoje', 'Relatório de status semanal', 'Teste de revisão'],
}

/** Per-locale Scheduled task titles keyed by routine key. */
export const ROUTINE_TITLES = Object.fromEntries(Object.entries(ROUTINE_ROWS).map(([locale, titles]) => [locale,
  Object.fromEntries(ROUTINE_KEYS.map((key, index) => [key, titles[index]]))]))
