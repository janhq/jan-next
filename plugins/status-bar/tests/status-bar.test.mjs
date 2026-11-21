import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { cpuPercent, parseIoreg, parseMeminfo, parseNvidiaSmi, parseVmStat, parseWindowsCounter } from '../resources.mjs'
import { blockerCommand, createAwakeController } from '../awake.mjs'

let chunk
runInNewContext(readFileSync(new URL('../client.layout.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { chunk = value } } },
})
// The chunk runs in its own realm; copy its results into this one so deepEqual compares values.
const local = fn => (...args) => JSON.parse(JSON.stringify(fn(...args)))
const layout = chunk.factory()
const [arrange, placeAt, attention] = [local(layout.arrange), local(layout.placeAt), local(layout.attention)]
const { levelOf } = layout

const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } })

test('cpu use is the busy share between two readings', () => {
  assert.equal(cpuPercent([cpu(100, 100), cpu(100, 100)], [cpu(150, 150), cpu(190, 110)]), 70)
  assert.equal(cpuPercent([cpu(1, 1)], [cpu(1, 1)]), null)
})

test('macOS memory counts app, wired and compressed pages like Activity Monitor', () => {
  const vmStat = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               1000.',
    'Pages active:                             9999.',
    'Pages wired down:                        100000.',
    'Pages purgeable:                          50000.',
    'Anonymous pages:                         350000.',
    'Pages occupied by compressor:             50000.',
  ].join('\n')
  const total = 16 * 2 ** 30
  const memory = parseVmStat(vmStat, total)
  assert.equal(memory.used, (300000 + 100000 + 50000) * 16384)
  assert.equal(memory.percent, 42.9)
  assert.equal(parseVmStat('garbage', total), null)
})

test('linux memory is total minus available', () => {
  const memory = parseMeminfo('MemTotal:       8000000 kB\nMemFree:  100 kB\nMemAvailable:   2000000 kB\n')
  assert.equal(memory.percent, 75)
  assert.equal(parseMeminfo('MemTotal: 10 kB\n'), null)
})

test('gpu parsers take the busiest device and reject non-numbers', () => {
  assert.equal(parseIoreg('"Device Utilization %"=12\n"Device Utilization %" = 40'), 40)
  assert.equal(parseIoreg('nothing'), null)
  assert.equal(parseNvidiaSmi('3\n81\n'), 81)
  assert.equal(parseNvidiaSmi('[N/A]\n'), null)
  assert.equal(parseWindowsCounter('17,5\r\n'), 17.5)
  assert.equal(parseWindowsCounter(''), null)
})

test('each system has a sleep blocker tied to the Host process', () => {
  assert.deepEqual(blockerCommand('darwin', 42), { command: 'caffeinate', args: ['-i', '-w', '42'] })
  assert.ok(blockerCommand('linux', 42).args.includes('--pid=42'))
  assert.match(blockerCommand('win32', 42).args.at(-1), /SetThreadExecutionState.*Wait-Process -Id 42/s)
  assert.equal(blockerCommand('aix', 42), null)
})

function fakeRunner() {
  const runs = []
  const run = (command, args, signal) => new Promise((resolve, reject) => {
    const entry = { command, signal, exit: resolve, fail: reject }
    runs.push(entry)
    signal.addEventListener('abort', () => resolve())
  })
  return { runs, run }
}

test('agent mode holds the blocker only while an agent runs', () => {
  const { runs, run } = fakeRunner()
  const awake = createAwakeController({ run, platform: 'darwin', pid: 1 })
  awake.setMode('agent')
  assert.equal(runs.length, 0)
  awake.setWorking('a', true)
  awake.setWorking('b', true)
  assert.equal(runs.length, 1)
  awake.setWorking('a', false)
  assert.equal(runs[0].signal.aborted, false)
  awake.setWorking('b', false)
  assert.equal(runs[0].signal.aborted, true)
  assert.equal(awake.state().active, false)
})

test('a blocker that fails is reported, and choosing a mode again retries it', async () => {
  const { runs, run } = fakeRunner()
  const changes = []
  const awake = createAwakeController({ run, platform: 'darwin', pid: 1, onChange: state => changes.push(state) })
  awake.setMode('on')
  runs[0].fail(Object.assign(new Error('no such file'), { code: 'ENOENT' }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual({ active: awake.state().active, error: awake.state().error }, { active: false, error: 'missing' })
  assert.equal(changes.at(-1).error, 'missing')
  awake.setMode('on')
  assert.equal(runs.length, 2)
  assert.equal(awake.state().active, true)
  awake.dispose()
  assert.equal(runs[1].signal.aborted, true)
})

const entries = {
  left: [{ options: { id: 'awake', order: 10 } }],
  right: [{ options: { id: 'cpu', order: 10 } }, { options: { id: 'mem', order: 20 } }, { options: { id: 'gpu', order: 30 } }],
}

test('items keep their slot and order until the user places them', () => {
  assert.deepEqual(arrange(entries, {}).map(item => `${item.side}:${item.id}`), ['left:awake', 'right:cpu', 'right:mem', 'right:gpu'])
  const moved = arrange(entries, { gpu: { side: 'left', order: 5 }, mem: { hidden: true } })
  assert.deepEqual(moved.map(item => `${item.side}:${item.id}`), ['left:gpu', 'left:awake', 'right:cpu', 'right:mem'])
  assert.equal(moved.find(item => item.id === 'mem').hidden, true)
})

test('placing an item renumbers only its destination side', () => {
  const items = arrange(entries, {})
  const ops = placeAt(items, 'gpu', 'right', 0)
  const next = arrange(entries, Object.fromEntries(ops.map(op => [op.path[1], { order: op.value }])))
  assert.deepEqual(next.filter(item => item.side === 'right').map(item => item.id), ['gpu', 'cpu', 'mem'])
  assert.ok(ops.every(op => op.path[1] !== 'awake'))
  const across = placeAt(items, 'cpu', 'left', Infinity)
  assert.deepEqual(across.at(-1), { op: 'set', path: ['items', 'cpu', 'side'], value: 'left' })
})

test('meters warn and turn critical at the configured thresholds', () => {
  assert.equal(levelOf(59, 60, 85), 'ok')
  assert.equal(levelOf(60, 60, 85), 'warn')
  assert.equal(levelOf(85, 60, 85), 'critical')
  assert.equal(levelOf(null, 60, 85), undefined)
})

test('activity counts chats needing the user before working ones', () => {
  const statuses = new Map([['s1', { running: true }], ['s2', { running: true, pendingInteraction: {} }], ['s3', { running: false }]])
  assert.deepEqual(attention(statuses), { working: 1, waiting: 1, next: 's2' })
})
