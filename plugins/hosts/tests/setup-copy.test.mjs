import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receiveSetup, setupState } from '../setup-copy.mjs'
import { applySync, syncInventory, syncKey, syncReview } from '../setup-sync.mjs'

/** A Jan's settings and credentials, as the Host services answer them. */
function jan({ providers = {}, user = {}, defaultModel, keys = {} } = {}) {
  const state = { providers: { ...providers }, user, defaultModel, keys: { ...keys } }
  return {
    state,
    settings: {
      describe: () => [
        { ns: 'llm-pi-ai', value: { providers: state.providers }, user: state.user },
        { ns: 'agent-default-model', value: state.defaultModel ?? { provider: 'tokamak', model: 'tokamak/auto' }, user: state.defaultModel ?? {} },
      ],
      async update(ns, patch) {
        if (ns === 'llm-pi-ai') {
          state.providers = { ...state.providers, ...patch.providers }
          state.user = { providers: { ...state.user.providers, ...patch.providers } }
        } else state.defaultModel = patch
      },
    },
    credentials: {
      describe: async ref => ({ configured: Object.hasOwn(state.keys, ref) }),
      resolve: async ref => Object.hasOwn(state.keys, ref) ? { value: state.keys[ref], source: 'file' } : undefined,
      async set(ref, value) { state.keys[ref] = value },
    },
  }
}

const tokamak = { displayName: 'Tokamak', apiKeyEnv: 'TOKAMAK_API_KEY', baseURL: 'https://api.tokamak.sh/v1' }
const router = { displayName: '9Router', apiKeyEnv: 'NINEROUTER_API_KEY', api: 'openai-completions', baseURL: 'http://10.0.0.2:20128/v1' }
const local = { displayName: 'Local', baseURLEnv: 'LLAMA_CPP_BASE_URL', apiKeyEnv: 'LLAMA_CPP_API_KEY' }

test('a fresh Jan reports its setup without key values', async () => {
  const remote = jan({ providers: { tokamak, local }, keys: { TOKAMAK_API_KEY: 'sk-tok' } })
  const state = await setupState(remote)
  assert.equal(state.untouched, true)
  assert.deepEqual({ ...state.routes }, {
    tokamak: { key: true, binding: { ref: 'TOKAMAK_API_KEY', endpoint: tokamak.baseURL } },
    local: { key: false, binding: undefined },
  })
})

test('the receiving Jan adds the route, its key and the default model', async () => {
  const remote = jan({ providers: { tokamak } })
  const result = await receiveSetup(remote, {
    providers: { ninerouter: router },
    keys: { ninerouter: { ref: 'NINEROUTER_API_KEY', endpoint: router.baseURL, value: 'sk-router' } },
    defaultModel: { provider: 'ninerouter', model: 'claude-sonnet' },
  })
  assert.deepEqual(result, { added: ['ninerouter'], kept: [], keys: ['NINEROUTER_API_KEY'], defaultModel: true })
  assert.deepEqual(remote.state.providers.ninerouter, router)
  assert.equal(remote.state.keys.NINEROUTER_API_KEY, 'sk-router')
  assert.deepEqual(remote.state.defaultModel, { provider: 'ninerouter', model: 'claude-sonnet' })
})

test('a Jan someone already set up is not untouched', async () => {
  const picked = jan({ providers: { tokamak }, defaultModel: { provider: 'tokamak', model: 'tokamak/auto' } })
  assert.equal((await setupState(picked)).untouched, false)
  const added = jan({ providers: { tokamak, mine: router }, user: { providers: { mine: router } } })
  assert.equal((await setupState(added)).untouched, false)
})

test('the receiving Jan keeps its own route, key and default model', async () => {
  const theirs = { ...router, baseURL: 'http://their-router/v1' }
  const remote = jan({
    providers: { ninerouter: theirs }, user: { providers: { ninerouter: theirs } },
    defaultModel: { provider: 'ninerouter', model: 'their-model' }, keys: { NINEROUTER_API_KEY: 'sk-theirs' },
  })
  const result = await receiveSetup(remote, {
    providers: { ninerouter: router },
    keys: { ninerouter: { ref: 'NINEROUTER_API_KEY', endpoint: router.baseURL, value: 'sk-router' } },
    defaultModel: { provider: 'ninerouter', model: 'claude-sonnet' },
  })
  assert.deepEqual(result, { added: [], kept: ['ninerouter'], keys: [], defaultModel: false })
  assert.equal(remote.state.providers.ninerouter.baseURL, 'http://their-router/v1')
  assert.equal(remote.state.keys.NINEROUTER_API_KEY, 'sk-theirs')
  assert.deepEqual(remote.state.defaultModel, { provider: 'ninerouter', model: 'their-model' })
})

