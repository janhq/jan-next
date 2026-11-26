import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const reactRequire = createRequire(require.resolve('@testing-library/react'))
const React = reactRequire('react')
const { createRoot } = reactRequire('react-dom/client')

function loadChunks(context) {
  const modules = new Map([['react', React]])
  const load = name => modules.get(name)
  load.async = async name => modules.get(name.slice(2))
  context.window.__ModuleLoader__ = { load({ chunk, factory }) { modules.set(chunk, factory(load)) } }
  for (const entry of ['client.open-bot-avatar.js', 'client.avatar.js']) {
    runInNewContext(readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8'), context, { filename: entry })
  }
  return { ...modules.get('client.open-bot-avatar.js'), ...modules.get('client.avatar.js') }
}

const snapshot = { enabled: true, paused: false, activeRun: null, lastRun: null, approvals: [], events: [], lastDeliveryAgeMs: null }

test('maps background activity and prioritizes paused, approval and active states', () => {
  const { avatarAppearance, definition, validateAvatar } = loadChunks({ window: {}, performance })
  const validated = validateAvatar(definition)
  assert.ok(validated.ok, JSON.stringify(validated.errors))
  const cases = [
    [{ enabled: false, activeRun: 'working' }, 'idle', 'neutral', true, 'off'],
    [{ paused: true, approvals: [{}] }, 'idle', 'neutral', true, 'paused'],
    [{ approvals: [{}], activeRun: 'working' }, 'blocked', 'neutral', false, 'deferred'],
    [{ blocked: true, activeRun: 'working' }, 'blocked', 'neutral', false, 'deferred'],
    [{ activeRun: 'working', lastRun: 'failed' }, 'working', 'neutral', false, 'avatarWorking'],
    [{ activeRun: 'thinking', events: [{ status: 'pending' }] }, 'thinking', 'neutral', false, 'avatarThinking'],
    [{ events: [{ status: 'pending' }], lastRun: 'failed' }, 'waiting', 'neutral', false, 'pending'],
    [{ pending: true }, 'waiting', 'neutral', false, 'pending'],
    [{ lastRun: 'failed', lastDeliveryAgeMs: 20 }, 'blocked', 'neutral', false, 'failed'],
    [{ lastRun: 'done', lastDeliveryAgeMs: 20 }, 'done', 'happy', false, 'sent'],
    [{ lastRun: 'done', lastDeliveryAgeMs: 4000 }, 'idle', 'neutral', false, 'avatarIdle'],
    [{ lastRun: 'done' }, 'idle', 'neutral', false, 'avatarIdle'],
  ]
  for (const [input, state, mood, still, labelKey] of cases) {
    assert.deepEqual({ ...avatarAppearance({ ...snapshot, ...input }) }, { state, mood, still, labelKey })
  }
})

test('mounts the real renderer, updates its colors and expires a delivery, then destroys it on unmount', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const { window } = dom
  const document = window.document
  const rootNode = document.querySelector('main')
  const globals = Object.getOwnPropertyDescriptors(globalThis)
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => {
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key])
      else delete globalThis[key]
    }
  })
  let frame
  const frames = new Map()
  let nextFrame = 0
  const tick = () => { const queued = [...frames.values()]; frames.clear(); for (const draw of queued) draw(++frame) }
  frame = performance.now()
  window.matchMedia = () => Object.assign(new window.EventTarget(), { matches: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { Avatar, definition, loadAvatarRenderer } = loadChunks({ window, document, performance, setTimeout, clearTimeout,
    requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: window.getComputedStyle.bind(window), MutationObserver: window.MutationObserver })
  const mountBotAvatar = await loadAvatarRenderer()
  const directHost = document.createElement('div')
  const direct = mountBotAvatar(directHost, { definition, color: '#123456', state: 'idle', mood: 'neutral', still: true, label: 'Test bot' })
  tick()
  assert.equal(directHost.getAttribute('aria-label'), 'Test bot')
  assert.equal(directHost.style.color, 'rgb(18, 52, 86)')
  direct.update({ color: '#654321', label: 'Updated bot' })
  tick()
  assert.equal(directHost.getAttribute('aria-label'), 'Updated bot')
  assert.equal(directHost.style.color, 'rgb(101, 67, 33)')
  direct.destroy()
  assert.equal(directHost.childElementCount, 0)
  const root = createRoot(rootNode)
  let unmounted = false
  t.after(() => { if (!unmounted) React.act(() => root.unmount()) })
  const tMessage = key => ({ title: 'Bots', off: 'Off', sent: 'Sent', avatarIdle: 'Idle' })[key]
  const render = state => React.act(() => root.render(React.createElement(Avatar, { snapshot: state, t: tMessage, mountBotAvatar })))
  document.body.style.setProperty('--dsw-alias-brand-primary', '#ffc928')
  document.body.style.setProperty('--dsw-alias-label-primary-foreground', 'rgb(34, 34, 34)')
  render({ ...snapshot, enabled: false })
  const host = rootNode.querySelector('[role=img]')
  tick()
  assert.equal(host.getAttribute('aria-label'), 'Bots: Off')
  assert.equal(host.style.color, 'rgb(255, 201, 40)')
  document.body.setAttribute('data-ds-dark-theme', '')
  document.body.style.setProperty('--dsw-alias-brand-primary', '#456bde')
  await Promise.resolve()
  tick()
  assert.equal(host.style.color, 'rgb(69, 107, 222)')

  React.act(() => root.render(React.createElement(Avatar, { snapshot: { ...snapshot, paused: true },
    t: key => key === 'paused' ? 'Paused' : tMessage(key), mountBotAvatar, name: 'Dawn', appearance: { shape: 1, color: '#8c553d' } })))
  tick()
  assert.equal(host.getAttribute('aria-label'), 'Dawn: Paused')
  assert.equal(host.style.color, 'rgb(140, 85, 61)')

  render({ ...snapshot, lastDeliveryAgeMs: 3990 })
  assert.equal(host.getAttribute('aria-label'), 'Bots: Sent')
  t.mock.timers.tick(10)
  assert.equal(host.getAttribute('aria-label'), 'Bots: Idle')
  React.act(() => root.unmount())
  unmounted = true
  assert.equal(host.childElementCount, 0)
  assert.equal(frames.size, 0)
})

