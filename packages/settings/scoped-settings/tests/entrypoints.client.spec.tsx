// @vitest-environment jsdom
/** The configured project, chat and General Settings actions open the shared editor. */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { en as common } from '@janhq/jan-client-locale/src/locales/en.ts'
import { SlotTestRuntime } from '@janhq/jan-client-test-runtime'
import type { CommandContribution } from '@janhq/jan-client-ui-commands/client'
import type { MenuContribution } from '@janhq/jan-client-ui-context-menu/client'
import { SessionId } from '@janhq/jan-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScopeAddress, ScopedWriteRequest } from '../src/types.ts'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

vi.mock('@janhq/jan-scoped-settings/remote', () => ({ default: { package: '@janhq/jan-scoped-settings', descriptors: [] } }))
afterEach(cleanup)

it('opens the correct scope from each entry point and excludes federated chats and projects', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx, undefined, { languages: ['en'] })
    locale.register('common', { en: common })
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const unregisterProject = vi.fn(), unregisterChat = vi.fn(), unmountRemote = vi.fn(async () => {})
    const projectMenu = vi.fn<(entry: MenuContribution<'workspace'>) => () => void>(() => unregisterProject)
    const chatCommand = vi.fn<(entry: CommandContribution) => () => void>(() => unregisterChat)
    runtime.ctx.provide('contextMenus', { register: projectMenu } as never)
    runtime.ctx.provide('commandUi', { register: chatCommand } as never)
    const read = vi.fn(async (_address: ScopeAddress) => ({ ok: true as const, value: {} }))
    const write = vi.fn(async (_request: ScopedWriteRequest) => ({ ok: true as const, value: {} }))
    const toolCatalog = async () => ({ ok: true as const, value: { tools: ['bash'], mcpServers: [] } })
    const modelCatalog = vi.fn(async () => ({ ok: true as const, value: { groups: [] } }))
    const list = vi.fn(async () => ({ ok: true as const, value: { presets: [] } }))
    const mountRemote = vi.spyOn(runtime.remote, '$mount').mockImplementation(async () => {
      runtime.remote.provideNamespaces({ scopedSettings: { read, write, toolCatalog }, session: { modelCatalog }, agentPresets: { list } })
      return unmountRemote
    })
    await runtime.declare({
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    })
    const feature = await runtime.mount({ inject, apply: (ctx) => { ctx.effect(() => apply(ctx)) } })
    const general = runtime.renderSlot('settings.general.item', {}).view
    runtime.renderSlot('shell.overlay', {})
    expect(mountRemote).toHaveBeenCalledOnce()

    const menu = projectMenu.mock.calls[0]![0]
    expect(menu).toMatchObject({ target: 'workspace', order: 60 })
    const signal = new AbortController().signal
    const local = { workspaceId: 'project-c' as never, path: '/repo', displayTitle: 'Project C' }
    expect(await menu.resolve({ ...local, workspaceId: 'host~project-c' as never }, signal)).toEqual([])
    const actions = await menu.resolve(local, signal)
    expect(actions[0]?.label).toBe(en['project.settings'])
    await act(async () => { await actions[0]?.run?.() })
    const project = await screen.findByRole('dialog', { name: 'Settings for Project C' })
    expect(within(project).getByRole('button', { name: en['model.label'] })).toBeTruthy()
    expect(read).toHaveBeenLastCalledWith({ scope: 'project', id: 'project-c' })
    expect(modelCatalog).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    fireEvent.click(within(project).getByRole('button', { name: 'Close' }))

    const command = chatCommand.mock.calls[0]![0]
    const chat = { sessionId: SessionId('chat-a') }
    expect(command.name).toBe('tools')
    expect(command.available({ sessionId: SessionId('host~chat-a') })).toBe(false)
    expect(command.available(chat)).toBe(true)
    const ui = command.ui
    if (ui.kind !== 'action') throw new Error('/tools must open the editor without submitting a message')
    act(() => { ui.run(chat) })
    const session = await screen.findByRole('dialog', { name: en['session.title'] })
    expect(read).toHaveBeenLastCalledWith({ scope: 'session', id: 'chat-a' })
    fireEvent.click(within(session).getByRole('button', { name: 'Close' }))

    fireEvent.click(general.getByRole('button', { name: en['global.action'] }))
    const global = await screen.findByRole('dialog', { name: en['global.title'] })
    fireEvent.click(await within(global).findByRole('checkbox', { name: 'bash' }))
    fireEvent.click(within(global).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(read).toHaveBeenLastCalledWith({ scope: 'global' })
    expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'global', values: { toolsDisabled: ['bash'] } })
    expect(modelCatalog).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()

    await feature.dispose()
    expect(unregisterProject).toHaveBeenCalledOnce()
    expect(unregisterChat).toHaveBeenCalledOnce()
    expect(unmountRemote).toHaveBeenCalledOnce()
    expect(general.queryByRole('button', { name: en['global.action'] })).toBeNull()
  } finally {
    await runtime.dispose()
  }
})
