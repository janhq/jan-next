/**
 * Test-only client roster of the assembled viewer page.
 *
 * A served viewer page is the owner's own Web shell with the owner's client plugins; this roster is the
 * subset the viewer page specs need: the wire plugin, the Gateway, remote access, the Session/Workspace controllers,
 * the menu service, presentation plugins, and the Liveshare `./client` face, which mounts the viewer surfaces when the
 * carrier names a share. Every row is the package's own `/client` face registered as a module-table
 * factory. It must be imported only after {@link prepareViewerRemoteFaces} answered the generated
 * `/remote` faces these plugins import.
 *
 * @module @janhq/jan-experimental-liveshare/tests/viewer-page-roster
 */

import * as apiGateway from '@janhq/jan-api-gateway/client'
import * as apiRemoteAccess from '@janhq/jan-api-remote-access/client'
import * as apiRemotes from '@janhq/jan-api-remotes/client'
import * as apiSessionController from '@janhq/jan-api-session-controller/client'
import * as apiWorkspaceController from '@janhq/jan-api-workspace-controller/client'
import * as clientConnection from '@janhq/jan-client-connection/client'
import * as clientFileUpload from '@janhq/jan-client-file-upload/client'
import * as clientLocale from '@janhq/jan-client-locale/client'
import * as clientModules from '@janhq/jan-client-modules/client'
import * as clientResources from '@janhq/jan-client-resources/client'
import * as clientShortcuts from '@janhq/jan-client-shortcuts/client'
import * as uiAttachment from '@janhq/jan-client-ui-attachment/client'
import * as uiChat from '@janhq/jan-client-ui-chat/client'
import * as uiContextMenu from '@janhq/jan-client-ui-context-menu/client'
import * as uiConversation from '@janhq/jan-client-ui-conversation/client'
import * as uiDeliverables from '@janhq/jan-client-ui-deliverables/client'
import * as uiFileDrag from '@janhq/jan-client-ui-file-drag/client'
import * as uiLayout from '@janhq/jan-client-ui-layout/client'
import * as uiRenderer from '@janhq/jan-client-ui-renderer/client'
import * as uiSession from '@janhq/jan-client-ui-session/client'
import * as uiSettings from '@janhq/jan-client-ui-settings/client'
import * as uiSidebar from '@janhq/jan-client-ui-sidebar/client'
import * as uiSidebarRight from '@janhq/jan-client-ui-sidebar-right/client'
import * as uiTheme from '@janhq/jan-client-ui-theme/client'
import * as uiTool from '@janhq/jan-client-ui-tool/client'
import * as uiTrajectory from '@janhq/jan-client-ui-trajectory/client'
import * as uiWorkspace from '@janhq/jan-client-ui-workspace/client'
import * as typertRegistry from '@janhq/jan-typert-registry/client'
import * as liveshare from '../src/client/index.ts'

/** One module-table row: the entry id the Loader creates, and that plugin's client exports. */
export interface ViewerPageRosterRow {
  readonly id: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Entry id of the module-system bootstrap whose exports the facade hands to the module system. */
export const VIEWER_PAGE_BOOTSTRAP_ID = '@janhq/jan-client-modules'

/** The viewer page roster; Cordis composes these entries by service injection, so order is irrelevant. */
export const VIEWER_PAGE_ROSTER: readonly ViewerPageRosterRow[] = [
  { id: '@janhq/jan-typert-registry', exports: typertRegistry },
  { id: '@janhq/jan-experimental-liveshare', exports: liveshare },
  { id: VIEWER_PAGE_BOOTSTRAP_ID, exports: clientModules },
  { id: '@janhq/jan-client-connection', exports: clientConnection },
  { id: '@janhq/jan-api-gateway', exports: apiGateway },
  { id: '@janhq/jan-api-remote-access', exports: apiRemoteAccess },
  { id: '@janhq/jan-api-remotes', exports: apiRemotes },
  { id: '@janhq/jan-api-session-controller', exports: apiSessionController },
  { id: '@janhq/jan-api-workspace-controller', exports: apiWorkspaceController },
  { id: '@janhq/jan-client-file-upload', exports: clientFileUpload },
  { id: '@janhq/jan-client-locale', exports: clientLocale },
  { id: '@janhq/jan-client-resources', exports: clientResources },
  { id: '@janhq/jan-client-shortcuts', exports: clientShortcuts },
  { id: '@janhq/jan-client-ui-renderer', exports: uiRenderer },
  { id: '@janhq/jan-client-ui-theme', exports: uiTheme },
  { id: '@janhq/jan-client-ui-settings', exports: uiSettings },
  { id: '@janhq/jan-client-ui-layout', exports: uiLayout },
  { id: '@janhq/jan-client-ui-session', exports: uiSession },
  { id: '@janhq/jan-client-ui-sidebar', exports: uiSidebar },
  { id: '@janhq/jan-client-ui-conversation', exports: uiConversation },
  { id: '@janhq/jan-client-ui-chat', exports: uiChat },
  { id: '@janhq/jan-client-ui-context-menu', exports: uiContextMenu },
  { id: '@janhq/jan-client-ui-tool', exports: uiTool },
  { id: '@janhq/jan-client-ui-attachment', exports: uiAttachment },
  { id: '@janhq/jan-client-ui-file-drag', exports: uiFileDrag },
  { id: '@janhq/jan-client-ui-sidebar-right', exports: uiSidebarRight },
  { id: '@janhq/jan-client-ui-trajectory', exports: uiTrajectory },
  { id: '@janhq/jan-client-ui-deliverables', exports: uiDeliverables },
  { id: '@janhq/jan-client-ui-workspace', exports: uiWorkspace },
]
