#!/usr/bin/env node
// End-to-end check of the real desktop build: launches Jan-Desktop on a
// throwaway data root, drives its WebView2 over the DevTools protocol and
// exits non-zero on the first failed step. Screenshots land in --out.
//
//   node scripts/e2e-desktop.mjs [--exe path] [--out dir] [--plugin dir] [--prompt text]
//                                [--providers-from <Jan data folder>] [--import-from <Jan data folder>] [--perf] [--profile] [--keep] [--root dir] [--expect-no-welcome]
//
// Each step records its wall time, main-thread long tasks and slowest
// requests in steps.json; --perf also prints the requests.
//
// --plugin installs a local plugin folder through the Plugins page and waits
// for it to report as enabled. --prompt sends one chat message and waits for a
// reply; it needs a working model, so it is off by default.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]])
  return pairs
}, []))
const root = resolve(import.meta.dirname, '..')
const exe = resolve(args.exe ?? join(root, 'src-tauri/target/debug', process.platform === 'win32' ? 'Jan-Desktop.exe' : 'Jan-Desktop'))
const out = resolve(args.out ?? join(root, 'e2e-results'))
const port = 9400 + Math.floor(Math.random() * 400)
// --root reuses a data folder (with --keep) to check what survives a relaunch.
const dataRoot = args.root ? resolve(String(args.root)) : mkdtempSync(join(tmpdir(), 'ow-e2e-'))
if (args.root) mkdirSync(dataRoot, { recursive: true })
mkdirSync(out, { recursive: true })

// --providers-from copies only the provider list (endpoints, models, selection)
// from an existing Jan data folder. Keys stay in the OS keyring under the same
// provider names, so no secret is written to the temporary root.
if (args['providers-from']) {
  const source = JSON.parse(readFileSync(join(resolve(String(args['providers-from'])), 'settings.json'), 'utf8'))
  const target = join(dataRoot, 'Jan', 'data')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'settings.json'), JSON.stringify({ 'model-provider': source['model-provider'] }))
}

// --import-from copies the two most recent Jan threads into the temporary data
// folder, so the import step reads real history without touching the source.
let importIds = []
if (args['import-from']) {
  const threads = join(resolve(String(args['import-from'])), 'threads')
  importIds = readdirSync(threads).filter(id => existsSync(join(threads, id, 'messages.jsonl')))
    .sort((a, b) => statSync(join(threads, b, 'messages.jsonl')).mtimeMs - statSync(join(threads, a, 'messages.jsonl')).mtimeMs).slice(0, 2)
  for (const id of importIds) cpSync(join(threads, id), join(dataRoot, 'Jan', 'data', 'threads', id), { recursive: true })
}

const env = { ...process.env, JAN_DATA_ROOT: dataRoot, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }
const app = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
app.stdout.on('data', d => { log += d })
app.stderr.on('data', d => { log += d })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const steps = []
const started = Date.now()
let cdp
let finishing = false

