/**
 * Fixed first-use Workspace naming, shared by the Host that creates the
 * directory and by browser consumers that label the resulting row. A pure fold
 * with no imports, so client bundles inline it instead of requesting a
 * module-table row this package does not publish.
 * @module @janhq/jan-api-workspace-controller/default-workspace
 */

/**
 * Leaf directory name of the first-use Workspace under
 * `<Documents>/jan`. Language-neutral, so one installation keeps
 * one on-disk path across language switches. The registry derives the initial
 * title from this same segment, which is the title
 * {@link workspaceDisplayTitle} recognizes as automatic.
 */
export const DEFAULT_WORKSPACE_DIRECTORY = 'default-workspace'

/**
 * Localize the registered first-use Workspace while it still has its stock
 * title. Every custom title and every other Workspace reads verbatim.
 * @param workspace - stored title and registered first-use marker.
 * @param localizedDefault - the default Workspace name in the active language.
 * @returns the title to display.
 */
export function workspaceDisplayTitle(workspace: { readonly title: string; readonly isDefault?: true }, localizedDefault: string): string {
  return workspace.isDefault === true && workspace.title === DEFAULT_WORKSPACE_DIRECTORY ? localizedDefault : workspace.title
}
