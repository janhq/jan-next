/** Shared reads for the sidebar's window-chrome controls: toggle, New Session, Back and Forward. */
import type { InjectFace } from '@janhq/jan-client-ui-slots'
import type { SidebarRootInjected } from './contract/slots.ts'

/**
 * Read the shortcut rows and navigation availability both the sidebar header and the hidden-sidebar seat render.
 * @param hooks - the injected shortcut and navigation-history hooks.
 * @returns the toggle, New Session, Back and Forward shortcuts and whether Back and Forward can move.
 */
export function useChromeControls({ useShortcuts, useNavigationHistory }: Pick<
  InjectFace<SidebarRootInjected>, 'useShortcuts' | 'useNavigationHistory'
>) {
  return {
    shortcut: useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle')),
    newShortcut: useShortcuts(rows => rows.find(row => row.id === 'session.new')),
    backShortcut: useShortcuts(rows => rows.find(row => row.id === 'navigation.back')),
    forwardShortcut: useShortcuts(rows => rows.find(row => row.id === 'navigation.forward')),
    canGoBack: useNavigationHistory(state => state.canGoBack),
    canGoForward: useNavigationHistory(state => state.canGoForward),
  }
}
