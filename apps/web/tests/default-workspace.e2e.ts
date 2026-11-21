/** First interaction prepares a durable default project through the shipped Web composition. */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  assertFinalWorkspaceSnapshot, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  selectedSessionFixture, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('../../../snapshots/web/default-workspace/ui.expected.md', import.meta.url))
const FAILURE_EXPECTED = fileURLToPath(new URL('./expected/default-workspace/failure.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: default Workspace', () => {
  it('opens a local composer, creates the default on interaction, and restores the blank chat on reload', async () => {
    const fixture = await selectedSessionFixture(FIXTURE)
    const scaffold = await launchWebScaffold({
      firstUse: true,
      replayFixture: fixture,
      // The round-trip scenario owns the full Session snapshot; this scenario
      // asserts the submitted prompt and filesystem results.
      compareReplaySession: false,
      paceMs: 5,
    })
    onTestFinished(() => scaffold.close())
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      try {
        await page.goto(scaffold.authenticatedUrl)
        const input = page.locator('[data-composer-input][contenteditable="true"]').first()
        const localInput = page.locator('[data-composer-input][contenteditable="plaintext-only"]')
        await localInput.waitFor()
        expect(scaffold.ctx.workspaceRegistry.list()).toEqual([])
        expect(scaffold.ctx.sessions.list()).toEqual([])
        await localInput.click()
        await page.getByRole('button', { name: 'Choose project', exact: true })
          .getByText('Default project', { exact: true }).waitFor()
        expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(1)
        const initialSession = scaffold.ctx.sessions.list()[0]!
        expect(scaffold.ctx.sessions.list()).toHaveLength(1)
        expect(initialSession.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
        await page.reload()
        await input.waitFor()
        expect(scaffold.ctx.sessions.list().map(session => session.id)).toEqual([initialSession.id])
        const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
        await input.fill(prompt)
        const settled = scaffold.whenTurnSettled()
        await input.press('Enter')
        const sessionId = await settled
        const workspace = scaffold.ctx.workspaceRegistry.list()[0]!
        expect(workspace.title).toBe('default-workspace')
        expect(workspace.path).toBe(join(scaffold.workspaceCwd, 'Documents', 'jan', 'default-workspace'))
        expect((await stat(workspace.path)).isDirectory()).toBe(true)
        expect(workspace.sessionIds).toContain(sessionId)
        const session = scaffold.ctx.sessions.get(sessionId)
        expect(session?.header.cwd).toBe(workspace.path)
        expect(session?.snapshotEvents()).toContainEqual(expect.objectContaining({
          type: 'user/message',
          data: expect.objectContaining({
            source: expect.objectContaining({ kind: 'user' }),
            content: [{ type: 'text', text: prompt }],
          }),
        }))
        await assertFinalWorkspaceSnapshot(fileURLToPath(new URL('../../../snapshots/web/default-workspace', import.meta.url)), workspace.path)
        await page.getByText('DONE', { exact: true }).waitFor()
        await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), MODE)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-default-workspace')
        throw error
      }
    } finally {
      await browser.close()
    }
  })

  it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
    'opens the default Workspace chooser from its external trigger ($name)', async ({ engine }) => {
      const scaffold = await launchWebScaffold({ firstUse: true })
      onTestFinished(() => scaffold.close())
      const browser = await engine.launch()
      onTestFinished(() => browser.close())
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Asia/Shanghai',
        isMobile: true, hasTouch: true,
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('[data-composer-input][contenteditable="plaintext-only"]').tap()
      const trigger = page.getByRole('button', { name: 'Choose project', exact: true })
      await trigger.getByText('Default project', { exact: true }).waitFor()
      await trigger.tap()
      const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Default project', exact: true }) })
      await menu.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await trigger.getAttribute('aria-expanded')).toBe('true')
      expect(await trigger.evaluate(node => node.style.anchorName)).toBe(await menu.evaluate(node => node.style.positionAnchor))
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    },
  )

  it('retains a local draft when recovering from a default project directory conflict', async () => {
    const scaffold = await launchWebScaffold({ firstUse: true })
    onTestFinished(() => scaffold.close())
    const parent = join(scaffold.workspaceCwd, 'Documents', 'jan')
    await mkdir(parent, { recursive: true })
    // A Chinese reader gets the same fixed directory name, so the same occupant conflicts.
    await writeFile(join(parent, 'default-workspace'), 'occupied')
    const chosen = join(scaffold.workspaceCwd, 'chosen')
    await mkdir(chosen)
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
      const tripwire = watchConsole(page)
      try {
        await page.goto(scaffold.authenticatedUrl)
        const input = page.locator('[data-composer-input][contenteditable="true"]').first()
        const localInput = page.locator('[data-composer-input][contenteditable="plaintext-only"]')
        await localInput.click()
        const notice = page.getByRole('alert').filter({ hasText: '无法创建默认工作区' })
        await notice.waitFor()
        const pendingText = 'Keep this draft while choosing a project.'
        await localInput.fill(pendingText)
        expect(scaffold.ctx.workspaceRegistry.list()).toEqual([])
        expect(scaffold.ctx.sessions.list()).toEqual([])
        await compareOrRefreshGolden(FAILURE_EXPECTED, await notice.ariaSnapshot(), MODE)
        expect(await page.getByRole('dialog').count()).toBe(0)
        await page.getByRole('button', { name: '选择工作区', exact: true }).click()
        const picker = page.getByRole('dialog', { name: '选择工作区目录' })
        await picker.waitFor()
        await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
        await picker.getByRole('textbox', { name: '编辑路径' }).fill(chosen)
        await page.keyboard.press('Enter')
        await picker.getByRole('button', { name: '打开', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        await expect.poll(() => scaffold.ctx.workspaceRegistry.list().length).toBe(1)
        await input.waitFor()
        expect(await input.textContent()).toBe(pendingText)
        expect(scaffold.ctx.workspaceRegistry.list()[0]?.path).toBe(chosen)
        expect(scaffold.ctx.sessions.list()).toHaveLength(1)
        expect(scaffold.ctx.sessions.list().every(session =>
          session.snapshotEvents().every(event => event.type !== 'user/message'))).toBe(true)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-default-workspace-failure')
        throw error
      }
    } finally {
      await browser.close()
    }
  })

  it('keeps a deleted default absent on reload and recreates it on New Chat', async () => {
    const scaffold = await launchWebScaffold()
    onTestFinished(() => scaffold.close())
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.reload()
      await page.locator('[data-composer-input][contenteditable="plaintext-only"]').waitFor()
      expect(scaffold.ctx.workspaceRegistry.list()).toEqual([])
      expect(scaffold.ctx.sessions.list()).toEqual([])
      const create = page.waitForResponse('**/api/session/create')
      await page.getByRole('button', { name: 'New session', exact: true }).last().click()
      const created = await create
      const [project] = scaffold.ctx.workspaceRegistry.list()
      expect(project?.path).toBe(join(scaffold.workspaceCwd, 'Documents', 'jan', 'default-workspace'))
      expect(created.request().postDataJSON()).toMatchObject({ payload: { args: { request: { workspaceId: project?.id } } } })
      const [session] = scaffold.ctx.sessions.list()
      expect(session?.header.cwd).toBe(project?.path)
      expect(project?.sessionIds).toContain(session?.id)
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    } finally {
      await browser.close()
    }
  })
})