test('a bundled route that lacks only its key there receives just the key', async () => {
  const remote = jan({ providers: { tokamak } })
  const result = await receiveSetup(remote, {
    providers: {},
    keys: { tokamak: { ref: 'TOKAMAK_API_KEY', endpoint: tokamak.baseURL, value: 'sk-tok' } },
  })
  assert.deepEqual(result, { added: [], kept: [], keys: ['TOKAMAK_API_KEY'], defaultModel: false })
  assert.equal(remote.state.keys.TOKAMAK_API_KEY, 'sk-tok')
})

test('the receiving Jan never stores a vault pointer', async () => {
  const ref = 'TOKAMAK_API_KEY'
  const remote = jan({ providers: { tokamak } })
  assert.deepEqual((await receiveSetup(remote, {
    providers: {}, keys: { tokamak: { ref, endpoint: tokamak.baseURL, value: 'op://Private/Jan/model-key' } },
  })).keys, [])
})

test('sync skips both source and destination vault pointers without reading their values', async () => {
  const ref = 'TOKAMAK_API_KEY'
  const remote = jan({ providers: { tokamak } })
  const source = { ...jan({ providers: { tokamak }, keys: { [ref]: 'bw://item/password' } }), skillRoots: [] }
  const keys = source.credentials.resolve
  source.credentials.resolve = (ref, options) => {
    assert.equal(options?.dereference, false)
    return keys(ref)
  }
  const key = syncKey()
  const item = { kind: 'keys', id: ref }
  const [entry] = await syncInventory(source, key, item)
  assert.equal(entry.value, null)
  assert.equal(syncReview([entry], [])[0].status, 'skipped')
  const approved = { ...item, value: { endpoint: tokamak.baseURL, value: 'plain' }, expected: entry.digest }
  assert.equal((await applySync({ ...source, receiving: true }, [approved], key))[0].status, 'stale')
  assert.equal((await applySync({ ...remote, receiving: true }, [{ ...approved, expected: null,
    value: { ...approved.value, value: 'bw://item/password' } }], key))[0].status, 'failed')
})

test('the receiving Jan checks the endpoint again before storing the key', async () => {
  const remote = jan({ providers: { tokamak: { ...tokamak, baseURL: 'https://other.example/v1' } } })
  const body = {
    providers: {},
    keys: { tokamak: { ref: 'TOKAMAK_API_KEY', endpoint: tokamak.baseURL, value: 'sk-tok' } },
  }
  assert.deepEqual((await receiveSetup(remote, body)).keys, [])
  assert.deepEqual(remote.state.keys, {})
})

test('the receiving Jan matches a key against the catalog default endpoint', async () => {
  const profile = { apiKeyEnv: 'EXAMPLE_API_KEY' }
  const llm = { listConfigurableProviders: () => [{ settingsNs: 'llm-pi-ai', provider: 'example', defaultBaseURL: 'https://example.com/v1' }] }
  const remote = { ...jan({ providers: { example: profile } }), llm }
  const result = await receiveSetup(remote, {
    providers: {},
    keys: { example: { ref: 'EXAMPLE_API_KEY', endpoint: 'https://example.com/v1', value: 'sk-example' } },
  })
  assert.deepEqual(result.keys, ['EXAMPLE_API_KEY'])
})

test('a key that would also activate a different endpoint is not stored', async () => {
  const remote = jan({ providers: { tokamak, other: { ...tokamak, baseURL: 'https://other.example/v1' } } })
  const body = {
    providers: {},
    keys: { tokamak: { ref: 'TOKAMAK_API_KEY', endpoint: tokamak.baseURL, value: 'sk-tok' } },
  }
  assert.deepEqual((await receiveSetup(remote, body)).keys, [])
  assert.deepEqual(remote.state.keys, {})
})
