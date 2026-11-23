window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  chunk: 'client.locale.js',
  factory() {
    const groups = [
      ['about', 'aboutHint', 'name', 'roles', 'goals', 'goalsHint', 'goalOptions', 'setup', 'setupHint', 'modes', 'plugins'],
      ['continue', 'back', 'skip', 'start', 'makeDefault', 'isDefault', 'loading', 'working', 'noPlugins', 'catalogError', 'saveError', 'retry'],
      ['role.developer', 'role.student', 'role.researcher', 'role.writer', 'role.marketing', 'role.analyst', 'role.office', 'role.designer'],
      ['goal.code', 'goal.debug', 'goal.learn', 'goal.research', 'goal.analyze', 'goal.draft', 'goal.plan', 'goal.report', 'goal.design'],
      ['item.chat', 'item.standard', 'item.worktrees', 'item.search', 'item.titles', 'item.voice'],
      ['why.chat', 'why.standard', 'why.worktrees', 'why.search', 'why.titles', 'why.voice'],
    ]
    const copy = {
      en: [
        ['About you', 'Tell us a little about yourself so Jan can suggest a setup for you.', 'Your name (optional)', 'Choose 1 to 3 roles', 'What are your goals?', 'Choose anything you would like help with. You can also continue without choosing.', 'Goals for your roles', 'Your setup', 'Review your recommendations. You can change these choices later in Plugins and Settings.', 'Modes', 'Plugins'],
        ['Continue', 'Back', 'Skip setup', 'Start using Jan', 'Make default', 'Default for new chats', 'Loading recommendations…', 'Applying your setup…', 'No additional plugins are recommended for this setup.', 'Recommendations could not load. Try again or skip setup.', 'Jan could not finish applying your setup. Try again to finish saving it.', 'Try again'],
        ['Developer', 'Student', 'Researcher', 'Writer / content creator', 'Marketing / social media', 'Data / analyst', 'Business / office work', 'Designer'],
        ['Write code', 'Debug and review code', 'Learn and study', 'Research a topic', 'Analyze data', 'Draft and edit content', 'Plan work and projects', 'Create reports', 'Explore design ideas'],
        ['Chat mode', 'Standard mode', 'Change requests & worktrees', 'Session search', 'Conversation-following titles', 'Voice input'],
        ['Talk through ideas, research the web, and create simple artifacts.', 'Work with code and files using a full set of tools.', 'Review changes and keep each coding task in a separate worktree.', 'Find related work in earlier chats in the same project.', 'Keep chat titles useful as your task changes.', 'Speak drafts and ideas instead of typing them.'],
      ],
      zh: [
        ['关于你', '简单介绍一下自己，Jan 会为你推荐合适的设置。', '你的名字（选填）', '选择 1 至 3 个角色', '你的目标是什么？', '选择你希望获得帮助的事项，也可以不选直接继续。', '适合你角色的目标', '你的设置', '查看推荐内容。以后可以在插件和设置中修改这些选项。', '模式', '插件'],
        ['继续', '上一步', '跳过设置', '开始使用 Jan', '设为默认', '新聊天的默认模式', '正在加载推荐…', '正在应用你的设置…', '此设置没有额外推荐的插件', '无法加载推荐，请重试或跳过设置', 'Jan 未能完成设置，请重试以保存', '重试'],
        ['开发者', '学生', '研究人员', '写作者 / 内容创作者', '营销 / 社交媒体', '数据 / 分析师', '商务 / 办公', '设计师'],
        ['编写代码', '调试和审查代码', '学习和复习', '研究主题', '分析数据', '起草和编辑内容', '规划工作和项目', '制作报告', '探索设计灵感'],
        ['聊天模式', '标准模式', '变更请求与工作树', '会话搜索', '随对话更新标题', '语音输入'],
        ['讨论想法、搜索网络并创建简单作品。', '使用完整的工具集处理代码和文件。', '审查变更，并将每项编码任务放在独立的工作树中。', '在同一工作区的早期聊天中查找相关工作。', '任务发生变化时，让聊天标题仍然有用。', '用说话代替打字，记录草稿和想法。'],
      ],
      ja: [
        ['あなたについて', 'あなたに合った設定を Jan が提案できるよう、少し教えてください。', 'お名前（任意）', '役割を 1〜3 個選択', '何をしたいですか？', 'サポートが必要な項目を選んでください。選択せずに進むこともできます。', '役割に合った目標', 'あなたのセットアップ', 'おすすめを確認しましょう。選択は後からプラグインと設定で変更できます。', 'モード', 'プラグイン'],
        ['続ける', '戻る', 'セットアップをスキップ', 'Jan を使い始める', '既定に設定', '新しいチャットの既定', 'おすすめを読み込み中…', '設定を適用中…', 'この設定に追加のおすすめプラグインはありません。', 'おすすめを読み込めませんでした。再試行するか、セットアップをスキップしてください。', '設定の適用を完了できませんでした。再試行して保存してください。', '再試行'],
        ['開発者', '学生', '研究者', 'ライター / コンテンツ制作者', 'マーケティング / SNS', 'データ / アナリスト', 'ビジネス / 事務', 'デザイナー'],
        ['コードを書く', 'コードのデバッグとレビュー', '学習する', 'テーマを調査する', 'データを分析する', '文章を作成・編集する', '業務やプロジェクトを計画する', 'レポートを作る', 'デザイン案を探る'],
        ['チャットモード', '標準モード', '変更リクエストと作業ツリー', 'セッション検索', '会話に合わせたタイトル', '音声入力'],
        ['アイデアを話し合い、ウェブで調べ、簡単な成果物を作れます。', '充実したツールでコードやファイルを扱えます。', '変更を確認し、コーディング作業ごとに作業ツリーを分けられます。', '同じワークスペースの以前のチャットから関連する作業を探せます。', 'タスクの変化に合わせてチャットのタイトルを更新できます。', '入力する代わりに、文章やアイデアを話して残せます。'],
      ],
      es: [
        ['Sobre ti', 'Cuéntanos un poco sobre ti para que Jan pueda recomendarte una configuración.', 'Tu nombre (opcional)', 'Elige entre 1 y 3 perfiles', '¿Cuáles son tus objetivos?', 'Elige en qué quieres ayuda. También puedes continuar sin seleccionar nada.', 'Objetivos para tus perfiles', 'Tu configuración', 'Revisa las recomendaciones. Puedes cambiar tus elecciones más tarde en Plugins y Configuración.', 'Modos', 'Plugins'],
        ['Continuar', 'Atrás', 'Omitir configuración', 'Empezar a usar Jan', 'Hacer predeterminado', 'Predeterminado para chats nuevos', 'Cargando recomendaciones…', 'Aplicando tu configuración…', 'No hay plugins adicionales recomendados para esta configuración.', 'No se pudieron cargar las recomendaciones. Reintenta u omite la configuración.', 'Jan no pudo terminar de aplicar la configuración. Reintenta para guardarla.', 'Reintentar'],
        ['Desarrollo', 'Estudios', 'Investigación', 'Escritura / creación de contenido', 'Marketing / redes sociales', 'Datos / análisis', 'Negocios / trabajo de oficina', 'Diseño'],
        ['Escribir código', 'Depurar y revisar código', 'Aprender y estudiar', 'Investigar un tema', 'Analizar datos', 'Redactar y editar contenido', 'Planificar trabajo y proyectos', 'Crear informes', 'Explorar ideas de diseño'],
        ['Modo de chat', 'Modo estándar', 'Solicitudes de cambios y árboles de trabajo', 'Búsqueda de sesiones', 'Títulos adaptados a la conversación', 'Entrada por voz'],
        ['Comenta tus ideas, investiga en la web y crea artefactos sencillos.', 'Trabaja con código y archivos con un conjunto completo de herramientas.', 'Revisa cambios y aísla cada tarea de código en su propio árbol de trabajo.', 'Encuentra trabajos relacionados en chats anteriores del mismo espacio.', 'Mantén los títulos al día cuando cambie tu tarea.', 'Dicta borradores e ideas en lugar de teclearlos.'],
      ],
      fr: [
        ['À propos de vous', 'Parlez-nous un peu de vous pour que Jan vous recommande une configuration.', 'Votre prénom (facultatif)', 'Choisissez 1 à 3 rôles', 'Quels sont vos objectifs ?', 'Choisissez les sujets pour lesquels vous souhaitez de l’aide. Vous pouvez aussi continuer sans rien sélectionner.', 'Objectifs adaptés à vos rôles', 'Votre configuration', 'Consultez les recommandations. Vous pourrez modifier ces choix dans Plugins et Paramètres.', 'Modes', 'Plugins'],
        ['Continuer', 'Retour', 'Ignorer la configuration', 'Commencer à utiliser Jan', 'Définir par défaut', 'Par défaut pour les nouvelles discussions', 'Chargement des recommandations…', 'Application de votre configuration…', 'Aucun plugin supplémentaire n’est recommandé pour cette configuration.', 'Impossible de charger les recommandations. Réessayez ou ignorez la configuration.', 'Jan n’a pas pu terminer la configuration. Réessayez pour l’enregistrer.', 'Réessayer'],
        ['Développement', 'Études', 'Recherche', 'Rédaction / création de contenu', 'Marketing / réseaux sociaux', 'Données / analyse', 'Gestion / travail de bureau', 'Design'],
        ['Écrire du code', 'Déboguer et relire du code', 'Apprendre et étudier', 'Étudier un sujet', 'Analyser des données', 'Rédiger et réviser du contenu', 'Planifier le travail et les projets', 'Créer des rapports', 'Explorer des idées de design'],
        ['Mode discussion', 'Mode standard', 'Demandes de changement et arbres de travail', 'Recherche de sessions', 'Titres adaptés à la discussion', 'Saisie vocale'],
        ['Discutez d’idées, faites des recherches sur le Web et créez des artefacts simples.', 'Utilisez une suite complète d’outils pour travailler sur vos fichiers et votre code.', 'Relisez les changements et isolez chaque tâche de code dans son propre arbre de travail.', 'Retrouvez vos travaux dans les anciennes discussions du même espace.', 'Gardez des titres utiles lorsque votre tâche évolue.', 'Dictez vos brouillons et vos idées sans les taper.'],
      ],
      de: [
        ['Über dich', 'Erzähl uns etwas über dich, damit Jan dir eine passende Einrichtung vorschlagen kann.', 'Dein Name (optional)', 'Wähle 1 bis 3 Rollen', 'Was sind deine Ziele?', 'Wähle, wobei du Hilfe möchtest. Du kannst auch ohne Auswahl fortfahren.', 'Ziele für deine Rollen', 'Deine Einrichtung', 'Prüfe die Empfehlungen. Du kannst deine Auswahl später unter Plugins und Einstellungen ändern.', 'Modi', 'Plugins'],
        ['Weiter', 'Zurück', 'Einrichtung überspringen', 'Jan verwenden', 'Als Standard festlegen', 'Standard für neue Chats', 'Empfehlungen werden geladen…', 'Deine Einrichtung wird angewendet…', 'Für diese Einrichtung gibt es keine weiteren Plugin-Empfehlungen.', 'Die Empfehlungen konnten nicht geladen werden. Versuche es erneut oder überspringe die Einrichtung.', 'Jan konnte die Einrichtung nicht abschließen. Versuche es erneut, um sie zu speichern.', 'Erneut versuchen'],
        ['Entwicklung', 'Studium', 'Forschung', 'Schreiben / Inhalte erstellen', 'Marketing / soziale Medien', 'Daten / Analyse', 'Geschäft / Büroarbeit', 'Design'],
        ['Code schreiben', 'Code prüfen und Fehler beheben', 'Lernen und studieren', 'Ein Thema recherchieren', 'Daten analysieren', 'Inhalte schreiben und bearbeiten', 'Arbeit und Projekte planen', 'Berichte erstellen', 'Designideen erkunden'],
        ['Chatmodus', 'Standardmodus', 'Änderungsanfragen und Arbeitsbäume', 'Sitzungssuche', 'Titel passend zum Gespräch', 'Spracheingabe'],
        ['Besprich Ideen, recherchiere im Web und erstelle einfache Artefakte.', 'Arbeite mit Code und Dateien mit einem vollständigen Werkzeugsatz.', 'Prüfe Änderungen und halte jede Coding-Aufgabe in einem eigenen Arbeitsbaum.', 'Finde ähnliche Arbeiten in früheren Chats desselben Arbeitsbereichs.', 'Passe Chat-Titel an, wenn sich die Aufgabe ändert.', 'Diktiere Entwürfe und Ideen, statt sie zu tippen.'],
      ],
      ru: [
        ['О вас', 'Расскажите немного о себе, чтобы Jan предложил подходящие настройки.', 'Ваше имя (необязательно)', 'Выберите от 1 до 3 ролей', 'Какие у вас цели?', 'Выберите, в чём вам нужна помощь. Можно продолжить и без выбора.', 'Цели для ваших ролей', 'Ваши настройки', 'Проверьте рекомендации. Вы сможете изменить свой выбор в разделах «Плагины» и «Настройки».', 'Режимы', 'Плагины'],
        ['Продолжить', 'Назад', 'Пропустить настройку', 'Начать пользоваться Jan', 'Сделать основным', 'По умолчанию для новых чатов', 'Загрузка рекомендаций…', 'Применение настроек…', 'Для этого набора нет дополнительных рекомендуемых плагинов.', 'Не удалось загрузить рекомендации. Повторите попытку или пропустите настройку.', 'Jan не смог завершить настройку. Повторите попытку, чтобы сохранить изменения.', 'Повторить попытку'],
        ['Разработка', 'Учёба', 'Исследования', 'Тексты / создание контента', 'Маркетинг / соцсети', 'Данные / аналитика', 'Бизнес / офисная работа', 'Дизайн'],
        ['Писать код', 'Отлаживать и проверять код', 'Учиться', 'Исследовать тему', 'Анализировать данные', 'Писать и редактировать тексты', 'Планировать работу и проекты', 'Создавать отчёты', 'Искать идеи для дизайна'],
        ['Режим чата', 'Стандартный режим', 'Запросы на изменения и рабочие деревья', 'Поиск сессий', 'Заголовки по ходу беседы', 'Голосовой ввод'],
        ['Обсуждайте идеи, ищите информацию в интернете и создавайте простые материалы.', 'Используйте полный набор инструментов для работы с кодом и файлами.', 'Проверяйте изменения и выполняйте каждую задачу в отдельном рабочем дереве.', 'Находите похожие задачи в прошлых чатах того же рабочего пространства.', 'Обновляйте заголовки чатов, когда меняется задача.', 'Диктуйте черновики и идеи вместо набора текста.'],
      ],
      pt: [
        ['Sobre você', 'Conte um pouco sobre você para o Jan sugerir uma configuração adequada.', 'Seu nome (opcional)', 'Escolha de 1 a 3 perfis', 'Quais são seus objetivos?', 'Escolha em que você quer ajuda. Você também pode continuar sem selecionar nada.', 'Objetivos para seus perfis', 'Sua configuração', 'Confira as recomendações. Você pode alterar suas escolhas mais tarde em Plugins e Configurações.', 'Modos', 'Plugins'],
        ['Continuar', 'Voltar', 'Pular configuração', 'Começar a usar o Jan', 'Definir como padrão', 'Padrão para novas conversas', 'Carregando recomendações…', 'Aplicando sua configuração…', 'Não há plugins adicionais recomendados para esta configuração.', 'Não foi possível carregar as recomendações. Tente novamente ou pule a configuração.', 'O Jan não conseguiu terminar de aplicar a configuração. Tente novamente para salvá-la.', 'Tentar novamente'],
        ['Desenvolvimento', 'Estudos', 'Pesquisa', 'Escrita / criação de conteúdo', 'Marketing / redes sociais', 'Dados / análise', 'Negócios / trabalho de escritório', 'Design'],
        ['Escrever código', 'Depurar e revisar código', 'Aprender e estudar', 'Pesquisar um assunto', 'Analisar dados', 'Escrever e editar conteúdo', 'Planejar trabalhos e projetos', 'Criar relatórios', 'Explorar ideias de design'],
        ['Modo de conversa', 'Modo padrão', 'Solicitações de alterações e árvores de trabalho', 'Busca de sessões', 'Títulos que acompanham a conversa', 'Entrada por voz'],
        ['Discuta ideias, pesquise na web e crie artefatos simples.', 'Trabalhe com código e arquivos usando um conjunto completo de ferramentas.', 'Revise alterações e isole cada tarefa de código em sua própria árvore de trabalho.', 'Encontre trabalhos relacionados em conversas anteriores da mesma área de trabalho.', 'Mantenha os títulos úteis quando a tarefa mudar.', 'Dite rascunhos e ideias em vez de digitá-los.'],
      ],
    }
    const progressKeys = ['stepCounter', 'progress.about', 'progress.goals', 'progress.detail', 'progress.setup', 'rail.about', 'rail.goals', 'rail.detail', 'rail.setup', 'welcome']
    const progress = {
      en: ['Step {step} of {total}', 'Let’s get you set up', 'Nice, a couple more', 'Almost there…', 'All set', 'About you', 'Goals', 'Detail level', 'Setup', 'Welcome to Jan'],
      zh: ['第 {step} 步，共 {total} 步', '我们开始设置吧', '不错，再来两步', '快完成了…', '准备好了', '关于你', '目标', '详细程度', '设置', '欢迎使用 Jan'],
      ja: ['{total} ステップ中 {step} ステップ目', 'セットアップを始めましょう', 'あと少しです', 'もうすぐ完了です…', '準備ができました', 'あなたについて', '目標', '表示の詳しさ', 'セットアップ', 'Jan へようこそ'],
      es: ['Paso {step} de {total}', 'Vamos a preparar todo', 'Bien, quedan un par de pasos', 'Ya casi…', 'Todo listo', 'Sobre ti', 'Objetivos', 'Nivel de detalle', 'Configuración', 'Te damos la bienvenida a Jan'],
      fr: ['Étape {step} sur {total}', 'Commençons la configuration', 'Parfait, encore deux étapes', 'On y est presque…', 'Tout est prêt', 'À propos de vous', 'Objectifs', 'Niveau de détail', 'Configuration', 'Bienvenue dans Jan'],
      de: ['Schritt {step} von {total}', 'Los geht’s mit der Einrichtung', 'Prima, noch zwei Schritte', 'Fast geschafft…', 'Alles bereit', 'Über dich', 'Ziele', 'Detailgrad', 'Einrichtung', 'Willkommen bei Jan'],
      ru: ['Шаг {step} из {total}', 'Давайте начнём настройку', 'Отлично, ещё пара шагов', 'Почти готово…', 'Всё готово', 'О вас', 'Цели', 'Детализация', 'Настройки', 'Добро пожаловать в Jan'],
      pt: ['Etapa {step} de {total}', 'Vamos começar a configuração', 'Ótimo, faltam mais duas', 'Quase lá…', 'Tudo pronto', 'Sobre você', 'Objetivos', 'Nível de detalhe', 'Configuração', 'Boas-vindas ao Jan'],
    }
    return { dictionaries: Object.fromEntries(Object.entries(copy).map(([locale, values]) => [locale,
      Object.fromEntries([
        ...groups.flatMap((keys, group) => keys.map((key, i) => [key, values[group][i]])),
        ...progressKeys.map((key, i) => [key, progress[locale][i]]),
      ]),
    ])) }
  },
})
