// @vitest-environment jsdom
/** The scoped editor stages edits until Save and clears inherited fields explicitly. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { en as common } from '@janhq/jan-client-locale/src/locales/en.ts'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { ScopedSettingsDialog, type ScopedSettingsDialogProps } from '../src/client/ScopedSettingsDialog.tsx'
import { en } from '../src/client/locales.ts'
import type { ScopedSkillCatalog } from '../src/types.ts'

const catalog = { tools: ['bash', 'read_file'], mcpServers: ['notion'] }
const skillCatalog: ScopedSkillCatalog = { folders: [
  { path: '/repo/skills', label: '/repo/skills', off: false, skills: [
    { name: 'summarize', description: 'Summarize a document.', off: false },
    { name: 'extract', description: 'Extract details from a document.', off: false },
  ] },
  { path: '/repo/shared', label: '/repo/shared', off: false, skills: [
    { name: 'format', description: 'Format a document.', off: false },
  ] },
  { path: null, label: null, off: false, skills: [{ name: 'outline', description: 'Outline a document.', off: false }] },
] }
const models = [{ id: 'anthropic', name: 'Anthropic', models: [{
  id: 'haiku', name: 'Haiku', reasoning: { efforts: [{ id: 'high', name: 'High' }] },
}] }]
const modes = [{ id: 'chat', name: 'Chat', isDefault: true }]
const t = makeTranslate(en, common)

afterEach(cleanup)

function open({ scope = 'project', id = scope === 'project' ? 'project-c' : undefined, ...overrides }: Partial<ScopedSettingsDialogProps> = {}) {
  const write = vi.fn<ScopedSettingsDialogProps['write']>().mockResolvedValue(undefined)
  const close = vi.fn()
  render(<ScopedSettingsDialog scope={scope} {...id === undefined ? {} : { id }} title="Project C" t={t} write={write} close={close}
    retry={vi.fn()}
    presetName={preset => preset.name ?? preset.id}
    state={{ status: 'ready', values: {}, catalog, skillCatalog, models, modes, agents: [], codingTools: false }} {...overrides} />)
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

it('writes null for cleared project defaults and tool switches', async () => {
  const { dialog, write, close } = open({ state: { status: 'ready', catalog, skillCatalog, models, modes, agents: ['reviewer'], codingTools: false, values: {
    model: { provider: 'anthropic', model: 'haiku', reasoningEffort: 'high' }, mode: 'chat', agent: 'reviewer', toolsDisabled: ['bash'],
  } } })
  choose(dialog, en['model.label'], en['inherit.global'])
  choose(dialog, en['mode.label'], en['inherit.global'])
  choose(dialog, en['agent.label'], en['agent.none'])
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'bash', checked: false }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'project', id: 'project-c', values: {
    model: null, mode: null, agent: null, toolsDisabled: null,
  } })
})

it('offers the Coding Tools presets only with that preference, as the composer does', () => {
  const roster = [...modes, { id: 'ptc', isDefault: false }, { id: 'hidden', name: 'Hidden', isDefault: false, showInModePicker: false }]
  const offered = (codingTools: boolean) => {
    const { dialog } = open({ state: { status: 'ready', values: { mode: 'ptc' }, catalog, skillCatalog, models, modes: roster, agents: [], codingTools } })
    const picker = within(dialog).getByRole('button', { name: en['mode.label'] })
    const label = picker.textContent
    fireEvent.click(picker)
    const items = screen.getAllByRole('menuitem').map(item => item.textContent)
    cleanup()
    return { label, items }
  }
  const hidden = offered(false)
  expect(hidden.label).toContain('ptc')
  expect(hidden.items).toEqual([en['inherit.global'], 'Chat'])
  expect(offered(true).items).toEqual([en['inherit.global'], 'Chat', 'ptc'])
})

it('shows Tools and Skills for a chat and leaves untouched skill switches out of the write', async () => {
  const { dialog, write, close } = open({ scope: 'session', id: 'session-a' })
  expect(within(dialog).queryByRole('button', { name: en['model.label'] })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: en['mode.label'] })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: en['agent.label'] })).toBeNull()
  expect(within(dialog).getByRole('group', { name: en['tools.label'] })).toBeTruthy()
  expect(within(dialog).getByRole('group', { name: 'Skills' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'read_file', checked: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'session', id: 'session-a', values: { toolsDisabled: ['read_file'] } })
})

it('stages skill and folder switches and saves sorted lists in the same write', async () => {
  const { dialog, write, close } = open()
  const skills = within(within(dialog).getByRole('group', { name: 'Skills' }))
  expect(skills.queryByRole('checkbox', { name: 'summarize' })).toBeNull()
  expect(skills.queryByRole('checkbox', { name: 'Built in' })).toBeNull()
  const expand = skills.getByRole('button', { name: 'Skills in /repo/skills', expanded: false })
  expect(expand.textContent).toContain('2 of 2')
  fireEvent.click(expand)
  expect(skills.getByText('Summarize a document.')).toBeTruthy()
  fireEvent.click(skills.getByRole('checkbox', { name: 'summarize', checked: true }))
  expect(expand.textContent).toContain('1 of 2')
  fireEvent.click(skills.getByRole('checkbox', { name: 'extract', checked: true }))
  fireEvent.click(skills.getByRole('checkbox', { name: '/repo/skills', checked: true }))
  expect(skills.getByRole('checkbox', { name: 'extract', checked: false })).toHaveProperty('disabled', true)
  fireEvent.click(skills.getByRole('checkbox', { name: '/repo/shared', checked: true }))
  fireEvent.click(expand)
  expect(skills.queryByRole('checkbox', { name: 'extract' })).toBeNull()
  expect(write).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'project', id: 'project-c', values: {
    model: null, mode: null, toolsDisabled: null, skillsDisabled: ['extract', 'summarize'],
    skillFoldersDisabled: ['/repo/shared', '/repo/skills'],
  } })
})

it('shows why inherited folders and skills cannot be turned on for this chat', () => {
  const inherited: ScopedSkillCatalog = { folders: [
    { path: '/repo/shared', label: '/repo/shared', off: false, offAt: 'global', skills: [
      { name: 'format', description: 'Format a document.', off: false },
    ] },
    { path: null, label: null, off: false, skills: [
      { name: 'outline', description: 'Outline a document.', off: false, offAt: 'project' },
    ] },
  ] }
  const { dialog } = open({ scope: 'session', id: 'session-a',
    state: { status: 'ready', values: {}, catalog, models, modes, agents: [], codingTools: false, skillCatalog: inherited } })
  const skills = within(within(dialog).getByRole('group', { name: 'Skills' }))
  const folder = skills.getByRole('checkbox', { name: '/repo/shared', checked: false })
  expect(folder).toHaveProperty('disabled', true)
  expect(folder.closest('label')?.title).toBe('Off for every chat')
  fireEvent.click(skills.getByRole('button', { name: 'Skills in /repo/shared' }))
  expect(skills.getByRole('checkbox', { name: 'format', checked: false })).toHaveProperty('disabled', true)
  fireEvent.click(skills.getByRole('button', { name: 'Skills in Built in' }))
  const skill = skills.getByRole('checkbox', { name: 'outline', checked: false })
  expect(skill).toHaveProperty('disabled', true)
  expect(skill.closest('label')?.title).toBe('Off for this project')
})

it('removes stored skill switches when their last entries are turned back on', async () => {
  const disabled: ScopedSkillCatalog = { folders: [
    { path: '/repo/skills', label: '/repo/skills', off: true, skills: [
      { name: 'summarize', description: 'Summarize a document.', off: true },
    ] },
  ] }
  const { dialog, write, close } = open({ scope: 'global',
    state: { status: 'ready', catalog, models, modes, agents: [], codingTools: false, skillCatalog: disabled,
      values: { skillsDisabled: ['summarize'], skillFoldersDisabled: ['/repo/skills'] } } })
  const skills = within(within(dialog).getByRole('group', { name: 'Skills' }))
  fireEvent.click(skills.getByRole('checkbox', { name: '/repo/skills', checked: false }))
  fireEvent.click(skills.getByRole('button', { name: 'Skills in /repo/skills' }))
  fireEvent.click(skills.getByRole('checkbox', { name: 'summarize', checked: false }))
  fireEvent.click(within(dialog).getByRole('button', { name: common.save }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(write).toHaveBeenCalledExactlyOnceWith({ scope: 'global', values: {
    toolsDisabled: null, skillsDisabled: null, skillFoldersDisabled: null,
  } })
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
