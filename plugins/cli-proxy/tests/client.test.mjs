import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'

const reactRequire = createRequire(createRequire(import.meta.url).resolve('@testing-library/react'))
const React = reactRequire('react')
const { createRoot } = reactRequire('react-dom/client')
const h = React.createElement

async function mount(t, initial) {
  const { window } = new JSDOM('<main></main>', { url: 'https://jan.example/' })
  const { document } = window
  const restore = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key,
    Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const rootNode = document.querySelector('main')
  const root = createRoot(rootNode)
  window.open = () => null
  t.after(() => {
    React.act(() => root.unmount())
    window.close()
    for (const [key, descriptor] of Object.entries(restore)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const modules = new Map([['react', React], ['@janhq/jan-client-ui-primitives', {
    Button: ({ variant: _variant, size: _size, ...props }) => h('button', props),
    IconLinkOutlineRegular: () => h('svg'), IconUserOutlineRegular: () => h('svg'),
  }]])
  const load = key => modules.get(key)
  load.async = async key => modules.get(key.slice(2))
  window.__ModuleLoader__ = { load: ({ chunk, factory }) => { modules.set(chunk || 'plugin', factory(load)) } }
  const requests = []
  const snapshot = { status: { phase: 'idle' }, accounts: [], signIn: null, ...initial }
  const sandbox = {
    window, document, URL, AbortController, setTimeout, clearTimeout,
    fetch: async (_, options) => {
      const params = JSON.parse(options.body)
      requests.push(params)
      if (params.method === 'signIn') {
        snapshot.signIn = { provider: 'codex', url: 'https://example.com/sign-in', code: 'ABC-123' }
      }
      if (params.method === 'cancel') snapshot.signIn = null
      return new Response(JSON.stringify({ result: params.method === 'state' ? snapshot : true }))
    },
  }
  for (const file of ['client.locale.js', 'client.icons.js', 'client.js']) {
    runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), sandbox, { filename: file })
  }
  const registrations = new Map()
  const tMessage = (key, params) => modules.get('client.locale.js').dictionaries.en[key]
    .replace(/\{(\w+)\}/g, (_, name) => params[name])
  const registered = Promise.withResolvers()
  modules.get('plugin').apply({
    effect: install => install(), locale: { register() {}, bind: () => tMessage },
    slots: { inject: (_slot, register) => register(), register: ({ name }, Component) => {
      registrations.set(name, Component)
      if (name === 'settings.section') registered.resolve()
    } },
  })
  await registered.promise
  await React.act(async () => root.render(h(registrations.get('settings.section'), { t: tMessage })))
  return { rootNode, requests, button: name => [...rootNode.querySelectorAll('button')].find(button => button.textContent === name) }
}

test('offers provider sign-in and shows a browser link, device code, and cancel action while waiting', async t => {
  const { rootNode, requests, button } = await mount(t)
  await React.act(async () => button('Sign in with ChatGPT').click())
  assert.match(rootNode.textContent, /Finish signing in in your browser/)
  assert.match(rootNode.textContent, /ABC-123/)
  assert.equal(rootNode.querySelector('a').href, 'https://example.com/sign-in')
  assert.equal(button('Sign in with Claude').disabled, true)
  await React.act(async () => button('Cancel').click())
  assert.equal(requests.find(entry => entry.method === 'signIn').params.provider, 'codex')
  assert.ok(requests.some(entry => entry.method === 'cancel'))
  assert.doesNotMatch(rootNode.textContent, /ABC-123/)
})

test('shows connected accounts and offers a retry for a failed proxy', async t => {
  const { rootNode, requests, button } = await mount(t, {
    status: { phase: 'error', error: 'checksum' },
    accounts: [{ id: 'account.json', provider: 'claude', label: 'casey@example.com' }],
  })
  assert.match(rootNode.textContent, /couldn’t verify/)
  assert.match(rootNode.textContent, /casey@example.com/)
  assert.equal(button('Sign out').disabled, true)
  await React.act(async () => button('Try again').click())
  assert.ok(requests.some(entry => entry.method === 'retry'))
})

test('announces proxy download progress', async t => {
  const { rootNode } = await mount(t, { status: { phase: 'downloading', percent: 42 }, signIn: { provider: 'claude' } })
  assert.match(rootNode.textContent, /42%/)
  assert.equal(rootNode.querySelector('progress').value, 42)
})
