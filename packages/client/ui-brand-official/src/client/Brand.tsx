import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import janLogoUrl from './assets/jan-logo.png'

/** Product name shown beside the mark in `official` builds. */
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
 * Render the product name without its independently slotted mark.
 * @returns the Jan name as text.
 */
export function OfficialBrandName() {
  return <span data-brand-name="jan">{BRAND_NAME}</span>
}
