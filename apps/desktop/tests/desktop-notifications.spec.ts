import { afterEach, expect, it, vi } from 'vitest'
import { DesktopNotifications, isWindowActive, parseDesktopNotificationRequest } from '../src/desktop-notifications.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const shown: FakeNotification[] = []
  class FakeNotification extends EventEmitter {
    static supported = true
    static isSupported(): boolean { return FakeNotification.supported }
    readonly show = vi.fn()
    readonly close = vi.fn()
    constructor(readonly options: { title: string; body: string }) { super(); shown.push(this) }
  }
  return { shown, FakeNotification }
})
vi.mock('electron', () => ({ Notification: native.FakeNotification }))

afterEach(() => { native.shown.length = 0; native.FakeNotification.supported = true })

function setup() {
  return { notifications: new DesktopNotifications(), clicked: vi.fn() }
}

it('shows the title and body and reports the requested id to the posting document', () => {
  const f = setup()
  expect(f.notifications.show({ id: 'finish:s1:1', title: 'Jan finished the task', body: 'Plan is ready.' }, 1, f.clicked)).toBe(true)
  const notification = native.shown[0]!
  expect(notification.options).toEqual({ title: 'Jan finished the task', body: 'Plan is ready.' })
  expect(notification.show).toHaveBeenCalledOnce()
  notification.emit('click')
  expect(f.clicked).toHaveBeenCalledExactlyOnceWith('finish:s1:1')
})

it('replaces an earlier notification with the same id only in the posting window', () => {
  const f = setup()
  const secondary = vi.fn()
  f.notifications.show({ id: 'approval:s1', title: 'a', body: 'b' }, 1, f.clicked)
  f.notifications.show({ id: 'approval:s1', title: 'c', body: 'd' }, 2, secondary)
  f.notifications.show({ id: 'approval:s1', title: 'e', body: 'f' }, 1, f.clicked)
  expect(native.shown[0]!.close).toHaveBeenCalledOnce()
  expect(native.shown[1]!.close).not.toHaveBeenCalled()
  native.shown[0]!.emit('click')
  expect(f.clicked).not.toHaveBeenCalled()
  native.shown[1]!.emit('click')
  expect(secondary).toHaveBeenCalledExactlyOnceWith('approval:s1')
  expect(f.clicked).not.toHaveBeenCalled()
})

it('shows nothing when the platform has no notification support', () => {
  native.FakeNotification.supported = false
  expect(setup().notifications.show({ id: 'x', title: 'a', body: 'b' }, 1, vi.fn())).toBe(false)
  expect(native.shown).toHaveLength(0)
})

it('closes every shown notification on dispose', () => {
  const f = setup()
  f.notifications.show({ id: 'one', title: 'a', body: 'b' }, 1, f.clicked)
  f.notifications.show({ id: 'two', title: 'a', body: 'b' }, 2, f.clicked)
  f.notifications.dispose()
  expect(native.shown.map(item => item.close.mock.calls.length)).toEqual([1, 1])
})

it('keeps at most 32 notifications referenced and drops the oldest first', () => {
  const f = setup()
  for (let index = 0; index < 33; index++) f.notifications.show({ id: `n${index}`, title: 'a', body: 'b' }, 1, f.clicked)
  native.shown[0]!.emit('click')
  expect(f.clicked).not.toHaveBeenCalled()
  native.shown[32]!.emit('click')
  expect(f.clicked).toHaveBeenCalledWith('n32')
})

it('rejects renderer requests that are not bounded non-empty strings', () => {
  expect(parseDesktopNotificationRequest({ id: 'a', title: 'b', body: 'c' })).toEqual({ id: 'a', title: 'b', body: 'c' })
  expect(() => parseDesktopNotificationRequest(null)).toThrow(TypeError)
  expect(() => parseDesktopNotificationRequest({ id: '', title: 'b', body: 'c' })).toThrow(/id/)
  expect(() => parseDesktopNotificationRequest({ id: 'a', title: 1, body: 'c' })).toThrow(/title/)
  expect(() => parseDesktopNotificationRequest({ id: 'a', title: 'b', body: 'x'.repeat(1025) })).toThrow(/body/)
})

it('treats only a shown, restored and focused window as active', () => {
  const window = (visible: boolean, minimized: boolean, focused: boolean) =>
    ({ isVisible: () => visible, isMinimized: () => minimized, isFocused: () => focused })
  expect(isWindowActive(window(true, false, true))).toBe(true)
  expect(isWindowActive(window(false, false, true))).toBe(false)
  expect(isWindowActive(window(true, true, true))).toBe(false)
  expect(isWindowActive(window(true, false, false))).toBe(false)
})
