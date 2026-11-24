window.__ModuleLoader__.load({
  id: '@janhq/jan-cli-proxy', chunk: 'client.locale.js',
  factory() {
    const keys = `title intro proxy connect accounts empty signIn signOut loading unavailable idle downloading progress starting restarting running
      unsupported download checksum startup retry preparing pending cancelling openBrowser deviceCode cancel
      signInUnavailable signInFailed timeout cancelFailed signOutFailed refreshFailed`.split(/\s+/)
    const copy = {
      en: `Bring your own subscription|Sign in with a provider to use its supported models in Jan.|Local proxy|Connect a subscription|Connected accounts|No subscriptions connected yet.|Sign in with {provider}|Sign out
Loading…|Couldn’t reach subscription settings.|Not started|Downloading CLIProxyAPI…|Downloading CLIProxyAPI: {percent}%|Starting the local proxy…|Restarting the local proxy…|Running
CLIProxyAPI isn’t available on this platform.|Couldn’t download the local proxy.|Jan couldn’t verify the download.|Couldn’t start the local proxy.|Try again
Preparing sign-in…|Complete sign-in in your browser.|Cancelling sign-in…|Open sign-in in browser|Enter this code if asked: {code}|Cancel
Couldn’t open this sign-in. Try again and close other apps using the provider’s sign-in port.|Sign-in didn’t finish. Try again.|Sign-in timed out. Try again.|Couldn’t confirm cancellation. Check the account list before trying again.|Couldn’t sign out. Try again.|Couldn’t refresh subscriptions and models. Try again.`,
      de: `Abonnements|Verbinde deine eigenen Abonnements. Jan sendet Anfragen über einen lokalen Proxy. Unterstützte Modelle erscheinen automatisch in der Modellauswahl.|Lokaler Proxy|Abonnement verbinden|Verbundene Konten|Noch keine Abonnements verbunden.|Mit {provider} anmelden|Abmelden
Wird geladen…|Die Abonnementeinstellungen sind nicht erreichbar.|Nicht gestartet|CLIProxyAPI wird heruntergeladen…|CLIProxyAPI wird heruntergeladen: {percent} %|Lokaler Proxy wird gestartet…|Lokaler Proxy wird neu gestartet…|Läuft
CLIProxyAPI ist auf dieser Plattform nicht verfügbar.|Der lokale Proxy konnte nicht heruntergeladen werden.|Jan konnte den Download nicht überprüfen.|Der lokale Proxy konnte nicht gestartet werden.|Erneut versuchen
Anmeldung wird vorbereitet…|Schließe die Anmeldung in deinem Browser ab.|Anmeldung wird abgebrochen…|Anmeldung im Browser öffnen|Gib bei Aufforderung diesen Code ein: {code}|Abbrechen
Die Anmeldung konnte nicht geöffnet werden. Schließe andere Apps, die den Anmeldeport des Anbieters nutzen, und versuche es erneut.|Die Anmeldung wurde nicht abgeschlossen. Versuche es erneut.|Die Anmeldung hat zu lange gedauert. Versuche es erneut.|Der Abbruch konnte nicht bestätigt werden. Prüfe vor einem neuen Versuch die Kontoliste.|Abmelden fehlgeschlagen. Versuche es erneut.|Abonnements und Modelle konnten nicht aktualisiert werden. Versuche es erneut.`,
      es: `Suscripciones|Conecta tus propias suscripciones. Jan envía las solicitudes a través de un proxy local y los modelos compatibles aparecen automáticamente en el selector.|Proxy local|Conectar una suscripción|Cuentas conectadas|Todavía no hay suscripciones conectadas.|Iniciar sesión con {provider}|Cerrar sesión
Cargando…|No se pudo acceder a los ajustes de suscripciones.|Sin iniciar|Descargando CLIProxyAPI…|Descargando CLIProxyAPI: {percent} %|Iniciando el proxy local…|Reiniciando el proxy local…|En funcionamiento
CLIProxyAPI no está disponible en esta plataforma.|No se pudo descargar el proxy local.|Jan no pudo verificar la descarga.|No se pudo iniciar el proxy local.|Volver a intentar
Preparando el inicio de sesión…|Termina de iniciar sesión en el navegador.|Cancelando el inicio de sesión…|Abrir el inicio de sesión en el navegador|Si se te solicita, introduce este código: {code}|Cancelar
No se pudo abrir el inicio de sesión. Cierra otras aplicaciones que usen el puerto de inicio de sesión del proveedor y vuelve a intentarlo.|No se completó el inicio de sesión. Vuelve a intentarlo.|Se agotó el tiempo para iniciar sesión. Vuelve a intentarlo.|No se pudo confirmar la cancelación. Revisa la lista de cuentas antes de volver a intentarlo.|No se pudo cerrar la sesión. Vuelve a intentarlo.|No se pudieron actualizar las suscripciones y los modelos. Vuelve a intentarlo.`,
      fr: `Abonnements|Connectez vos propres abonnements. Jan envoie les requêtes via un proxy local. Les modèles compatibles s’affichent automatiquement dans le sélecteur.|Proxy local|Connecter un abonnement|Comptes connectés|Aucun abonnement connecté pour le moment.|Se connecter avec {provider}|Se déconnecter
Chargement…|Impossible d’accéder aux réglages des abonnements.|Non démarré|Téléchargement de CLIProxyAPI…|Téléchargement de CLIProxyAPI : {percent} %|Démarrage du proxy local…|Redémarrage du proxy local…|En cours d’exécution
CLIProxyAPI n’est pas disponible sur cette plateforme.|Impossible de télécharger le proxy local.|Jan n’a pas pu vérifier le téléchargement.|Impossible de démarrer le proxy local.|Réessayer
Préparation de la connexion…|Terminez la connexion dans votre navigateur.|Annulation de la connexion…|Ouvrir la connexion dans le navigateur|Si nécessaire, saisissez ce code : {code}|Annuler
Impossible d’ouvrir la connexion. Fermez les autres applications qui utilisent le port de connexion du fournisseur, puis réessayez.|La connexion n’a pas abouti. Réessayez.|Le délai de connexion est dépassé. Réessayez.|Impossible de confirmer l’annulation. Vérifiez la liste des comptes avant de réessayer.|Impossible de se déconnecter. Réessayez.|Impossible d’actualiser les abonnements et les modèles. Réessayez.`,
      ja: `サブスクリプション|お持ちのサブスクリプションを接続します。Jan はローカルプロキシ経由でリクエストを送信し、対応モデルはモデル選択欄に自動で表示されます。|ローカルプロキシ|サブスクリプションを接続|接続済みアカウント|接続されたサブスクリプションはありません。|{provider} でサインイン|サインアウト
読み込み中…|サブスクリプションの設定を開けませんでした。|未起動|CLIProxyAPI をダウンロード中…|CLIProxyAPI をダウンロード中: {percent}%|ローカルプロキシを起動中…|ローカルプロキシを再起動中…|稼働中
このプラットフォームでは CLIProxyAPI を利用できません。|ローカルプロキシをダウンロードできませんでした。|ダウンロードを検証できませんでした。|ローカルプロキシを起動できませんでした。|再試行
サインインを準備中…|ブラウザーでサインインを完了してください。|サインインをキャンセル中…|ブラウザーでサインインを開く|求められた場合はこのコードを入力してください: {code}|キャンセル
サインインを開けませんでした。プロバイダーのサインインポートを使っている他のアプリを閉じてから、再試行してください。|サインインが完了しませんでした。再試行してください。|サインインの時間が切れました。再試行してください。|キャンセルを確認できませんでした。再試行する前にアカウント一覧を確認してください。|サインアウトできませんでした。再試行してください。|サブスクリプションとモデルを更新できませんでした。再試行してください。`,
      pt: `Assinaturas|Conecte suas próprias assinaturas. O Jan envia os pedidos por um proxy local e os modelos compatíveis aparecem automaticamente no seletor.|Proxy local|Conectar uma assinatura|Contas conectadas|Nenhuma assinatura conectada ainda.|Entrar com {provider}|Sair
Carregando…|Não foi possível acessar as configurações de assinaturas.|Não iniciado|Baixando o CLIProxyAPI…|Baixando o CLIProxyAPI: {percent}%|Iniciando o proxy local…|Reiniciando o proxy local…|Em execução
O CLIProxyAPI não está disponível nesta plataforma.|Não foi possível baixar o proxy local.|O Jan não conseguiu verificar o download.|Não foi possível iniciar o proxy local.|Tentar novamente
Preparando o login…|Conclua o login no navegador.|Cancelando o login…|Abrir login no navegador|Se solicitado, digite este código: {code}|Cancelar
Não foi possível abrir o login. Feche outros aplicativos que usam a porta de login do provedor e tente novamente.|O login não foi concluído. Tente novamente.|O tempo para fazer login acabou. Tente novamente.|Não foi possível confirmar o cancelamento. Confira a lista de contas antes de tentar novamente.|Não foi possível sair. Tente novamente.|Não foi possível atualizar as assinaturas e os modelos. Tente novamente.`,
      ru: `Подписки|Подключите свои подписки. Jan отправляет запросы через локальный прокси, а поддерживаемые модели автоматически появляются в списке выбора.|Локальный прокси|Подключить подписку|Подключённые аккаунты|Подписок пока нет.|Войти через {provider}|Выйти
Загрузка…|Не удалось открыть настройки подписок.|Не запущен|Загрузка CLIProxyAPI…|Загрузка CLIProxyAPI: {percent}%|Запуск локального прокси…|Перезапуск локального прокси…|Работает
CLIProxyAPI недоступен на этой платформе.|Не удалось загрузить локальный прокси.|Jan не удалось проверить загрузку.|Не удалось запустить локальный прокси.|Повторить
Подготовка входа…|Завершите вход в браузере.|Отмена входа…|Открыть страницу входа в браузере|Введите этот код, если потребуется: {code}|Отмена
Не удалось открыть страницу входа. Закройте другие приложения, использующие порт входа этого сервиса, и повторите попытку.|Вход не завершён. Повторите попытку.|Время на вход истекло. Повторите попытку.|Не удалось подтвердить отмену. Проверьте список аккаунтов, прежде чем повторить попытку.|Не удалось выйти. Повторите попытку.|Не удалось обновить подписки и модели. Повторите попытку.`,
      zh: `订阅|连接你自己的订阅。Jan 通过本地代理发送请求，支持的模型会自动出现在模型选择器中|本地代理|连接订阅|已连接的账号|尚未连接任何订阅|使用 {provider} 登录|退出登录
正在加载…|无法打开订阅设置|未启动|正在下载 CLIProxyAPI…|正在下载 CLIProxyAPI：{percent}%|正在启动本地代理…|正在重启本地代理…|正在运行
此平台不支持 CLIProxyAPI|无法下载本地代理|Jan 无法验证下载的文件|无法启动本地代理|重试
正在准备登录…|请在浏览器中完成登录|正在取消登录…|在浏览器中打开登录页面|如果系统提示，请输入此代码：{code}|取消
无法打开登录页面。请关闭占用该服务登录端口的其他应用后重试|登录未完成，请重试|登录超时，请重试|无法确认是否已取消。重试前请检查账号列表|无法退出登录，请重试|无法刷新订阅和模型，请重试`,
    }
    const poweredBy = {
      en: 'Powered by CLI Proxy {version}',
      de: 'Mit CLI Proxy {version}',
      es: 'Con tecnología de CLI Proxy {version}',
      fr: 'Propulsé par CLI Proxy {version}',
      ja: 'CLI Proxy {version} を使用',
      pt: 'Com tecnologia do CLI Proxy {version}',
      ru: 'Работает на базе CLI Proxy {version}',
      zh: '由 CLI Proxy {version} 提供支持',
    }
    return { dictionaries: Object.fromEntries(Object.entries(copy).map(([locale, value]) => {
      const labels = value.split(/[|\n]/)
      if (labels.length !== keys.length) throw new Error(`Invalid subscription copy: ${locale}`)
      return [locale, { ...Object.fromEntries(keys.map((key, i) => [key, labels[i]])), poweredBy: poweredBy[locale] }]
    })) }
  },
})
