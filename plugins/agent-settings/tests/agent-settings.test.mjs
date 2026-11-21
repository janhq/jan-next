import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.mjs'

// SettingsForms returns a Schemastery reference table, not an inline tree.
const namespace = (ns = 'compaction-settings') => ({
  ns, revision: 3, schema: { uid: 0, refs: {
    0: { type: 'object', dict: { thresholdRatio: 1, apiKey: 2, nested: 3, account: 5, mode: 7, maxTokens: 10, login: 2 } },
    1: { type: 'number', meta: { default: 0.8, min: 0, max: 1, description: 'When to compact the chat.' } },
    2: { type: 'string', meta: { role: 'secret', default: 'hidden-default' } },
    3: { type: 'object', meta: { role: 'secret' }, dict: { alias: 4 } },
    4: { type: 'string' },
    5: { type: 'string', meta: { role: 'credential-ref' } },
    7: { type: 'union', list: [8, 9] },
    8: { type: 'const', value: 'fast' },
    9: { type: 'const', value: 'slow' },
    10: { type: 'number', meta: { description: { en: 'Maximum output tokens.' } } },
  } },
  value: { thresholdRatio: 0.8, apiKey: 'hidden-value', nested: { alias: 'nested-secret' }, account: 'credential-ref-value', mode: 'fast', maxTokens: 100, login: 'secret-role' },
  base: { thresholdRatio: 0.8, mode: 'fast' }, user: { maxTokens: 100 },
})

const threshold = value => ({ scope: 'saved', namespace: 'compaction-settings', path: ['thresholdRatio'], value })

function harness({ rows = [namespace()], mutate, policy = 'ask', next = { kind: 'allow' }, resolveCallConfig = async config => config } = {}) {
  const registered = new Map()
  const calls = []
  let before
  let current = { provider: 'example', model: 'small', reasoningEffort: 'low' }
  const agent = { id: 'chat-1', session: {}, model: {
    current: () => ({ ...current }),
    select: value => { calls.push(['select', value]); current = value },
  } }
  const ctx = {
    tools: { register: tool => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } },
    effect: callback => { for (const disposer of callback()) assert.equal(typeof disposer, 'function') },
    on: (event, handler) => { assert.equal(event, 'tools/pre-execute'); before = handler; return () => {} },
    get: key => key === 'approval' ? { overrideOf: () => policy, config: { policy: 'ask' } } : undefined,
    settings: {
      describe: options => { assert.deepEqual(options, { redactSecrets: true }); return rows },
      mutate: async (ns, ops, revision) => {
        calls.push(['mutate', ns, ops, revision])
        if (mutate) return mutate(ns, ops, revision)
        const row = rows.find(row => row.ns === ns)
        assert.equal(row.revision, revision)
        for (const { path, value } of ops) {
          const parent = path.slice(0, -1).reduce((node, key) => node[key], row.value)
          parent[path.at(-1)] = value
        }
      },
    },
    agents: { get: () => agent },
    llm: {
      listProviders: () => [{ id: 'example' }],
      listModels: async () => [{ id: 'small' }, { id: 'large' }],
      resolveCallConfig,
    },
  }
  apply(ctx)
  const prepare = async (name, arguments_) => {
    const exec = { name, arguments: arguments_, agent, signal: new AbortController().signal }
    const decision = await before(exec, async () => next)
    return { decision, dispatch: () => registered.get(name).execute(arguments_, exec) }
  }
  const run = async (name, arguments_, { allow = true } = {}) => {
    const { decision, dispatch } = await prepare(name, arguments_)
    if (decision.kind === 'deny') return { message: decision.reason }
    if (decision.kind === 'ask' && !allow) return { message: 'The user denied the change.' }
    return dispatch()
  }
  return { calls, run, prepare, setModel: value => { current = value } }
}

test('read returns only public fields with effective value, default, type, range and source', async () => {
  const { run } = harness()
  const listing = await run('jan_settings_read', {})
  assert.deepEqual(listing.namespaces, ['compaction-settings'])
  const result = await run('jan_settings_read', { namespace: 'compaction-settings' })
  assert.deepEqual(result.fields, [
    { path: ['thresholdRatio'], value: 0.8, default: 0.8, type: 'number', min: 0, max: 1, description: 'When to compact the chat.', source: 'default' },
    { path: ['mode'], value: 'fast', type: 'union', enum: ['fast', 'slow'], source: 'inherited' },
    { path: ['maxTokens'], value: 100, type: 'number', description: 'Maximum output tokens.', source: 'saved' },
  ])
  assert.doesNotMatch(JSON.stringify(result), /apiKey|alias|account|login|secret|credential|hidden/)
})

