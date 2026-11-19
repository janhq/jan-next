/** Back / Forward commands and the pointer's back/forward buttons. */
import type { Context } from '@janhq/cordis'
import type { ShortcutBinding, ShortcutCommand, ShortcutCommandId } from '@janhq/jan-client-shortcuts/client'
import { modalSelector } from '@janhq/jan-client-ui-primitives'
import type { NavigationDirection } from './history.ts'
import type { UiWorkspace } from './navigation.ts'

/** Code editors keep Alt+Arrow and Mod+[ for their own text editing. */
const CODE_EDITOR_SELECTOR = '.cm-editor, .monaco-editor'

/**
 * Defaults per device. Windows and Linux Desktop use Alt+Arrow, as apps there do. macOS Desktop
 * uses Mod+[ / Mod+] (Chrome and Claude on macOS). Web avoids the browser's own history keys
 * (Alt+Arrow, Cmd+[) with Mod+Alt+[ / Mod+Alt+]; Web Linux stays unbound like the other Web
 * defaults, since the registry admits no Mod+Alt pair there.
 */
function defaults(direction: NavigationDirection): ShortcutCommand['defaults'] {
  const bracket = direction === 'back' ? 'BracketLeft' : 'BracketRight'
  const arrow = direction === 'back' ? 'ArrowLeft' : 'ArrowRight'
  const mod: ShortcutBinding = { code: bracket, modifiers: ['primary'] }
  const alt: ShortcutBinding = { code: arrow, modifiers: ['alt'] }
  const web: ShortcutBinding = { code: bracket, modifiers: ['primary', 'alt'] }
  return {
    'desktop:macos': mod,
    'desktop:windows': alt,
    'desktop:linux': alt,
    'web:macos': web,
    'web:windows': web,
  }
}

/**
 * Register `navigation.back` / `navigation.forward` and the mouse back/forward buttons.
 * A command passes the key through while its direction has no entry, and inside terminals
 * and code editors.
 * @param ctx - plugin context with the shortcut and locale services.
 * @param navigation - the history the commands drive.
 */
export function installNavigationShortcuts(
  ctx: Context,
  navigation: Pick<UiWorkspace, 'goBack' | 'goForward' | 'navigationHistory'>,
): void {
  const t = ctx.locale.bind('workspace')
  const go = (direction: NavigationDirection): void => {
    if (direction === 'back') navigation.goBack()
    else navigation.goForward()
  }
  const register = (direction: NavigationDirection, label: () => string, aliases: string[]): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: `navigation.${direction}` as ShortcutCommandId, label, aliases, defaults: defaults(direction),
      regions: ['page', 'editable'], modals: ['sidebar'],
      resolve: context => !navigation.navigationHistory.getSnapshot()[direction === 'back' ? 'canGoBack' : 'canGoForward']
        || context.region === 'terminal'
        || context.target?.closest(CODE_EDITOR_SELECTOR) != null
        ? { status: 'pass' }
        : { status: 'handled', run: () => { go(direction) } },
    }), `ui-workspace: navigation.${direction}`)
  }
  register('back', () => t('navigation.back'), ['back', 'go back', 'previous page'])
  register('forward', () => t('navigation.forward'), ['forward', 'go forward', 'next page'])

  // Browsers read the side buttons as page history, which this app does not use;
  // Desktop delivers them as the same button numbers.
  // Headless profiles instantiate client registrations without a window.
  if (typeof window !== 'undefined') ctx.effect(() => {
    const onButton = (event: MouseEvent): void => {
      if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) return
      const top = Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).at(-1)
      if (top !== undefined && top.dataset.shortcutModal !== 'sidebar') return
      event.preventDefault()
      if (event.type === 'mouseup') go(event.button === 3 ? 'back' : 'forward')
    }
    window.addEventListener('mousedown', onButton)
    window.addEventListener('mouseup', onButton)
    return () => {
      window.removeEventListener('mousedown', onButton)
      window.removeEventListener('mouseup', onButton)
    }
  }, 'ui-workspace: mouse navigation buttons')
}
