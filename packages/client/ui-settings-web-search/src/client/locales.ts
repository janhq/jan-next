/** Locale bundles for the web-search provider's settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type WebSearchSettingsLocaleKey =
  | 'title' | 'description' | 'searchSection' | 'fetchSection'
  | 'providerLocal' | 'providerMissing' | 'providerAuto'
  | 'providersFailed' | 'retry' | 'pluginProviderHint'
  | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'

/** English copy. */
export const en: Record<WebSearchSettingsLocaleKey, string> = {
  title: 'Web search and fetch',
  description: 'Choose the providers web search and web fetch use.',
  searchSection: 'Web search provider',
  fetchSection: 'Web fetch provider',
  providerLocal: 'Direct fetch',
  providerMissing: '{id} (not loaded)',
  providerAuto: 'Automatic',
  providersFailed: "Couldn't load the provider list, so this menu may be incomplete.",
  retry: 'Retry',
  pluginProviderHint: 'Configure this provider in its own plugin settings.',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
}

/** Simplified Chinese copy. */
export const zh: Record<WebSearchSettingsLocaleKey, string> = {
  title: '网页搜索与获取',
  description: '选择网页搜索与网页获取使用的提供方。',
  searchSection: '网页搜索提供方',
  fetchSection: '网页获取提供方',
  providerLocal: '本机直接获取',
  providerMissing: '{id}（未加载）',
  providerAuto: '自动选择',
  providersFailed: '无法读取提供方列表，此菜单可能不完整',
  retry: '重试',
  pluginProviderHint: '请在该插件自己的设置中配置',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: WebSearchSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  'title': 'Web 検索と取得',
  'description': 'Web 検索と Web 取得に使用するプロバイダーを選択します。',
  'searchSection': 'Web 検索プロバイダー',
  'fetchSection': 'Web 取得プロバイダー',
  'providerLocal': '直接取得',
  'providerMissing': '{id}（未読み込み）',
  'providerAuto': '自動',
  'providersFailed': 'プロバイダー一覧を読み込めなかったため、このメニューは不完全な可能性があります。',
  'retry': '再試行',
  'pluginProviderHint': 'このプロバイダーは、そのプラグイン自身の設定で構成してください。',
  'readOnly': 'このデプロイでは設定は読み取り専用で保存されます。',
  'unavailable': 'このプラグインは読み込まれていないため、現在設定できません。',
  'save': '保存',
  'saving': '保存中…',
  'saveFailed': 'デプロイがこれらの値を受け入れませんでした。修正用に残されています。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  title: 'Búsqueda y obtención web',
  description: 'Elija los proveedores que usan la búsqueda web y la obtención web.',
  searchSection: 'Proveedor de búsqueda web',
  fetchSection: 'Proveedor de obtención web',
  providerLocal: 'Obtención directa',
  providerMissing: '{id} (no cargado)',
  providerAuto: 'Automático',
  providersFailed: 'No se pudo cargar la lista de proveedores, por lo que este menú puede estar incompleto.',
  retry: 'Reintentar',
  pluginProviderHint: 'Configure este proveedor en la configuración de su propio complemento.',
  readOnly: 'Esta implementación almacena configuraciones de solo lectura.',
  unavailable: 'Este complemento no está cargado, por lo que no se puede configurar en este momento.',
  save: 'Guardar',
  saving: 'Guardando…',
  saveFailed: 'El despliegue no aceptó estos valores; quedaron para que usted los corrigiera.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  title: 'Recherche et récupération web',
  description: 'Choisissez les fournisseurs utilisés par la recherche web et la récupération web.',
  searchSection: 'Fournisseur de recherche web',
  fetchSection: 'Fournisseur de récupération web',
  providerLocal: 'Récupération directe',
  providerMissing: '{id} (non chargé)',
  providerAuto: 'Automatique',
  providersFailed: 'Impossible de charger la liste des fournisseurs ; ce menu peut être incomplet.',
  retry: 'Réessayer',
  pluginProviderHint: 'Configurez ce fournisseur dans les paramètres de son propre plugin.',
  readOnly: 'Ce déploiement stocke les paramètres en lecture seule.',
  unavailable: "Ce plugin n'est pas chargé, il ne peut donc pas être configuré pour le moment.",
  save: 'Enregistrer',
  saving: 'Sauvegarde…',
  saveFailed: "Le déploiement n'a pas accepté ces valeurs ; ils vous ont été laissés à corriger.",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  title: 'Websuche und Webabruf',
  description: 'Wählen Sie die Anbieter für Websuche und Webabruf.',
  searchSection: 'Anbieter für Websuche',
  fetchSection: 'Anbieter für Webabruf',
  providerLocal: 'Direkter Abruf',
  providerMissing: '{id} (nicht geladen)',
  providerAuto: 'Automatisch',
  providersFailed: 'Die Anbieterliste konnte nicht geladen werden, daher ist dieses Menü möglicherweise unvollständig.',
  retry: 'Erneut versuchen',
  pluginProviderHint: 'Konfigurieren Sie diesen Anbieter in den Einstellungen seines eigenen Plugins.',
  readOnly: 'Diese Bereitstellung speichert Einstellungen schreibgeschützt.',
  unavailable: 'Dieses Plugin ist nicht geladen und kann daher derzeit nicht konfiguriert werden.',
  save: 'Speichern',
  saving: 'Speichern…',
  saveFailed: 'Die Bereitstellung hat diese Werte nicht akzeptiert. Sie mussten sie korrigieren.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  title: 'Веб-поиск и загрузка',
  description: 'Выберите поставщиков для веб-поиска и загрузки веб-страниц.',
  searchSection: 'Поставщик веб-поиска',
  fetchSection: 'Поставщик загрузки веб-страниц',
  providerLocal: 'Прямая загрузка',
  providerMissing: '{id} (не загружен)',
  providerAuto: 'Автоматически',
  providersFailed: 'Не удалось загрузить список поставщиков, поэтому это меню может быть неполным.',
  retry: 'Повторить',
  pluginProviderHint: 'Настройте этого поставщика в настройках его собственного плагина.',
  readOnly: 'В этом развертывании параметры сохраняются только для чтения.',
  unavailable: 'Этот плагин не загружен, поэтому его невозможно настроить прямо сейчас.',
  save: 'Сохранить',
  saving: 'Сохранение…',
  saveFailed: 'Развертывание не приняло эти значения; их оставили вам на исправление.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  title: 'Pesquisa e obtenção na web',
  description: 'Escolha os provedores usados pela pesquisa na web e pela obtenção na web.',
  searchSection: 'Provedor de pesquisa na web',
  fetchSection: 'Provedor de obtenção na web',
  providerLocal: 'Obtenção direta',
  providerMissing: '{id} (não carregado)',
  providerAuto: 'Automático',
  providersFailed: 'Não foi possível carregar a lista de provedores, por isso este menu pode estar incompleto.',
  retry: 'Tentar novamente',
  pluginProviderHint: 'Configure este provedor nas configurações do próprio plugin.',
  readOnly: 'Esta implantação armazena configurações somente leitura.',
  unavailable: 'Este plugin não está carregado, portanto não pode ser configurado agora.',
  save: 'Salvar',
  saving: 'Salvando…',
  saveFailed: 'A implantação não aceitou esses valores; eles foram deixados para você corrigir.',
} satisfies Record<keyof typeof en, string>
