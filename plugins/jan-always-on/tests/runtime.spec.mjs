import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openBackground } from '../background.mjs'

const START = 1_800_000_000_000
const event = id => ({ id, kind: 'task', text: id })

async function harness(t, sessionId) {
  const directory = mkdtempSync(join(tmpdir(), 'jan-alwayson-test-'))
  let current = START, runtime
  const runs = [], sent = [], phases = []
  async function reopen() {
    await runtime?.close()
    runtime = openBackground({ directory, sessionId, now: () => current, changed() {},
      activityChanged: () => { phases.push(runtime.snapshot().activeRun) },
      notify: async message => { sent.push(message.text); return 'sent' },
      run: async (job, signal, setPhase) => {
        const held = Promise.withResolvers()
        runs.push({ job, finish: held.resolve, signal, setPhase })
        signal.addEventListener('abort', () => held.resolve('failed'), { once: true })
        return held.promise
      },
    })
  }
  t.after(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }) })
  await reopen()
  await runtime.setPaused(false)
  return { get runtime() { return runtime }, runs, sent, phases, reopen,
    async advance(stamp = runtime.next()) { assert.notEqual(stamp, undefined); current = Math.max(current, stamp); await runtime.deliver(current) },
  }
}

test('reports the current phase and last completed run without counting pause as a failure', async t => {
  const h = await harness(t)
  const { runtime, runs } = h
  assert.equal(runtime.snapshot().activeRun, null)
  runtime.enqueue(event('work'))
  await h.advance()
  assert.equal(runtime.snapshot().activeRun, 'thinking')
  runs[0].setPhase('working')
  assert.equal(runtime.snapshot().activeRun, 'working')
  runs[0].setPhase('thinking')
  assert.equal(runtime.snapshot().activeRun, 'thinking')
  assert.deepEqual(h.phases, ['working', 'thinking'])
  runs[0].finish('failed')
  await runtime.idle()
  assert.equal(runtime.snapshot().activeRun, null)
  assert.equal(runtime.snapshot().lastRun, 'failed')

  runtime.enqueue(event('interrupted'))
  await h.advance()
  await runtime.setPaused(true)
  assert.equal(runtime.snapshot().lastRun, 'failed')
  await runtime.setPaused(false)
  await h.advance()
  runs[2].finish('done')
  await runtime.idle()
  assert.equal(runtime.snapshot().lastRun, 'done')
})

test('deduplicates concurrent events and admits one durable batch at a time', async t => {
  const h = await harness(t)
  const { runtime, runs } = h
  assert.deepEqual([runtime.enqueue(event('one')), runtime.enqueue(event('two')), runtime.enqueue(event('one'))], [true, true, false])
  await h.advance()
  assert.deepEqual(runs[0].job.events.map(entry => entry.id), ['one', 'two'])
  runtime.enqueue(event('three'))
  assert.equal(runtime.next(), undefined)
  runs[0].finish('done')
  await runtime.idle()
  await h.advance()
  assert.deepEqual(runs[1].job.events.map(entry => entry.id), ['three'])
  runs[1].finish('done')
  await runtime.idle()
  await h.reopen()
  assert.equal(h.runtime.enqueue(event('one')), false)
})

test('accepts Scheduled occurrences while paused and batches them after restart', async t => {
  const h = await harness(t)
  const { runtime, runs } = h
  await runtime.setPaused(true)
  runtime.enqueue(event('timer:occurrence-a'))
  runtime.enqueue(event('timer:occurrence-b'))
  await h.reopen()
  assert.equal(h.runtime.paused, true)
  assert.equal(h.runtime.enqueue(event('timer:occurrence-a')), false)
  assert.equal(h.runtime.next(), undefined)
  await h.runtime.setPaused(false)
  await h.advance()
  assert.deepEqual(runs[0].job.events.map(item => item.id), ['timer:occurrence-a', 'timer:occurrence-b'])
  runs[0].finish('done')
  await h.runtime.idle()
})

test('pause cancels the active batch and prevents starts until resumed', async t => {
  const h = await harness(t)
  const { runtime, runs } = h
  runtime.enqueue(event('one'))
  await h.advance()
  await runtime.setPaused(true)
  assert.equal(runs[0].signal.aborted, true)
  runtime.enqueue(event('two'))
  assert.equal(runtime.next(), undefined)
  await h.advance(START + 60_000)
  assert.equal(runs.length, 1)
  await runtime.setPaused(false)
  await h.advance()
  assert.equal(runs[1].job.sessionId, runs[0].job.sessionId)
  runs[1].finish('done')
  await runtime.idle()
})

test('answers once after restart and resumes the original session', async t => {
  const h = await harness(t)
  const { runtime, runs } = h
  runtime.enqueue(event('one'))
  await h.advance()
  runtime.defer(runs[0].job, runs[0].job.runId, { path: 'instructions.md', text: 'New preference' })
  runs[0].finish('deferred')
  await runtime.idle()
  await h.reopen()
  assert.equal(h.runtime.snapshot().events[0].status, 'deferred')
  const id = runs[0].job.runId
  assert.equal(h.runtime.answer(id, 'allowed-once'), true)
  assert.equal(h.runtime.answer(id, 'rejected'), false)
  await h.advance()
  assert.equal(runs[1].job.sessionId, runs[0].job.sessionId)
  assert.equal(runs[1].job.approval.decision, 'allowed-once')
  runs[1].finish('done')
  await h.runtime.idle()
})

test('paces outbox deliveries, suppresses duplicate notifications and resumes on reply', async t => {
  const h = await harness(t)
  const { runtime, runs, sent } = h
  runtime.enqueue(event('one'))
  await h.advance()
  const { job } = runs[0]
  assert.equal(runtime.send(job, 'first', 'First message'), true)
  assert.equal(runtime.send(job, 'first', 'Duplicate'), false)
  assert.equal(runtime.snapshot().lastDeliveryAgeMs, null)
  assert.equal(runtime.send(job, 'second', 'Second message'), true)
  runs[0].finish('done')
  await runtime.idle()
  assert.deepEqual(sent, ['First message'])
  assert.equal(runtime.snapshot().lastDeliveryAgeMs, 0)
  assert.equal(runtime.next(), START + 250 + 60_000)
  const [first] = runtime.snapshot().outbox
  assert.equal(runtime.reply(first.id, 'Continue', 'reply-1'), true)
  assert.equal(runtime.reply(first.id, 'Duplicate reply', 'reply-1'), false)
  await h.advance()
  assert.equal(runs[1].job.sessionId, job.sessionId)
  runs[1].finish('done')
  assert.ok(runtime.snapshot().lastDeliveryAgeMs > 0)
  await runtime.idle()
  await h.advance()
  await runtime.idle()
  assert.deepEqual(sent, ['First message', 'Second message'])
})

test('new work, migrated replies and migrated approvals run in the same canonical chat', async t => {
  const h = await harness(t, 'session-bot-jan')
  h.runtime.enqueue({ ...event('legacy'), sessionId: 'session-always-on-old' })
  await h.advance()
  const first = h.runs[0]
  assert.equal(first.job.sessionId, 'session-bot-jan')
  assert.equal(first.job.events[0].sessionId, 'session-always-on-old')
  h.runtime.defer(first.job, first.job.runId, { path: 'instructions.md', text: 'review' })
  first.finish('deferred')
  await h.runtime.idle()
  assert.equal(h.runtime.answer(first.job.runId, 'allowed-once'), true)
  await h.advance()
  assert.equal(h.runs[1].job.sessionId, first.job.sessionId)
  h.runs[1].finish('done')
  await h.runtime.idle()
})
