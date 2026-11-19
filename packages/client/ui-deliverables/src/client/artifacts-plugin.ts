/**
 * Artifacts library registration: the `artifacts` main panel and its sidebar
 * entry. Kept apart from the turn-tail registrations so a composition without
 * the workspace or Session list loses only the library.
 */
import type { Context as ClientContext } from '@janhq/cordis'
import type {} from '@janhq/jan-api-session-controller/client'
import type {} from '@janhq/jan-api-workspace-files/remote'
import type {} from '@janhq/jan-client-locale/client'
import type { MainPanelId } from '@janhq/jan-client-ui-layout/client'
import type {} from '@janhq/jan-client-ui-sidebar/client'
import type {} from '@janhq/jan-client-ui-workspace/client'
import { ArtifactsController } from './artifacts.ts'
import { ArtifactsPage, type ArtifactsInjected } from './ArtifactsPage.tsx'
import { ArtifactsPanelIcon } from './ArtifactsPanelIcon.tsx'
import { NS } from './locales.ts'
import type { PresentedOpenController } from './present-open.ts'

/** The id shared by the sidebar entry and the main panel it opens. */
export const ARTIFACTS_PANEL_ID = 'artifacts' as MainPanelId

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
      }),
    }, ArtifactsPage))
    child.slots.inject('sidebar.panellist', () => child.slots.register({
      name: 'sidebar.panellist', id: ARTIFACTS_PANEL_ID, order: 10, label: () => t('artifacts.panel'), locale: NS,
    }, ArtifactsPanelIcon))
  })
}
