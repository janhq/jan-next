/** Window-chrome controls for the fully hidden sidebar (frame shell.leading seat). */
import {
  IconNewChatOutlineRegular, IconPanelLeftOutlineRegular, Tooltip,
} from '@janhq/jan-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
// Type-only: pulls the frame's shell.leading slot declaration.
import type {} from '@janhq/jan-client-ui-layout/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { NavigationButton } from './NavigationButton.tsx'
import { useChromeControls } from './chrome-controls.ts'
import css from './HeaderLeadingControls.module.css'

/** Full props of the shell.leading occupant. */
export type HeaderLeadingControlsProps =
  PropsRuntime<'shell.leading'>
  & InjectFace<SidebarRootInjected>
  & PropsLocale<'sidebar'>

/**
 * Sidebar-open, Back / Forward and New Session controls in the frame's window-chrome seat.
 * The frame mounts this seat for hidden sidebars and owns its placement.
 * Web shows the sidebar opener and Back / Forward; Desktop also retains New Session.
 * @param props - Injected sidebar actions, the global access Hook, and the sidebar locale seat.
 * @returns the sidebar toggle and Back / Forward, plus New Session on Desktop while access allows `session/create`.
 */
export function HeaderLeadingControls({
  toggleSidebar, goBack, goForward, startSession, trackEntryClick, useRemoteAccess, useShortcuts, useNavigationHistory, t,
}: HeaderLeadingControlsProps) {
  // A page whose access snapshot excludes starting a Session keeps only the sidebar toggle here.
  const canStartSession = useRemoteAccess('session/create')
  const desktop = document.documentElement.hasAttribute('data-platform')
  const {
    shortcut, newShortcut, backShortcut, forwardShortcut, canGoBack, canGoForward,
  } = useChromeControls({ useShortcuts, useNavigationHistory })
  return (
    <div className={css.controls}>
      <Tooltip label={t('toggle.open')} shortcutKeys={shortcut?.keys} delayMs={500}>
        <button
          data-sidebar-opener
          type="button"
          className={css.iconButton}
          aria-label={t('toggle.open')}
          aria-keyshortcuts={shortcut?.aria}
          onClick={() => { toggleSidebar() }}
        >
          <IconPanelLeftOutlineRegular size={16} />
        </button>
      </Tooltip>
      <NavigationButton
        direction="back" label={t('navigation.back')} shortcut={backShortcut} disabled={!canGoBack}
        onClick={goBack} className={css.iconButton} size={16}
      />
      <NavigationButton
        direction="forward" label={t('navigation.forward')} shortcut={forwardShortcut} disabled={!canGoForward}
        onClick={goForward} className={css.iconButton} size={16}
      />
      {desktop && canStartSession && (
        <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('session.new.label')}
            aria-keyshortcuts={newShortcut?.aria}
            onClick={() => {
              trackEntryClick({ menu_name: 'new_session', position: 'titlebar' })
              startSession()
            }}
          >
            <IconNewChatOutlineRegular size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
