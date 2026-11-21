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
  context.window.__ModuleLoader__ = { load({ chunk, factory }) { modules.set(chunk, factory(name => modules.get(name))) } }
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
    [{ activeRun: 'working', lastRun: 'failed' }, 'working', 'neutral', false, 'avatarWorking'],
    [{ activeRun: 'thinking', events: [{ status: 'pending' }] }, 'thinking', 'neutral', false, 'avatarThinking'],
    [{ events: [{ status: 'pending' }], lastRun: 'failed' }, 'waiting', 'neutral', false, 'pending'],
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
  window.matchMedia = () => ({ matches: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { Avatar, mountAvatar } = loadChunks({ window, document, performance, setTimeout, clearTimeout,
    requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: window.getComputedStyle.bind(window), MutationObserver: window.MutationObserver })
  const root = createRoot(rootNode)
  let unmounted = false
  t.after(() => { if (!unmounted) React.act(() => root.unmount()) })
  const tMessage = key => ({ title: 'Bots', off: 'Off', sent: 'Sent', avatarIdle: 'Idle' })[key]
  const render = state => React.act(() => root.render(React.createElement(Avatar, { snapshot: state, t: tMessage, mountAvatar })))
  document.body.style.setProperty('--dsw-alias-brand-primary', '#ffc928')
  document.body.style.setProperty('--dsw-alias-label-primary-foreground', 'rgb(34, 34, 34)')
  render({ ...snapshot, enabled: false })
  const host = rootNode.querySelector('[role=img]')
  tick()
  assert.equal(host.getAttribute('aria-label'), 'Bots: Off')
  assert.ok(host.querySelector('svg > g[fill="#ffc928"]'))
  document.body.setAttribute('data-ds-dark-theme', '')
  document.body.style.setProperty('--dsw-alias-brand-primary', '#456bde')
  await Promise.resolve()
  tick()
  assert.ok(host.querySelector('svg > g[fill="#456bde"]'))

  render({ ...snapshot, lastDeliveryAgeMs: 3990 })
  assert.equal(host.getAttribute('aria-label'), 'Bots: Sent')
  t.mock.timers.tick(10)
  assert.equal(host.getAttribute('aria-label'), 'Bots: Idle')
  React.act(() => root.unmount())
  unmounted = true
  assert.equal(host.childElementCount, 0)
  assert.equal(frames.size, 0)
})
