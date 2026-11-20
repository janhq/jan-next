import { afterEach, expect, it, vi } from 'vitest'
import { DesktopNotifications, parseDesktopNotificationRequest } from '../src/desktop-notifications.ts'

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
  const focus = vi.fn()
  const clicked = vi.fn()
  return { notifications: new DesktopNotifications({ focus, clicked }), focus, clicked }
}

it('shows the title and body and reports the id after focusing the window on click', () => {
  const f = setup()
  expect(f.notifications.show({ id: 'finish:s1:1', title: 'Jan finished the task', body: 'Plan is ready.' })).toBe(true)
  const notification = native.shown[0]!
  expect(notification.options).toEqual({ title: 'Jan finished the task', body: 'Plan is ready.' })
  expect(notification.show).toHaveBeenCalledOnce()
  notification.emit('click')
  expect(f.focus).toHaveBeenCalledOnce()
  expect(f.clicked).toHaveBeenCalledWith('finish:s1:1')
  expect(f.focus.mock.invocationCallOrder[0]).toBeLessThan(f.clicked.mock.invocationCallOrder[0]!)
})

it('replaces an earlier notification with the same id', () => {
  const f = setup()
  f.notifications.show({ id: 'approval:s1', title: 'a', body: 'b' })
  f.notifications.show({ id: 'approval:s1', title: 'c', body: 'd' })
  expect(native.shown[0]!.close).toHaveBeenCalledOnce()
  native.shown[0]!.emit('click')
  expect(f.clicked).not.toHaveBeenCalled()
})

it('shows nothing when the platform has no notification support', () => {
  native.FakeNotification.supported = false
  expect(setup().notifications.show({ id: 'x', title: 'a', body: 'b' })).toBe(false)
  expect(native.shown).toHaveLength(0)
})

it('closes every shown notification on dispose', () => {
  const f = setup()
  f.notifications.show({ id: 'one', title: 'a', body: 'b' })
  f.notifications.show({ id: 'two', title: 'a', body: 'b' })
  f.notifications.dispose()
  expect(native.shown.map(item => item.close.mock.calls.length)).toEqual([1, 1])
})

it('keeps at most 32 notifications referenced and drops the oldest first', () => {
  const f = setup()
  for (let index = 0; index < 33; index++) f.notifications.show({ id: `n${index}`, title: 'a', body: 'b' })
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
