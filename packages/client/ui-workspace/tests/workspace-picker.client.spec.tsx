// @vitest-environment jsdom
import { contextMenuHook } from '@janhq/jan-client-test-runtime'
import type { GlobalStandardProps } from '@janhq/jan-client-ui-slots'
import type { RemoteHostFacts } from '@janhq/jan-api-remotes/client'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@janhq/jan-api-workspace-controller/client'
import type { } from '@janhq/jan-client-locale/client'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@janhq/jan-client-test-runtime'
import { zh as commonZh } from '@janhq/jan-client-locale/src/locales/zh.ts'
import type { SessionStatusSnapshot } from '@janhq/jan-client-ui-session/client'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '../src/client/contract/slots.ts'
import type { RemoteMachine, RemoteMachineSource } from '../src/client/remote-machines.ts'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { zh } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => { } })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: WorkspacePickerProps['t'] = makeTranslate(zh, commonZh)

const wid = (id: string) => id as WorkspaceId
function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}
const sessions: SessionListState = {
  ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
}
const noPendingInteraction: SessionStatusSnapshot = new Map()
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})
function anchor(): { current: HTMLElement } {
  const element = document.createElement('button')
  element.getBoundingClientRect = () => ({
    top: 10, left: 20, width: 30, height: 40, right: 50, bottom: 50,
    x: 20, y: 10, toJSON: () => ({}),
  })
  return { current: element }
}

/**
 * Probe occupant of the directory-flow hole: records the latest owner
 * conversation so tests drive onPicked/onCancel/onError like a composed flow
 * package would, and renders a marker element while the flow is open.
 */
function flowProbe() {
  const probe: { owner: DirectoryFlowOwnerProps | undefined } = { owner: undefined }
  const renderSlot = ((_name: string, owner: DirectoryFlowOwnerProps) => {
    probe.owner = owner
    return owner.open ? <div data-testid="directory-flow" data-busy={owner.busy} /> : null
  }) as never
  return { probe, renderSlot }
}