async function finish(code, error) {
  if (finishing) return
  finishing = true
  if (error) {
    console.error(`FAIL ${error.message ?? error}`)
    const shot = await cdp?.send('Page.captureScreenshot', { format: 'png' }).catch(() => undefined)
    if (shot) writeFileSync(join(out, 'failure.png'), Buffer.from(shot.data, 'base64'))
  }
  writeFileSync(join(out, 'app.log'), log)
  writeFileSync(join(out, 'steps.json'), JSON.stringify(steps, null, 2))
  cdp?.close()
  // The app's DSH host and engine are its children; kill the tree, or they keep
  // the temporary data root locked.
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  else app.kill()
  if (!args.keep) {
    await sleep(1500)
    try { rmSync(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) }
    catch (e) { console.warn(`could not remove ${dataRoot}: ${e.code ?? e.message}`) }
  }
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${steps.length} steps in ${((Date.now() - started) / 1000).toFixed(1)} s, results in ${out}`)
  process.exit(code)
}

async function until(label, check, timeoutMs = 60_000) {
  const t = Date.now()
  for (; ;) {
    const value = await check().catch(() => undefined)
    if (value) return value
    if (Date.now() - t > timeoutMs) throw new Error(`${label}: not reached within ${timeoutMs / 1000} s`)
    await sleep(50)
  }
}

function connect(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  const handlers = new Map()
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.method) handlers.get(msg.method)?.(msg.params)
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result)
  }
  const send = (method, params = {}) => new Promise((ok, fail) => {
    pending.set(++id, { resolve: ok, reject: fail })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((ok, fail) => {
    ws.onopen = () => ok({ send, on: (method, fn) => handlers.set(method, fn), close: () => ws.close() })
    ws.onerror = () => fail(new Error(`cannot open ${url}`))
  })
}

// Every check reads what a person sees: visible text and accessible names.
const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
const visible = text => evaluate(`[...document.querySelectorAll('button,[role=tab],[role=switch],h1,h2,h3,p,span,[role=status]')]
  .some(el => el.offsetParent !== null && (el.getAttribute('aria-label') === ${JSON.stringify(text)} || el.textContent.trim() === ${JSON.stringify(text)}))`)
const click = label => evaluate(`(() => {
  const el = [...document.querySelectorAll('button,[role=tab],[role=menuitem],[role=switch]')]
    .find(e => e.offsetParent !== null && !e.disabled && (e.getAttribute('aria-label') === ${JSON.stringify(label)} || e.textContent.trim() === ${JSON.stringify(label)}
      // A menu item carries a title plus a description; match its title.
      || (e.getAttribute('role') === 'menuitem' && e.textContent.trim().startsWith(${JSON.stringify(label)}))))
  if (!el) return false
  el.click()
  return true
})()`)

// What a person waits through in one step: main-thread stalls over 50 ms (the
// jank they feel) and the slowest requests the page made.
const PERF_PROBE = `(() => {
  if (window.__owPerf) return
  window.__owPerf = { long: [] }
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__owPerf.long.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
})()`
const perfSince = t0 => evaluate(`(() => {
  const long = window.__owPerf.long.filter(([s]) => s >= ${t0}).map(([, d]) => d)
  const api = performance.getEntriesByType('resource').filter(e => e.startTime >= ${t0})
    .map(e => ({ name: e.name.replace(location.origin, '').replace(/[?&]rev=\\w+/, '').slice(0, 90), ms: Math.round(e.duration) }))
    .sort((a, b) => b.ms - a.ms).slice(0, 5)
  return { longTasks: long.length, longMs: Math.round(long.reduce((a, b) => a + b, 0)), longMax: Math.round(Math.max(0, ...long)), slowest: api }
})()`)

async function step(name, run) {
  const t = Date.now()
  const t0 = await evaluate('performance.now()')
  await run()
  const seconds = (Date.now() - t) / 1000
  const perf = await perfSince(t0)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${String(steps.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
  writeFileSync(join(out, file), Buffer.from(shot.data, 'base64'))
  steps.push({ name, seconds, perf, screenshot: file })
  console.log(`ok   ${name} (${seconds.toFixed(2)} s, ${perf.longTasks} long tasks ${perf.longMs} ms, max ${perf.longMax} ms)`)
  if (args.perf) for (const r of perf.slowest) console.log(`       ${String(r.ms).padStart(6)} ms ${r.name}`)
}

try {
  app.on('exit', code => { if (code) finish(1, new Error(`app exited with ${code}\n${log.slice(-2000)}`)) })
  const page = await until('DevTools endpoint', async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return list.find(p => p.type === 'page')
  })
  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PERF_PROBE })
  await evaluate(PERF_PROBE)
  cdp.on('Runtime.consoleAPICalled', ({ type, args: a }) => {
    if (type === 'warning' || type === 'error') log += `[page ${type}] ${a.map(x => x.value ?? x.description ?? '').join(' ')}\n`
  })

  // --profile records the page's main thread from navigation to a ready shell,
  // the stretch where boot long tasks show up.
  if (args.profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start') }
  await step('shell opens', () => until('DSH shell with composer', async () =>
    (await evaluate('location.origin.startsWith("http://127.0.0.1")')) && (await evaluate('!!document.querySelector("[contenteditable=true]")')), 120_000))
  // A fresh data folder opens on the welcome; its primary action leaves it.
  if (args['expect-no-welcome']) {
    await step('welcome stays dismissed', async () => {
      await sleep(3000)
      if (await visible('Welcome to Jan')) throw new Error('the welcome came back after it was dismissed')
    })
  } else await step('welcome shows once', async () => {
    await until('welcome', () => visible('Welcome to Jan'), 30_000)
    const action = await until('welcome action', () => evaluate(`['Start chatting', 'Skip for now'].find(label => [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && !b.disabled && b.textContent.trim() === label))`), 15_000)
    if (!(await click(action))) throw new Error(`welcome action ${action} is not clickable`)
    await until('welcome closed', async () => !(await visible('Welcome to Jan')), 10_000)
  })
  const placeholder = await evaluate(`document.querySelector('[contenteditable=true]')?.closest('[data-slot], div')?.parentElement?.innerText ?? ''`)
  if (/what you want to build/i.test(String(placeholder) + await evaluate('document.body.innerText'))) throw new Error('the empty composer still asks what to build')
  for (const label of ['New Chat', 'New project', 'Search', 'Model Hub', 'Plugin manager', 'Settings']) {
    if (!(await visible(label))) throw new Error(`sidebar control "${label}" is missing`)
  }
  if (await evaluate(`[...document.querySelectorAll('[role=treeitem]')].some(el => el.offsetParent !== null && el.textContent.includes('New Session'))`)) {
    throw new Error('the chat list shows an empty "New Session" row')
  }
  if (args.profile) writeFileSync(join(out, 'boot.cpuprofile'), JSON.stringify((await cdp.send('Profiler.stop')).profile))
  if (!log.includes('[dsh-log] ready')) throw new Error('ow-log-bridge did not load; DSH errors would not reach the app log')
  await step('settings opens', async () => {
    if (!(await click('Settings'))) throw new Error('Settings is not clickable')
    await until('Settings dialog', () => evaluate('!!document.querySelector("[role=dialog]")'), 15_000)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  })
  await step('plugins page loads', async () => {
    if (!(await click('Plugin manager'))) throw new Error('Plugin manager is not clickable')
    await until('enabled Add plugin', () => evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add plugin' && !b.disabled)`), 60_000)
  })
  // An experimental bundle must apply live: its card promises a Discover tab.
  await step('experimental plugin applies live', async () => {
    const toggled = await evaluate(`(() => {
      const sw = document.querySelector('[aria-label="Enable Custom plugin indexes"]')
      if (!sw) return false
      if (!(sw.checked || sw.getAttribute('aria-checked') === 'true')) sw.click()
      return true
    })()`)
    if (!toggled) throw new Error('no switch for Custom plugin indexes')
    await until('Discover tab', () => visible('Discover'), 30_000)
  })
  if (importIds.length) {
    await step('jan chats import', async () => {
      if (!(await click('Settings'))) throw new Error('Settings is not clickable')
      await until('Settings dialog', () => evaluate('!!document.querySelector("[role=dialog]")'), 15_000)
      await until('Built-in plugins section', () => click('Built-in plugins'), 15_000)
      await until('Import from Jan tab', () => click('Import from Jan'), 15_000)
      await until('copied threads listed', () => evaluate(`document.querySelectorAll('.ow-jan-import li').length >= ${importIds.length}`), 30_000)
      await until('Select all', () => evaluate(`(() => { const box = [...document.querySelectorAll('.ow-jan-import label')].find(l => l.textContent.trim() === 'Select all'); if (!box) return false; box.click(); return true })()`), 10_000)
      await until('Import enabled', () => click(`Import selected (${importIds.length})`), 10_000)
      await until('import results', () => evaluate(`[...document.querySelectorAll('.ow-jan-import [role=status]')].filter(el => /^(imported|skipped|failed)/i.test(el.textContent.trim())).length >= ${importIds.length}`), 60_000)
      const statuses = await evaluate(`[...document.querySelectorAll('.ow-jan-import li > [role=status]')].map(el => el.textContent.trim())`)
      console.log(`     import: ${statuses.join(' | ')}`)
      if (statuses.some(text => /^failed/i.test(text))) throw new Error('a Jan chat failed to import')
      const titles = await evaluate(`[...document.querySelectorAll('.ow-jan-import li label')].map(el => el.textContent.trim())`)
      await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
      await until('imported chats in the Chats list', () => evaluate(`(() => { const rows = [...document.querySelectorAll('[role=treeitem]')].filter(el => el.offsetParent !== null).map(el => el.textContent); return ${JSON.stringify('TITLES')}.every(t => rows.some(r => r.includes(t))) })()`.replace('"TITLES"', JSON.stringify(titles))), 15_000)
    })
    // An imported chat must open on its transcript, not on an empty session.
    await step('imported chat opens', async () => {
      const first = importIds[0]
      // Match the first line of the reply: short user prompts ("hi") also occur in the UI chrome.
      const lines = readFileSync(join(dataRoot, 'Jan', 'data', 'threads', first, 'messages.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      const assistant = lines.find(message => message.role === 'assistant')
      const reply = (assistant?.content ?? []).filter(part => part.type === 'text').map(part => part.text?.value ?? part.text ?? '').join('\n').trim().split('\n')[0].slice(0, 40)
      if (!reply) throw new Error('the first copied Jan thread has no assistant text to look for')
      const title = JSON.parse(readFileSync(join(dataRoot, 'Jan', 'data', 'threads', first, 'thread.json'), 'utf8')).title
      await evaluate(`[...document.querySelectorAll('[role=treeitem]')].find(el => el.textContent.includes(${JSON.stringify(String(title).slice(0, 12))}))?.click()`)
      await until('imported reply visible', () => evaluate(`document.body.innerText.includes(${JSON.stringify(reply)})`), 15_000)
    })
  }
  if (args.plugin) {
    const folder = resolve(String(args.plugin))
    await step('local plugin installs', async () => {
      await click('Choose how to add a plugin')
      await until('install menu', () => click('Install a third-party plugin'), 10_000)
      await until('package field', () => evaluate('!!document.querySelector("input[aria-label=\'Package name or address\'], [role=dialog] input")'), 10_000)
      await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[role=dialog] input").focus()' })
      await cdp.send('Input.insertText', { text: folder })
      await until('Install enabled', () => click('Install'), 10_000)
      await until('Enable now', () => click('Enable now'), 180_000)
      // The row's own switch must agree with the "is active" claim right away.
      const label = `Enable ${JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name}`
      const enabledAt = Date.now()
      const state = () => evaluate(`(() => {
        const sw = [...document.querySelectorAll('[aria-label^="Enable "]')].find(el => el.getAttribute('aria-label').includes(${JSON.stringify(label.slice(7))}))
        return sw ? String(sw.checked ?? sw.getAttribute('aria-checked')) : 'absent'
      })()`)
      let seen = await state()
      const changes = [`0.0 s ${seen}`]
      await until('installed row switch on', async () => {
        const now = await state()
        if (now !== seen) { seen = now; changes.push(`${((Date.now() - enabledAt) / 1000).toFixed(1)} s ${now}`) }
        return now === 'true'
      }, 30_000)
      console.log(`     row switch: ${changes.join(' -> ')}`)
    })
  }
  if (args.prompt) {
    await step('reply arrives', async () => {
      await click('New Chat')
      await until('empty new chat', () => evaluate('!!document.querySelector("[contenteditable=true]") && !/Completed in/.test(document.body.innerText)'), 15_000)
      await evaluate('document.querySelector("[contenteditable=true]").focus()')
      await cdp.send('Input.insertText', { text: String(args.prompt) })
      await sleep(300)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      // Count finished turns so a transcript already on screen cannot pass this step.
      const before = await evaluate(`(document.body.innerText.match(/Completed in|This turn failed/g) ?? []).length`)
      await until('finished turn', () => evaluate(`(document.body.innerText.match(/Completed in|This turn failed/g) ?? []).length > ${before}`), 180_000)
      if (await evaluate(`document.body.innerText.includes('This turn failed')`)) throw new Error('the turn failed; see the screenshot')
    })
  }
  await finish(0)
} catch (error) {
  await finish(1, error)
}
