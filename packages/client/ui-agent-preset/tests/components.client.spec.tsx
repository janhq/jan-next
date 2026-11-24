// @vitest-environment jsdom
/**
 * The two conversation-adjacent surfaces: the new-session chip naming the
 * next session's preset, and the composer chip of a started session. The
 * host's rule splits them: a started session switches only at a turn
 * boundary, from its next turn on.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@janhq/jan-client-test-runtime'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { SessionRetainInfo } from '@janhq/jan-api-session-controller/client'
import { SessionId } from '@janhq/jan-session/types'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetSeat } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetSeatProps } from '../src/client/AgentPresetSeat.tsx'
import type { AgentPresetModeAction } from '../src/client/index.ts'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import type { AgentPresetSeatState } from '../src/client/seat-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ROSTER_READY: AgentPresetSettingsState = {
  status: 'ready',
  error: null,
  options: [{ id: 'standard' }, { id: 'mine' }],
}

const SEAT_READY: AgentPresetSeatState = {
  current: 'standard',
  options: [
    { id: 'standard' },
    { id: 'mine' },
  ],
  busy: false,
  error: null,
  introduce: false,
}

const useSessionRetainInfo = <Selected,>(selector: (value: undefined) => Selected): Selected => selector(undefined)

/** The runtime's own `{name}` substitution, so a test reads the shown text. */
function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function renderSeat(
  state: Partial<AgentPresetSeatState> = {},
  select: () => Promise<string | undefined> = () => Promise.resolve(undefined),
  session?: { id: string; retainInfo: SessionRetainInfo | undefined },
  enabled = true,
  modeActions = createSnapshotStore([] as readonly AgentPresetModeAction[]),
) {
  const store = createSnapshotStore<AgentPresetSeatState>({ ...SEAT_READY, ...state })
  const developerTools = createSnapshotStore(enabled)
  const actions = {
    load: vi.fn(() => Promise.resolve()), select: vi.fn(select), introduced: vi.fn(),
    dismissRefusal: vi.fn((error: AgentPresetSeatState['error']) => {
      if (store.getSnapshot().error === error && error !== null && typeof error === 'object') {
        store.set({ ...store.getSnapshot(), error: error.reason })
      }
    }),
  }
  const props = {
    ...actions,
    sessionId: session === undefined ? undefined : SessionId(session.id),
    useModeActions: bindSnapshotSelector(modeActions),
    useDeveloperTools: bindSnapshotSelector(developerTools),
    useAgentPresetSeat: bindSnapshotSelector(store),
    useSessionRetainInfo: session === undefined
      ? useSessionRetainInfo
      : <Selected,>(selector: (value: SessionRetainInfo | undefined) => Selected) => selector(session.retainInfo),
    t: translate,
  } as AgentPresetSeatProps
  render(<AgentPresetSeat {...props} />)
  return { ...actions, developerTools, store }
}

function renderLabel(
  summary: { blank: boolean; running?: boolean; projectionValues?: { agentPreset?: string | null } } | undefined,
  roster: Partial<AgentPresetSettingsState> = {},
  modeActions = createSnapshotStore([] as readonly AgentPresetModeAction[]),
) {
  // The chip and the label read the same roster, metadata included.
  const store = createSnapshotStore<AgentPresetSettingsState>({
    ...ROSTER_READY, options: SEAT_READY.options, ...roster,
  })
  const sessions = createSnapshotStore({ byId: summary === undefined ? {} : { s1: summary } })
  const load = vi.fn(() => Promise.resolve())
  const select = vi.fn((_sessionId: string, _id: string) => Promise.resolve<string | undefined>(undefined))
  const props: AgentPresetLabelProps = {
    load,
    select,
    sessionId: 's1',
    useModeActions: bindSnapshotSelector(modeActions),
    useSessions: bindSnapshotSelector(sessions),
    useAgentPresets: bindSnapshotSelector(store),
    useDeveloperTools: bindSnapshotSelector(createSnapshotStore(true)),
    t: translate,
  } as never
  const view = render(<AgentPresetLabel {...props} />)
  return { load, select, view }
}

