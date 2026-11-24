// @vitest-environment jsdom
import { apply as applyMenus, inject as injectMenus } from '@janhq/jan-client-ui-context-menu/client'
/** Conversation assembly acceptance independent of Tool presentation. */
import './control-row-dom.ts'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import type { ISession } from '@janhq/jan-api-session-controller/client'
import type { PropsRenderSlots, PropsRuntime } from '@janhq/jan-client-ui-slots'
import {
  RemoteError, SlotTestRuntime, usePinnedBrowserLanguages, stubConfigForm,
} from '@janhq/jan-client-test-runtime'
import { InputHub } from '../src/client/input/hub.ts'
import { MULTITASK_LAYOUT_KEY } from '../src/client/skeleton/multitask-layout.ts'
import { apply, inject, type EmptyWorkspaceOwnerProps } from '@janhq/jan-client-ui-conversation/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { WorkspaceId } from '@janhq/jan-workspace/types'

// jsdom implements no Range geometry (Lexical's scroll-into-view measures the
// caret with one once the surface is genuinely contenteditable).
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})


usePinnedBrowserLanguages('zh-CN')


const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

type AppRootProps = PropsRenderSlots<'main'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('main', {}, { entryKey: 'conversation' })}</>
}

const LAYOUT_CHILDREN = {
  'main': { kind: 'keyed', scope: 'root' },
} as const

function provideWorkspaceNavigation(runtime: SlotTestRuntime, waitForOpen = Promise.resolve()) {
  let mainReference: ReturnType<typeof runtime.sessions.retain> | undefined
  const openSession = (id: SessionId): void => {
    const next = runtime.sessions.retain(id, { source: 'mainView' })
    mainReference?.release()
    mainReference = next
  }
  const openWorkspace = vi.fn(async (_workspaceId: WorkspaceId | undefined, beforeOpen: (id: SessionId) => void) => {
    await waitForOpen
    openSession(SID)
    beforeOpen(SID)
  })
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace,
    openSession,
  } as never)
  return { openSession, openWorkspace }
}

function WorkspaceProbe({ open }: EmptyWorkspaceOwnerProps) {
  const [count, setCount] = useState(0)
  return (
    <button data-testid="workspace-probe" onClick={() => { setCount(value => value + 1) }}>
      {String(open)}:{count}
    </button>
  )
}

async function bench(opts?: { blank?: boolean; listPending?: boolean }) {
  const runtime = await SlotTestRuntime.create()
  const { openSession } = provideWorkspaceNavigation(runtime)
  runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
  await runtime.mount({ inject: [...injectMenus], apply: applyMenus })
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
    ...(opts?.blank === true ? { snapshot: { blank: true } } : {}),
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  openSession(SID)
  if (opts?.listPending) runtime.sessions.list.update((draft) => { draft.phase = 'pending' })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...inject], apply })
  return runtime
}