/** Manual occupancy source bound like the renderer would: flip() drives the hook like a real registration change. */
function occupancySource(initial = true) {
  let occupied = initial
  const listeners = new Set<() => void>()
  const useDirectoryFlow = bindSnapshotSelector({
    getSnapshot: () => occupied,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  return {
    useDirectoryFlow,
    flip: (next: boolean) => {
      occupied = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Host facts: a local computer by default, or a named remote Host. */
function hostFacts(remoteName?: string): RemoteHostFacts {
  return remoteName === undefined
    ? { home: '/home/fixture', name: 'fixture.local', remote: false, isLoopback: true }
    : { home: '/home/fixture', name: remoteName, remote: true, isLoopback: false }
}

function remoteSource(machines: readonly RemoteMachine[] = []) {
  return {
    list: vi.fn(async (_signal: AbortSignal) => machines),
    connect: vi.fn(async (_id: string) => { }),
    listDirectory: vi.fn(async (_id: string, path?: string) => ({
      path: path ?? '/home/lab', home: '/home/lab', crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'lab', path: '/home/lab', hidden: false }],
      entries: [{ name: 'code', path: '/home/lab/code', hidden: false }],
      truncated: false,
    })),
    createDirectory: vi.fn(async (_id: string, path: string, name: string) => `${path}/${name}`),
    manage: vi.fn(),
  } satisfies RemoteMachineSource
}

interface MountOptions {
  items?: readonly WorkspaceView[]
  createWorkspace?: Mock<(input: { path: string; hostId?: string }) => Promise<WorkspaceView>>
  createDirectory?: Mock<(parent: string, name: string) => Promise<string>>
  occupancy?: ReturnType<typeof occupancySource>
  remoteName?: string
  remote?: RemoteMachineSource
  selectedId?: WorkspaceId
  state?: WorkspaceSnapshot
}

function mount({
  items = [workspace('alpha', 'Alpha')],
  createWorkspace = vi.fn<(input: { path: string; hostId?: string }) => Promise<WorkspaceView>>(),
  createDirectory = vi.fn(async (parent: string, name: string) => `${parent}/${name}`),
  occupancy = occupancySource(),
  remoteName,
  remote,
  selectedId,
  state,
}: MountOptions = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const anchorRef = anchor()
  const { probe, renderSlot } = flowProbe()
  const renderPicker = (nextItems: readonly WorkspaceView[]) => (
    <WorkspacePicker
      open
      anchorRef={anchorRef}
      useSessions={hook(sessions)}
      useSessionStatus={hook(noPendingInteraction)}
      useSessionRetainInfo={() => undefined}
      usePanelInfo={usePanelInfo} useContextMenu={contextMenuHook()} useResource={useResource}
      useWorkspaces={hook(state ?? workspaceState(nextItems))}
      {...allowAllAccess}
      selectedId={selectedId}
      onPick={onPick}
      onClose={onClose}
      createWorkspace={createWorkspace}
      createDirectory={createDirectory}
      useDirectoryFlow={occupancy.useDirectoryFlow}
      useHostInfo={hook(hostFacts(remoteName))}
      useRemoteMachines={hook(remote)}
      renderSlot={renderSlot}
      t={t}
    />
  )
  const view = render(renderPicker(items))
  return {
    view, onPick, onClose, createWorkspace, createDirectory, probe, occupancy,
    rerenderItems: (nextItems: readonly WorkspaceView[]) => { view.rerender(renderPicker(nextItems)) },
  }
}

const USE_EXISTING = '使用现有文件夹…'
const NEW_FOLDER = '新建文件夹…'
const THIS_COMPUTER = '本机'

function chooseAdd(): void {
  fireEvent.click(screen.getByRole('menuitem', { name: USE_EXISTING }))
}

/** Open the computer row's submenu and return its project rows' text. */
function openThisComputer(name = THIS_COMPUTER): string[] {
  fireEvent.click(screen.getByRole('menuitem', { name }))
  const child = screen.getAllByRole('menu').at(-1)!
  return within(child).getAllByRole('menuitem').map(row => row.textContent ?? '')
}

function search(text: string): HTMLInputElement {
  const field = screen.getByRole<HTMLInputElement>('searchbox', { name: '搜索项目和电脑…' })
  fireEvent.change(field, { target: { value: text } })
  return field
}

describe('WorkspacePicker', () => {
  it('opens on the computers with the search field focused', () => {
    mount()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索项目和电脑…' }))
    expect(screen.getByRole('menu').textContent).toContain('电脑')
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual([THIS_COMPUTER, USE_EXISTING, NEW_FOLDER])
  })

  it('lists projects under the computer with distinguishing path suffixes, checks the selected one, and picks', () => {
    const b = mount({
      items: [
        { ...workspace('alpha', 'Shared'), path: '/one/a/Shared' },
        { ...workspace('beta', 'Shared'), path: '/two/a/Shared' },
        workspace('gamma', 'Alone'),
      ],
      selectedId: wid('gamma'),
    })
    expect(openThisComputer()).toEqual(['Shared one/a/Shared', 'Shared two/a/Shared', 'Alone', '浏览文件夹…'])
    // The full path stays reachable when a narrow menu truncates the row.
    expect(screen.getByText('two/a/Shared').parentElement?.title).toBe('/two/a/Shared')
    expect(screen.getByRole('menuitem', { name: 'Alone' }).querySelectorAll('svg').length)
      .toBeGreaterThan(screen.getByRole('menuitem', { name: 'Shared one/a/Shared' }).querySelectorAll('svg').length)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shared two/a/Shared' }))
    expect(b.onPick).toHaveBeenCalledWith(wid('beta'))
  })

  it('localizes only the registered default with its automatic title', () => {
    mount({
      items: [
        { ...workspace('default', 'default-workspace'), isDefault: true },
        workspace('manual', 'default-workspace'),
      ],
    })
    openThisComputer()
    expect(screen.getByRole('menuitem', { name: '默认工作区' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'default-workspace' })).toBeTruthy()
  })

  it('names the Host in a window working on another computer', () => {
    mount({ remoteName: 'homelab' })
    expect(openThisComputer('homelab')).toEqual(['Alpha', '浏览文件夹…'])
  })

  it('filters projects by search and picks the first match on Enter', () => {
    const b = mount({ items: [workspace('alpha', 'Alpha'), workspace('walk', 'Walk project')] })
    const field = search('walk')
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['Walk project', USE_EXISTING, NEW_FOLDER])
    expect(screen.getByRole('menu').textContent).toContain(THIS_COMPUTER)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(b.onPick).toHaveBeenCalledWith(wid('walk'))
  })

  it('says when nothing matches and keeps the folder actions', () => {
    const b = mount()
    const field = search('zzz')
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['没有匹配项', USE_EXISTING, NEW_FOLDER])
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(b.onPick).not.toHaveBeenCalled()
  })

  it('opens the composed directory flow, adopts its picked path, and selects the returned Workspace', async () => {
    const created = { ...workspace('adopted'), path: '/tmp/project', title: 'project' }
    const createWorkspace = vi.fn(async () => created)
    const b = mount({ createWorkspace })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    chooseAdd()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    await act(async () => { b.probe.owner!.onPicked('/tmp/project') })
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/tmp/project' })
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(created.workspaceId) })
    // Successful adoption withdraws the flow request.
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('treats flow cancellation as a silent no-op', () => {
    const b = mount()
    chooseAdd()
    act(() => { b.probe.owner!.onCancel() })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
    expect(b.onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a non-Error adoption failure in the folder-error surface', async () => {
    const b = mount({ createWorkspace: vi.fn(async () => { throw 'permission denied' }) })
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toBe('permission denied')
    expect(b.probe.owner!.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    expect(b.probe.owner!.open).toBe(true)
    expect(b.onPick).not.toHaveBeenCalled()
  })

  it('disables every menu action from flow open through adoption, and reports busy to the flow', async () => {
    let resolve!: (workspace: WorkspaceView) => void
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    const created = workspace('adopted')
    const b = mount({ createWorkspace: vi.fn(() => pending) })
    chooseAdd()
    // The flow is open but nothing is picked yet: a chooser pending on the
    // host display must already block concurrent workspace actions.
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: USE_EXISTING }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: NEW_FOLDER }).disabled).toBe(true)
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    openThisComputer()
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(true)
    await act(async () => { resolve(created); await pending })
    expect(b.probe.owner!.busy).toBe(false)
  })

  it('shows the flow-reported failure in the folder-error surface', () => {
    const b = mount()
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    expect(screen.getByRole('alert').textContent).toBe('no chooser installed')
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
  })

  it('closes the folder-error surface when the user cancels', () => {
    const b = mount()
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits to show its menu until an optional anchor is available', () => {
    const { renderSlot } = flowProbe()
    render(
      <WorkspacePicker
        open useSessions={hook(sessions)} useWorkspaces={hook(workspaceState([workspace('alpha', 'Alpha')]))}
        useSessionStatus={hook(noPendingInteraction)}
        useSessionRetainInfo={() => undefined}
        usePanelInfo={usePanelInfo} useContextMenu={contextMenuHook()} useResource={useResource}
        {...allowAllAccess}
        onPick={vi.fn()} onClose={vi.fn()} createWorkspace={vi.fn()} createDirectory={vi.fn()}
        useDirectoryFlow={occupancySource().useDirectoryFlow} useHostInfo={hook(hostFacts())}
        useRemoteMachines={hook(undefined)} renderSlot={renderSlot} t={t}
      />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the list loading under the computer while the baseline is in flight', () => {
    mount({ state: { ...workspaceState([]), phase: 'pending', state: 'loading' } })
    expect(openThisComputer()).toEqual(['正在加载工作区…', '浏览文件夹…'])
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('hides the folder-picking rows while the directory-flow hole is empty, and shows them once it fills', () => {
    const b = mount({ occupancy: occupancySource(false) })
    expect(screen.queryByRole('menuitem', { name: USE_EXISTING })).toBeNull()
    expect(openThisComputer()).toEqual(['Alpha'])
    // Registration changes flow through the subscription, no re-render needed.
    act(() => { b.occupancy.flip(true) })
    expect(screen.getByRole('menuitem', { name: USE_EXISTING })).toBeTruthy()
  })

  it('keeps Choose again inert while the flow occupant is gone, and snaps back a flow opened over an empty hole', async () => {
    const b = mount({ createWorkspace: vi.fn(async () => { throw new Error('adoption failed') }) })
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy() })
    // The occupant unloads while the error dialog is up: retrying would open
    // a flow nobody can serve or cancel, so the button goes inert.
    act(() => { b.occupancy.flip(false) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新选择' }).disabled).toBe(true)
    // Cancel stays the way out, and the menu actions are usable again.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: NEW_FOLDER }).disabled).toBe(false)
  })

  it('withdraws an open flow when its occupant unloads, re-enabling the menu actions', () => {
    const b = mount()
    chooseAdd()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    // The flow plugin unloads mid-interaction (HMR): nobody is left to
    // cancel, so the owner withdraws and the actions come back.
    act(() => { b.occupancy.flip(false) })
    expect(b.probe.owner!.open).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: NEW_FOLDER }).disabled).toBe(false)
    expect(screen.queryByRole('menuitem', { name: USE_EXISTING })).toBeNull()
  })

  it('offers no Remote row without a registered source', () => {
    mount()
    expect(screen.queryByRole('menuitem', { name: '远程' })).toBeNull()
  })

  it('lists remote computers, opens one, and sends Add a computer to their settings', async () => {
    const source = remoteSource([
      { id: 'lab', name: 'homelab', detail: 'thinh@lab', state: 'ready' },
      { id: 'cloud', name: 'cloud box', detail: 'https://box.example', state: 'idle' },
    ])
    const createWorkspace = vi.fn(async () => ({ ...workspace('lab~code'), path: '/home/lab' }))
    const b = mount({ remote: source, createWorkspace })
    await waitFor(() => { expect(source.list).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('menuitem', { name: '远程' }))
    await screen.findByRole('menuitem', { name: 'homelab thinh@lab' })
    expect(screen.getByRole('menuitem', { name: 'cloud box 未连接' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'homelab thinh@lab' }))
    expect(source.connect).toHaveBeenCalledWith('lab')
    expect(b.onClose).toHaveBeenCalled()
    // Connected, the in-app chooser lists that computer's folders and makes the pick a project there.
    const chooser = await screen.findByRole('dialog', { name: '选择“homelab”上的文件夹' })
    await waitFor(() => { expect(source.listDirectory).toHaveBeenCalledWith('lab', undefined) })
    fireEvent.click(await within(chooser).findByRole('button', { name: '打开' }))
    await waitFor(() => { expect(b.createWorkspace).toHaveBeenCalledWith({ path: '/home/lab', hostId: 'lab' }) })
    await waitFor(() => { expect(b.onPick).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('menuitem', { name: '远程' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加电脑…' }))
    expect(source.manage).toHaveBeenCalledTimes(1)
  })

  it('finds a remote computer by search and reports an open failure', async () => {
    const source = remoteSource([{ id: 'lab', name: 'homelab', detail: 'thinh@lab', state: 'ready' }])
    source.connect.mockRejectedValueOnce(new Error('host key changed'))
    mount({ remote: source })
    await waitFor(() => { expect(source.list).toHaveBeenCalled() })
    const field = search('lab')
    await screen.findByRole('menuitem', { name: 'homelab thinh@lab' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(source.connect).toHaveBeenCalledWith('lab')
    await screen.findByRole('dialog', { name: '无法打开这台电脑' })
    expect(screen.getByRole('alert').textContent).toBe('host key changed')
    expect(screen.queryByRole('button', { name: '重新选择' })).toBeNull()
  })

  it('creates a new folder in the home, adopts it, and picks the project', async () => {
    const created = { ...workspace('fresh'), path: '/home/fixture/fresh' }
    const createWorkspace = vi.fn(async () => created)
    const b = mount({ createWorkspace })
    fireEvent.click(screen.getByRole('menuitem', { name: NEW_FOLDER }))
    const dialog = screen.getByRole('dialog', { name: '新建项目文件夹' })
    expect(within(dialog).getByText('/home/fixture')).toBeTruthy()
    const name = within(dialog).getByRole('textbox', { name: '名称' })
    fireEvent.change(name, { target: { value: 'a/b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('请输入不含斜杠的文件夹名称。')
    expect(b.createDirectory).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: ' fresh ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(created.workspaceId) })
    expect(b.createDirectory).toHaveBeenCalledWith('/home/fixture', 'fresh')
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/home/fixture/fresh' })
    expect(screen.queryByRole('dialog', { name: '新建项目文件夹' })).toBeNull()
  })

  it('takes the new folder location from the directory flow without adopting it', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('menuitem', { name: NEW_FOLDER }))
    fireEvent.click(screen.getByRole('button', { name: '更改…' }))
    act(() => { b.probe.owner!.onPicked('/work/clients') })
    expect(b.createWorkspace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(within(screen.getByRole('dialog', { name: '新建项目文件夹' })).getByText('/work/clients')).toBeTruthy()
  })
})