test('saved change asks once with old and new values and scope', async () => {
  const { prepare, calls } = harness()
  const { decision } = await prepare('jan_settings_change', threshold(0.85))
  assert.deepEqual(calls, [])
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /compaction threshold.*0\.8 -> 0\.85.*saved for all chats/i)
})

test('a change to the value already in force skips the approval card and writes nothing', async () => {
  const { prepare, calls } = harness()
  const saved = await prepare('jan_settings_change', threshold(0.8))
  assert.equal(saved.decision.kind, 'allow')
  assert.match((await saved.dispatch()).message, /no change.*already 0\.8/i)
  const chat = await prepare('jan_settings_change', { scope: 'chat', reasoningEffort: 'low' })
  assert.equal(chat.decision.kind, 'allow')
  assert.match((await chat.dispatch()).message, /no change/i)
  assert.deepEqual(calls, [])
})

test('chat change asks with the session model and reasoning effort, but does not save the default', async () => {
  const { prepare, calls } = harness()
  const args = { scope: 'chat', provider: 'example', model: 'large', reasoningEffort: 'high' }
  const { decision, dispatch } = await prepare('jan_settings_change', args)
  assert.match(decision.reason, /example\/small.*low.*->.*example\/large.*high.*this chat only/i)
  const result = await dispatch()
  assert.match(result.message, /this chat only.*model picker/i)
  assert.deepEqual(calls, [['select', { provider: 'example', model: 'large', reasoningEffort: 'high' }]])
})

test('changing only reasoning effort retains the current chat model', async () => {
  const { run, calls } = harness()
  await run('jan_settings_change', { scope: 'chat', reasoningEffort: 'high' })
  assert.deepEqual(calls, [['select', { provider: 'example', model: 'small', reasoningEffort: 'high' }]])
})

test('denylist refuses permission, MCP, provider, market, credentials and self configuration before mutation', async () => {
  const { run, calls } = harness({ rows: [namespace(), namespace('jan-theme'), namespace('llm-pi-ai'), namespace('jan-agent-settings'), namespace('plugin-market')] })
  const blocked = [
    ['jan-theme', ['mcpServers']], ['llm-pi-ai', ['providers']], ['jan-agent-settings', ['enabled']],
    ['plugin-market', ['indexUrls']], ['compaction-settings', ['approvalPolicy']],
    ['compaction-settings', ['apiKey']], ['compaction-settings', ['nested', 'alias']],
    ['compaction-settings', ['account']], ['compaction-settings', ['login']],
  ]
  for (const [namespace, path] of blocked) {
    const result = await run('jan_settings_change', { scope: 'saved', namespace, path, value: 'bad' })
    assert.match(result.message, /cannot change|not available/i)
  }
  assert.deepEqual(calls, [])
})

test('saved change uses one revision-checked set op and reports its Settings location', async () => {
  const { run, calls } = harness()
  const result = await run('jan_settings_change', threshold(0.85))
  assert.deepEqual(calls, [['mutate', 'compaction-settings', [{ op: 'set', path: ['thresholdRatio'], value: 0.85 }], 3]])
  assert.match(result.message, /0\.8 -> 0\.85.*saved for all chats.*Settings > Agent loop/i)
})

test('saved result reports the effective Host value if it differs from what was requested', async () => {
  const row = namespace()
  const { run } = harness({ rows: [row], mutate: async () => { row.value.thresholdRatio = 0.9 } })
  const result = await run('jan_settings_change', threshold(0.85))
  assert.equal(result.ok, true)
  assert.match(result.message, /0\.8 -> 0\.9 \(requested 0\.85\)/)
})

test('Host validation reason is returned without claiming success', async () => {
  const { run } = harness({ mutate: async () => { throw new Error('Ratio must stay below 1.') } })
  const result = await run('jan_settings_change', threshold(0.95))
  assert.match(result.message, /Ratio must stay below 1\./)
  assert.doesNotMatch(result.message, /Changed|Saved/)
})

test('approval denial makes no change and full access follows the existing bypass policy', async () => {
  const { calls, run } = harness()
  await run('jan_settings_change', threshold(0.9), { allow: false })
  assert.deepEqual(calls, [])
  const full = harness({ policy: 'never' })
  const { decision, dispatch } = await full.prepare('jan_settings_change', { scope: 'chat', reasoningEffort: 'high' })
  assert.deepEqual(decision, { kind: 'allow' })
  await dispatch()
  assert.equal(full.calls.length, 1)
})

test('a downstream denial never runs a settings change', async () => {
  const { run, calls } = harness({ next: { kind: 'deny', reason: 'Tool disabled.' } })
  assert.deepEqual(await run('jan_settings_change', threshold(0.85)), { message: 'Tool disabled.' })
  assert.deepEqual(calls, [])
})