it('opens a contributed mode from both preset menus without selecting a capability preset', () => {
  const run = vi.fn()
  const modeActions = createSnapshotStore<readonly AgentPresetModeAction[]>([{
    id: 'persistent', name: () => 'Persistent mode', description: () => 'Continue in one chat', run,
  }])
  const seat = renderSeat({}, undefined, undefined, false, modeActions)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('menuitem', { name: /^Persistent mode/ }))
  expect(run).toHaveBeenLastCalledWith(undefined)
  expect(seat.select).not.toHaveBeenCalled()
  cleanup()

  const { select } = renderLabel({ blank: false, projectionValues: { agentPreset: 'standard' } }, {}, modeActions)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('menuitem', { name: /^Persistent mode/ }))
  expect(run).toHaveBeenLastCalledWith('s1')
  expect(select).not.toHaveBeenCalled()
})

it.each(['new session', 'started session'])('shows only user-facing modes in menu order for a %s', (surface) => {
  const options = [
    { id: 'chat', name: 'Chat mode', order: 0 },
    { id: 'standard', order: 1 },
    { id: 'cordis', order: 5 },
    ...['reviewer', 'scout', 'worker'].map(id => ({ id, showInModePicker: false })),
  ]
  const modeActions = createSnapshotStore<readonly AgentPresetModeAction[]>([{
    id: 'bots', order: 4, name: () => 'Bots mode', description: () => 'Create a bot', run: vi.fn(),
  }])
  if (surface === 'new session') renderSeat({ options }, undefined, undefined, false, modeActions)
  else renderLabel({ blank: false, projectionValues: { agentPreset: 'standard' } }, { options }, modeActions)

  fireEvent.click(screen.getByRole('button'))
  const modes = ['Chat mode', 'Code mode', 'Bots mode', 'Creator mode']
  expect(screen.getAllByRole('menuitem')).toEqual(modes.map(name => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })))
})

