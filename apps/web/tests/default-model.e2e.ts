// Web e2e scenario: switching models in the composer is how this deployment's
// default is chosen. The gesture writes the shared `agent-default-model` settings section, a
// session created afterwards starts from it, and a session that already logged
// a route keeps deriving from its own log — the tier order the gateway
// resolves on every read.
// Zero model calls: the switch is settings/llm-domain traffic only, so there
// is no fixture and a stray stream would fail loud because the adapter registry is empty. Both
// routes are declared host-side (not through the UI, which has its own
// scenario) through the pi-ai adapter the shipped tree already mounts: a
// fixture-less scaffold registers no adapter at all, so the routes the
// picker offers — and the one the composer must start on — have to come from
// somewhere, and settings profiles are the product's own way to add them.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@janhq/jan-session'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, saveFailureShot } from './support.ts'

/** Points the shipped shared Agent default at this scenario's own route. */
const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))

/** The route this scenario starts on, patched over the shipped default. */
const START_ROUTE = 'origin-gateway'
const START_MODEL = 'origin-large'
/** The route the switch lands on, which then becomes the saved default. */
const ROUTE = 'acme-gateway'
const MODEL = 'acme-large'
/** Keyboard stops of the model menu and its details card, as the product walks them. */
const MENU_ROWS = 'button:is([role="menuitem"], [role="menuitemradio"], [role="radio"], [role="switch"]):not([disabled])'

/** Escape leaves the details card first, then closes the menu. */
async function closeModelMenu(page: Page): Promise<void> {
  const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
  for (let attempt = 0; attempt < 2 && await surface.count() > 0; attempt++) await page.keyboard.press('Escape')
  await surface.waitFor({ state: 'detached' })
}

/** Opens the /model popup from the composer's command menu. */
async function openModelCommand(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse commands', exact: true }).click()
  await page.getByRole('option', { name: /^Model/ }).click()
}

/** Opens the scenario's Workspace from a page that has no session yet. */
async function chooseWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Choose project', exact: true }).click()
  await page.getByRole('menuitem', { name: /^This (computer|Mac)$/ }).click()
  await page.getByRole('menuitem', { name: 'workspace', exact: true }).click()
}

