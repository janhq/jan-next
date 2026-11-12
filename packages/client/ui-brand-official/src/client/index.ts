/** Jan brand occupants: the sidebar and conversation-hero marks, and the sidebar name with its release stage. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

/** Required services: the UI slot registry and the copy dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar and hero marks with the Jan logo, and the sidebar name with "Jan" and its release
 * stage, in every build profile. The sidebar's local-build label (name plus build number) is replaced.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'brand: copy dictionaries')
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, OfficialBrandName))
}
