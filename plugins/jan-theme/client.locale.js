window.__ModuleLoader__.load({
  id: '@janhq/jan-client-ui-jan-theme',
  chunk: 'client.locale.js',
  factory() {
    const keys = [
      'connect', 'connectTo', 'connecting', 'updateKey', 'added', 'description', 'keyLabel', 'help', 'dashboard',
      'composio-invalid-key', 'composio-permissions', 'composio-unavailable', 'composio-invalid-response',
      'composio-name-conflict', 'composio-save-failed',
    ]
    const copy = {
      en: [
        'Connect', 'Connect to Composio', 'Connecting…', 'Update API key', 'Added', 'Connect your apps to Jan through Composio.',
        'Composio project API key', "Copy your key from Composio's Project Settings under API Keys. Connect your apps in Composio when Jan asks.", 'Open Composio dashboard',
        "Composio didn't accept this key. Check that you copied a project API key.", "This key doesn't have access to Composio sessions and tools. Check its permissions in Composio.",
        "Jan couldn't connect to Composio. Check your connection and try again.", 'Composio returned an invalid session. Try again later.',
        'An MCP server named composio already exists. Remove it before connecting Composio.', "Jan couldn't save the key. Reopen this section and try again.",
      ],
      zh: [
        '连接', '连接到 Composio', '正在连接…', '更新 API 密钥', '已添加', '通过 Composio 将你的应用连接到 Jan。',
        'Composio 项目 API 密钥', '在 Composio 的项目设置中打开 API Keys 并复制密钥。Jan 提示时，请在 Composio 中连接你的应用。', '打开 Composio 控制台',
        'Composio 未接受此密钥。请确认复制的是项目 API 密钥。', '此密钥无权访问 Composio 的会话和工具。请在 Composio 中检查密钥权限。',
        'Jan 无法连接到 Composio。请检查网络连接后重试。', 'Composio 返回了无效的会话。请稍后重试。',
        '已存在名为 composio 的 MCP 服务器。请先移除该服务器，再连接 Composio。', 'Jan 无法保存密钥。请重新打开此页面后重试。',
      ],
      ja: [
        '接続', 'Composio に接続', '接続中…', 'API キーを更新', '追加済み', 'Composio を使ってアプリを Jan に接続します。',
        'Composio のプロジェクト API キー', 'Composio のプロジェクト設定で「API Keys」を開き、キーをコピーしてください。Jan に求められたら、Composio でアプリを接続してください。', 'Composio ダッシュボードを開く',
        'Composio がこのキーを受け付けませんでした。プロジェクト API キーをコピーしたか確認してください。', 'このキーには Composio のセッションやツールへのアクセス権がありません。Composio で権限を確認してください。',
        'Jan は Composio に接続できませんでした。ネットワーク接続を確認して、もう一度お試しください。', 'Composio が無効なセッションを返しました。しばらくしてから、もう一度お試しください。',
        'composio という名前の MCP サーバーがすでにあります。Composio に接続する前に、そのサーバーを削除してください。', 'Jan はキーを保存できませんでした。このページを開き直して、もう一度お試しください。',
      ],
      es: [
        'Conectar', 'Conectar con Composio', 'Conectando…', 'Actualizar clave de API', 'Añadido', 'Conecta tus aplicaciones a Jan a través de Composio.',
        'Clave de API del proyecto de Composio', 'Copia la clave desde API Keys en la configuración del proyecto de Composio. Conecta tus aplicaciones en Composio cuando Jan te lo pida.', 'Abrir el panel de Composio',
        'Composio no ha aceptado esta clave. Comprueba que has copiado una clave de API del proyecto.', 'Esta clave no tiene acceso a las sesiones y herramientas de Composio. Revisa sus permisos en Composio.',
        'Jan no ha podido conectarse con Composio. Comprueba la conexión y vuelve a intentarlo.', 'Composio ha devuelto una sesión no válida. Vuelve a intentarlo más tarde.',
        'Ya existe un servidor MCP llamado composio. Elimínalo antes de conectar Composio.', 'Jan no ha podido guardar la clave. Vuelve a abrir esta sección e inténtalo de nuevo.',
      ],
      fr: [
        'Connecter', 'Se connecter à Composio', 'Connexion en cours…', 'Mettre à jour la clé API', 'Ajouté', 'Connectez vos applications à Jan via Composio.',
        'Clé API du projet Composio', 'Copiez la clé dans la rubrique API Keys des paramètres du projet Composio. Connectez vos applications dans Composio lorsque Jan vous le demande.', 'Ouvrir le tableau de bord Composio',
        'Composio a refusé cette clé. Vérifiez que vous avez copié une clé API de projet.', 'Cette clé ne donne pas accès aux sessions et aux outils de Composio. Vérifiez ses autorisations dans Composio.',
        'Jan n’a pas pu se connecter à Composio. Vérifiez votre connexion et réessayez.', 'Composio a renvoyé une session non valide. Réessayez plus tard.',
        'Il existe déjà un serveur MCP nommé composio. Supprimez-le avant de connecter Composio.', 'Jan n’a pas pu enregistrer la clé. Rouvrez cette section et réessayez.',
      ],
      de: [
        'Verbinden', 'Mit Composio verbinden', 'Verbindung wird hergestellt…', 'API-Schlüssel aktualisieren', 'Hinzugefügt', 'Verbinde deine Apps über Composio mit Jan.',
        'Composio-Projekt-API-Schlüssel', 'Kopiere den Schlüssel in den Projekteinstellungen von Composio unter API Keys. Verbinde deine Apps in Composio, wenn Jan dich dazu auffordert.', 'Composio-Dashboard öffnen',
        'Composio hat diesen Schlüssel abgelehnt. Prüfe, ob du einen Projekt-API-Schlüssel kopiert hast.', 'Dieser Schlüssel erlaubt keinen Zugriff auf Sitzungen und Tools von Composio. Prüfe seine Berechtigungen in Composio.',
        'Jan konnte keine Verbindung zu Composio herstellen. Prüfe deine Verbindung und versuche es erneut.', 'Composio hat eine ungültige Sitzung zurückgegeben. Versuche es später erneut.',
        'Ein MCP-Server namens composio ist bereits vorhanden. Entferne ihn, bevor du Composio verbindest.', 'Jan konnte den Schlüssel nicht speichern. Öffne diesen Abschnitt erneut und versuche es noch einmal.',
      ],
      ru: [
        'Подключить', 'Подключиться к Composio', 'Подключение…', 'Обновить ключ API', 'Добавлено', 'Подключайте приложения к Jan через Composio.',
        'Ключ API проекта Composio', 'Скопируйте ключ из раздела API Keys в настройках проекта Composio. Подключите приложения в Composio, когда Jan попросит об этом.', 'Открыть панель Composio',
        'Composio отклонил ключ. Убедитесь, что вы скопировали ключ API проекта.', 'У ключа нет доступа к сеансам и инструментам Composio. Проверьте его разрешения в Composio.',
        'Jan не удалось подключиться к Composio. Проверьте соединение и попробуйте снова.', 'Composio вернул недопустимый сеанс. Попробуйте позже.',
        'Сервер MCP с именем composio уже существует. Удалите его, прежде чем подключать Composio.', 'Jan не удалось сохранить ключ. Откройте этот раздел заново и попробуйте снова.',
      ],
      pt: [
        'Conectar', 'Conectar ao Composio', 'Conectando…', 'Atualizar chave de API', 'Adicionado', 'Conecte seus aplicativos ao Jan pelo Composio.',
        'Chave de API do projeto do Composio', 'Copie a chave na seção API Keys das configurações do projeto do Composio. Conecte seus aplicativos no Composio quando o Jan solicitar.', 'Abrir o painel do Composio',
        'O Composio não aceitou esta chave. Confira se você copiou uma chave de API do projeto.', 'Esta chave não tem acesso às sessões e ferramentas do Composio. Confira as permissões da chave no Composio.',
        'O Jan não conseguiu se conectar ao Composio. Verifique a conexão e tente novamente.', 'O Composio retornou uma sessão inválida. Tente novamente mais tarde.',
        'Já existe um servidor MCP chamado composio. Remova-o antes de conectar o Composio.', 'O Jan não conseguiu salvar a chave. Abra esta seção novamente e tente outra vez.',
      ],
    }
    return { dictionaries: Object.fromEntries(Object.entries(copy).map(([locale, values]) => [locale, Object.fromEntries(keys.map((key, i) => [key, values[i]]))])) }
  },
})
