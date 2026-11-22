/** Builtin audio and video metadata and keyed document-body registration. */
import type { Context } from '@janhq/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { MediaBody, type MediaBodyInjected } from './MediaBody.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

/** Video implementation identity, shared by metadata and the keyed slot. */
export const MEDIA_VIDEO_ID = '@janhq/jan-client-ui-sidebar-documentpreview/video'
/** Audio implementation identity, shared by metadata and the keyed slot. */
export const MEDIA_AUDIO_ID = '@janhq/jan-client-ui-sidebar-documentpreview/audio'

/** Video suffixes the media element is asked to play. */
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'] as const
/** Audio suffixes the media element is asked to play. */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'] as const

/**
 * Describe one builtin media renderer; it streams the file itself rather than reading bytes.
 * @param id - implementation identity.
 * @param extensions - claimed binary suffixes.
 * @param title - locale-owned implementation name.
 */
export function mediaBodyDefinition(id: string, extensions: readonly string[], title: () => string): DocumentPreviewDefinition {
  return { id, extensions, binaryExtensions: extensions, priority: 'builtin', title, loading: 'renderer', wrap: false }
}

/**
 * Register the media dictionary, both definitions, and both bodies with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarMedia')
  ctx.effect(() => ctx.locale.register('sidebarMedia', { zh, en, ja, es, fr, de, ru, pt }), 'document-media: dictionaries')
  const kinds = [[MEDIA_VIDEO_ID, VIDEO_EXTENSIONS, 'video'], [MEDIA_AUDIO_ID, AUDIO_EXTENSIONS, 'audio']] as const
  for (const [id, extensions, kind] of kinds) {
    ctx.effect(() => ctx.documentPreviews.register(mediaBodyDefinition(id, extensions, () => t(kind))), `document-media: ${kind} metadata`)
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
      name: 'sidebar.right.tab.document', key: id, locale: 'sidebarMedia',
      inject: (): MediaBodyInjected => ({ kind }),
    }, MediaBody)), `document-media: ${kind} body`)
  }
}