describe('web e2e: the composer model switch is the default for later sessions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Create one session and its agent through the same wire face the browser uses. */
  const createSession = async (sessionId: string): Promise<string> => {
    const response = await scaffold.ctx.sessionController.create({
      sessionId: SessionId(sessionId),
      cwd: scaffold.workspaceCwd,
    })
    return response.sessionId
  }

  /** The route the Client derives from the Session projection and Host default. */
  const currentOf = (sessionId: string): Promise<unknown> => {
    const session = scaffold.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) throw new Error(`session "${sessionId}" is not live`)
    return Promise.resolve(
      scaffold.ctx.sessionProjections.snapshot(session).values.modelSelection?.next
        ?? scaffold.ctx.agentDefaultModel.currentSelection(),
    )
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Two routes so the picker has somewhere to start and somewhere to go.
    // Declared through the settings seam rather than the Models page: this
    // scenario is about the composer, and the declaring flow is covered by
    // models-settings.e2e.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        [START_ROUTE]: {
          displayName: 'Origin Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.origin.example/v1',
          models: [{ id: START_MODEL, name: 'Origin Large' }],
        },
        [ROUTE]: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }, { id: 'acme-small', name: 'Acme Small' }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The composer's seats only exist once a workspace is connected: without
    // one the input is the locked placeholder and no session scope is open.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('exposes inline model labels with exact routes throughout the composer picker', async () => {
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const label = '[data-provider-id][data-model-id]'
    const readLabels = (surface: Locator) => surface.locator(label).evaluateAll(nodes => nodes.map(node => ({
      provider: node.getAttribute('data-provider-id'), model: node.getAttribute('data-model-id'),
      name: node.textContent, slot: node.querySelector('[data-slot]')?.getAttribute('data-slot'),
      inline: node.tagName === 'SPAN' && node.querySelector('div') === null,
    })))
    const current = {
      provider: START_ROUTE, model: START_MODEL, name: 'Origin Large',
      slot: 'conversation.input.model.label', inline: true,
    }
    await expect.poll(() => readLabels(trigger)).toEqual([current])
    try {
      await trigger.click()
      const menu = page.getByRole('menu', { name: 'Model', exact: true })
      await menu.locator(label).first().waitFor()
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/model-labels.expected.md', import.meta.url)),
        JSON.stringify(await readLabels(menu), null, 2),
        webSnapshotMode(),
      )
    } finally {
      await closeModelMenu(page)
    }
  })

  it('reanchors the model menu when a label grows and shrinks without a window resize', async () => {
    const viewport = page.viewportSize()!
    const trigger = page.getByRole('button', { name: /^Select model/ })
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await trigger.click()
      const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
      const label = surface.locator('[data-provider-id="origin-gateway"][data-model-id="origin-large"]')
      await label.waitFor()
      const original = await surface.boundingBox()
      expect(original).not.toBeNull()
      // A Slot descendant can resize independently of ModelSelect's props and state.
      await label.evaluate((node) => {
        const badge = node.ownerDocument.createElement('span')
        badge.dataset.modelLabelResizeProbe = ''
        badge.textContent = ' — Provider identification badge with a long channel name'
        node.appendChild(badge)
      })
      await expect.poll(async () => (await surface.boundingBox())!.width).toBeGreaterThan(original!.width + 50)
      await expect.poll(async () => {
        const box = (await surface.boundingBox())!
        return box.x >= 12 && box.x + box.width <= 378
      }).toBe(true)
      await label.locator('[data-model-label-resize-probe]').evaluate((node) => { node.remove() })
      await expect.poll(async () => (await surface.boundingBox())!.width).toBeCloseTo(original!.width)
      await expect.poll(async () => (await surface.boundingBox())!.x).toBeCloseTo(original!.x)
    } finally {
      await closeModelMenu(page)
      await page.setViewportSize(viewport)
    }
  })

  it('keeps command popup search borders transparent in both palettes', async () => {
    const composer = page.locator('[data-composer-input]').first()
    await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Browse commands', exact: true }).click()
    const commandMenuBounds = await page.locator('[data-trigger-menu]').boundingBox()
    await page.getByRole('option', { name: /^Model/ }).click()
    const search = page.getByRole('textbox', { name: 'Filter options', exact: true })
    await search.waitFor()
    try {
      const popupBounds = await page.locator('[aria-label="/model options"]').boundingBox()
      expect(popupBounds).not.toBeNull()
      expect(commandMenuBounds).not.toBeNull()
      // The command list is compact; the /model options span the composer from the same left edge.
      const composerBounds = await page.locator('[data-composer-card]').first().boundingBox()
      expect(commandMenuBounds!.width).toBeLessThan(composerBounds!.width)
      expect(popupBounds!.width).toBeCloseTo(composerBounds!.width, 0)
      expect(popupBounds!.x).toBeCloseTo(commandMenuBounds!.x)
      expect(await search.getAttribute('placeholder')).toBe('Search models…')
      // Command menu height changes where the pointer lands in the model popup.
      await page.getByRole('option', { name: 'Acme Large', exact: true }).hover()
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/command-picker.expected.md', import.meta.url)),
        await captureStableAria(page, '[aria-label="/model options"]', scaffold.workspaceCwd),
        webSnapshotMode(),
      )
      await search.fill('no-model-matches')
      await page.getByText('No matching models.', { exact: true }).waitFor()
      await search.fill('')
      const borders = await search.evaluate((input) => {
        const body = input.ownerDocument.body
        const previousTheme = body.getAttribute('data-ds-dark-theme')
        try {
          return [false, true].map((dark) => {
            body.toggleAttribute('data-ds-dark-theme', dark)
            return getComputedStyle(input).borderColor
          })
        } finally {
          if (previousTheme === null) body.removeAttribute('data-ds-dark-theme')
          else body.setAttribute('data-ds-dark-theme', previousTheme)
        }
      })
      expect(borders).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
    } finally {
      await search.press('Escape')
      await composer.fill('')
    }
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', automatic: false },
    { device: 'Android Chrome', userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36', automatic: false },
    { device: 'iPhone Chrome', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/139.0.0.0 Mobile/15E148 Safari/604.1', automatic: false },
    { device: 'narrow desktop', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', automatic: true },
  ])('respects $device composer sizing and search focus when opening /model', async ({ userAgent, automatic }) => {
    const context = await browser.newContext({
      userAgent, viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: !automatic,
    })
    try {
      const devicePage = await context.newPage()
      const consoleWatch = watchConsole(devicePage)
      await devicePage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chooseWorkspace(devicePage)
      const composer = devicePage.locator('[data-composer-input][contenteditable="true"]').first()
      await composer.waitFor()
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe(automatic ? '14px' : '16px')
      await composer.fill('/model')
      await devicePage.getByRole('option', { name: /^Model/ }).click()
      const search = devicePage.getByRole('textbox', { name: 'Filter options', exact: true })
      await search.waitFor()
      await devicePage.getByRole('option', { name: /Origin Large/ }).waitFor()
      expect(await search.evaluate(input => document.activeElement === input)).toBe(automatic)
      await search.click()
      expect(await search.evaluate(input => document.activeElement === input)).toBe(true)
      await search.fill('Origin')
      await devicePage.getByRole('option', { name: /Origin Large/ }).waitFor()
      expect(await devicePage.getByRole('option', { name: /Acme/ }).count()).toBe(0)
      await search.press('Escape')
      await composer.fill('')
      expect(consoleWatch.pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', platform: 'iPhone' },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', platform: 'MacIntel' },
  ])('retains model menu keyboard focus on $device', async ({ userAgent, platform }) => {
    const context = await browser.newContext({
      userAgent, viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true,
    })
    try {
      await context.addInitScript(({ platform }) => {
        Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
      }, { platform })
      const devicePage = await context.newPage()
      const consoleWatch = watchConsole(devicePage)
      await devicePage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chooseWorkspace(devicePage)
      const trigger = devicePage.getByRole('button', { name: /^Select model/ })
      const observations: string[] = []
      const observeFocus = async (action: string): Promise<void> => {
        const focused = await devicePage.evaluate(() => {
          const element = document.activeElement!
          const role = element.getAttribute('role') ?? element.tagName.toLowerCase()
          const label = element.getAttribute('aria-label') ?? element.textContent?.replace(/\s+/g, ' ').trim()
          return `${role}: ${label}`
        })
        observations.push(`${action}: ${focused}`)
      }
      await trigger.click()
      await expect.poll(() => trigger.evaluate(element => document.activeElement === element)).toBe(true)
      await observeFocus('Open')
      await devicePage.keyboard.press('ArrowDown')
      const search = devicePage.getByRole('searchbox', { name: 'Search models…' })
      expect(await search.evaluate(input => getComputedStyle(input).fontSize)).toBe('16px')
      await expect.poll(() => search.evaluate(element => document.activeElement === element)).toBe(true)
      expect(await search.getAttribute('aria-activedescendant'))
        .toBe(await devicePage.getByRole('menuitemradio', { name: 'Acme Large', exact: true }).getAttribute('id'))
      await observeFocus('Navigate models')
      await devicePage.keyboard.press('ArrowRight')
      const favorite = devicePage.getByRole('group', { name: 'Acme Large details', exact: true }).getByRole('switch', { name: 'Favorite' })
      await expect.poll(() => favorite.evaluate(element => document.activeElement === element)).toBe(true)
      await observeFocus('Enter details')
      await devicePage.keyboard.press('ArrowLeft')
      await expect.poll(() => search.evaluate(element => document.activeElement === element)).toBe(true)
      await observeFocus('Return to search')
      await devicePage.keyboard.press('Escape')
      await expect.poll(() => trigger.evaluate(element => document.activeElement === element)).toBe(true)
      await observeFocus('Close')
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
      expect(consoleWatch.pageErrors).toEqual([])
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/mobile-keyboard.expected.md', import.meta.url)),
        observations.join('\n'), webSnapshotMode(),
      )
    } finally {
      await context.close()
    }
  })

  it('shares provider order, fuzzy result order and sticky header material between both model pickers', async () => {
    const readGroups = (surface: Locator, role: 'option' | 'menuitemradio') => surface.locator('[data-menu-group]')
      .evaluateAll((groups, rowRole) => groups.map(group => ({
        label: group.querySelector('[data-menu-group-heading]')!.textContent,
        rows: [...group.querySelectorAll(`[role="${rowRole}"]`)].map(row => row.textContent),
      })), role)
    const checkSticky = async (surface: Locator, viewport: Locator) => {
      // Bound only this test's list viewport so native scrolling can cross a heading.
      await viewport.evaluate((node) => { node.style.maxHeight = '80px'; node.scrollTop = 0 })
      const heading = surface.locator('[data-menu-group-heading]').first()
      await expect.poll(() => heading.getAttribute('data-stuck')).toBeNull()
      const clear = await heading.evaluate(node => getComputedStyle(node).backgroundColor)
      expect(clear).toBe('rgba(0, 0, 0, 0)')
      await viewport.evaluate((node) => { node.scrollTop = 10 })
      await expect.poll(() => heading.getAttribute('data-stuck')).toBe('')
      const stuck = await heading.evaluate((node) => {
        const style = getComputedStyle(node)
        return { fill: style.backgroundColor, radius: style.borderRadius, font: style.fontSize, padding: style.padding }
      })
      await viewport.evaluate((node) => { node.scrollTop = 0 })
      await expect.poll(() => heading.getAttribute('data-stuck')).toBeNull()
      return stuck
    }
    try {
      await page.getByRole('button', { name: /^Select model/ }).click()
      const menu = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
      const menuSearch = page.getByRole('searchbox', { name: 'Search models…' })
      await menu.getByRole('menuitemradio').first().waitFor()
      const order = await readGroups(menu, 'menuitemradio')
      const sticky = await checkSticky(menu, menu.getByRole('menu', { name: 'Model', exact: true }))
      await menuSearch.fill('  acme LARGE  ')
      const filtered = await readGroups(menu, 'menuitemradio')
      await menuSearch.press('Escape')
      await menu.waitFor({ state: 'detached' })
      await openModelCommand(page)
      const popup = page.locator('[aria-label="/model options"]')
      await popup.getByRole('option').first().waitFor()
      expect(await readGroups(popup, 'option')).toEqual(order)
      expect(await checkSticky(popup, popup.getByRole('listbox'))).toEqual(sticky)
      const popupSearch = page.getByRole('textbox', { name: 'Filter options', exact: true })
      await popupSearch.fill('  acme LARGE  ')
      expect(await readGroups(popup, 'option')).toEqual(filtered)
      expect(await popupSearch.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
    }
  })

  it('hides search only in the button menu when four models remain', async () => {
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const search = page.getByRole('searchbox', { name: 'Search models…' })
    const setModels = (expanded: boolean) => scaffold.ctx.settings.update('llm-pi-ai', {
      providers: { [ROUTE]: {
        displayName: 'Acme Gateway', api: 'openai-completions', baseURL: 'https://gateway.acme.example/v1',
        models: expanded ? [{ id: MODEL, name: 'Acme Large' }, { id: 'acme-small', name: 'Acme Small' }]
          : [{ id: MODEL, name: 'Acme Large' }],
      } },
    })
    try {
      await setModels(false)
      await trigger.click()
      await expect.poll(() => page.getByRole('menuitemradio').count()).toBe(4)
      expect(await search.count()).toBe(0)
      const current = page.getByRole('menuitemradio', { name: 'Origin Large', exact: true })
      await expect.poll(() => current.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
      const rows = page.getByRole('menuitemradio')
      const currentId = await current.getAttribute('id')
      const stops = await page.getByRole('group', { name: 'Model and reasoning effort', exact: true }).locator(MENU_ROWS).count()
      expect(stops).toBeGreaterThan(4)
      for (let index = 0; index < stops; index++) await page.keyboard.press('ArrowDown')
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(currentId)
      await page.keyboard.press('Enter')
      await expect.poll(() => trigger.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
      expect(await trigger.evaluate(node => getComputedStyle(node).boxShadow)).toBe('none')
      await openModelCommand(page)
      const commandSearch = page.getByRole('textbox', { name: 'Filter options', exact: true })
      await commandSearch.waitFor()
      expect(await commandSearch.getAttribute('placeholder')).toBe('Search models…')
      await commandSearch.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
      expect(await rows.count()).toBe(0)
    } finally {
      await closeModelMenu(page)
      await setModels(true)
      await trigger.click()
      await expect.poll(() => page.getByRole('menuitemradio').count()).toBe(5)
      await search.waitFor()
      await closeModelMenu(page)
    }
  })

  it('paints only pinned provider headings across themes, filtering, and reopening', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-sticky-headings'))
    const originalViewport = page.viewportSize()!
    const attributes = await page.evaluate(() => ({
      platform: document.documentElement.getAttribute('data-platform'),
      theme: document.body.getAttribute('data-ds-dark-theme'),
    }))
    const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    const trigger = page.getByRole('button', { name: /^Select model/ })
    const search = page.getByRole('searchbox', { name: 'Search models…' })
    try {
      await page.setViewportSize({ width: 1680, height: 400 })
      await trigger.click()
      const scroller = page.getByRole('menu', { name: 'Model', exact: true })
      const headings = surface.locator('section[role="group"] > div')
      const readPinned = () => headings.evaluateAll(nodes => nodes.map(node => node.hasAttribute('data-stuck')))
      const resetScroll = async (): Promise<void> => {
        await scroller.evaluate((node) => { node.scrollTop = 0 })
        await expect.poll(readPinned).toEqual([false, false, false])
      }
      for (const platform of ['web', 'win32', 'darwin']) {
        for (const dark of [false, true]) {
          await page.evaluate(({ platform, dark }) => {
            if (platform === 'web') document.documentElement.removeAttribute('data-platform')
            else document.documentElement.setAttribute('data-platform', platform)
            document.body.toggleAttribute('data-ds-dark-theme', dark)
          }, { platform, dark })
          await resetScroll()
          expect(await headings.evaluateAll(nodes => [...new Set(nodes.map(node => getComputedStyle(node).backgroundColor))]))
            .toEqual(['rgba(0, 0, 0, 0)'])
          const secondTop = await scroller.evaluate((node) => {
            const second = node.querySelectorAll('section')[1]!
            return Math.ceil(second.getBoundingClientRect().top - node.getBoundingClientRect().top) + 1
          })
          expect(await scroller.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThanOrEqual(secondTop)
          await scroller.evaluate((node) => { node.scrollTop = 10 })
          await expect.poll(readPinned).toEqual([true, false, false])
          expect(await headings.first().evaluate(node => getComputedStyle(node).backgroundColor))
            .toBe(dark ? 'rgba(48, 49, 54, 0.94)' : 'rgba(248, 249, 250, 0.94)')
          await scroller.evaluate((node, top) => { node.scrollTop = top }, secondTop)
          await expect.poll(readPinned).toEqual([false, true, false])
          await scroller.evaluate((node) => { node.scrollTop = 10 })
          await expect.poll(readPinned).toEqual([true, false, false])
          await resetScroll()
        }
      }
      await scroller.evaluate((node) => { node.scrollTop = 10 })
      await expect.poll(readPinned).toEqual([true, false, false])
      await search.fill('Origin Large')
      await expect.poll(() => headings.count()).toBe(1)
      await expect.poll(readPinned).toEqual([false])
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect.poll(readPinned).toEqual([false, false, false])
      await search.fill('zzzz')
      await expect.poll(() => surface.locator('[data-stuck]').count()).toBe(0)
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect.poll(readPinned).toEqual([false, false, false])
      await search.press('Escape')
      await surface.waitFor({ state: 'detached' })
      await trigger.click()
      expect(await search.inputValue()).toBe('')
      await resetScroll()
    } finally {
      await closeModelMenu(page)
      await page.setViewportSize(originalViewport)
      await page.evaluate(({ platform, theme }) => {
        if (platform === null) document.documentElement.removeAttribute('data-platform')
        else document.documentElement.setAttribute('data-platform', platform)
        if (theme === null) document.body.removeAttribute('data-ds-dark-theme')
        else document.body.setAttribute('data-ds-dark-theme', theme)
      }, attributes)
    }
  })

  it('writes the switched model as the default and leaves a logged session alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model'))
    // A session that has already run a turn, spelled as the fact a turn
    // leaves behind: its own logged route.
    const loggedId = await createSession('default-model-logged')
    scaffold.ctx.sessions.get(SessionId(loggedId))?.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })

    const trigger = page.getByRole('button', { name: /^Select model/ })
    await trigger.waitFor({ timeout: 15_000 })
    expect(await trigger.evaluate(element => getComputedStyle(element).fontWeight)).toBe('400')
    await trigger.click()
    const surface = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    const modelMenuBounds = await surface.boundingBox()
    const composerBounds = await page.locator('[data-composer-card]').first().boundingBox()
    expect(modelMenuBounds!.width).toBeLessThan(composerBounds!.width)
    const search = page.getByRole('searchbox', { name: 'Search models…' })
    await surface.getByRole('menuitemradio').first().waitFor()
    const rowIds = await page.getByRole('menuitemradio').evaluateAll(rows => rows.map(row => row.id))
    const initialHighlight = rowIds.indexOf(await search.getAttribute('aria-activedescendant') ?? '')
    expect(initialHighlight).toBeGreaterThanOrEqual(0)
    for (let step = initialHighlight + 1; step < rowIds.length; step++) {
      await search.press('ArrowDown')
      expect(await search.getAttribute('aria-activedescendant')).toBe(rowIds[step])
      expect(await search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
    }
    // Down past the last result walks the option rows below the list, then wraps to the first result.
    const optionRows = page.getByRole('menu', { name: 'Model options', exact: true }).locator(MENU_ROWS)
    const optionCount = await optionRows.count()
    expect(optionCount).toBeGreaterThan(0)
    for (let index = 0; index < optionCount; index++) {
      await page.keyboard.press('ArrowDown')
      await expect.poll(() => optionRows.nth(index).evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    }
    const manage = page.getByRole('menuitem', { name: 'Manage models…', exact: true })
    expect(await manage.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
    expect(await manage.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    expect(await manage.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    const focusedBackground = await manage.evaluate(element => getComputedStyle(element).backgroundColor)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
    expect(await search.getAttribute('aria-activedescendant')).toBe(rowIds[0])
    await search.press('ArrowUp')
    expect(await search.getAttribute('aria-activedescendant')).toBe(rowIds.at(-1))
    await manage.hover()
    expect(await manage.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(focusedBackground)
    const searchStyle = await search.evaluate((input) => {
      const wrapper = input.parentElement!
      const caption = input.ownerDocument.createElement('span')
      caption.style.color = 'var(--dsw-alias-label-caption)'
      wrapper.append(caption)
      try {
        return {
          placeholderColor: getComputedStyle(input, '::placeholder').color,
          captionColor: getComputedStyle(caption).color,
          iconCount: wrapper.querySelectorAll('svg').length,
          background: getComputedStyle(wrapper).backgroundColor,
          radius: getComputedStyle(wrapper).borderRadius,
          padding: getComputedStyle(wrapper).padding,
          fontSize: getComputedStyle(input).fontSize,
        }
      } finally {
        caption.remove()
      }
    })
    expect(searchStyle.placeholderColor).toBe(searchStyle.captionColor)
    expect(searchStyle.iconCount).toBe(1)
    expect(searchStyle.background).toBe('rgba(0, 0, 0, 0)')
    expect(searchStyle.radius).toBe('12px')
    expect(searchStyle.padding).toBe('5px 7px')
    expect(searchStyle.fontSize).toBe('12px')
    const modelWeights = await page.getByRole('menuitemradio').evaluateAll(rows => rows.map(row =>
      `${row.getAttribute('aria-checked')}:${getComputedStyle(row.querySelector('span span')!).fontWeight}`,
    ))
    expect(new Set(modelWeights)).toEqual(new Set(['false:400', 'true:600']))
    const headingPalettes = await page.getByRole('group', { name: 'Model and reasoning effort', exact: true }).evaluate((menu) => {
      const html = menu.ownerDocument.documentElement
      const body = menu.ownerDocument.body
      const previousPlatform = html.getAttribute('data-platform')
      const previousTheme = body.getAttribute('data-ds-dark-theme')
      try {
        return ['web', 'win32', 'darwin'].flatMap(platform => [false, true].map((dark) => {
          if (platform === 'web') html.removeAttribute('data-platform')
          else html.setAttribute('data-platform', platform)
          body.toggleAttribute('data-ds-dark-theme', dark)
          const headings = [...menu.querySelectorAll('section[role="group"] > div')]
          return {
            platform, dark,
            headingFills: [...new Set(headings.map(heading => getComputedStyle(heading).backgroundColor))],
            positions: [...new Set(headings.map(heading => getComputedStyle(heading).position))],
            headingRadii: [...new Set(headings.map(heading => getComputedStyle(heading).borderRadius))],
            optionRadius: getComputedStyle(menu.querySelector('[role="menuitemradio"]')!).borderRadius,
            menuFill: getComputedStyle(menu.querySelector(':scope > [aria-hidden="true"]')!).backgroundColor,
            searchBorder: getComputedStyle(menu.querySelector('input')!.parentElement!).borderColor,
          }
        }))
      } finally {
        if (previousPlatform === null) html.removeAttribute('data-platform')
        else html.setAttribute('data-platform', previousPlatform)
        if (previousTheme === null) body.removeAttribute('data-ds-dark-theme')
        else body.setAttribute('data-ds-dark-theme', previousTheme)
      }
    })
    for (const palette of headingPalettes) {
      expect(palette.headingFills, `${palette.platform}, dark=${String(palette.dark)}`)
        .toEqual(['rgba(0, 0, 0, 0)'])
      expect(palette.menuFill).toBe(palette.dark ? 'rgba(48, 49, 54, 0.64)' : 'rgba(252, 253, 254, 0.7)')
      expect(palette.searchBorder).toBe('rgba(0, 0, 0, 0)')
      expect(palette.positions).toEqual(['sticky'])
      expect(palette.headingRadii).toEqual([palette.platform === 'darwin' ? '0px' : palette.optionRadius])
    }
    await search.fill('zzzz')
    await page.getByText('No matching models.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    expect(await search.inputValue()).toBe('')
    expect(await search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
    expect(await page.getByRole('menuitemradio').count()).toBe(modelWeights.length)
    expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0)
    await search.fill('  acme LARGE  ')
    expect(await page.getByRole('menuitemradio').allTextContents()).toEqual(['Acme Large'])
    expect(await page.getByRole('group', { name: 'Origin Gateway', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/default-model/search.expected.md', import.meta.url)),
      await captureStableAria(page, '[role="group"][aria-label="Model and reasoning effort"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const blocked = scaffold.ctx.hmr.runExclusive(async () => {
      entered.resolve(undefined)
      await release.promise
    })
    try {
      await entered.promise
      await expect.poll(() => search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
      expect(await search.getAttribute('aria-activedescendant'))
        .toBe(await page.getByRole('menuitemradio', { name: 'Acme Large' }).getAttribute('id'))
      await page.keyboard.press('Enter')
      await expect.poll(() => trigger.getAttribute('aria-busy')).toBe('false')
      await expect.poll(() => trigger.textContent()).toContain('Acme Large')
      await expect.poll(() => trigger.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      expect(await trigger.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none')
      expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: START_ROUTE, model: START_MODEL })
      const aria = await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/default-model/background-save.expected.md', import.meta.url)), aria, webSnapshotMode())
    } finally {
      release.resolve(undefined)
      await blocked
    }

    // The switch is what sets the default: the shared Agent-route settings section
    // now names it, beside the provider profiles the Models page writes.
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('id: agent-default-model')
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain(`provider: ${ROUTE}`)
    expect(document).toContain(`model: ${MODEL}`)

    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection())
      .toEqual({ provider: ROUTE, model: MODEL })
    // A session created after the switch starts from it...
    expect(await currentOf(await createSession('default-model-after')))
      .toEqual({ provider: ROUTE, model: MODEL })
    // ...while the one holding a logged route keeps deriving from its log.
    expect(await currentOf(loggedId)).toEqual({ provider: START_ROUTE, model: START_MODEL })
    await trigger.press('Tab')
    await trigger.focus()
    expect(await trigger.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    expect(await trigger.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('retains the saved route and editable composer when its provider is removed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model-blocked'))
    const box = page.locator('[data-composer-input]').first()
    await expect.poll(async () => box.isEnabled(), { timeout: 10_000 }).toBe(true)

    // Removing the selected provider preserves the other route and the saved
    // selection. A merge update would retain the removed profile.
    await scaffold.ctx.settings.replace('llm-pi-ai', { providers: {
      [START_ROUTE]: { displayName: 'Origin Gateway', api: 'openai-completions',
        baseURL: 'https://gateway.origin.example/v1', models: [{ id: START_MODEL, name: 'Origin Large' }] },
    } })

    const seat = page.getByRole('button', { name: 'Select model', exact: true })
    await seat.waitFor()
    expect(await box.isEnabled()).toBe(true)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: ROUTE, model: MODEL })
    const aria = await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/default-model/unselected.expected.md', import.meta.url)), aria, webSnapshotMode())
    await seat.click()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
