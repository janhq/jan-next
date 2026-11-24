import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchNew, normalizeSources } from '../sources.mjs'
import { openWatch } from '../watch.mjs'
import { createTriage } from '../triage.mjs'

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const issue = number => ({ number, title: `Issue ${number}`, user: { login: 'octo' }, html_url: `https://github.com/janhq/jan/issues/${number}`, body: 'Crash on start' })

function fakeQueue() {
  const store = new Map(), events = new Map()
  return { paused: false, events, get: key => store.get(key), set: (key, value) => store.set(key, value),
    enqueue({ id, ...value }) { if (events.has(id)) return false; events.set(id, value); return true } }
}

test('rejects malformed and duplicate sources before they reach the registry', () => {
  assert.deepEqual(normalizeSources([{ kind: 'github', target: 'janhq/jan' }]), [{ kind: 'github', target: 'janhq/jan', everyMinutes: 15 }])
  for (const bad of [[{ kind: 'github', target: 'not a repo' }], [{ kind: 'slack', target: 'C1', everyMinutes: 15 }],
    [{ kind: 'discord', target: '123456789012345678', everyMinutes: 1 }],
    [{ kind: 'github', target: 'janhq/jan' }, { kind: 'github', target: 'JanHQ/jan' }]]) {
    assert.throws(() => normalizeSources(bad), /invalid-sources/)
  }
})