describe('resident composer', () => {
  it('renders a persistent Session identity before its first turn', async () => {
    const runtime = await bench({ blank: true })
    runtime.slots.register({ name: 'conversation.session.header.identity', id: 'example' }, ({ blank }) => (
      <span>{blank ? 'Blank identity' : 'Active identity'}</span>
    ))
    const view = runtime.renderRoot()
    expect(await view.findByText('Blank identity')).toBeTruthy()
    await runtime.dispose()
  })

  it('materializes the default chat on first focus and preserves text typed while it opens', async () => {
    const runtime = await SlotTestRuntime.create()
    const pending = Promise.withResolvers<undefined>()
    const { openWorkspace } = provideWorkspaceNavigation(runtime, pending.promise)
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.sessions.add({ id: SID, summary: { cwd: '/proj', blank: true }, snapshot: { blank: true } })
    runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
    await runtime.mount({ inject: [...injectMenus], apply: applyMenus })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    const view = runtime.renderRoot()
    const textarea = view.container.querySelector<HTMLDivElement>('[data-composer-input]')
    expect(textarea).not.toBeNull()
    expect(textarea!.getAttribute('aria-disabled')).not.toBe('true')
    expect(textarea!.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(openWorkspace).not.toHaveBeenCalled()
    fireEvent.focus(textarea!)
    textarea!.textContent = 'hi'
    fireEvent.input(textarea!)
    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(Function), { reuseBlank: false })
    await act(async () => { pending.resolve(undefined); await runtime.flush() })
    await waitFor(() => { expect(textarea!.getAttribute('contenteditable')).toBe('true') })
    expect(textarea!.textContent).toBe('hi')
    await runtime.dispose()
  })

  it('keeps the complete Hero tree mounted when the first Workspace session appears', async () => {
    const runtime = await SlotTestRuntime.create()
    const { openSession } = provideWorkspaceNavigation(runtime)
    runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
    await runtime.mount({ inject: [...injectMenus], apply: applyMenus })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    const view = runtime.renderRoot()

    const root = view.container.querySelector('[data-phase="hero"]')!
    const scrollBody = view.container.querySelector('[data-conversation-scroll]')!
    const composerSeat = view.container.querySelector('[data-composer-seat]')!
    const textarea = view.container.querySelector<HTMLDivElement>('[data-composer-input]')!
    const workspaceChip = view.getByRole('button', { name: '选择工作区' })
    const workspaceProbe = view.getByTestId('workspace-probe')
    expect(textarea.getAttribute('aria-disabled')).not.toBe('true')
    expect(textarea.getAttribute('contenteditable')).toBe('plaintext-only')

    fireEvent.click(workspaceChip)
    fireEvent.click(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')

    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj', blank: true },
      snapshot: { blank: true },
    })
    openSession(SID)
    await runtime.flush()

    expect(view.container.querySelector('[data-phase="hero"]')).toBe(root)
    expect(view.container.querySelector('[data-conversation-scroll]')).toBe(scrollBody)
    expect(view.container.querySelector('[data-composer-seat]')).toBe(composerSeat)
    expect(view.container.querySelector<HTMLDivElement>('[data-composer-input]')).toBe(textarea)
    expect(view.getByRole('button', { name: '选择工作区' })).toBe(workspaceChip)
    expect(view.getByTestId('workspace-probe')).toBe(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')
    expect(textarea.getAttribute('aria-disabled')).not.toBe('true')
    expect(textarea.getAttribute('contenteditable')).toBe('true')
    await runtime.dispose()
  })

  it('the textarea survives the blank→active conversion as the same DOM node', async () => {
    const runtime = await bench({ blank: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    const view = runtime.renderRoot()
    const hero = view.container.querySelector<HTMLDivElement>('[data-composer-input]')
    expect(hero).not.toBeNull()
    expect(hero!.getAttribute('aria-disabled')).not.toBe('true')

    await runtime.sessions.updateSessionSnapshot(SID, (draft) => {
      draft.blank = false
    })
    expect(view.container.querySelector<HTMLDivElement>('[data-composer-input]')).toBe(hero)
    await runtime.dispose()
  })
})

describe('multitask conversation', () => {
  it('opens history with its own Session binding in a restored background pane', async () => {
    localStorage.setItem(MULTITASK_LAYOUT_KEY, JSON.stringify({
      root: { axis: 'column', sizes: [0.5, 0.5], children: [{ tabs: [SID], active: 0 }, { tabs: ['second'], active: 0 }] },
      active: 0,
    }))
    const runtime = await bench({ listPending: true })
    onTestFinished(() => runtime.dispose())
    const history = Promise.withResolvers<undefined>()
    onTestFinished(() => { history.resolve(undefined) })
    const opened = vi.fn(() => history.promise)
    const second = await runtime.sessions.add({ id: 'second', snapshot: { openState: 'loading' }, initialOpen: opened })
    function HistoryProbe({ sessionId, useSession }: PropsRuntime<'conversation.view'>) {
      const openState = useSession(value => value.openState)
      return <output data-session={sessionId} data-open={openState} />
    }
    runtime.slots.register({ name: 'conversation.view', id: 'chat', label: 'History probe' }, HistoryProbe)
    const view = runtime.renderRoot()
    act(() => { runtime.sessions.list.update((draft) => { draft.phase = 'ready' }) })
    const background = view.container.querySelector<HTMLElement>('[data-dockkit-pane]:not([data-dockkit-pane-active])')!
    const probe = await within(background).findByRole('status')
    expect(probe.getAttribute('data-session')).toBe(second)
    expect(probe.getAttribute('data-open')).toBe('loading')
    expect(opened).toHaveBeenCalledOnce()

    history.resolve(undefined)
    await runtime.sessions.updateSessionSnapshot(second, (draft) => { draft.openState = 'open' })
    expect(probe.getAttribute('data-open')).toBe('open')
  })

  it('gives a split pane its own composer and releases its Session when its tab closes', async () => {
    localStorage.setItem(MULTITASK_LAYOUT_KEY, JSON.stringify({
      root: { axis: 'row', sizes: [0.5, 0.5], children: [{ tabs: [SID], active: 0 }, { tabs: ['second'], active: 0 }] },
      active: 0,
    }))
    const runtime = await bench({ listPending: true })
    const view = runtime.renderRoot()
    const second = await runtime.sessions.add({ id: 'second', summary: { displayTitle: 'Second chat' } })
    act(() => { runtime.sessions.list.update((draft) => { draft.phase = 'ready' }) })
    const panes = () => [...view.container.querySelectorAll('[data-conversation-session]')]
    expect(panes().map(pane => pane.getAttribute('data-conversation-session'))).toEqual([SID, second])
    expect(view.container.querySelectorAll('[data-composer-input]')).toHaveLength(2)
    const strips = view.getAllByRole('tablist', { name: '对话标签页' })
    fireEvent.click(within(strips[1]!).getByRole('button', { name: '关闭对话标签页' }))
    expect(panes().map(pane => pane.getAttribute('data-conversation-session'))).toEqual([SID])
    expect(runtime.sessions.retainInfo(second).getSnapshot().referenceCount).toBe(0)
    await runtime.dispose()
  })

  it('waits for the catalog before acquiring a restored pane', async () => {
    localStorage.setItem(MULTITASK_LAYOUT_KEY, JSON.stringify({
      root: { axis: 'row', sizes: [0.6, 0.4], children: [{ tabs: [SID], active: 0 }, { tabs: ['restored'], active: 0 }] },
      active: 0,
    }))
    const runtime = await bench({ listPending: true })
    const view = runtime.renderRoot()
    expect(view.container.querySelector('[data-slot-error="main"]')).toBeNull()
    expect(view.container.querySelectorAll('[data-composer-input]')).toHaveLength(1)
    const second = await runtime.sessions.add({ id: 'restored' })
    act(() => { runtime.sessions.list.update((draft) => { draft.phase = 'ready' }) })
    expect(view.container.querySelectorAll('[data-composer-input]')).toHaveLength(2)
    expect(runtime.sessions.retainInfo(second).getSnapshot().referenceCount).toBe(1)
    await runtime.dispose()
  })
})

describe('prompt rejection through the assembled composer', () => {
  it('renders the promptError alert strip and keeps the draft in the machine', async () => {
    const runtime = await SlotTestRuntime.create()
    const { openSession } = provideWorkspaceNavigation(runtime)
    runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
    await runtime.mount({ inject: [...injectMenus], apply: applyMenus })
    const prompt = vi.fn<ISession['prompt']>(async () => ({
      ok: false,
      error: new RemoteError('session/agent-busy', 'prompt rejected before acceptance', { reason: 'busy' }),
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
      session: { prompt, loadOlder: vi.fn<ISession['loadOlder']>() },
    })
    openSession(SID)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    const composer = view.container.querySelector<HTMLDivElement>('[data-composer-input]')!
    // Write through the assembled input resolver (contenteditable change
    // events carry no value; the resolver is the public draft write path).
    const conversation = runtime.ctx.get('conversation') as { input: unknown }
    const shell = (conversation.input as InputHub).shell(SID)
    act(() => { shell.setDraft('do not lose this') })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })

    await runtime.sessions.updateSessionSnapshot(SID, (draft) => {
      draft.promptError = {
        op: 'send',
        error: new RemoteError('session/agent-busy', 'prompt rejected before acceptance', { reason: 'busy' }),
      }
    })
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('prompt rejected before acceptance (session/agent-busy)')
    await waitFor(() => {
      expect(shell.snapshot.draft).toBe('do not lose this')
    })
    await runtime.dispose()
  })
})

describe('title projection across assembled surfaces', () => {
  it('one summary update re-labels the current-session crumb', async () => {
    const runtime = await bench()
    const view = runtime.renderRoot()
    const hierarchy = view.getByRole('navigation', { name: '会话层级' })
    expect(within(hierarchy).getByText('S').tagName).toBe('SPAN')

    await runtime.sessions.updateSummary(SID, { displayTitle: '修订标题', title: '修订标题' })
    await waitFor(() => {
      expect(within(hierarchy).getByText('修订标题').tagName).toBe('SPAN')
    })
    expect(within(hierarchy).queryByText('S')).toBeNull()
    await runtime.dispose()
  })
})
