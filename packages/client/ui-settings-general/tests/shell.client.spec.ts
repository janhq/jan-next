// @vitest-environment jsdom
/**
 * Settings shell registration inside the assembled web client: the shell
 * occupies the `sidebar.settings` hole ui-sidebar declares, its ledger
 * projections read the product's real sections, its connection control is the
 * roster's Connection, and it survives a Loader rebuild of the declarer.
 */
import { describe, expect, onTestFinished, vi } from 'vitest'
import type {} from '@janhq/jan-client-ui-renderer/client'
import { createClientTest, type TestClient, webApp } from '@janhq/jan-client-test-runtime/src/assembly/index.ts'
import { inject } from '../src/client/index.ts'
import type { SettingsRootInjected } from '../src/client/shell-contract.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import type { DesktopUpdatePresentation } from '../src/types.ts'
import { act, fireEvent, screen } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@janhq/jan-client-test-runtime'
import { en, fr } from '../src/client/locales.ts'
import { ok } from '@janhq/jan-remote-mock'
import { LocaleSettingsSchema } from '@janhq/jan-client-locale/src/locale-settings.ts'
import type { SettingsNamespaceView } from '@janhq/jan-settings/types'

const SELF = '@janhq/jan-client-ui-settings-general'
const SIDEBAR = '@janhq/jan-client-ui-sidebar'
const it = createClientTest({ roster: webApp })
const mounted = createClientTest({ roster: webApp.without(['@janhq/jan-client-ui-settings-models']) }, { mount: true })
usePinnedBrowserLanguages('en-US')
const withoutSettingsAccess = createClientTest({ roster: webApp }, { access: action => action !== 'settings/describe' })
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000

function injectedOf(c: TestClient): SettingsRootInjected {
  const entry = c.ctx.slots.entries('sidebar.settings')[0]!
  return (entry.inject as () => SettingsRootInjected)()
}

