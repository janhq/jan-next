import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { act, fireEvent, render } from '@testing-library/react'
import { JSDOM } from 'jsdom'

function loadPanel(modules, globals = {}) {
  let plugin
  const filename = new URL('../client.js', import.meta.url)
  runInNewContext(readFileSync(filename, 'utf8'), {
    URL,
    document: { baseURI: 'https://jan.example.com/prefix/' },
    ...globals,
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, '@janhq/jan-orchestration')
      plugin = factory(name => modules[name])
    } }, ...globals.window },
  }, { filename: filename.pathname })
  return plugin
}

function registerPanel(modules, globals = {}, uiWorkspace = {}) {
  const cleanups = []
  const slots = new Map()
  const state = {}
  const t = (key, params) => state.dictionary.en[key].replace(/\{(\w+)\}/g, (_, name) => params[name])
  const plugin = loadPanel(modules, globals)
  plugin.apply({
    effect: setup => cleanups.push(setup()),
    locale: {
      register(_namespace, values) { state.dictionary = values; return () => { delete state.dictionary } },
      bind: () => t,
    },
    sidebarRightTabs: { register(value) { state.definition = value; return () => { delete state.definition } } },
    slots: {
      inject: (_name, register) => register(),
      register(options, component) {
        slots.set(options.name, { options, component })
        return () => slots.delete(options.name)
      },
    },
    uiWorkspace,
  })
  return { state, slots, t, dispose: () => { for (const cleanup of cleanups.reverse()) cleanup() } }
}

test('offers Orchestration in the sidebar tab menu and localizes its panel in all product languages', () => {
  let styled = false
  const style = { remove() { styled = false } }
  const document = {
    baseURI: 'https://jan.example.com/prefix/',
    createElement: () => style,
    head: { append() { styled = true } },
  }
  const { state, slots, dispose } = registerPanel({ react: {}, '@janhq/jan-client-ui-primitives': {} }, { document })
  const { dictionary, definition } = state
  try {
    assert.equal(definition.kind, 'orchestration')
    assert.equal(definition.guide[0].title(), 'Orchestration')
    for (const name of ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']) {
      assert.equal(slots.get(name).options.key, definition.id)
    }
    assert.deepEqual(Object.keys(dictionary), ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
    for (const [locale, copy] of Object.entries(dictionary)) {
      assert.deepEqual(Object.keys(copy).sort(), Object.keys(dictionary.en).sort(), locale)
      assert.ok(Object.values(copy).every(value => typeof value === 'string' && value.trim()), locale)
      assert.match(copy.waiting, /\{n\}/, locale)
    }
    assert.equal(styled, true)
  } finally {
    dispose()
  }
  assert.equal(slots.size, 0)
  assert.equal(state.definition, undefined)
  assert.equal(styled, false)
})

const react = createRequire(import.meta.resolve('@testing-library/react'))('react')
const baseURI = 'https://jan.example.com/prefix/'
const tasks = [
  { taskId: 'task_local', title: 'Update README', status: 'dispatched', hostName: 'This computer',
    isolation: { kind: 'worktree', branch: 'jan-update-readme-a1b2', path: '/projects/demo/.agents/worktrees/jan-update-readme-a1b2' },
    lastMessage: { type: 'status', body: 'Draft ready', createdAt: 1000 }, undelivered: 2,
    dispatch: { id: 'dsp_local', status: 'running', sessionId: 'session_local', host: 'local' } },
  { taskId: 'task_ssh', title: 'Check build', status: 'completed', hostName: 'Build machine',
    isolation: { kind: 'shared', reason: 'requested' }, undelivered: 0,
    dispatch: { id: 'dsp_ssh', status: 'done', sessionId: 'session_ssh', qualifiedSessionId: 'build~session_ssh', host: 'build' } },
  { taskId: 'task_url', title: 'Write release notes', status: 'dispatched', hostName: 'Office computer',
    isolation: { kind: 'shared', reason: 'requested' }, undelivered: 0,
    dispatch: { id: 'dsp_url', status: 'running', sessionId: 'session_url', host: 'office' } },
]

function mountPanel(test, { reply }) {
  const { window } = new JSDOM('<!doctype html>', { url: baseURI, pretendToBeVisual: true })
  const restore = [
    ['window', Object.getOwnPropertyDescriptor(globalThis, 'window')],
    ['IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')],
  ]
  let teardown
  test.after(() => {
    try { teardown?.() } finally {
      for (const [key, previous] of restore) {
        if (previous === undefined) delete globalThis[key]
        else Object.defineProperty(globalThis, key, previous)
      }
      window.close()
    }
  })
  globalThis.window = window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { document } = window
  const opened = [], requests = [], timers = new Map()
  let nextId = 0
  const { slots, t, dispose } = registerPanel({ react, '@janhq/jan-client-ui-primitives': {
    Button: ({ size, variant, ...props }) => react.createElement('button', props),
  } }, {
    document,
    AbortController,
    window: { open: (...args) => opened.push(args) },
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, delay }); return id },
    clearTimeout: id => timers.delete(id),
    async fetch(url, { body, method, signal }) {
      const request = { url, httpMethod: method, ...JSON.parse(body), signal }
      requests.push(request)
      return new Response(JSON.stringify({ result: await reply(request) }), { headers: { 'content-type': 'application/json' } })
    },
  }, { openSession: id => opened.push(id) })
  const { component, options } = slots.get('sidebar.right.pane.tab')
  const container = document.body.appendChild(document.createElement('div'))
  const signal = new AbortController().signal
  const view = (visible, sessionId = 'coordinator') => react.createElement(component, {
    ...options.inject(), sessionId, t, useTabInfo: () => ({ tab: { visible, signal } }),
  })
  const ui = render(view(false), { container, baseElement: document.body })
  teardown = () => { ui.unmount(); dispose() }
  return { ui, opened, requests, timers,
    show: (visible, sessionId) => act(() => ui.rerender(view(visible, sessionId))),
    documentVisible: visible => act(() => {
      Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true })
      document.dispatchEvent(new window.Event('visibilitychange'))
    }),
    tick: () => act(async () => {
      for (const [id, { callback, delay }] of timers) {
        assert.equal(delay, 2000)
        timers.delete(id)
        await callback()
        break
      }
    }),
  }
}

