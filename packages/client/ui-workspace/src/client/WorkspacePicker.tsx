/**
 * Workspace pick/add flow. WorkspacePickFlow is the reusable core (menu, New
 * folder dialog and folder error dialog) consumed directly by
 * WorkspaceBrowser (same package, the sidebar's Add project button) and
 * wrapped by WorkspacePicker for the conversation empty-state chip. Both
 * surfaces show one menu:
 *
 * - a search field filtering projects and remote computers;
 * - `This Mac` (or this Host's name in a window on another computer) with
 *   the Host's projects and Browse folders in a submenu;
 * - `Remote` with the computers a plugin registered (saved Hosts) and the
 *   place to add one;
 * - Use existing folder (the composed directory flow) and New folder.
 *
 * Directory picking itself lives in the composed flow package's slot
 * occupant (see the contract module doc): this core only opens the flow,
 * adopts the picked path (or takes it as the New folder parent), and owns
 * the error surface.
 */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconFolderOpenOutlineRegular, IconFollowsystemOutlineRegular, IconLinkOutlineRegular,
  IconPlusOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular, Input, Menu, Modal, type MenuEntry,
} from '@janhq/jan-client-ui-primitives'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@janhq/jan-api-workspace-controller/client'
import type { RemoteHostFacts } from '@janhq/jan-api-remotes/client'
import { workspaceDisplayTitle } from '@janhq/jan-api-workspace-controller/default-workspace'
import type { SnapshotSelectorHook } from '@janhq/jan-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import type { RemoteMachine, RemoteMachineSource } from './remote-machines.ts'
import { distinguishingPathSuffixes } from './path-suffix.ts'
import { ProjectAvatar } from './ProjectAvatar.tsx'
import css from './WorkspacePicker.module.css'

const THIS_MACHINE = '::this-machine'
const BROWSE = '::browse'
const REMOTE = '::remote'
const REMOTE_PREFIX = '::remote:'
const ADD_COMPUTER = '::add-computer'
const USE_EXISTING = '::use-existing'
const NEW_FOLDER = '::new-folder'
const STATUS = '::status'
/** Last parent a New folder was created in, offered as the next default. */
const NEW_FOLDER_PARENT_KEY = 'jan.workspace.newFolderParent'

/** Core flow props: the owner supplies popover control and pick semantics. */
export interface WorkspacePickFlowProps {
  /** The standard locale seat, forwarded by whichever slot entry hosts the flow. */
  t: WorkspacePickerProps['t']
  /** Popover visibility (anchor button toggle state, owner-local). */
  open: boolean
  /** The anchor button element — the popover's placement anchor. */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  /** Selector hook over the workspace list (framework standard hook). */
  useWorkspaces: <S>(selector: (state: WorkspaceSnapshot) => S) => S
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Create a folder on this Host (New folder). */
  createDirectory: (parent: string, name: string) => Promise<string>
  /** Bound occupancy selector hook for this surface's directory-flow hole (empty hides the folder-picking rows). */
  useDirectoryFlow: SnapshotSelectorHook<boolean>
  /** Bound selector over the Host facts: names this computer and supplies the New folder home. */
  useHostInfo: SnapshotSelectorHook<RemoteHostFacts>
  /** Bound selector over the registered remote computer source; none hides the Remote row. */
  useRemoteMachines: SnapshotSelectorHook<RemoteMachineSource | undefined>
  /** Render this surface's directory-flow hole with the owner conversation (the entry's narrowed renderSlot). */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  /** A real Workspace was picked or created. */
  onPick: (workspaceId: WorkspaceId) => void
  /** Close the popover (outside click / Escape / post-pick). */
  onClose: () => void
  /** Report the picking interaction and adoption occupancy. */
  onBusyChange?: (busy: boolean) => void
  /** Menu opening direction relative to the anchor. */
  side?: 'bottom' | 'top' | 'right'
  /** Currently active workspace (trailing check in the project list). */
  selectedId?: WorkspaceId | undefined
}

type RemoteList =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly RemoteMachine[] }
  | { readonly status: 'error' }

interface NewFolderDraft {
  readonly name: string
  readonly parent: string
  readonly error: string | null
  readonly busy: boolean
}

