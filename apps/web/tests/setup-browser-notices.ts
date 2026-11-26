/**
 * Web lane setup: every browser context starts with the one-time Full access notice already
 * seen, so it does not cover the page in scenarios about other surfaces. A scenario covering the
 * notice opts a browser out with {@link showFullAccessNotice}. The key is owned by
 * `packages/client/ui-permission-presets/src/client/index.ts`.
 */
import { chromium, webkit, type Browser, type BrowserType } from 'playwright'

const FULL_ACCESS_NOTICE_KEY = 'jan.permission.fullAccessNoticeSeen'
const noticeShown = new WeakSet<Browser>()

/**
 * Let contexts created afterwards on this browser show the Full access notice as a new user sees it.
 * @param browser - browser launched in the Web lane.
 */
export function showFullAccessNotice(browser: Browser): void {
  noticeShown.add(browser)
}

function markNoticeSeen(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Opaque origins such as about:blank refuse storage; the app origin accepts it.
  }
}

function withNoticeSeen(browser: Browser): Browser {
  const newContext = browser.newContext.bind(browser)
  const newPage = browser.newPage.bind(browser)
  browser.newContext = async (...args) => {
    const context = await newContext(...args)
    if (!noticeShown.has(browser)) await context.addInitScript(markNoticeSeen, FULL_ACCESS_NOTICE_KEY)
    return context
  }
  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    if (!noticeShown.has(browser)) await page.context().addInitScript(markNoticeSeen, FULL_ACCESS_NOTICE_KEY)
    return page
  }
  return browser
}

for (const type of [chromium, webkit] as BrowserType[]) {
  const launch = type.launch.bind(type)
  type.launch = async (...args) => withNoticeSeen(await launch(...args))
}