test('saved values are literal data and cannot introduce a loader expression', async () => {
  const { run, calls } = harness()
  const result = await run('jan_settings_change', threshold({ __jsExpr: '1' }))
  assert.match(result.message, /literal|expression/i)
  assert.deepEqual(calls, [])
})

test('writes use the revision shown for approval, not a newer revision after the user saw the card', async () => {
  const rows = [namespace()]
  const { prepare, calls } = harness({ rows, mutate: async (_ns, _ops, revision) => {
    if (revision !== rows[0].revision) throw new Error('Setting changed since approval.')
  } })
  const { dispatch } = await prepare('jan_settings_change', threshold(0.85))
  rows[0].revision++
  const result = await dispatch()
  assert.match(result.message, /changed since approval/i)
  assert.equal(calls[0][3], 3)
})

test('a reasoning-only approval cannot be applied to a different model after a picker change', async () => {
  const { prepare, setModel, calls } = harness()
  const { dispatch } = await prepare('jan_settings_change', { scope: 'chat', reasoningEffort: 'high' })
  setModel({ provider: 'example', model: 'large' })
  assert.match((await dispatch()).message, /changed.*approval/i)
  assert.deepEqual(calls, [])
})

test('compaction shows the built-in threshold when the Host preference is unset, and rejects invalid ratios before saving', async () => {
  const row = namespace()
  row.schema.refs[1] = { type: 'number' }
  delete row.value.thresholdRatio
  delete row.base.thresholdRatio
  const { prepare, run, calls } = harness({ rows: [row] })
  const field = (await run('jan_settings_read', { namespace: row.ns })).fields[0]
  assert.equal(field.value, 0.8)
  assert.equal(field.default, 0.8)
  assert.match((await prepare('jan_settings_change', threshold(0.85))).decision.reason, /0\.8 -> 0\.85/)
  assert.match((await run('jan_settings_change', threshold(1.1))).message, /between.*0.*1|\(0, 1\]/i)
  assert.deepEqual(calls, [])
})

test('chat errors return the LLM service reason and leave the selection alone', async () => {
  const { run, calls } = harness({ resolveCallConfig: async () => { throw new Error('Unsupported reasoning effort.') } })
  const result = await run('jan_settings_change', { scope: 'chat', reasoningEffort: 'unsupported' })
  assert.match(result.message, /Unsupported reasoning effort\./)
  assert.deepEqual(calls, [])
})

test('one saved batch approves the paired summary model and writes both fields together', async () => {
  const row = namespace()
  row.schema.refs[0].dict.summarizationProvider = 4
  row.schema.refs[0].dict.summarizationModel = 4
  const { prepare, calls } = harness({ rows: [row] })
  const changes = [{ path: ['summarizationProvider'], value: 'example' }, { path: ['summarizationModel'], value: 'small' }]
  const { decision, dispatch } = await prepare('jan_settings_change', { scope: 'saved', namespace: row.ns, changes })
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /summary provider.*model default -> "example".*summary model.*model default -> "small".*saved for all chats/s)
  await dispatch()
  assert.deepEqual(calls, [['mutate', row.ns, changes.map(change => ({ op: 'set', ...change })), 3]])
})

test('batch rejects a protected path without writing the other field', async () => {
  const { run, calls } = harness()
  const result = await run('jan_settings_change', { scope: 'saved', namespace: 'compaction-settings', changes: [
    { path: ['thresholdRatio'], value: 0.85 }, { path: ['login'], value: 'stop' },
  ] })
  assert.match(result.message, /not available/i)
  assert.deepEqual(calls, [])
})

test('a pre-existing ask is still a single card with the settings delta', async () => {
  const { prepare } = harness({ next: { kind: 'ask', reason: 'Generic approval.' } })
  const { decision } = await prepare('jan_settings_change', threshold(0.85))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /0\.8 -> 0\.85/)
})

test('an unavailable summary route does not replace the saved pair', async () => {
  const row = namespace()
  row.schema.refs[0].dict.summarizationProvider = 4
  row.schema.refs[0].dict.summarizationModel = 4
  const { run, calls } = harness({ rows: [row] })
  const result = await run('jan_settings_change', { scope: 'saved', namespace: row.ns, changes: [
    { path: ['summarizationProvider'], value: 'missing' }, { path: ['summarizationModel'], value: 'small' },
  ] })
  assert.match(result.message, /not available/i)
  assert.deepEqual(calls, [])
})

test('null reasoning effort restores the current model default', async () => {
  const { prepare, calls } = harness()
  const { decision, dispatch } = await prepare('jan_settings_change', { scope: 'chat', reasoningEffort: null })
  assert.match(decision.reason, /reasoning low -> example\/small, reasoning model default/)
  await dispatch()
  assert.deepEqual(calls, [['select', { provider: 'example', model: 'small' }]])
})