describe('the new-session chip', () => {
  it.each([false, true])('offers Code, Creator and custom presets with Developer tools %s', (enabled) => {
    const actions = renderSeat({
      options: [
        { id: 'standard' }, { id: 'ptc' }, { id: 'minimal' }, { id: 'cordis' }, { id: 'mine' },
      ],
    }, undefined, undefined, enabled)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('menuitem')).toHaveLength(enabled ? 5 : 3)
    expect(screen.getByRole('menuitem', { name: /^Code mode/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^mine/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Code Mode/ }) !== null).toBe(enabled)
    expect(screen.queryByRole('menuitem', { name: /^Minimal mode/ }) !== null).toBe(enabled)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Creator mode/ }))
    expect(actions.select).toHaveBeenCalledWith('cordis')
  })

  it('keeps a named custom preset that overrides a development preset id', () => {
    renderSeat({ options: [{ id: 'ptc', name: 'My workflow' }] }, undefined, undefined, false)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: /^My workflow/ })).toBeTruthy()
  })

  it('keeps the current mode visible without opening a picker when all options are hidden', () => {
    const actions = renderSeat({ current: 'minimal', options: [{ id: 'ptc' }, { id: 'minimal' }] }, undefined, undefined, false)
    const trigger = screen.getByRole<HTMLButtonElement>('button', { name: en.presetMinimalName })
    expect(trigger.disabled).toBe(true)
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(actions.select).not.toHaveBeenCalled()
  })

  it('closes a picker when its last visible option disappears and keeps it closed when options return', () => {
    const options = [{ id: 'minimal' }, { id: 'mine' }]
    const actions = renderSeat({ current: 'minimal', options }, undefined, undefined, false)
    const trigger = screen.getByRole<HTMLButtonElement>('button', { name: en.presetMinimalName })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: /^mine/ })).toBeTruthy()
    act(() => { actions.store.set({ ...actions.store.getSnapshot(), options: [{ id: 'ptc' }, { id: 'minimal' }] }) })
    expect(trigger.disabled).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => { actions.store.set({ ...actions.store.getSnapshot(), options }) })
    expect(trigger.disabled).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(actions.select).not.toHaveBeenCalled()
  })

  it('renders only for a Session retained by the main view', () => {
    renderSeat({}, undefined, {
      id: 's1', retainInfo: { referenceCount: 1, retainedBy: { mainView: 1 } },
    })
    expect(screen.getByRole('button')).toBeTruthy()
    cleanup()

    renderSeat({}, undefined, { id: 's1', retainInfo: undefined })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads the roster once and shows the staged preset by name', async () => {
    const actions = renderSeat()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button').textContent).toContain(en.presetStandardName)
    expect(screen.getByRole('button').getAttribute('title')).toBe(en.seatHint)
  })

  it('offers each preset with what it is for', () => {
    renderSeat()

    fireEvent.click(screen.getByRole('button'))

    // The id alone never said what a preset does; the description is the
    // whole reason a preset can publish metadata at all.
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    // A preset that published none still reads as a row, with its id standing
    // in for the name.
    expect(screen.getByText(en.noDescription)).toBeTruthy()
    expect(screen.getByText('mine')).toBeTruthy()
  })

  it('closes the picker immediately when developer tools turn off without changing the staged preset', () => {
    const actions = renderSeat()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    act(() => { actions.developerTools.set(false) })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en.presetStandardDescription)).toBeNull()
    expect(actions.select).not.toHaveBeenCalled()
    act(() => { actions.developerTools.set(true) })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button').textContent).toContain(en.presetStandardName)
  })

  it('falls back to the id when the staged preset published no name', () => {
    renderSeat({ current: 'mine' })

    expect(screen.getByRole('button').textContent).toContain('mine')
  })

  it('shows the staged id until a stale roster contains it', () => {
    renderSeat({ current: 'arriving' })

    expect(screen.getByRole('button').textContent).toContain('arriving')
  })

  it('stages the picked preset and closes the menu', () => {
    const actions = renderSeat()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getByText('mine'))

    expect(actions.select).toHaveBeenCalledWith('mine')
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('disables the trigger while a switch is in flight', () => {
    renderSeat({ busy: true })

    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })

  it('shows a refused switch on the trigger', () => {
    renderSeat({ error: 'session has already started' })

    expect(screen.getByRole('button').getAttribute('title')).toBe('session has already started')
  })

  it('renders nothing before the roster arrives or when there is none', () => {
    const empty = renderSeat({ options: [] })
    expect(empty).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    renderSeat({ current: '' })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('closes on an outside dismissal', () => {
    renderSeat()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('a refused switch', () => {
  it('announces delayed and repeated refusals even without a composed preset or Coding Tools', () => {
    // The banner's own timer has to be a fake one from the start, or the
    // lifetime assertion below would wait out its real nine seconds.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const reason = 'failed to import loader entry live-on-mac (@janhq/jan-also-gone)'
      const actions = renderSeat({ current: '' }, undefined, undefined, false)
      const refusal = { preset: { id: 'cordis' }, reason }
      act(() => { actions.store.set({ ...actions.store.getSnapshot(), error: refusal }) })

      // The host refuses a mount discovery reported healthy, so this banner is
      // the only place the cause appears — the chip has already reverted and
      // the settings row shows the preset as fine.
      const banner = screen.getByRole('alert')
      expect(banner.textContent).toContain(reason)
      expect(banner.textContent).toContain(en.presetCordisName)
      expect(screen.queryByRole('button', { expanded: false })).toBeNull()

      act(() => { vi.advanceTimersByTime(7000) })
      act(() => { actions.store.set({ ...actions.store.getSnapshot(), error: { ...refusal } }) })
      act(() => { vi.advanceTimersByTime(2001) })
      expect(screen.getByRole('alert').textContent).toContain(reason)

      // Transient by design: it holds long enough to read a cause that names
      // packages, then leaves rather than sitting over the screen.
      act(() => { vi.advanceTimersByTime(9001) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(actions.dismissRefusal).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing when the switch lands', async () => {
    const actions = renderSeat()

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /mine/ }))

    await waitFor(() => { expect(actions.select).toHaveBeenCalledWith('mine') })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the chip introduce cue', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Character spans carry inline animation delays; nothing else does. */
  function delayedChars(): HTMLElement[] {
    return Array.from(screen.getByRole('button').querySelectorAll<HTMLElement>('[style]'))
  }

  it('reveals a long Latin name inside the shared window, then acknowledges', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', name: 'CreatorMode' }],
      introduce: true,
    })

    // Eleven characters split the 200ms window into 20ms steps, where the
    // fixed 40ms tick would have doubled the run for a Latin name.
    const chars = delayedChars()
    expect(chars.map(span => span.textContent).join('')).toBe('CreatorMode')
    expect(chars[0]!.style.animationDelay).toBe('150ms')
    expect(chars[1]!.style.animationDelay).toBe('170ms')
    expect(chars[10]!.style.animationDelay).toBe('350ms')

    // 150 delay + 200 window + 400 fade: acknowledged only once the last
    // character has settled, and the label is plain text again after.
    act(() => { vi.advanceTimersByTime(749) })
    expect(actions.introduced).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })

  it('keeps the per-tick cap for a short CJK name', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    renderSeat({
      current: 'creator',
      options: [{ id: 'creator', name: '创造模式' }],
      introduce: true,
    })

    // Four characters fit under the window, so the 40ms tick applies as-is.
    const chars = delayedChars()
    expect(chars).toHaveLength(4)
    expect(chars[1]!.style.animationDelay).toBe('190ms')
    expect(chars[3]!.style.animationDelay).toBe('270ms')
  })

  it('starts a one-character name with no stagger at all', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.useFakeTimers()
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', name: 'C' }],
      introduce: true,
    })

    expect(delayedChars()[0]!.style.animationDelay).toBe('150ms')
    act(() => { vi.advanceTimersByTime(550) })
    expect(actions.introduced).toHaveBeenCalledTimes(1)
  })

  it('skips the run under reduced motion and acknowledges at once', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const actions = renderSeat({ introduce: true })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })

  it('acknowledges an empty staged name without arming a run', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const actions = renderSeat({
      current: 'creator',
      options: [{ id: 'creator', name: '' }],
      introduce: true,
    })

    expect(actions.introduced).toHaveBeenCalledTimes(1)
    expect(delayedChars()).toHaveLength(0)
  })
})

