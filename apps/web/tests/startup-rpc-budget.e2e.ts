// Cold boot bounds shared settings reads. No model call or replay fixture is involved.
import type { Browser, Page, Request } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/** One eager read plus one first-connection reset closes the pre-subscription commit window. */
const DESCRIBE_BUDGET = 2

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

describe('startup RPC budget', () => {
  it('keeps settings reads at their publication count', async () => {
    page = await newEnglishPage(browser)
    watchConsole(page)
    const calls: string[] = []
    const pending = new Set<Request>()
    let settingsFinished = 0
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!url.pathname.startsWith('/api/')) return
      calls.push(url.pathname.slice('/api/'.length))
      pending.add(request)
    })
    page.on('requestfinished', (request) => {
      pending.delete(request)
      if (new URL(request.url()).pathname === '/api/settings/describe') settingsFinished++
    })
    page.on('requestfailed', request => pending.delete(request))
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Choose project', exact: true }).waitFor({ timeout: 30_000 })
    await expect.poll(() => settingsFinished, { timeout: 30_000 }).toBeGreaterThanOrEqual(DESCRIBE_BUDGET)
    await expect.poll(() => pending.size, { timeout: 30_000 }).toBe(0)
    const describeCount = calls.filter(method => method === 'settings/describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})
