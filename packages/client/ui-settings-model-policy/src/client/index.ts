/** Browser contribution for Models page fallback and context controls. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type {} from '@janhq/jan-client-ui-settings/client'
import type {} from '@janhq/jan-client-ui-settings-models/client'
import { FallbackCard, type FallbackSettings } from './FallbackCard.tsx'
import { ContextCard, type CompactionSettings } from './ContextCard.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import type { CatalogLoader } from './useCatalog.ts'

export const inject = ['remote', 'remote.session', 'slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-model-policy: dictionaries')
  const loadCatalog: CatalogLoader = () => ctx.remote.session.modelCatalog()
  const fallback = ctx.configForms.get<FallbackSettings>('model-fallback')
  // Host-plane preferences: presets mount compaction-basic inside isolated realms that Settings does not serve.
  const compaction = ctx.configForms.get<CompactionSettings>('compaction-settings')
  ctx.effect(() => ctx.configForms.whileServed(['model-fallback'], () => ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'model-fallback', locale: NS,
    inject: () => ({ form: fallback, loadCatalog }),
  }, FallbackCard))), 'ui-settings-model-policy: fallback card')
  ctx.effect(() => ctx.configForms.whileServed(['compaction-settings'], () => ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'compaction-settings', locale: NS,
    inject: () => ({ form: compaction, loadCatalog }),
  }, ContextCard))), 'ui-settings-model-policy: context card')
}
