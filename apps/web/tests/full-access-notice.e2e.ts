import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { showFullAccessNotice } from './setup-browser-notices.ts'
import { expandProject, newEnglishPage, saveFailureShot } from './support.ts'

it('shows the Full access notice in the first chat and keeps it dismissed after a reload', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const browser = await chromium.launch()
  try {
    showFullAccessNotice(browser)
    const page = await newEnglishPage(browser)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-full-access-notice'))
    const openChat = async (): Promise<void> => {
      await expandProject(page, workspace.title)
      const row = page.getByRole('treeitem').filter({ has: page.getByText(workspace.title, { exact: true }) }).first()
      await row.hover()
      await row.getByRole('button', { name: `New session in ${workspace.title}`, exact: true }).click()
      await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor()
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openChat()
    const title = page.getByRole('heading', { name: 'New chats use Full access', exact: true })
    await title.waitFor()
    expect(await page.getByRole('button', { name: 'Change default', exact: true }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    await title.waitFor({ state: 'detached' })

    await page.reload({ waitUntil: 'load' })
    await openChat()
    expect(await title.count()).toBe(0)
  } finally {
    await browser.close()
  }
})
