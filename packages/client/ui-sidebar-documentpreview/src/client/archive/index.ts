/** Builtin zip listing metadata and keyed document-body registration. */
import type { Context } from '@janhq/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { ArchiveBody } from './ArchiveBody.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

/** Archive implementation identity, shared by metadata and the keyed slot. */
export const ARCHIVE_BODY_ID = '@janhq/jan-client-ui-sidebar-documentpreview/archive'

/** Archive suffixes listed by the builtin renderer. */
export const ARCHIVE_EXTENSIONS = ['zip'] as const

/**
 * Describe the builtin zip listing.
 * @param title - locale-owned implementation name.
 */
export function archiveBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: ARCHIVE_BODY_ID, extensions: ARCHIVE_EXTENSIONS, binaryExtensions: ARCHIVE_EXTENSIONS, priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}

/**
 * Register the archive dictionary, metadata, and body with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarArchive')
  ctx.effect(() => ctx.locale.register('sidebarArchive', { zh, en, ja, es, fr, de, ru, pt }), 'document-archive: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(archiveBodyDefinition(() => t('title'))), 'document-archive: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: ARCHIVE_BODY_ID, locale: 'sidebarArchive',
  }, ArchiveBody)), 'document-archive: body')
}
