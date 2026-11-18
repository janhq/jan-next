// @vitest-environment jsdom
/** Back / Forward commands: per-device defaults, the guards that pass the key through, and the mouse buttons. */
import { Context } from '@janhq/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import type { ShortcutCommand, ShortcutGesture, ShortcutPlatform } from '@janhq/jan-client-shortcuts/client'
import { ShortcutRegistry } from '../../shortcuts/src/client/registry.ts'
import { installNavigationShortcuts } from '../src/client/navigation-shortcuts.ts'
import type { NavigationAvailability } from '../src/client/history.ts'
import { en, zh } from '../src/client/locales.ts'

const page = { region: 'page', modal: null, target: null } as const
const key = (code: string, rest: Partial<ShortcutGesture> = {}): ShortcutGesture => ({
  code, control: false, alt: false, shift: false, meta: false, repeat: false,
  composing: false, defaultPrevented: false, ...rest,
})

async function bench(
  runtime: 'web' | 'desktop',
  platform: ShortcutPlatform,
  available: NavigationAvailability = { canGoBack: true, canGoForward: true },
) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const registry = new ShortcutRegistry(runtime, platform)
  const commands = new Map<string, ShortcutCommand>()
  ctx.provide('shortcuts', { register: (command: ShortcutCommand) => {
    commands.set(command.id, command)
    return registry.register(command)
  }, catalog: registry.catalog })
  const locale = new LocaleRuntime(ctx)
  locale.register('workspace', { en, zh })
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const navigation = {
    goBack: vi.fn(), goForward: vi.fn(), navigationHistory: createSnapshotStore(available),
  }
  const fiber = ctx.plugin((scoped) => { installNavigationShortcuts(scoped, navigation) })
  await fiber.await()
  return { registry, commands, navigation, fiber }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('navigation shortcut defaults', () => {
  it.each([
    ['desktop', 'windows', { alt: true }, 'ArrowLeft', 'ArrowRight'],
    ['desktop', 'macos', { meta: true }, 'BracketLeft', 'BracketRight'],
    ['desktop', 'linux', { alt: true }, 'ArrowLeft', 'ArrowRight'],
    ['web', 'macos', { meta: true, alt: true }, 'BracketLeft', 'BracketRight'],
    ['web', 'windows', { control: true, alt: true }, 'BracketLeft', 'BracketRight'],
  ] as const)('runs Back and Forward from the %s/%s binding', async (runtime, platform, modifiers, back, forward) => {
    const b = await bench(runtime, platform)
    const consume = vi.fn()
    expect(b.registry.dispatch(key(back, modifiers), page, consume).status).toBe('handled')
    expect(b.navigation.goBack).toHaveBeenCalledOnce()
    expect(b.registry.dispatch(key(forward, modifiers), page, consume).status).toBe('handled')
    expect(b.navigation.goForward).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledTimes(2)
  })

  it('registers both commands for every device without a conflict, leaving Web Linux unbound', async () => {
    for (const [runtime, platform] of [
      ['desktop', 'macos'], ['desktop', 'windows'], ['desktop', 'linux'],
      ['web', 'macos'], ['web', 'windows'], ['web', 'linux'],
    ] as const) {
      const b = await bench(runtime, platform)
      const rows = b.registry.catalog.getSnapshot()
      expect(rows.map(row => row.id)).toEqual(['navigation.back', 'navigation.forward'])
      expect(rows.map(row => row.label)).toEqual([en['navigation.back'], en['navigation.forward']])
      expect(rows.every(row => row.keys.length > 0)).toBe(runtime === 'desktop' || platform !== 'linux')
    }
  })

  it('shows Alt+Left on Windows Desktop, as Windows apps and Claude do', async () => {
    const b = await bench('desktop', 'windows')
    expect(b.registry.catalog.getSnapshot()[0]).toMatchObject({ keys: ['Alt', '+', '←'], aria: 'Alt+ArrowLeft' })
  })

  it('removes the commands with the plugin', async () => {
    const b = await bench('desktop', 'windows')
    await b.fiber.dispose()
    expect(b.registry.catalog.getSnapshot()).toEqual([])
  })
})

