/** Builtin font metadata and keyed document-body registration. */
import type { Context } from '@janhq/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { FontBody } from './FontBody.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

/** Font implementation identity, shared by metadata and the keyed slot. */
export const FONT_BODY_ID = '@janhq/jan-client-ui-sidebar-documentpreview/font'

/** Font suffixes the browser's FontFace loader reads. */
export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const

/**
 * Describe the builtin font renderer.
 * @param title - locale-owned implementation name.
 * @returns metadata that requests the complete font bytes before mounting the preview body.
 */
export function fontBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: FONT_BODY_ID, extensions: FONT_EXTENSIONS, binaryExtensions: FONT_EXTENSIONS, priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}

/**
 * Register the font dictionary, metadata, and body with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarFont')
  ctx.effect(() => ctx.locale.register('sidebarFont', { zh, en, ja, es, fr, de, ru, pt }), 'document-font: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(fontBodyDefinition(() => t('title'))), 'document-font: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: FONT_BODY_ID, locale: 'sidebarFont',
  }, FontBody)), 'document-font: body')
}
