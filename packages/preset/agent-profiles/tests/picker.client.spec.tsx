// @vitest-environment jsdom
/** The agent picker groups usable profiles and stages a choice for the hero's draft creation. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { en as common } from '@janhq/jan-client-locale/src/locales/en.ts'
import { en as conversation } from '@janhq/jan-client-ui-conversation/src/client/locales.ts'
import { ConversationContent } from '@janhq/jan-client-ui-conversation/src/client/skeleton/ConversationContent.tsx'
import type { ConversationContentProps, ComposerBarOwnerProps } from '@janhq/jan-client-ui-conversation/src/client/contract/slots.ts'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import type { WorkspaceSnapshot } from '@janhq/jan-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@janhq/jan-client-ui-session/client'
import { allowAllAccess, contextMenuHook, makeTranslate } from '@janhq/jan-client-test-runtime'
import type { WorkspaceId } from '@janhq/jan-workspace/types'
import type { AgentProfileSummary } from '../src/types.ts'
import { AgentProfilePicker, type AgentProfilePickerProps } from '../src/client/AgentProfilePicker.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const workspaceId = 'project-a' as WorkspaceId
const workspace = {
  workspaceId, isDefault: true as const, path: '/project-a', title: 'Project A', sessionIds: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const workspaces: WorkspaceSnapshot = {
  phase: 'ready', state: 'idle', items: [workspace], archivedSessionIds: [], pinnedSessionIds: [], error: null,
}
const sessions: SessionListState = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }
const statuses: SessionStatusSnapshot = new Map()

function profile(id: string, overrides: Partial<AgentProfileSummary> = {}): AgentProfileSummary {
  return { id, description: '', use: 'all', scope: 'global', source: 'jan', path: `/agents/${id}.md`,
    writable: true, disallowedTools: [], warnings: [], ...overrides }
}

function unused(): never { throw new Error('Unexpected use of a fixture hook') }

function mount() {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const list = vi.fn<AgentProfilePickerProps['list']>(async () => ({ profiles: [
    profile('global-helper'),
    profile('project-reviewer', { scope: 'project', source: 'claude', writable: false,
      description: 'Reviews code', warnings: ['Unmapped key: memory'] }),
    profile('subagent-only', { use: 'subagent' }),
    profile('shadowed', { shadowedBy: '/project-a/.jan/agents/shadowed.md' }),
  ], problems: [] }))
  const select = vi.fn<AgentProfilePickerProps['select']>(async () => undefined)
  const manage = vi.fn<AgentProfilePickerProps['manage']>()
  const openDefaultDraft = vi.fn<NonNullable<ConversationContentProps['openDefaultDraft']>>(async () => {})
  const standard = {
    sessionId: undefined, useSession: () => undefined, useProjection: () => undefined,
    useSessions: <T,>(read: (state: SessionListState) => T) => read(sessions),
    useWorkspaces: <T,>(read: (state: WorkspaceSnapshot) => T) => read(workspaces),
    useSessionRetainInfo: () => undefined, useResource: unused, usePanelInfo: unused,
    useSessionStatus: <T,>(read: (state: SessionStatusSnapshot) => T) => read(statuses),
    useContextMenu: contextMenuHook(), ...allowAllAccess,
  }
  const renderSlot = ((name: string, owner: object, options?: { children?: React.ReactNode }) => {
    if (name === 'conversation.hero.agentProfile') return <AgentProfilePicker sessionId={undefined} useSessions={standard.useSessions} useProjection={standard.useProjection}
      {...owner as Pick<AgentProfilePickerProps, 'workspaceId' | 'pending' | 'onPick'>}
      list={list} select={select} manage={manage} watchChanges={() => () => {}} t={makeTranslate(en, common)} />
    if (name === 'conversation.composer.bar') {
      const props = owner as ComposerBarOwnerProps
      return <>{props.dockStart}<button type="button" onClick={() => { void props.onActivateDraft?.(() => 'hello') }}>Start draft</button></>
    }
    return options?.children ?? null
  }) as ConversationContentProps['renderSlot']
  render(<ConversationContent {...standard} variant="main" phase="hero" hero
    SessionProvider={({ children }) => children} useConversation={() => undefined}
    useInput={() => undefined} inputActions={undefined}
    useComposerBlock={read => read(undefined)} useHeroPlaceholder={read => read(undefined)}
    selectWorkspace={unused} openDefaultDraft={openDefaultDraft} pickSuggestion={unused}
    useFactorySlot={((_name: string, fallback: unknown) => fallback) as ConversationContentProps['useFactorySlot']}
    renderFactorySlot={unused} renderSlot={renderSlot}
    renderSlotChain={((_name, _owner, options) => options?.fallback) as ConversationContentProps['renderSlotChain']}
    t={makeTranslate(conversation, common)} />)
  return { list, select, manage, openDefaultDraft }
}

it('offers Jan, then project and global profiles, without hidden choices', async () => {
  const { list } = mount()
  expect(list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent: Jan' }))
  const reviewer = await screen.findByRole('menuitem', { name: /project-reviewer/ })
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem')).toEqual([
    within(menu).getByRole('menuitem', { name: 'Jan (no agent)' }), reviewer,
    within(menu).getByRole('menuitem', { name: 'global-helper' }),
    within(menu).getByRole('menuitem', { name: 'New agent' }),
    within(menu).getByRole('menuitem', { name: 'Manage agents…' }),
  ])
  expect(menu.textContent).toMatch(/Project agents.*project-reviewer.*Global agents.*global-helper/s)
  expect(within(reviewer).getByText('Claude')).toBeTruthy()
  expect(within(reviewer).getByText('Reviews code')).toBeTruthy()
  expect(within(reviewer).getByLabelText('Profile warnings: Unmapped key: memory')).toBeTruthy()
  expect(list).toHaveBeenCalledExactlyOnceWith({ workspaceId })
})

it('creates an agent straight from the picker, and manages without opening the editor', async () => {
  const { manage, select } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent: Jan' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New agent' }))
  expect(manage).toHaveBeenLastCalledWith('create')
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent: Jan' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage agents…' }))
  expect(manage).toHaveBeenLastCalledWith(undefined)
  expect(select).not.toHaveBeenCalled()
})

it('starts the draft with the pending selection, including explicit plain Jan', async () => {
  const { select, openDefaultDraft } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent: Jan' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /project-reviewer/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Start draft' }))
  expect(openDefaultDraft).toHaveBeenLastCalledWith(expect.any(Function), 'project-reviewer')
  expect(select).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Choose agent: project-reviewer' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Jan (no agent)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start draft' }))
  expect(openDefaultDraft).toHaveBeenLastCalledWith(expect.any(Function), null)
})