test('a new GitHub source starts at the newest item, then reports only later ones, oldest first', async () => {
  let rows = [issue(10), issue(9)]
  const fetch = async () => json(rows)
  const first = await fetchNew({ kind: 'github', target: 'janhq/jan' }, null, { fetch })
  assert.deepEqual(first, { items: [], cursor: { last: 10 } })
  rows = [issue(12), issue(11), issue(10)]
  const next = await fetchNew({ kind: 'github', target: 'janhq/jan' }, first.cursor, { fetch })
  assert.deepEqual(next.items.map(item => item.id), ['11', '12'])
  assert.match(next.items[0].text, /Issue #11 "Issue 11" by octo - https:\/\/github.com\/janhq\/jan\/issues\/11\nCrash on start/u)
  assert.deepEqual(next.cursor, { last: 12 })
})

test('Slack and Discord need a token and send it only in the request header', async () => {
  await assert.rejects(fetchNew({ kind: 'slack', target: 'C0123456789' }, null, { fetch: async () => json({}) }), /token-missing/)
  const seen = []
  const fetch = async (url, init) => {
    seen.push([url, init.headers.authorization])
    return url.endsWith('/channels/123456789012345678') ? json({ guild_id: '42' })
      : json([{ id: '123456789012345699', type: 0, content: 'help: model fails to load', author: { username: 'ana' } },
        { id: '123456789012345690', type: 7, content: '', author: { username: 'bob' } }])
  }
  const result = await fetchNew({ kind: 'discord', target: '123456789012345678' }, { last: '123456789012345680', guild: '42' }, { token: 'secret', fetch })
  assert.deepEqual(result.items.map(item => item.id), ['123456789012345699'])
  assert.ok(!result.items[0].text.includes('secret'))
  assert.ok(seen.every(([, auth]) => auth === 'Bot secret'))
})

test('the poller enqueues each new item once, skips quiet checks and backs off on failure', async () => {
  const queue = fakeQueue()
  let now = 0, rows = [issue(1)], fail = false
  const fetch = async () => fail ? new Response('', { status: 500 }) : json(rows)
  const watch = openWatch({ queue, sources: () => [{ kind: 'github', target: 'janhq/jan', everyMinutes: 15 }], token: async () => undefined,
    fetch, now: () => now })
  await watch.tick()
  assert.equal(queue.events.size, 0, 'the first check only records the position')
  rows = [issue(3), issue(2), issue(1)]
  await watch.tick()
  assert.equal(queue.events.size, 0, 'not due yet')
  now = 15 * 60_000
  await watch.tick()
  assert.deepEqual([...queue.events.keys()], ['source:github:janhq/jan:2', 'source:github:janhq/jan:3'])
  assert.equal(watch.status()[0].lastFound, 2)
  now += 15 * 60_000
  await watch.tick()
  assert.equal(queue.events.size, 2, 'a quiet check adds nothing')
  fail = true
  now += 15 * 60_000
  await watch.tick()
  const status = watch.status()[0]
  assert.equal(status.lastError, 'http-500')
  assert.equal(status.nextCheckAt - now, 15 * 60_000)
  now = status.nextCheckAt
  await watch.tick()
  assert.equal(watch.status()[0].nextCheckAt - now, 30 * 60_000, 'repeated failures wait longer')
})

test('a paused bot does not poll unless asked to check now', async () => {
  const queue = fakeQueue()
  queue.paused = true
  let calls = 0
  const watch = openWatch({ queue, sources: () => [{ kind: 'github', target: 'janhq/jan', everyMinutes: 15 }], token: async () => undefined,
    fetch: async () => { calls++; return json([]) } })
  await watch.tick()
  assert.equal(calls, 0)
  await watch.tick({ force: true })
  assert.equal(calls, 1)
})

test('Jev triage drops only items it is confident the bot ignores, so an all-noise check wakes nothing', async () => {
  const queue = fakeQueue()
  let rows = [issue(1)]
  const bodies = []
  const answers = { 'Issue 2': 0.96, 'Issue 3': 0.05, 'Issue 4': 0.3 }
  const triage = createTriage({ profile: () => ({ name: 'QA', role: 'Release QA', agentProfile: 'qa', workspaceId: 'project-a' }),
    agentProfiles: { async get(query) {
      assert.deepEqual(query, { id: 'qa', workspaceId: 'project-a' })
      return { description: 'Crashes and regressions' }
    } },
    request: async body => {
      bodies.push(body)
      return { answers: Object.fromEntries(Object.entries(body.state).filter(([key]) => key.startsWith('item_'))
        .map(([key, text]) => [key, { type: 'noul', noul: answers[text.match(/"(Issue \d+)"/u)[1]] }])) }
    } })
  let now = 0
  const watch = openWatch({ queue, sources: () => [{ kind: 'github', target: 'janhq/jan', everyMinutes: 15 }], token: async () => undefined,
    triage, fetch: async () => json(rows), now: () => now })
  await watch.tick()
  assert.equal(bodies.length, 0, 'the first check returns no items, so nothing is asked')
  rows = [issue(4), issue(3), issue(2), issue(1)]
  now = 15 * 60_000
  await watch.tick()
  // 0.05 is confidently unrelated; 0.3 is unsure and still reaches the bot.
  assert.deepEqual([...queue.events.keys()], ['source:github:janhq/jan:2', 'source:github:janhq/jan:4'])
  assert.match(bodies[0].state.bot, /Release QA\. Crashes and regressions/u)
  assert.deepEqual(watch.status()[0], { kind: 'github', target: 'janhq/jan', everyMinutes: 15, lastCheckAt: now,
    nextCheckAt: now + 15 * 60_000, lastError: null, lastFound: 2, lastSkipped: 1 })
})

test('Jev triage keeps every item when it cannot answer or the selected agent is missing and the bot has no role', async () => {
  const items = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }]
  const profile = () => ({ role: 'Release QA' })
  for (const request of [
    async () => { throw new Error('This needs a Tokamak account.') },
    async () => ({ answers: { item_0: { noul: 'low' }, item_1: { noul: 7 } } }),
    async () => ({}),
  ]) assert.equal((await createTriage({ request, profile })(items)).size, 0)
  let asked = false
  const unasked = createTriage({ request: async () => { asked = true; return {} }, profile: () => ({ name: 'Bot', role: '', agentProfile: 'missing' }),
    agentProfiles: { async get() { throw Object.assign(new Error('No such agent'), { code: 'agent-profiles/not-found' }) } } })
  assert.equal((await unasked(items)).size, 0)
  assert.equal(asked, false)
})
