// The Host's native-onboarding setting must reach the assembled browser before its dialogs register.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, WELCOME_NOTICE_COPY, type WebScaffold,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/onboarding-native', import.meta.url))
const SIGNED_OUT_MENU_EXPECTED = join(SNAPSHOT_DIR, 'signed-out-menu.expected.md')
const MODE = webSnapshotMode()
const { version } = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
const versionCapture = { replacements: [[version, '{{version}}']] as const }

describe.skipIf(MODE === 'record').each([false, true])('web e2e: native credential onboarding (desktop marker: %s)', (desktop) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      missingModelCredential: true,
      welcomeNoticePending: true,
      ...desktop ? {} : { extraOverlayPath: fileURLToPath(new URL('./fixtures/onboarding-native/cordis.patch.yml', import.meta.url)) },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    // The shared menu golden uses the Linux shortcut profile on every test host.
    await page.addInitScript(() => { Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64' }) })
    if (desktop) await page.addInitScript(() => { Object.defineProperty(globalThis, 'janDesktop', { value: { protocolVersion: 1 } }) })
    tripwire = watchConsole(page)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the notice and Models settings without another credential dialog or credential write', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-native'))
    const credentialPath = join(scaffold.harnessHome, '.credentials.yaml')
    const credentials = await readFile(credentialPath, 'utf8')
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    if (!desktop) {
      await welcome.waitFor()
      await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
      await welcome.waitFor({ state: 'detached' })
    }

    for (const reload of [false, true]) {
      if (reload) {
        const warningsBefore = tripwire.warnings.length
        await page.reload({ waitUntil: 'load' })
        acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
      }
      const login = page.getByRole('button', { name: '登录', exact: true })
      await login.waitFor()
      expect(Math.abs((await login.boundingBox())!.height - 32)).toBeLessThan(1)
      const accountMenu = page.getByRole('button', { name: '账号菜单', exact: true })
      expect(await accountMenu.getAttribute('title')).toBe('设置')
      expect(await accountMenu.textContent()).toBe('')
      const triggerBox = (await accountMenu.boundingBox())!
      expect(Math.abs(triggerBox.width - 36)).toBeLessThan(1)
      expect(Math.abs(triggerBox.height - 36)).toBeLessThan(1)
      await accountMenu.click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      const menuItems = ['设置', '语言', '推理配置', '查看更新日志', '了解更多', '登录']
      expect(await menu.getByRole('menuitem').count()).toBe(menuItems.length)
      for (const name of menuItems) {
        expect(await menu.getByRole('menuitem', { name, exact: true }).count()).toBe(1)
      }
      const menuBox = (await menu.boundingBox())!
      expect(Math.abs(menuBox.width - 136)).toBeLessThan(1)
      expect(Math.abs(menuBox.height - 294.5)).toBeLessThan(1)
      expect(Math.abs(triggerBox.y - (menuBox.y + menuBox.height) - 4)).toBeLessThan(1)
      for (const row of await menu.getByRole('menuitem').all()) {
        const rowBox = (await row.boundingBox())!
        expect(Math.abs(rowBox.height - 40)).toBeLessThan(1)
        expect(Math.abs(menuBox.width - rowBox.width - 8)).toBeLessThan(1)
        const glyph = (await row.locator('svg').first().boundingBox())!
        expect(Math.abs(glyph.width - 16)).toBeLessThan(1)
        expect(Math.abs(glyph.height - 16)).toBeLessThan(1)
      }
      const menuAria = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd, versionCapture)
      await compareOrRefreshGolden(SIGNED_OUT_MENU_EXPECTED, menuAria, MODE)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      expect(await page.getByRole('dialog', { name: '开始使用', exact: true }).count()).toBe(0)
      await openSettings(page, 'zh')
      const settings = page.getByRole('dialog', { name: '设置', exact: true })
      await settings.getByRole('button', { name: '模型', exact: true }).click()
      const tokamak = settings.getByRole('listitem').filter({ has: page.getByRole('button', { name: '编辑 Tokamak (tokamak)', exact: true }) })
      await tokamak.getByRole('img', { name: 'API 密钥缺失', exact: true }).waitFor()
      expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)
      expect(await welcome.count()).toBe(0)
      expect(await readFile(credentialPath, 'utf8')).toBe(credentials)
      const aria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'models.expected.md'), aria, MODE)
      await page.keyboard.press('Escape')
    }
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['models.expected.md', 'signed-out-menu.expected.md'])
  })
})
