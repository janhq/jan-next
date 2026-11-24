/** Shared reads for the sidebar's window-chrome controls: toggle, New Session, Back and Forward. */
import type { ShortcutCatalogEntry } from '@janhq/jan-client-shortcuts/client'
import type { InjectFace } from '@janhq/jan-client-ui-slots'
import type { SidebarRootInjected } from './contract/slots.ts'

/** Shortcut rows and navigation availability of the sidebar's window-chrome controls. */
export interface ChromeControls {
  shortcut: ShortcutCatalogEntry | undefined
  newShortcut: ShortcutCatalogEntry | undefined
  backShortcut: ShortcutCatalogEntry | undefined
  forwardShortcut: ShortcutCatalogEntry | undefined
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * Read the shortcut rows and navigation availability both the sidebar header and the hidden-sidebar seat render.
 * @param hooks - the injected shortcut and navigation-history hooks.
 * @returns the toggle, New Session, Back and Forward shortcuts and whether Back and Forward can move.
 */
export function useChromeControls(
  hooks: Pick<InjectFace<SidebarRootInjected>, 'useShortcuts' | 'useNavigationHistory'>,
): ChromeControls {
  const { useShortcuts, useNavigationHistory } = hooks
  return {
    shortcut: useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle')),
    newShortcut: useShortcuts(rows => rows.find(row => row.id === 'session.new')),
    backShortcut: useShortcuts(rows => rows.find(row => row.id === 'navigation.back')),
    forwardShortcut: useShortcuts(rows => rows.find(row => row.id === 'navigation.forward')),
    canGoBack: useNavigationHistory(state => state.canGoBack),
    canGoForward: useNavigationHistory(state => state.canGoForward),
  }
}