describe('navigation shortcut guards', () => {
  it.each([
    ['back', { canGoBack: false, canGoForward: true }, 'ArrowLeft'],
    ['forward', { canGoBack: true, canGoForward: false }, 'ArrowRight'],
  ] as const)('passes the key through while %s has no entry', async (_direction, available, code) => {
    const b = await bench('desktop', 'windows', available)
    const consume = vi.fn()
    expect(b.registry.dispatch(key(code, { alt: true }), page, consume)).toEqual({ status: 'pass' })
    expect(consume).not.toHaveBeenCalled()
    expect(b.navigation.goBack).not.toHaveBeenCalled()
    expect(b.navigation.goForward).not.toHaveBeenCalled()
  })

  it('leaves the key to a terminal', async () => {
    const b = await bench('desktop', 'windows')
    expect(b.registry.dispatch(key('ArrowLeft', { alt: true }), { ...page, region: 'terminal' }, vi.fn())).toEqual({ status: 'pass' })
    expect(b.navigation.goBack).not.toHaveBeenCalled()
  })

  it('leaves the key to a code editor, where it moves the caret', async () => {
    const b = await bench('desktop', 'windows')
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    editor.append(content)
    document.body.append(editor)
    const inEditor = { region: 'editable', modal: null, target: content } as const
    expect(b.registry.dispatch(key('ArrowLeft', { alt: true }), inEditor, vi.fn())).toEqual({ status: 'pass' })
    expect(b.navigation.goBack).not.toHaveBeenCalled()
  })

  it('still navigates from the chat input', async () => {
    const b = await bench('desktop', 'windows')
    const input = document.createElement('textarea')
    document.body.append(input)
    const typing = { region: 'editable', modal: null, target: input } as const
    expect(b.registry.dispatch(key('ArrowLeft', { alt: true }), typing, vi.fn()).status).toBe('handled')
    expect(b.navigation.goBack).toHaveBeenCalledOnce()
  })

  it('works from the navigation drawer and not behind another dialog on Web', async () => {
    const b = await bench('web', 'windows')
    const gesture = key('BracketLeft', { control: true, alt: true })
    expect(b.registry.dispatch(gesture, { ...page, modal: 'sidebar' }, vi.fn()).status).toBe('handled')
    expect(b.registry.dispatch(gesture, { ...page, modal: 'settings' }, vi.fn()).status).toBe('blocked')
  })
})

describe('mouse navigation buttons', () => {
  const press = (type: 'mousedown' | 'mouseup', button: number): MouseEvent => {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    return event
  }

  it('maps buttons 3 and 4 to Back and Forward and keeps the browser from leaving the page', async () => {
    const b = await bench('web', 'windows')
    expect(press('mousedown', 3).defaultPrevented).toBe(true)
    expect(b.navigation.goBack).not.toHaveBeenCalled()
    expect(press('mouseup', 3).defaultPrevented).toBe(true)
    expect(b.navigation.goBack).toHaveBeenCalledOnce()
    expect(press('mouseup', 4).defaultPrevented).toBe(true)
    expect(b.navigation.goForward).toHaveBeenCalledOnce()
  })

  it('ignores the primary, auxiliary and context buttons', async () => {
    const b = await bench('web', 'windows')
    for (const button of [0, 1, 2]) expect(press('mouseup', button).defaultPrevented).toBe(false)
    expect(b.navigation.goBack).not.toHaveBeenCalled()
    expect(b.navigation.goForward).not.toHaveBeenCalled()
  })

  it('leaves the buttons to a dialog on top of the page, but not to the navigation drawer', async () => {
    const b = await bench('web', 'windows')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.dataset.shortcutModal = 'settings'
    document.body.append(dialog)
    expect(press('mouseup', 3).defaultPrevented).toBe(false)
    expect(b.navigation.goBack).not.toHaveBeenCalled()
    dialog.dataset.shortcutModal = 'sidebar'
    press('mouseup', 3)
    expect(b.navigation.goBack).toHaveBeenCalledOnce()
  })

  it('stops listening when the plugin is disposed', async () => {
    const b = await bench('web', 'windows')
    await b.fiber.dispose()
    expect(press('mouseup', 3).defaultPrevented).toBe(false)
    expect(b.navigation.goBack).not.toHaveBeenCalled()
  })
})