/** The shell's child declarations (chrome, actions, sections, and onboarding overlays). */
const CHILD_SPECS = {
  'settings.launcher': { kind: 'single', scope: 'root' },
  'settings.trigger': { kind: 'single', scope: 'root' },
  'settings.header': { kind: 'single', scope: 'root' },
  'settings.action': { kind: 'list', scope: 'root' },
  'settings.close': { kind: 'single', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'settings.section.icon': { kind: 'list', scope: 'root', inline: true },
  'settings.onboarding': { kind: 'list', scope: 'root' },
} as const
const CHILD_NAMES = Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>

/**
 * Section ids the web-app roster registers, in nav order: this package, then
 * ui-settings-models, ui-settings-plugins, and ui-agent-preset. A plugin
 * adding a section changes this list.
 */
const PRODUCT_SECTIONS: readonly string[] = ['general', 'models', 'plugins', 'agent-presets']
/** Onboarding steps the web-app roster registers, in coordinator order; both come from ui-settings-models. */
const PRODUCT_ONBOARDING: readonly { id: string; order: number }[] = [
  { id: 'welcome-notice', order: -100 },
  { id: 'get-started', order: 0 },
]

describe('ui-settings-general shell', () => {
  it('shares one carrier subscription between both update locations and releases it on unload', async ({ start }) => {
    const initial = Promise.withResolvers<DesktopUpdatePresentation>()
    let publish: ((state: DesktopUpdatePresentation) => void) | undefined
    const off = vi.fn()
    const subscribe = vi.fn((listener: typeof publish) => { publish = listener; return off })
    const open = vi.fn(async () => {})
    vi.stubGlobal('janDesktop', { protocolVersion: 1, updates: { status: () => initial.promise, subscribe, open } })
    onTestFinished(() => { vi.unstubAllGlobals(); initial.resolve({ phase: 'idle' }) })
    const c = await start()
    const row = injectedOf(c)
    const badge = (c.ctx.slots.entries('sidebar.toggle.badge')[0]!.inject as () => Pick<SettingsRootInjected, 'hooks'>)()
    expect(badge.hooks.desktopUpdate).toBe(row.hooks.desktopUpdate)
    expect(subscribe).toHaveBeenCalledOnce()
    const status = { phase: 'available' as const, version: '1.0.1' }
    publish!(status)
    expect(row.hooks.desktopUpdate.getSnapshot().presentation).toEqual(status)
    row.openDesktopUpdate()
    await c.flush()
    expect(open).toHaveBeenCalledOnce()
    await c.unload(SELF)
    await c.flush()
    expect(off).toHaveBeenCalledOnce()
    expect(c.ctx.slots.entries('sidebar.toggle.badge')).toHaveLength(0)
    publish!({ phase: 'error', version: status.version, failure: 'install' })
    expect(row.hooks.desktopUpdate.getSnapshot().presentation).toEqual(status)
  }, COLD_BOOT_TIMEOUT_MS)

  it('declares its services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.settings', 'configForms', 'shortcuts', 'modules', 'remoteAccess'])
  })

  it('occupies sidebar.settings, declared by ui-sidebar, and declares every child slot', async ({ start }) => {
    const c = await start()
    expect(c.ctx.slots.entries('sidebar.settings').map(entry => entry.component)).toEqual([SettingsRoot])
    for (const name of CHILD_NAMES) expect(c.ctx.slots.spec(name)).toEqual(CHILD_SPECS[name])
  }, COLD_BOOT_TIMEOUT_MS)

  it('opens the registered Models section through the client navigation service', async ({ start }) => {
    const c = await start()
    const decl = c.ctx.slots.entries('sidebar.settings')[0]!.store!
    const instance = (typeof decl === 'function' ? decl() : decl).create()
    expect(c.ctx.settingsNavigation.availability.getSnapshot()).toBe(true)
    expect(instance.getSnapshot()).toMatchObject({ open: false })
    expect(c.ctx.settingsNavigation.open('models')).toBe(true)
    expect(instance.getSnapshot()).toMatchObject({ open: true, activeId: 'models' })
  }, COLD_BOOT_TIMEOUT_MS)

  withoutSettingsAccess('leaves sidebar.settings unoccupied while the current Peer may not read the settings description', async ({ start }) => {
    const c = await start()
    expect(c.ctx.slots.entries('sidebar.settings')).toEqual([])
    expect(c.ctx.settingsNavigation.availability.getSnapshot()).toBe(false)
    expect(c.ctx.settingsNavigation.open('models')).toBe(false)
  }, COLD_BOOT_TIMEOUT_MS)

  it('projects the section ledger: product sections in order, defaults for bare rows, stable snapshots', async ({ start }) => {
    const c = await start()
    const { sections } = injectedOf(c).hooks
    const product = sections.getSnapshot()
    expect(product.map(row => row.id)).toEqual(PRODUCT_SECTIONS)
    c.ctx.slots.register({ name: 'settings.section', id: 'z', order: 1_000, label: 'Z' } as never, () => null)
    // No order and no label: both projection defaults apply, and order 0 sorts among the product rows.
    c.ctx.slots.register({ name: 'settings.section', id: 'a' } as never, () => null)
    const rows = sections.getSnapshot()
    expect(rows.at(-1)).toEqual({ id: 'z', order: 1_000, label: 'Z' })
    expect(rows.find(row => row.id === 'a')).toEqual({ id: 'a', order: 0, label: '' })
    expect(rows.map(row => row.order)).toEqual([...rows.map(row => row.order)].sort((x, y) => x - y))
    // Snapshot identity is stable until the ledger moves (uSES contract).
    expect(sections.getSnapshot()).toBe(rows)
    const listener = vi.fn()
    const off = sections.subscribe(listener)
    c.ctx.slots.register({ name: 'settings.section', id: 'b', order: 1, label: 'B' } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalled()
    expect(sections.getSnapshot()).not.toBe(rows)
    off()
  })

  it('shares a stable localized catalog and rejects shadowed or retracted search targets', async ({ mock, start }) => {
    mock.remote.settings.mutate.mockResolvedValueOnce(ok({
      ns: 'locale', schema: JSON.parse(JSON.stringify(LocaleSettingsSchema.toJSON())) as SettingsNamespaceView['schema'], value: { preference: 'fr' },
      autoGenerate: true, applies: 'live', secrets: [], revision: 1,
    }))
    const c = await start()
    const navigation = c.ctx.settingsNavigation
    const { targets } = navigation
    expect(targets).toBe(injectedOf(c).hooks.searchTargets)
    const initial = targets.getSnapshot()
    expect(targets.getSnapshot()).toBe(initial)
    expect(initial.find(target => target.destination.kind === 'row' && target.destination.id === 'developer-tools')?.title)
      .toBe(en['developerTools.title'])
    const listener = vi.fn()
    const stop = targets.subscribe(listener)
    onTestFinished(stop)
    c.ctx.locale.setLocale('fr')
    expect(listener).toHaveBeenCalled()
    expect(targets.getSnapshot().find(target => target.destination.kind === 'row' && target.destination.id === 'developer-tools')?.title)
      .toBe(fr['developerTools.title'])

    const original = c.ctx.slots.register({ name: 'settings.section', id: 'external-page', priority: 1 }, () => null)
    const contribution = targets.getSnapshot().find(target => target.sectionId === 'external-page')!
    expect(contribution.title).toBe('External page')
    const override = c.ctx.slots.register({ name: 'settings.section', id: 'external-page', label: 'Extension', priority: 0 }, () => null)
    expect(targets.getSnapshot().filter(target => target.sectionId === 'external-page').map(target => target.title)).toEqual(['Extension'])
    expect(navigation.openTarget(contribution)).toBe(false)
    override()
    const restored = targets.getSnapshot().find(target => target.sectionId === 'external-page')!
    expect(navigation.openTarget(restored)).toBe(true)
    original()
    await Promise.resolve()
    expect(targets.getSnapshot().some(target => target.sectionId === 'external-page')).toBe(false)
    expect(navigation.openTarget(restored)).toBe(false)
  }, COLD_BOOT_TIMEOUT_MS)

  it('shows Account first only while signed in and removes it on sign-out', async ({ start }) => {
    const c = await start()
    const { sections } = injectedOf(c).hooks
    await c.mock.streams.opened('account/watch', 1)
    expect(sections.getSnapshot().map(row => row.id)).toEqual(PRODUCT_SECTIONS)
    c.mock.streams.push('account/watch', { status: 'credential-stored', attempt: null })
    await vi.waitFor(() => {
      expect(sections.getSnapshot().map(row => row.id)).toEqual(['account', ...PRODUCT_SECTIONS])
    })
    c.mock.streams.push('account/watch', { status: 'credential-stored', attempt: null })
    await vi.waitFor(() => { expect(sections.getSnapshot().filter(row => row.id === 'account')).toHaveLength(1) })
    c.mock.streams.push('account/watch', { status: 'signed-out', attempt: null })
    await vi.waitFor(() => { expect(sections.getSnapshot().map(row => row.id)).toEqual(PRODUCT_SECTIONS) })
  })

  it('projects the roster Connection control without copying its state; reconnect opens a new $events generation', async ({ start }) => {
    const c = await start()
    const injected = injectedOf(c)
    expect(injected.hooks.connectionState).toBe(c.connection.state)
    expect(injected.hooks.connectionState.getSnapshot()).toBe('connected')
    injected.reconnect()
    await c.mock.streams.opened('$events', 2)
    await vi.waitFor(() => { expect(c.connection.state.getSnapshot()).toBe('connected') })
  })

  it('projects onboarding entries into stable coordinator order', async ({ start }) => {
    const c = await start()
    const { onboardingSteps } = injectedOf(c).hooks
    expect(onboardingSteps.getSnapshot()).toEqual(PRODUCT_ONBOARDING)
    c.ctx.slots.register({ name: 'settings.onboarding', id: 'credential', order: 0 } as never, () => null)
    c.ctx.slots.register({ name: 'settings.onboarding', id: 'welcome', order: -100 } as never, () => null)
    c.ctx.slots.register({ name: 'settings.onboarding', id: 'default-order' } as never, () => null)
    const steps = onboardingSteps.getSnapshot()
    expect(steps.filter(step => !PRODUCT_ONBOARDING.some(known => known.id === step.id))).toEqual([
      { id: 'welcome', order: -100 },
      { id: 'credential', order: 0 },
      { id: 'default-order', order: 0 },
    ])
    expect(onboardingSteps.getSnapshot()).toBe(steps)
    const listener = vi.fn()
    const off = onboardingSteps.subscribe(listener)
    c.ctx.slots.register({ name: 'settings.onboarding', id: 'later', order: 10 } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    off()
  })

  it('re-registers after the declarer reloads: the cascade removes the shell, the rebuilt declaration takes it back', async ({ start }) => {
    const c = await start()
    const before = c.ctx.slots.entries('sidebar.settings')[0]
    expect(before).toBeDefined()
    await c.reload(SIDEBAR)
    await c.flush()
    expect(c.ctx.slots.entries('sidebar.settings').map(entry => entry.component)).toEqual([SettingsRoot])
    expect(c.ctx.slots.entries('sidebar.settings')[0]).not.toBe(before)
    for (const name of CHILD_NAMES) expect(c.ctx.slots.spec(name)).toEqual(CHILD_SPECS[name])
  })

  it('unregisters the shell and collapses every child slot when its row unloads', async ({ start }) => {
    const c = await start()
    await c.unload(SELF)
    await c.flush()
    expect(c.ctx.slots.entries('sidebar.settings')).toHaveLength(0)
    for (const name of CHILD_NAMES) expect(c.ctx.slots.spec(name)).toBeUndefined()
  })
})

