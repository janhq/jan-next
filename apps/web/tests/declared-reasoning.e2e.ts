// Web e2e scenario: a hand-declared model's `reasoningEfforts` reaches the
// composer's model details card — the levels a settings profile declares are exactly
// what the picker offers, and picking one records it with the Agent default.
// Zero model calls: declaring, describing, and switching are settings/llm
// traffic only, so there is no fixture and a stray stream would fail loud.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page, Request } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, saveFailureShot } from './support.ts'

/** Starts the shipped default on this scenario's declared reasoning model. */
const OVERLAY = fileURLToPath(new URL('./declared-reasoning.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/declared-reasoning', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/ui.expected.md', import.meta.url))
const POINTER_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/pointer-menu.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record').each([
  { name: 'Chromium', engine: chromium },
  { name: 'WebKit', engine: webkit },
])('web e2e: declared reasoning efforts reach the composer ($name)', ({ engine }) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // The whole reasoning offer is the profile: key = selectable level, value
    // = the wire spelling dispatch would send (`max: ultra` renames; the
    // valueless `off` means "supported, send nothing"). The route sets no
    // deployment default, so the card leads with the provider-default entry.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [
            { id: 'acme-think', name: 'Acme Think' },
            { id: 'acme-swift', name: 'Acme Swift' },
            { id: 'acme-lite', name: 'Acme Lite' },
          ].map(model => ({
            ...model,
            reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
          })),
        },
      },
    })
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('offers exactly the declared levels and records the picked one', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-declared-reasoning-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    const details = page.getByRole('group', { name: 'Acme Think details', exact: true })
    const search = page.getByRole('searchbox', { name: 'Search models…' })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()

    // Declared levels, nothing else: the provider-default entry (the route
    // configures no `reasoning`), then Off/High/Max — minimal, low, medium,
    // and xhigh were not declared and must not be offered.
    const levels = details.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'High', 'Max'])
    const snapshot = await captureStableAria(page, '[role="group"][aria-label="Acme Think details"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    // Right from search enters the details card on its checked level; ↑↓ walk
    // the card's rows and Tab settles the focused one exactly as Enter would.
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect.poll(
      () => levels.nth(0).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(1).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(2).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)

    // Settling with Tab is the same gesture that saves the default selection, so
    // the effort lands in the Agent default Settings section beside provider/model.
    await page.keyboard.press('Tab')
    await expect.poll(() => surface.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('reasoningEffort: high')
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('Select model, current Acme Think, reasoning effort High')

    // Reopening parks the card on the level in use, and Shift+Tab walks back
    // out like Escape: to search, then closed.
    await trigger.click()
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('ArrowRight')
    const high = details.getByRole('radio', { name: 'High' })
    await expect.poll(
      () => high.evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(
      () => search.evaluate(element => element === element.ownerDocument.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => surface.count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens from the pointer with keyboard focus and closes from the trigger in the list and the details card', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-trigger-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    for (const pane of ['list', 'details']) {
      await page.locator('[data-composer-input][contenteditable="true"]').focus()
      await trigger.click()
      const search = page.getByRole('searchbox', { name: 'Search models…' })
      await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      if (pane === 'details') {
        await page.keyboard.press('ArrowRight')
        const checked = page.getByRole('radiogroup', { name: 'Effort' }).locator('[role="radio"][aria-checked="true"]')
        await expect.poll(() => checked.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      }
      await trigger.click()
      await surface.waitFor({ state: 'detached' })
      await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('selects model and effort by mouse and keeps keyboard control after cancelled or rejected clicks', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-pointer-${engine.name()}`))
    let selections = 0
    const countSelection = (request: Request): void => {
      if (new URL(request.url()).pathname.endsWith('/session/selectModel')) selections++
    }
    page.on('request', countSelection)
    onTestFinished(() => { page.off('request', countSelection) })
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const menu = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    await trigger.click()
    const current = page.getByRole('menuitemradio', { name: 'Acme Think', exact: true })
    const target = page.getByRole('menuitemradio', { name: 'Acme Swift', exact: true })
    const search = page.getByRole('searchbox', { name: 'Search models…' })
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))

    // Native mousedown must not blur search and unmount the menu before click in WebKit.
    await target.getByText('Acme Swift', { exact: true }).hover()
    await page.mouse.down()
    try {
      await expect.poll(() => menu.count()).toBe(1)
      await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      await menu.getByText('Acme Gateway', { exact: true }).hover()
    } finally {
      await page.mouse.up()
    }
    // Later selection counts also include any request from this cancelled press.
    expect(selections).toBe(0)
    // Rows sort by name: Acme Swift sits directly above Acme Think.
    await search.press('ArrowDown')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))
    await search.press('ArrowUp')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })

    await trigger.click()
    await target.getByText('Acme Swift', { exact: true }).click()
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(1)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().model, { timeout: 10_000 })
      .toBe('acme-swift')

    await trigger.click()
    await page.getByRole('group', { name: 'Acme Swift details', exact: true }).getByRole('radio', { name: 'Max', exact: true }).click()
    await menu.waitFor({ state: 'detached' })
    expect(selections).toBe(2)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort, { timeout: 10_000 })
      .toBe('max')

    await page.route('**/api/session/selectModel', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({
        json: {
          type: 'server-response', rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: { code: 'session/writer-held', message: 'writer held', details: { sessionId: 'held-session' } },
          },
        },
      })
    }, { times: 1 })
    await trigger.click()
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await current.click()
    await page.getByRole('alert').waitFor()
    expect(selections).toBe(3)
    await compareOrRefreshGolden(POINTER_EXPECTED,
      await captureStableAria(page, '[role="group"][aria-label="Model and reasoning effort"]', scaffold.workspaceCwd), MODE)
    await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Tab')
    await expect.poll(() => search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(await target.getAttribute('id'))
    await search.press('ArrowDown')
    expect(await search.getAttribute('aria-activedescendant')).toBe(await current.getAttribute('id'))
    expect(await search.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })

    await trigger.click()
    await page.locator('[data-composer-input][contenteditable="true"]').focus()
    await menu.waitFor({ state: 'detached' })
    await trigger.click()
    await page.mouse.click(0, 0)
    await menu.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md', 'pointer-menu.expected.md'])
  })
})