/** The folder or remote failure on display; only a folder failure offers Choose again. */
interface FailureNotice {
  readonly kind: 'folder' | 'remote'
  readonly message: string
}

function readNewFolderParent(): string | undefined {
  try {
    return localStorage.getItem(NEW_FOLDER_PARENT_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function rememberNewFolderParent(parent: string): void {
  try {
    localStorage.setItem(NEW_FOLDER_PARENT_KEY, parent)
  } catch {
    // Storage may be unavailable (private mode, quota); the default stays the home.
  }
}

/** A folder name the Host can create as one direct child. */
function validFolderName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name)
}

const reason = (value: unknown): string => value instanceof Error ? value.message : String(value)

/**
 * Render the computer menu plus the New folder and failure dialogs.
 * @param props - owner-controlled flow props.
 * @returns menu + dialog elements.
 */
export function WorkspacePickFlow({
  t,
  open,
  anchorRef,
  useWorkspaces,
  createWorkspace,
  createDirectory,
  useDirectoryFlow,
  useHostInfo,
  useRemoteMachines,
  renderDirectoryFlow,
  onPick,
  onClose,
  onBusyChange,
  side = 'bottom',
  selectedId,
}: WorkspacePickFlowProps) {
  // Without an owner-provided anchor, the menu remains hidden.
  const absentAnchor = useRef<HTMLElement>(null)
  const workspaceSnapshot = useWorkspaces(state => state)
  const workspaces = workspaceSnapshot.items
  const [failure, setFailure] = useState<FailureNotice | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  // The flow either adopts its pick as a project or hands it back as the New folder parent.
  const flowPurpose = useRef<'adopt' | 'parent'>('adopt')
  const [pickingFolder, setPickingFolder] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<RemoteList>({ status: 'loading' })
  const [newFolder, setNewFolder] = useState<NewFolderDraft | null>(null)
  // One picking interaction at a time: while the flow is open (native chooser
  // pending, browse dialog up) or its pick is being adopted, every other
  // menu action stays disabled — a late outcome must not race a concurrent
  // selection or adoption.
  const flowBusy = flowOpen || pickingFolder
  useEffect(() => { onBusyChange?.(flowBusy) }, [flowBusy, onBusyChange])

  // The occupied hole gates the folder-picking rows: with no composed flow
  // they are not there (the seam's documented no-flow default). The
  // framework-bound hook keeps occupancy live: flow plugins activate (and
  // HMR-reload) independently of this menu's renders.
  const flowAvailable = useDirectoryFlow(occupied => occupied)
  // An occupant that unloads mid-interaction leaves nobody to cancel: an
  // open flow over an empty hole withdraws so the menu actions come back.
  // flowOpen is a dependency because the flow can also OPEN over an already
  // empty hole (Choose again after the occupant unloaded with the error
  // dialog up) — that transition must snap back too, not just occupancy loss.
  useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])

  // A window can work on another computer over SSH; the row names the one
  // whose folders these are, so a pick is never made on the wrong machine.
  const localLabel = t(typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'picker.thisMac' : 'workspace.machine.local')
  const machineLabel = useHostInfo(info => info.name !== undefined && (info.remote || !info.isLoopback) ? info.name : localLabel)
  const home = useHostInfo(info => info.home)
  const remoteSource = useRemoteMachines(source => source)

  // Each opening reads the computers afresh; a close before the answer drops it.
  useEffect(() => {
    if (!open || remoteSource === undefined) return
    const controller = new AbortController()
    setRemote({ status: 'loading' })
    remoteSource.list(controller.signal).then((items) => {
      if (!controller.signal.aborted) setRemote({ status: 'ready', items })
    }, () => {
      if (!controller.signal.aborted) setRemote({ status: 'error' })
    })
    return () => { controller.abort() }
  }, [open, remoteSource])
  // A reopened menu starts from the full list.
  useEffect(() => { if (!open) setQuery('') }, [open])

  // The resolved name, not `t`, is the memo dependency: the bound seat keeps
  // its identity across a language switch.
  const defaultWorkspaceName = t('workspace.defaultName')
  const listed = useMemo(() => {
    const rows = workspaces.map(workspace => ({
      id: workspace.workspaceId,
      title: workspaceDisplayTitle(workspace, defaultWorkspaceName),
      path: workspace.path,
      avatar: workspace.avatar,
      githubOwner: workspace.githubOwner,
      color: workspace.color,
    }))
    const suffixes = distinguishingPathSuffixes(rows)
    return rows.map(row => ({ ...row, suffix: suffixes.get(row.id) }))
  }, [workspaces, defaultWorkspaceName])

  const projectEntry = ({ id, title, path, suffix, avatar, githubOwner, color }: typeof listed[number]): MenuEntry => ({
    id,
    // The title gives way first, so the suffix that tells the rows apart
    // stays visible; the native tooltip carries the full path.
    label: suffix === undefined
      ? title
      : (
        <span className={css.disambiguated} title={path}>
          <span className={css.title}>{title}</span>
          {' '}
          <span className={css.pathSuffix}>{suffix}</span>
        </span>
      ),
    icon: <ProjectAvatar avatar={avatar} githubOwner={githubOwner} color={color} />,
    disabled: flowBusy,
  })
  const machineEntry = (machine: RemoteMachine): MenuEntry => {
    const status = machine.state === 'connecting' ? t('picker.remoteConnecting')
      : machine.state === 'idle' ? t('picker.remoteNotConnected') : machine.detail
    return {
      id: REMOTE_PREFIX + machine.id,
      label: (
        <span className={css.disambiguated} title={machine.detail}>
          <span className={css.title}>{machine.name}</span>
          {status !== undefined && status !== '' && <>{' '}<span className={css.pathSuffix}>{status}</span></>}
        </span>
      ),
      icon: <IconFollowsystemOutlineRegular size={16} />,
      disabled: flowBusy,
    }
  }
  const statusEntry = (label: string): MenuEntry => ({ id: STATUS, label, disabled: true })
  const remoteMachines = remote.status === 'ready' ? remote.items : []
  const folderEntries: MenuEntry[] = [
    { type: 'separator', id: 'folders' },
    ...flowAvailable
      ? [{ id: USE_EXISTING, label: t('picker.useExisting'), icon: <IconFolderOpenOutlineRegular size={16} />, disabled: flowBusy }]
      : [],
    { id: NEW_FOLDER, label: t('picker.newFolder'), icon: <IconProjectAddOutlineRegular size={16} />, disabled: flowBusy },
  ]

  const needle = query.trim().toLowerCase()
  const projectMatches = needle === '' ? [] : listed.filter(row =>
    row.title.toLowerCase().includes(needle) || row.path.toLowerCase().includes(needle))
  const machineMatches = needle === '' ? [] : remoteMachines.filter(machine =>
    machine.name.toLowerCase().includes(needle) || machine.detail?.toLowerCase().includes(needle) === true)

  const entries: MenuEntry[] = needle !== ''
    ? [
      ...projectMatches.length > 0
        ? [{ type: 'label', id: 'this-machine', text: machineLabel } as const, ...projectMatches.map(projectEntry)]
        : [],
      ...machineMatches.length > 0
        ? [{ type: 'label', id: 'remote', text: t('picker.remote') } as const, ...machineMatches.map(machineEntry)]
        : [],
      ...projectMatches.length === 0 && machineMatches.length === 0 ? [statusEntry(t('picker.noMatches'))] : [],
      ...folderEntries,
    ]
    : [
      { type: 'label', id: 'computers', text: t('picker.computers') },
      {
        id: THIS_MACHINE,
        label: machineLabel,
        icon: <IconFollowsystemOutlineRegular size={16} />,
        submenu: [
          ...workspaceSnapshot.phase === 'pending' && listed.length === 0 ? [statusEntry(t('picker.loading'))] : listed.map(projectEntry),
          ...flowAvailable
            ? [
              ...listed.length > 0 ? [{ type: 'separator', id: 'browse' } as const] : [],
              { id: BROWSE, label: t('menu.addWorkspace'), icon: <IconPlusOutlineRegular size={16} />, disabled: flowBusy },
            ]
            : [],
        ],
      },
      ...remoteSource === undefined ? [] : [{
        id: REMOTE,
        label: t('picker.remote'),
        icon: <IconLinkOutlineRegular size={16} />,
        submenu: [
          ...remote.status === 'loading' ? [statusEntry(t('picker.remoteLoading'))]
            : remote.status === 'error' ? [statusEntry(t('picker.remoteFailed'))]
              : remote.items.map(machineEntry),
          ...remote.status === 'ready' && remote.items.length === 0 ? [] : [{ type: 'separator', id: 'add-computer' } as const],
          { id: ADD_COMPUTER, label: t('picker.addComputer'), icon: <IconPlusOutlineRegular size={16} /> },
        ],
      }],
      ...folderEntries,
    ]

  // Stable identity: React re-invokes a changed callback ref on every render,
  // which would pull the keyboard back from the rows whenever the list updates.
  const focusSearch = useCallback((node: HTMLInputElement | null): void => {
    node?.focus({ preventScroll: true })
  }, [])
  const closeFailure = (): void => { setFailure(null) }

  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
  const adoptDirectory = (path: string): Promise<void> =>
    createWorkspace({ path }).then((workspace) => {
      setFlowOpen(false)
      onPick(workspace.workspaceId)
    }).catch((error: unknown) => {
      setFlowOpen(false)
      setFailure({ kind: 'folder', message: reason(error) })
    })

  const openDirectoryFlow = useCallback((purpose: 'adopt' | 'parent' = 'adopt'): void => {
    flowPurpose.current = purpose
    onClose()
    setFailure(null)
    setFlowOpen(true)
  }, [onClose])

  /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: pickingFolder,
    onPicked: (path) => {
      if (flowPurpose.current === 'parent') {
        setFlowOpen(false)
        setNewFolder(draft => draft === null ? draft : { ...draft, parent: path, error: null })
        return
      }
      setPickingFolder(true)
      void adoptDirectory(path).finally(() => { setPickingFolder(false) })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: (message) => {
      setFlowOpen(false)
      if (flowPurpose.current === 'parent') setNewFolder(draft => draft === null ? draft : { ...draft, error: message })
      else setFailure({ kind: 'folder', message })
    },
  }

  const openRemote = (id: string): void => {
    onClose()
    if (remoteSource === undefined) return
    remoteSource.open(id).catch((error: unknown) => {
      setFailure({ kind: 'remote', message: reason(error) })
    })
  }

  const handleSelect = (id: string): void => {
    if (id === BROWSE || id === USE_EXISTING) {
      openDirectoryFlow()
      return
    }
    if (id === NEW_FOLDER) {
      onClose()
      setNewFolder({ name: '', parent: readNewFolderParent() ?? home ?? '', error: null, busy: false })
      return
    }
    if (id === ADD_COMPUTER) {
      onClose()
      remoteSource?.manage()
      return
    }
    if (id.startsWith(REMOTE_PREFIX)) {
      openRemote(id.slice(REMOTE_PREFIX.length))
      return
    }
    if (id === THIS_MACHINE || id === REMOTE || id === STATUS) return
    onPick(id as WorkspaceId)
  }

  /** Enter in the search field takes the first result, as a click on it would. */
  const pickFirstMatch = (): void => {
    if (flowBusy) return
    const project = projectMatches[0]
    if (project !== undefined) {
      onPick(project.id)
      return
    }
    const machine = machineMatches[0]
    if (machine !== undefined) openRemote(machine.id)
  }

  const createFolder = (): void => {
    if (newFolder === null || newFolder.busy) return
    const name = newFolder.name.trim()
    if (!validFolderName(name)) {
      setNewFolder({ ...newFolder, error: t('newFolder.invalidName') })
      return
    }
    const { parent } = newFolder
    setNewFolder({ ...newFolder, busy: true, error: null })
    createDirectory(parent, name)
      .then(path => createWorkspace({ path }))
      .then((workspace) => {
        rememberNewFolderParent(parent)
        setNewFolder(null)
        onPick(workspace.workspaceId)
      }, (error: unknown) => {
        setNewFolder(draft => draft === null ? draft : { ...draft, busy: false, error: reason(error) })
      })
  }

  return (
    <>
      <Menu
        open={open}
        anchor={null}
        items={entries}
        header={(
          <Input
            ref={focusSearch}
            type="search"
            className={css.search as string}
            icon={<IconSearchOutlineRegular size={16} />}
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              pickFirstMatch()
            }}
          />
        )}
        listClassName={css.menu}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        side={side}
        portal
        anchorRef={anchorRef ?? absentAnchor}
      />
      {renderDirectoryFlow(flowOwner)}
      <Modal
        open={newFolder !== null}
        onClose={() => { if (newFolder?.busy !== true) setNewFolder(null) }}
        closeLabel={t('close')}
        title={t('newFolder.title')}
        footer={(
          <>
            <Button variant="outline" className={css.modalAction} disabled={newFolder?.busy === true}
              onClick={() => { setNewFolder(null) }}>{t('cancel')}</Button>
            <Button variant="primary" className={css.modalAction}
              disabled={newFolder === null || newFolder.busy || newFolder.name.trim() === '' || newFolder.parent === ''}
              onClick={createFolder}>{t('newFolder.create')}</Button>
          </>
        )}
      >
        {newFolder !== null && (
          <form className={css.newFolder} onSubmit={(event) => { event.preventDefault(); createFolder() }}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('newFolder.name')}</span>
              <Input data-modal-autofocus="" value={newFolder.name} disabled={newFolder.busy}
                aria-invalid={newFolder.error !== null || undefined}
                onChange={(event) => { setNewFolder({ ...newFolder, name: event.target.value, error: null }) }} />
            </label>
            <div className={css.field}>
              <span className={css.fieldLabel}>{t('newFolder.location')}</span>
              <div className={css.location}>
                <span className={css.locationPath} title={newFolder.parent}>{newFolder.parent}</span>
                {flowAvailable && (
                  <Button variant="outline" size="sm" type="button" disabled={newFolder.busy || flowBusy}
                    onClick={() => { openDirectoryFlow('parent') }}>{t('newFolder.change')}</Button>
                )}
              </div>
            </div>
            {newFolder.error !== null && <div className={css.modalError} role="alert">{newFolder.error}</div>}
          </form>
        )}
      </Modal>
      <Modal
        open={failure !== null}
        onClose={closeFailure}
        closeLabel={t('close')}
        title={failure?.kind === 'remote' ? t('picker.remoteOpenFailed') : t('folderError.title')}
        footer={(
          <>
            <Button variant="outline" className={css.modalAction} onClick={closeFailure}>{t('cancel')}</Button>
            {/* Retrying needs an occupant to serve the flow; without one the
              * button would open a flow nobody can answer or cancel. */}
            {failure?.kind !== 'remote' && (
              <Button variant="primary" className={css.modalAction} disabled={!flowAvailable}
                onClick={() => { openDirectoryFlow() }}>{t('folderError.retry')}</Button>
            )}
          </>
        )}
      >
        <div className={css.modalError} role="alert">{failure?.message}</div>
      </Modal>
    </>
  )
}

/**
 * The conversation empty-state registration: adapts the owner share to the
 * core flow (all state and semantics live in the flow / the owner).
 * @param props - empty-state slot props (owner share + injected creation callbacks).
 * @returns the flow element.
 */
export function WorkspacePicker({
  open,
  anchorRef,
  useWorkspaces,
  selectedId,
  onPick,
  onClose,
  createWorkspace,
  createDirectory,
  useDirectoryFlow,
  useRemoteMachines,
  renderSlot,
  useHostInfo,
  t,
}: WorkspacePickerProps) {
  return (
    <WorkspacePickFlow
      t={t}
      open={open}
      anchorRef={anchorRef}
      useWorkspaces={useWorkspaces}
      createWorkspace={createWorkspace}
      createDirectory={createDirectory}
      useDirectoryFlow={useDirectoryFlow}
      useHostInfo={useHostInfo}
      useRemoteMachines={useRemoteMachines}
      renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner)}
      selectedId={selectedId}
      onPick={onPick}
      onClose={onClose}
    />
  )
}