mounted('searches live Cordis pages and owned General settings, with shortcuts scoped to the foreground dialog', async ({ start }) => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value() {} })
  onTestFinished(() => {
    if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    else Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor)
  })
  const c = await start()
  const contribution = c.ctx.plugin({
    name: 'search-test-settings', inject: ['slots'],
    apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'extension', label: 'Éxtension',
      }, () => 'Extension settings body'))
    },
  })
  await act(async () => { await contribution })
  const launcher = screen.getByRole('button', { name: 'Account menu' })
  const slash = { key: '/', code: 'Slash' }
  expect(fireEvent.keyDown(launcher, slash)).toBe(true)
  fireEvent.click(launcher)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  const search = screen.getByRole('combobox', { name: 'Search settings' })
  const general = screen.getByRole('button', { name: 'General' })
  expect(fireEvent.keyDown(general, { ...slash, repeat: true })).toBe(true)
  expect(fireEvent.keyDown(general, { ...slash, isComposing: true })).toBe(true)
  expect(fireEvent.keyDown(general, slash)).toBe(false)
  expect(document.activeElement).toBe(search)

  const editable = document.createElement('textarea')
  const terminal = document.createElement('div')
  terminal.className = 'xterm'
  const nested = document.createElement('div')
  nested.setAttribute('role', 'dialog')
  nested.setAttribute('aria-modal', 'true')
  settings.append(editable, terminal)
  for (const target of [editable, terminal]) expect(fireEvent.keyDown(target, slash)).toBe(true)
  document.body.append(nested)
  expect(fireEvent.keyDown(general, slash)).toBe(true)
  nested.remove()
  terminal.remove()
  editable.remove()
  const mac = c.ctx.shortcuts.platform === 'macos'
  general.focus()
  expect(fireEvent.keyDown(general, { key: 'f', code: 'KeyF', ctrlKey: !mac, metaKey: mac })).toBe(false)
  expect(document.activeElement).toBe(search)

  fireEvent.change(search, { target: { value: 'extension' } })
  fireEvent.click(screen.getByRole('option', { name: 'Éxtension' }))
  expect(screen.getByText('Extension settings body')).toBeTruthy()
  fireEvent.change(search, { target: { value: 'developer tools' } })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(document.activeElement?.textContent).toContain(en['developerTools.title'])
  expect(document.activeElement?.hasAttribute('data-settings-revealed')).toBe(true)

  fireEvent.change(search, { target: { value: 'extension' } })
  await act(async () => { await contribution.dispose() })
  expect(screen.queryByRole('option', { name: 'Éxtension' })).toBeNull()
  expect(screen.getByText('No settings found')).toBeTruthy()
}, COLD_BOOT_TIMEOUT_MS)
