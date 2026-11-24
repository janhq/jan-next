// @vitest-environment jsdom
/** The scoped editor stages edits until Save and clears inherited fields explicitly. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { en as common } from '@janhq/jan-client-locale/src/locales/en.ts'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { ScopedSettingsDialog, type ScopedSettingsDialogProps } from '../src/client/ScopedSettingsDialog.tsx'
import { en } from '../src/client/locales.ts'

const catalog = { tools: ['bash', 'read_file'], mcpServers: ['notion'] }
const models = [{ id: 'anthropic', name: 'Anthropic', models: [{
  id: 'haiku', name: 'Haiku', reasoning: { efforts: [{ id: 'high', name: 'High' }] },
}] }]
const modes = [{ id: 'chat', name: 'Chat', isDefault: true }]
const t = makeTranslate(en, common)

afterEach(cleanup)

function open(overrides: Partial<ScopedSettingsDialogProps> = {}) {
  const write = vi.fn<ScopedSettingsDialogProps['write']>().mockResolvedValue(undefined)
  const close = vi.fn()
  render(<ScopedSettingsDialog scope="project" id="project-c" title="Project C" t={t} write={write} close={close} retry={vi.fn()}
    state={{ status: 'ready', values: {}, catalog, models, modes }} {...overrides} />)
  return { write, close, dialog: screen.getByRole('dialog') }
}

function choose(dialog: HTMLElement, label: string, name: string) {
  fireEvent.click(within(dialog).getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

it('saves the project model, reasoning effort, mode and disabled tools together', async () => {
  const { dialog, write, close } = open()
  choose(dialog, en['model.label'], 'Haiku (Anthropic)')
  choose(dialog, en['model.effort'], 'High')
  choose(dialog, en['mode.label'], 'Chat')
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'bash', checked: true }))
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'notion (MCP server)', checked: true }))
  expect(within(dialog).getByRole('checkbox', { name: 'read_file' })).toHaveProperty('checked', true)
  expect(write).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'project', id: 'project-c', values: {
    model: { provider: 'anthropic', model: 'haiku', reasoningEffort: 'high' }, mode: 'chat', toolsDisabled: ['bash', 'mcp:notion'],
  } })
})

it('writes null for both inherited project defaults and a cleared tool list', async () => {
  const { dialog, write, close } = open({ state: { status: 'ready', catalog, models, modes, values: {
    model: { provider: 'anthropic', model: 'haiku', reasoningEffort: 'high' }, mode: 'chat', toolsDisabled: ['bash'],
  } } })
  choose(dialog, en['model.label'], en['inherit.global'])
  choose(dialog, en['mode.label'], en['inherit.global'])
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'bash', checked: false }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'project', id: 'project-c', values: {
    model: null, mode: null, toolsDisabled: null,
  } })
})

it('shows only Tools for a chat and saves only the chat tool switches', async () => {
  const { dialog, write, close } = open({ scope: 'session', id: 'session-a' })
  expect(within(dialog).queryByRole('button', { name: en['model.label'] })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: en['mode.label'] })).toBeNull()
  expect(within(dialog).getByRole('group', { name: en['tools.label'] })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'read_file', checked: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'session', id: 'session-a', values: { toolsDisabled: ['read_file'] } })
})

it('keeps staged changes visible after a failed save', async () => {
  const write = vi.fn<ScopedSettingsDialogProps['write']>().mockRejectedValue(new Error('Host could not write'))
  const { dialog, close } = open({ write })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'bash', checked: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe(en['save.error'])
  expect(within(dialog).getByRole('checkbox', { name: 'bash' })).toHaveProperty('checked', false)
  expect(close).not.toHaveBeenCalled()
})
