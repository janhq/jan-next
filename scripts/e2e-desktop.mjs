#!/usr/bin/env node
// End-to-end check of the real desktop build: launches Jan-Desktop on a
// throwaway data root, drives its WebView2 over the DevTools protocol and
// exits non-zero on the first failed step. Screenshots land in --out.
//
//   node scripts/e2e-desktop.mjs [--exe path] [--out dir] [--plugin dir] [--prompt text]
//                                [--providers-from <Jan data folder>] [--keep]
//
// --plugin installs a local plugin folder through the Plugins page and waits
// for it to report as enabled. --prompt sends one chat message and waits for a
// reply; it needs a working model, so it is off by default.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const dataRoot = mkdtempSync(join(tmpdir(), 'ow-e2e-'))
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
    await sleep(250)
  }
}

function connect(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data)
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
    ws.onopen = () => ok({ send, close: () => ws.close() })
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

async function step(name, run) {
  const t = Date.now()
  await run()
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${String(steps.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
  writeFileSync(join(out, file), Buffer.from(shot.data, 'base64'))
  steps.push({ name, seconds: (Date.now() - t) / 1000, screenshot: file })
  console.log(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`)
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

  await step('shell opens', () => until('DSH shell with composer', async () =>
    (await evaluate('location.origin.startsWith("http://127.0.0.1")')) && (await evaluate('!!document.querySelector("[contenteditable=true]")')), 120_000))
  for (const label of ['New Chat', 'New project', 'Search', 'Model Hub', 'Plugin manager', 'Settings']) {
    if (!(await visible(label))) throw new Error(`sidebar control "${label}" is missing`)
  }
  if (await evaluate(`[...document.querySelectorAll('[role=treeitem]')].some(el => el.offsetParent !== null && el.textContent.includes('New Session'))`)) {
    throw new Error('the chat list shows an empty "New Session" row')
  }
  await step('settings opens', async () => {
    if (!(await click('Settings'))) throw new Error('Settings is not clickable')
    await until('Settings dialog', () => evaluate('!!document.querySelector("[role=dialog]")'), 15_000)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  })
  await step('plugins page loads', async () => {
    if (!(await click('Plugin manager'))) throw new Error('Plugin manager is not clickable')
    await until('enabled Add plugin', () => evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add plugin' && !b.disabled)`), 60_000)
  })
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
    })
  }
  if (args.prompt) {
    await step('reply arrives', async () => {
      await click('New Chat')
      await until('composer', () => evaluate('!!document.querySelector("[contenteditable=true]")'), 15_000)
      await evaluate('document.querySelector("[contenteditable=true]").focus()')
      await cdp.send('Input.insertText', { text: String(args.prompt) })
      await sleep(300)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await until('finished turn', () => evaluate(`/Completed in|This turn failed/.test(document.body.innerText)`), 180_000)
      if (await evaluate(`document.body.innerText.includes('This turn failed')`)) throw new Error('the turn failed; see the screenshot')
    })
  }
  await finish(0)
} catch (error) {
  await finish(1, error)
}
