/**
 * Artifacts library registration: the `artifacts` main panel and its sidebar
 * entry. Kept apart from the turn-tail registrations so a composition without
 * the workspace or Session list loses only the library.
 *
 * A row opens beside the chat it came from: the library shows that chat and
 * opens the link in its built-in browser tab, or the file in its preview tab,
 * so reading it never leaves the app. The page offers the user's own browser
 * and the file's application as separate actions.
 */
import type { Context as ClientContext } from '@janhq/cordis'
import type {} from '@janhq/jan-api-session-controller/client'
import type {} from '@janhq/jan-api-workspace-files/remote'
import type {} from '@janhq/jan-client-locale/client'
import type { MainPanelId } from '@janhq/jan-client-ui-layout/client'
import type {} from '@janhq/jan-client-ui-sidebar/client'
import type {} from '@janhq/jan-client-ui-sidebar-right/client'
import type {} from '@janhq/jan-client-ui-sidebar-browser/client'
import type {} from '@janhq/jan-client-ui-workspace/client'
import type { SessionId } from '@janhq/jan-session/types'
import { fileAddressFor } from '@janhq/jan-util-workspace-path'
import { ArtifactsController } from './artifacts.ts'
import { ArtifactsPage, type ArtifactsInjected } from './ArtifactsPage.tsx'
import { ArtifactsPanelIcon } from './ArtifactsPanelIcon.tsx'
import { NS } from './locales.ts'
import type { PresentedOpenController } from './present-open.ts'

/** The id shared by the sidebar entry and the main panel it opens. */
export const ARTIFACTS_PANEL_ID = 'artifacts' as MainPanelId

/** How long a chat has to mount its side panel after the library shows it. */
const MOUNT_WAIT_MS = 5_000

/**
 * Register the library panel and its sidebar entry once Sessions, file metadata, and navigation exist.
 * @param ctx - client root context.
 * @param opener - the native open controller the turn-tail cards share.
 */
export function registerArtifacts(ctx: ClientContext, opener: PresentedOpenController): void {
  ctx.inject(['slots', 'locale', 'sessions', 'uiWorkspace', 'remote', 'remote.workspaceFiles'], (child) => {
    const t = child.locale.bind(NS)
    const controller = new ArtifactsController({
      stat: (sessionId, path, signal) => child.remote.workspaceFiles.stat(sessionId, path, signal),
      refreshProjections: sessionId => child.sessions.refreshProjections(sessionId),
    })
    child.effect(() => () => { controller.dispose() }, 'ui-deliverables: artifacts controller')
    const waits = new Set<() => void>()
    child.effect(() => () => { for (const cancel of waits) cancel() }, 'ui-deliverables: artifacts side panel waits')
    /**
     * Show a chat, then run `open` in its side panel once that panel is ready; `fallback` runs if it never is.
     * The on-screen id can already name the chat while the library covers it (the panel keeps the last
     * chat's id, but released its surface), and remounting it changes nothing observable, so the open is
     * tried each frame until the panel accepts it.
     */
    const besideChat = (sessionId: SessionId, open: () => void, fallback: () => void): void => {
      const sidebar = ctx.sidebarRight
      child.uiWorkspace.openSession(sessionId)
      const deadline = performance.now() + MOUNT_WAIT_MS
      let frame = 0
      const cancel = (): void => { waits.delete(cancel); cancelAnimationFrame(frame) }
      const attempt = (): void => {
        if (sidebar.mounted.getSnapshot() === sessionId) {
          try {
            open()
            cancel()
            return
          } catch {
            // The chat's panel surface is not adopted yet.
          }
        }
        if (performance.now() > deadline) { cancel(); fallback(); return }
        frame = requestAnimationFrame(attempt)
      }
      waits.add(cancel)
      frame = requestAnimationFrame(attempt)
    }
    const openInBrowser = (url: string): void => { window.open(url, '_blank', 'noopener,noreferrer') }
    child.effect(() => child.on('connection/reset', () => { controller.reset() }), 'ui-deliverables: artifacts reset')
    child.slots.inject('main', () => child.slots.register({
      name: 'main', key: ARTIFACTS_PANEL_ID, locale: NS,
      inject: (): ArtifactsInjected => ({
        hooks: {
          presentedOpen: opener.state, presentedHost: opener.host,
          availability: controller.availability, scanning: controller.scanning, resetGeneration: controller.resetGeneration,
        },
        reloadPresentedHost: () => opener.loadHost(),
        openPresented: (sessionId, seq, index, action, application) => opener.open(sessionId, seq, index, action, application),
        checkAvailability: row => controller.check(row),
        hydrate: (sessionIds) => { controller.hydrate(sessionIds) },
        openChat: (sessionId) => { child.uiWorkspace.openSession(sessionId) },
        openLink: (sessionId, url) => {
          // Without the built-in browser the link has nowhere in the app to go.
          if (ctx.sidebarRightTabs.get('browser') === undefined) { openInBrowser(url); return }
          besideChat(sessionId, () => { ctx.sidebarRight.openTab('browser', { params: { url } }) }, () => { openInBrowser(url) })
        },
        openInBrowser,
        previewFile: (sessionId, path) => {
          besideChat(sessionId, () => {
            ctx.sidebarRight.openResource(fileAddressFor(sessionId, child.sessions.list.getSnapshot().byId[sessionId]?.cwd, path))
          }, () => {})
        },
      }),
    }, ArtifactsPage))
    child.slots.inject('sidebar.panellist', () => child.slots.register({
      name: 'sidebar.panellist', id: ARTIFACTS_PANEL_ID, order: 10, label: () => t('artifacts.panel'), locale: NS,
    }, ArtifactsPanelIcon))
  })
}
