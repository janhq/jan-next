import { captureFailure } from '@janhq/jan-client-ui-primitives'
/**
 * Folder drop on the left Sidebar: a directory dragged from the system file
 * manager onto the Sidebar column becomes a Workspace. Listeners run in the
 * document capture phase and stop propagation only for drags over the column,
 * so the composer's document-level file drop keeps every other drop target.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceId, WorkspaceView } from '@janhq/jan-api-workspace-controller/client'
import type { FolderDropNotice } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

/** Desktop preload bridge answering the host path of a dropped `File`; a served Web page has none. */
interface HostPathBridge {
  pathFor(file: File): string
}

const SIDEBAR_SELECTOR = '[data-shell-sidebar]'

declare global {
  /** Installed by the Desktop preload; the composer reads the same bridge. */
  var __JAN_HOST_PATHS__: HostPathBridge | undefined
}

function hostPathBridge(): HostPathBridge | undefined {
  return globalThis.__JAN_HOST_PATHS__
}

/** Whether the drag carries files from outside the application (in-app row and image drags carry none). */
function externalFiles(event: DragEvent): DataTransfer | null {
  const transfer = event.dataTransfer
  return transfer !== null && transfer.types.includes('Files') && !transfer.types.includes('application/x-jan-file') ? transfer : null
}

/**
 * Host paths of the dropped items that may be directories. The entry API,
 * readable only while the drop event dispatches, rules out plain files; an
 * item it does not describe is kept, and Workspace adoption rejects it when
 * the path is not a directory.
 */
function droppedDirectoryPaths(transfer: DataTransfer, bridge: HostPathBridge): string[] {
  const paths: string[] = []
  for (const item of transfer.items) {
    if (item.kind !== 'file' || item.webkitGetAsEntry()?.isFile === true) continue
    const file = item.getAsFile()
    const path = file === null ? '' : bridge.pathFor(file)
    if (path !== '') paths.push(path)
  }
  return paths
}

/**
 * Accept folder drops on the Sidebar column while `enabled`.
 * @param props.enabled - whether this composition can add Workspaces (a directory flow is mounted).
 * @param props.anchor - an element inside the Sidebar column, used to find the column.
 * @param props.hint - the localized overlay label.
 * @param props.createWorkspace - adopts one host directory.
 * @param props.onAdded - runs once with the Workspace when exactly one folder was dropped.
 * @param props.notify - raises the outcome notice.
 * @returns the drop overlay, portalled into the column while a file drag is over it.
 */
export function FolderDrop({ enabled, anchor, hint, createWorkspace, onAdded, notify }: {
  enabled: boolean
  anchor: { readonly current: HTMLElement | null }
  hint: string
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  onAdded: (workspaceId: WorkspaceId) => void
  notify: (notice: FolderDropNotice) => void
}) {
  const [column, setColumn] = useState<HTMLElement | null>(null)
  const callbacks = useRef({ createWorkspace, onAdded, notify })
  callbacks.current = { createWorkspace, onAdded, notify }
  useEffect(() => {
    const bridge = hostPathBridge()
    const sidebar = anchor.current?.closest<HTMLElement>(SIDEBAR_SELECTOR)
    // Without host paths a folder cannot become a Workspace; the drop stays the composer's.
    if (!enabled || bridge === undefined || sidebar == null) return
    const over = (event: DragEvent): DataTransfer | null => event.target instanceof Node && sidebar.contains(event.target)
      ? externalFiles(event) : null
    const onEnterOrOver = (event: DragEvent): void => {
      const transfer = over(event)
      if (transfer === null) return
      event.preventDefault()
      event.stopPropagation()
      transfer.dropEffect = 'copy'
      setColumn(sidebar)
    }
    const onLeave = (event: DragEvent): void => {
      if (over(event) === null) return
      event.stopPropagation()
      // Leaving to a point outside the column ends the hover; moves between its children do not.
      if (!(event.relatedTarget instanceof Node && sidebar.contains(event.relatedTarget))) setColumn(null)
    }
    const onDrop = (event: DragEvent): void => {
      const transfer = over(event)
      if (transfer === null) return
      event.preventDefault()
      event.stopPropagation()
      setColumn(null)
      const paths = droppedDirectoryPaths(transfer, bridge)
      const { createWorkspace: create, onAdded: added, notify: tell } = callbacks.current
      if (paths.length === 0) { tell({ kind: 'folderDropNotFolder' }); return }
      void (async () => {
        let last: WorkspaceView | undefined
        for (const path of paths) {
          try {
            last = await create({ path })
          } catch (error) {
            tell({ kind: 'folderDropFailed', message: error instanceof Error ? error.message : String(error), failure: captureFailure('workspace.addFolder', error) })
            return
          }
        }
        if (last === undefined) return
        tell({ kind: 'folderAdded', title: last.title })
        // Several folders are a batch registration; one folder is a place to start working.
        if (paths.length === 1) added(last.workspaceId)
      })()
    }
    const clear = (): void => { setColumn(null) }
    document.addEventListener('dragenter', onEnterOrOver, true)
    document.addEventListener('dragover', onEnterOrOver, true)
    document.addEventListener('dragleave', onLeave, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', clear)
    return () => {
      document.removeEventListener('dragenter', onEnterOrOver, true)
      document.removeEventListener('dragover', onEnterOrOver, true)
      document.removeEventListener('dragleave', onLeave, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', clear)
      setColumn(null)
    }
  }, [enabled, anchor])
  return column === null ? null : createPortal(
    <div className={css.folderDrop} role="status"><span className={css.folderDropLabel}>{hint}</span></div>,
    column,
  )
}