describe('the composer preset chip of a started session', () => {
  it('names the preset the session runs and switches its next turn from the menu', async () => {
    const { load, select } = renderLabel({
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    })

    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    const control = screen.getByRole('button', { name: `${en.headerHint}: ${en.presetStandardName}` })
    expect(control.textContent).toBe(en.presetStandardName)
    fireEvent.click(control)
    fireEvent.click(screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('mine'))!)
    await waitFor(() => { expect(select).toHaveBeenCalledExactlyOnceWith('s1', 'mine') })
  })

  it('sends an explicit selection of the current preset', async () => {
    const { select } = renderLabel({ blank: true, projectionValues: { agentPreset: 'standard' } })
    fireEvent.click(screen.getByRole('button', { name: `${en.headerHint}: ${en.presetStandardName}` }))
    fireEvent.click(screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith(en.presetStandardName))!)
    await waitFor(() => { expect(select).toHaveBeenCalledExactlyOnceWith('s1', 'standard') })
  })

  it('shows a refusal toast when the injected selection rejects', async () => {
    const { select } = renderLabel({ blank: false, projectionValues: { agentPreset: 'standard' } })
    select.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(screen.getByRole('button', { name: `${en.headerHint}: ${en.presetStandardName}` }))
    fireEvent.click(screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('mine'))!)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('connection lost') })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: `${en.headerHint}: ${en.presetStandardName}` }).disabled).toBe(false)
  })

  it('disables the switch while a reply is running', () => {
    renderLabel({ blank: false, running: true, projectionValues: { agentPreset: 'standard' } })

    const control = screen.getByRole<HTMLButtonElement>('button', { name: `${en.switchBusy}: ${en.presetStandardName}` })
    expect(control.disabled).toBe(true)
  })

  it('falls back to the id when metadata is absent', () => {
    renderLabel({ blank: true, projectionValues: { agentPreset: 'mine' } })

    expect(screen.getByRole('button', { name: `${en.headerHint}: mine` }).textContent).toBe('mine')
  })

  it('shows the id until the roster resolves it', () => {
    renderLabel({
      blank: false,
      projectionValues: { agentPreset: 'standard' },
    }, { options: [] })

    // The session's own summary is the authority on which preset it runs; the
    // roster only supplies the display name, and its arrival is a later frame.
    expect(screen.getByRole('button', { name: `${en.headerHint}: standard` }).textContent).toBe('standard')
  })

  it('renders nothing, and reads no roster, when the session records no preset', async () => {
    const absent = renderLabel({ blank: true })
    expect(absent.view.container.firstChild).toBeNull()
    cleanup()

    // A session the list has not caught up to is the same answer: a deployment
    // that composes no presets must not pay for a roster read per header.
    const unknown = renderLabel(undefined)
    expect(unknown.view.container.firstChild).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(absent.load).not.toHaveBeenCalled()
    expect(unknown.load).not.toHaveBeenCalled()
  })
})
