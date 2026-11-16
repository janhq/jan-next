/** Original-file actions independent of menu or image component ownership. */
import { IconCopyOutlineRegular, IconDownloadOutlineRegular, IconSaveOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type { DesktopFileActions, FileActions } from '../types.ts'
import type {} from '@janhq/jan-client-locale/client'
import { registerFileMenus } from './context-menus.tsx'
import { zh, en, ja, es, fr, de, ru, pt, type FileActionKey } from './locales.ts'
import { BrowserFileActions } from './files.ts'

export type { FileActions, FileActionSource, FileSaveResult } from '../types.ts'
declare module '@janhq/cordis' {
  interface Context { /** Original-file saving and image clipboard commands. */ fileActions: FileActions }
}
declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Original-file action labels and feedback. */
    fileActions: FileActionKey
  }
}
/** The native adapter is optional; Web uses its own download and save capabilities. */
export const inject = []
/** @param ctx - plugin-owned Client context. */
export function apply(ctx: Context): void {
  const desktop = (window as Window & { janDesktop?: { fileActions?: DesktopFileActions } }).janDesktop?.fileActions
  const actions = new BrowserFileActions(desktop)
  ctx.provide('fileActions', actions)
  ctx.effect(() => () => { actions.dispose() }, 'file actions: lifetime')
  ctx.inject(['contextMenus', 'slots', 'locale', 'remote', 'remote.workspaceFiles', 'remote.session'], (child) => {
    child.effect(() => child.locale.register('fileActions', { zh, en, ja, es, fr, de, ru, pt }), 'file actions: locale')
    child.slots.inject('contextMenu.icon', function* () {
      for (const [key, Icon] of Object.entries({
        'file-actions.copy': IconCopyOutlineRegular, 'file-actions.download': IconDownloadOutlineRegular,
        'file-actions.save': IconSaveOutlineRegular,
      })) yield child.slots.register({ name: 'contextMenu.icon', key }, Icon)
    })
    registerFileMenus(child, actions, child.locale.bind('fileActions'))
  })
}