test('polls only the foreground coordinator while the document is visible and aborts on unmount', async test => {
  const delayed = Promise.withResolvers()
  const { ui, requests, timers, show, documentVisible, tick } = mountPanel(test, {
    reply: ({ params }) => params.coordinatorSessionId === 'another' ? delayed.promise : { tasks: [] },
  })
  assert.equal(requests.length, 0)
  await documentVisible(false)
  await show(true)
  assert.equal(requests.length, 0)
  await documentVisible(true)
  assert.equal(requests[0].url, `${baseURI}jan-api/orchestration`)
  assert.equal(requests[0].httpMethod, 'POST')
  assert.equal(requests[0].method, 'uiTasks')
  assert.equal(requests[0].params.coordinatorSessionId, 'coordinator')
  assert.match(ui.getByText(/No worker chats yet/).textContent, /split work into tasks/)
  await tick()
  assert.equal(requests.length, 2)
  await documentVisible(false)
  assert.equal(timers.size, 0)
  await documentVisible(true)
  assert.equal(requests.length, 3)
  await show(false)
  assert.equal(timers.size, 0)
  await show(true, 'another')
  const active = requests.at(-1)
  assert.equal(active.params.coordinatorSessionId, 'another')
  assert.equal(active.signal.aborted, false)
  ui.unmount()
  assert.equal(active.signal.aborted, true)
  delayed.resolve({ tasks })
  await act(async () => {})
  await documentVisible(true)
  assert.equal(timers.size, 0)
  assert.equal(requests.length, 4)
})

test('shows task details and opens or stops the worker through the matching route', async test => {
  const remoteUrl = 'https://office.example.com/'
  let stopped = false
  const { ui, opened, requests, show } = mountPanel(test, { reply: ({ method }) => {
    if (method === 'open') return { url: remoteUrl }
    if (method === 'uiStop') { stopped = true; return { stopped } }
    return { tasks: stopped ? [{ ...tasks[0], status: 'stopped' }, ...tasks.slice(1)] : tasks }
  } })
  await show(true)
  for (const text of ['Dispatched', 'Completed', 'This computer', 'jan-update-readme-a1b2', 'Draft ready', '2 waiting', 'Shared', 'Office computer']) {
    assert.ok(ui.queryAllByText(text).length > 0, `${text} is visible`)
  }
  fireEvent.click(ui.getByRole('button', { name: 'Update README' }))
  fireEvent.click(ui.getByRole('button', { name: 'Check build' }))
  assert.deepEqual(opened, ['session_local', 'build~session_ssh'])
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Open on that computer Write release notes' })) })
  const open = requests.at(-1)
  assert.deepEqual([open.url, open.httpMethod, open.method, open.params], [`${baseURI}jan-api/hosts`, 'POST', 'open', { id: 'office' }])
  assert.deepEqual(opened.at(-1), [remoteUrl, '_blank', 'noopener'])
  assert.equal(ui.queryByRole('button', { name: 'Stop Check build' }), null)
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Stop Update README' })) })
  const stop = requests.find(request => request.params.taskId === 'task_local')
  assert.deepEqual([stop.url, stop.httpMethod, stop.method], [`${baseURI}jan-api/orchestration`, 'POST', 'uiStop'])
  assert.ok(ui.getByText('Stopped'))
  assert.equal(ui.queryByRole('button', { name: 'Stop Update README' }), null)
})