test('mounted avatars follow only the latest cursor position per frame and release their shared listener', async t => {
  const { window } = new JSDOM('<main><span></span><span></span></main>')
  t.after(() => window.close())
  const { document } = window
  const motion = Object.assign(new window.EventTarget(), { matches: false })
  window.matchMedia = () => motion
  const add = t.mock.method(document, 'addEventListener')
  const remove = t.mock.method(document, 'removeEventListener')
  const frames = new Map()
  let frame = 0
  const tick = () => {
    const queued = [...frames.values()]
    frames.clear()
    for (const draw of queued) draw(frame * 16)
  }
  const { definition, loadAvatarRenderer } = loadChunks({ window, document, performance,
    requestAnimationFrame: draw => { frames.set(++frame, draw); return frame },
    cancelAnimationFrame: id => frames.delete(id), getComputedStyle: window.getComputedStyle.bind(window) })
  const mountBotAvatar = await loadAvatarRenderer()
  const [small, large] = document.querySelectorAll('span')
  small.getBoundingClientRect = () => ({ left: 20, top: 20, width: 16, height: 16 })
  large.getBoundingClientRect = () => ({ left: 50, top: 20, width: 42, height: 42 })
  const readOffset = (host, axis = 'x') => Number.parseFloat(host.style.getPropertyValue(`--jao-eye-${axis}`)) || 0
  const pointer = (clientX, clientY, pointerType = 'mouse') => document.dispatchEvent(Object.assign(
    new window.MouseEvent('pointermove', { clientX, clientY }), { pointerType }))
  const a = mountBotAvatar(small, { definition, still: true })
  const b = mountBotAvatar(large, { definition, state: 'thinking' })
  try {
    assert.deepEqual(add.mock.calls.filter(({ arguments: [type] }) => type === 'pointermove')
      .map(({ arguments: [, , options] }) => options.passive), [true])
    tick()
    const centered = small.querySelector('[data-eye="0"]').style.transform
    pointer(-500, 28)
    pointer(500, 28)
    assert.equal(readOffset(small), 0)
    tick()
    assert.ok(readOffset(small) >= .8 && readOffset(small) <= 1.1)
    assert.ok(readOffset(large) > readOffset(small) && readOffset(large) <= 3)
    assert.equal(small.querySelector('[data-eye="0"]').style.transform, centered)
    pointer(-500, 28)
    tick()
    const left = readOffset(small)
    assert.ok(left <= -.8)
    pointer(500, 28, 'touch')
    tick()
    assert.equal(readOffset(small), left)
    pointer(500, -500)
    tick()
    assert.ok(readOffset(small) > 0 && readOffset(small, 'y') < 0)
    assert.ok(Math.hypot(readOffset(large), readOffset(large, 'y')) <= 3.05)
    motion.matches = true
    motion.dispatchEvent(new window.Event('change'))
    pointer(500, 28)
    tick()
    assert.equal(readOffset(small), 0)
    assert.equal(readOffset(large), 0)
    motion.matches = false
    motion.dispatchEvent(new window.Event('change'))
    a.destroy()
    pointer(500, 28)
    tick()
    assert.ok(readOffset(large) > 0)
    pointer(-500, 28)
  } finally {
    a.destroy()
    b.destroy()
  }
  assert.equal(frames.size, 0)
  assert.equal(add.mock.calls.filter(({ arguments: [type] }) => type === 'pointermove').length,
    remove.mock.calls.filter(({ arguments: [type] }) => type === 'pointermove').length)
})
