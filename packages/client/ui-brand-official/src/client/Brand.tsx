import type { HeroBrandMarkOwnerProps } from '@janhq/jan-client-ui-conversation/client'
import { Tag } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import janLogoUrl from './assets/jan-logo.png'
import type { NS } from './locales.ts'
import css from './Brand.module.css'

/** Product name shown beside the mark. */
export const BRAND_NAME = 'Jan'

/**
 * Render the Jan waving-hand mark at the requested square size.
 * Serves both the sidebar mark (size only) and the conversation hero mark (size and host class).
 * @param props - Host-supplied mark presentation.
 * @returns the decorative Jan logo image.
 */
export function OfficialBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <img src={janLogoUrl} width={size} height={size} alt="" draggable={false} className={className} data-brand-mark="jan" />
}

/**
 * Render the product name and its release stage, without the independently slotted mark.
 * @param props - the slot's translator for this plugin's namespace.
 * @returns the Jan name followed by a stage tag.
 */
export function OfficialBrandName({ t }: PropsLocale<typeof NS>) {
  return (
    <span data-brand-name="jan" className={css.name}>
      {BRAND_NAME}
      <Tag tone="neutral">{t('stage')}</Tag>
    </span>
  )
}
