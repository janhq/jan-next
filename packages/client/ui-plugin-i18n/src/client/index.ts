/**
 * Plugin translation, browser half: loads the Host's stored translations into the locale runtime, provides
 * `ctx.pluginI18n` for install offers, proactive screen suggestions, tool cards, and Plugins settings.
 */
import type {} from '@janhq/jan-client-locale/client'
import type { Context as ClientContext } from '@janhq/cordis'
// Type-only: the `ctx.remote` merge with the generated `pluginI18n` and `pluginManager` namespaces and the forwarded events.
import type {} from '@janhq/jan-api-remotes/client'
import type {} from '@janhq/jan-host-plugin-i18n/types'
// Type-only: the `ctx.remoteAccess` merge.
import type {} from '@janhq/jan-api-remote-access/client'
import type {} from '@janhq/jan-client-ui-settings/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import { NamespaceOwnership, trackOwnership } from './ownership.ts'
import { PluginTranslationsTab, type PluginTranslationsTabInjected } from './PluginTranslationsTab.tsx'
import { PluginTranslationPrompt, type PluginTranslationPromptInjected } from './PluginTranslationPrompt.tsx'
import { languageName, PluginI18nClient, type PluginI18nService } from './service.ts'
import { en, ja, es, fr, de, ru, pt, zh, type PluginI18nLocaleKey } from './locales.ts'

export type { PluginI18nService, PluginI18nState, PluginTranslationSuggestion, TitleView, TranslationOffer, TranslationSubject } from './service.ts'
export type { PluginI18nLocaleKey } from './locales.ts'
export type { PluginTranslationsTabInjected, PluginTranslationsTabProps, TranslationPackage } from './PluginTranslationsTab.tsx'

declare module '@janhq/cordis' {
  interface Context {
    /** Plugin text translation: stored tables, install offers, and runtime string display. */
    pluginI18n: PluginI18nService
  }
}

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin translation settings copy. */
    'settings.pluginI18n': PluginI18nLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginI18n'

/** Services required by the settings registration, the Remote namespaces, and access. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginI18n', 'remote.pluginManager', 'remoteAccess']

/**
 * Provide the translation service and the settings tab, and keep both current on the Host's change events while the
 * current Peer may use the namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-plugin-i18n: dictionaries')
  const t = ctx.locale.bind(NS)
  const ownership = new NamespaceOwnership(() => new Set(ctx.locale.namespaces().map(row => row.ns)))
  const client = new PluginI18nClient(ctx, ownership, document)
  ctx.effect(() => () => { client.dispose() }, 'ui-plugin-i18n: service')
  trackOwnership(ctx, ownership, (pkg) => { client.activated(pkg) })
  ctx.provide('pluginI18n', client)

  const listPackages: PluginTranslationsTabInjected['listPackages'] = async () => {
    const result = await ctx.remote.pluginManager.listBundles()
    if (!result.ok) throw result.error
    return result.value
      .filter(bundle => bundle.installed && !bundle.official && bundle.availability !== 'missing')
      .map((bundle) => {
        const title = bundle.meta?.title
        return { name: bundle.name, title: title === undefined ? bundle.name : ctx.locale.resolveText(title) }
      })
  }
  // Stable identity: the tab reads the model choices again only when this or the route changes.
  const routes: PluginTranslationsTabInjected['routes'] = () => client.routes()
  const injected = (): PluginTranslationsTabInjected => ({
    hooks: { translations: client, locale: ctx.locale },
    listPackages,
    translate: (pkg, rerun) => client.translate(pkg, rerun),
    clear: pkg => client.clear(pkg),
    setGlobal: allowed => client.setGlobal(allowed),
    routes,
    setRoute: route => client.setRoute(route),
    languageName,
  })

  ctx.remoteAccess.whenAccess('pluginManager/listBundles', function* () {
    let revision = 0
    const reload = (): void => {
      const request = ++revision
      void ctx.remote.pluginManager.listBundles().then((result) => {
        if (request !== revision) return
        if (!result.ok) throw result.error
        client.setPackages(result.value
          .filter(bundle => bundle.installed && !bundle.official && bundle.availability !== 'missing')
          .map(bundle => ({
            pkg: bundle.name,
            title: bundle.meta?.title ?? bundle.name,
            meta: [bundle.meta?.title, bundle.meta?.description ?? bundle.description].filter(text => text !== undefined),
          })))
      }).catch((error: unknown) => { if (request === revision) ctx.logger.warn(error) })
    }
    reload()
    yield ctx.remote.$on('plugin-manager/changed', reload)
    yield ctx.on('connection/reset', reload)
    yield () => { revision += 1; client.setPackages([]) }
  })

  ctx.remoteAccess.whenAccess('pluginI18n/tables', function* () {
    client.hostChanged()
    yield ctx.remote.$on('plugin-i18n/changed', () => { client.hostChanged() })
    yield ctx.on('connection/reset', () => { client.hostChanged() })
    yield ctx.on('locale/change', () => { client.localeChanged() })
    const prompt: PluginTranslationPromptInjected = {
      hooks: { suggestions: client.suggestions, locale: ctx.locale },
      translate: (pkg, rerun) => client.translate(pkg, rerun),
      clear: pkg => client.clear(pkg),
      dismiss: (pkg, mode) => { client.dismiss(pkg, mode) },
    }
    yield ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'plugin-i18n.suggestion', locale: NS, inject: () => prompt,
    }, PluginTranslationPrompt))
    yield ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'translations',
      order: 20,
      label: () => t('tab'),
      locale: NS,
      inject: injected,
    }, PluginTranslationsTab))
  })
}
