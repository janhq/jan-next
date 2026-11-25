// Keyless assembled-browser coverage for per-Session agent teamwork
// over the real Host projection frame flow.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type {} from '@janhq/jan-agent-team'
import { SessionId } from '@janhq/jan-session'
import { CommandId } from '@janhq/jan-commands/brand'
import { createMessage, createUserMessage } from '@janhq/jan-llm'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { assertWarningDialogLayout, connectFreshWorkspace, connectFreshWorkspaceZh, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-team-panel', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'task.expected.md')
const RESIZE_EXPECTED = join(SNAPSHOT_DIR, 'resize.expected.md')
const MODE = webSnapshotMode()
const RESEARCHER_DESCRIPTION = 'Researcher: investigate the construction and verify every bound before reporting the result. '.repeat(8).trim()
const RECEIPT_LOCALES = [
  {
    language: 'English', code: 'en', browserLocale: 'en-US', connect: connectFreshWorkspace,
    modelButton: /^Select model/u, toggle: 'Enable agent teamwork', title: 'Agent teamwork',
    enabled: 'Enabled', disabled: 'Disabled',
    suggestions: 'Trigger suggestions', commandLabel: 'Team',
    failure: 'Failed: Use /team on or /team off.',
  },
  {
    language: 'Chinese', code: 'zh', browserLocale: 'zh-CN', connect: connectFreshWorkspaceZh,
    modelButton: /^选择模型/u, toggle: '启用智能体团队协作', title: '智能体团队协作',
    enabled: '已开启', disabled: '已停用',
    suggestions: '触发候选建议', commandLabel: '智能体团队协作',
    failure: '执行失败：Use /team on or /team off.',
  },
] as const

type ReceiptLocale = typeof RECEIPT_LOCALES[number]

async function seedTeamConversation(page: Page, scaffold: WebScaffold): Promise<void> {
  const agent = scaffold.ctx.agents.list()[0]
  if (agent === undefined) throw new Error('connected Team workspace did not create an Agent')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Open the task board.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Ready.' }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await scaffold.ctx.sessions.flush(agent.session)
  await page.getByText('Ready.').waitFor({ timeout: 10_000 })
}

async function withTeamReceiptPage(
  locale: ReceiptLocale,
  run: (page: Page, scaffold: WebScaffold, tripwire: ReturnType<typeof watchConsole>) => Promise<void>,
): Promise<void> {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 1680, height: 1000 }, locale: locale.browserLocale, timezoneId: 'Asia/Shanghai',
    })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await locale.connect(page, scaffold.workspaceCwd)
    try {
      await seedTeamConversation(page, scaffold)
      await run(page, scaffold, tripwire)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, `web-e2e-team-command-${locale.code}`)
      throw error
    }
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
}

describe('web e2e: agent teamwork panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await seedTeamConversation(page, scaffold)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('explains agent teamwork on hover and focus without changing the Session selection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-info'))
    await page.getByRole('button', { name: /^Select model/u }).click()
    const info = page.getByRole('button', { name: 'About agent teamwork', exact: true })
    const toggle = page.getByRole('switch', { name: 'Enable agent teamwork', exact: true })
    const tooltip = page.getByRole('tooltip')
    await info.hover()
    await tooltip.waitFor({ state: 'visible' })
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'info.expected.md'), await captureStableAria(page, '[role="tooltip"]', scaffold.workspaceCwd), MODE)
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await page.getByRole('button', { name: /^Select model/u }).hover()
    await tooltip.waitFor({ state: 'hidden' })
    await page.keyboard.press('Shift')
    await info.focus()
    await tooltip.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    expect(await toggle.isVisible()).toBe(true)
    await info.click()
    await tooltip.waitFor({ state: 'visible' })
    expect(await info.getAttribute('aria-describedby')).toBe(await tooltip.getAttribute('id'))
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await page.keyboard.press('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('toggles from the row label and empty space while keeping the information button independent', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-row'))
    await page.getByRole('button', { name: /^Select model/u }).click()
    const toggle = page.getByRole('switch', { name: 'Enable agent teamwork', exact: true })
    const info = page.getByRole('button', { name: 'About agent teamwork', exact: true })
    const label = page.getByText('Enable agent teamwork', { exact: true })
    const labelBounds = await label.boundingBox()
    if (labelBounds === null) throw new Error('Team label is not visible')
    const labelPoint = { x: labelBounds.x + labelBounds.width / 2, y: labelBounds.y + labelBounds.height / 2 }
    await page.mouse.move(labelPoint.x, labelPoint.y)
    expect(await toggle.evaluate((element) => {
      const row = element.parentElement!
      return getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)'
    })).toBe(true)
    await page.mouse.click(labelPoint.x, labelPoint.y)
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await info.click()
    await page.getByRole('tooltip').waitFor({ state: 'visible' })
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    const gap = await toggle.evaluate((element) => {
      const control = element.getBoundingClientRect()
      const help = element.parentElement!.querySelector('button:not([role="switch"])')!.getBoundingClientRect()
      return { x: (help.right + control.left) / 2, y: control.top + control.height / 2 }
    })
    await page.mouse.click(gap.x, gap.y)
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    expect(await page.getByRole('tooltip').count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('defaults off and saves a Session selection in the model menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-mode'))
    expect(await page.locator('[data-subagent-action]').count()).toBe(0)
    await page.getByRole('button', { name: /^Select model/u }).click()
    const toggle = page.getByRole('switch', { name: 'Enable agent teamwork', exact: true })
    await toggle.waitFor()
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await toggle.focus()
    await page.keyboard.press('ArrowUp')
    expect(await toggle.evaluate(element => element === document.activeElement)).toBe(false)
    await page.keyboard.press('ArrowDown')
    expect(await toggle.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Space')
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    expect(await page.locator('[data-subagent-action]').count()).toBe(0)
    const agent = scaffold.ctx.agents.list()[0]!
    expect(scaffold.ctx.commands.list(agent).some(command => command.name === 'team')).toBe(false)
    expect(agent.session.ownEvents().filter(event => event.type === 'command/run' || event.type === 'command/done')).toEqual([])
    const other = await scaffold.ctx.agents.create({ sessionId: SessionId('other-team-mode'), agentOptions: agent.options })
    expect(scaffold.ctx.agentTeams.isEnabled(other.agent)).toBe(false)
    await other.dispose()
    const beforeReload = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: /^Select model/u }).click()
    expect(await page.locator('[data-subagent-action]').count()).toBe(0)
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    acknowledgeReloadConnectionLoss(tripwire, beforeReload)
  }, 60_000)

  it('toggles from the model menu and keeps text editing usable after refocusing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-command-input'))
    const input = page.locator('[data-composer-input]').first()
    const agent = scaffold.ctx.agents.list()[0]!
    for (const enabled of [false, true]) {
      await page.getByRole('button', { name: /^Select model/u }).click()
      const toggle = page.getByRole('switch', { name: 'Enable agent teamwork', exact: true })
      await toggle.click()
      await expect.poll(() => toggle.getAttribute('aria-checked')).toBe(String(enabled))
      await page.keyboard.press('Escape')
      await expect.poll(() => scaffold.ctx.agentTeams.isEnabled(agent)).toBe(enabled)
      await expect.poll(() => input.textContent()).toBe('')
      await page.getByRole('button', { name: 'Account menu', exact: true }).focus()
      await input.click()
      await page.keyboard.insertText('asdas')
      await expect.poll(() => input.textContent()).toBe('asdas')
      expect(await input.evaluate((element) => {
        const selection = window.getSelection()
        return document.activeElement === element && selection?.isCollapsed === true
          && selection.anchorNode?.textContent === 'asdas' && selection.anchorOffset === 5
      })).toBe(true)
      await input.press('Backspace')
      await expect.poll(() => input.textContent()).toBe('asda')
      await writeComposerDraft(page, input, '')
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('shows tasks without children and hides the entry after the last task is deleted', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-task-only'))
    const agent = scaffold.ctx.agents.list()[0]!
    expect(await page.locator('[data-subagent-action]').count()).toBe(0)
    const task = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Plan before delegation', description: 'Prepare shared work before creating subagents',
    })
    const trigger = page.locator('[data-subagent-action]').getByRole('button', { name: '0 subagents', exact: true })
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await trigger.click()
    const panel = page.locator('[data-subagent-panel]')
    const board = panel.locator('[data-team-panel]')
    await board.getByText(task.subject, { exact: true }).waitFor()
    await panel.getByText('No subagents', { exact: true }).waitFor()
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    expect(await board.locator('[data-team-task-details]').count()).toBe(0)
    expect(await board.getByRole('button', { expanded: false }).count()).toBe(1)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'task-only.expected.md'),
      await captureStableAria(page, '[data-subagent-action]', scaffold.workspaceCwd), MODE)
    await scaffold.ctx.agentTeams.updateTask(agent, { taskId: task.id, expectedRevision: task.revision, action: 'delete' })
    await page.locator('[data-subagent-action]').waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens external members and live read-only tasks in one composer roster', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel'))
    const projectionReads = vi.spyOn(scaffold.ctx.sessionController, 'projections')
    onTestFinished(() => { projectionReads.mockRestore() })
    const agent = scaffold.ctx.agents.list()[0]!
    const memberId = SessionId('team-panel-researcher')
    agent.session.append('subagent/catalog', {
      version: 2, childId: memberId, childCreatedAt: Date.now(), mode: 'external',
      label: RESEARCHER_DESCRIPTION,
    })
    await scaffold.ctx.sessions.flush(agent.session)
    // A finished roster without shared tasks leaves the composer.
    expect(await page.locator('[data-subagent-action]').count()).toBe(0)
    const task = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Agent task', description: 'Created by the root agent', writeScopes: ['src/web'],
    })
    const trigger = page.locator('[data-subagent-action]').getByRole('button', { name: /^1 subagent\b/u })
    await trigger.waitFor()
    expect(await trigger.locator('[data-subagent-count]').textContent()).toBe('1 subagent')
    expect(await trigger.textContent()).toContain('1 external')
    const panel = page.locator('[data-subagent-panel]')
    await trigger.click()
    await panel.waitFor()
    await trigger.click()
    await panel.waitFor({ state: 'detached' })
    expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    await panel.waitFor()
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')

    const member = panel.getByRole('listitem').filter({ hasText: RESEARCHER_DESCRIPTION })
    await member.getByText('External task', { exact: true }).waitFor()
    expect(await member.getByRole('button').count()).toBe(0)
    const beforeClick = page.url()
    await member.getByText(RESEARCHER_DESCRIPTION, { exact: true }).click()
    expect(page.url()).toBe(beforeClick)
    expect(await panel.getByRole('button', { name: /^(New task|Refresh)/u }).count()).toBe(0)

    const board = panel.locator('[data-team-panel]')
    const row = board.locator(`[data-team-task="${task.id}"]`)
    await row.getByRole('button', { name: 'Pending Agent task', exact: true, expanded: false }).waitFor()
    await board.getByRole('heading', { name: 'Shared tasks 1 pending', exact: true }).waitFor()
    expect(await panel.evaluate((element) => {
      const members = element.querySelector('ul')!
      const tasks = element.querySelector('[data-team-panel]')!
      return Boolean(members.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    expect(await row.evaluate(element => ({ tag: element.tagName, parent: element.parentElement?.tagName })))
      .toEqual({ tag: 'LI', parent: 'UL' })
    expect(await board.locator('[data-team-task-details], article').count()).toBe(0)
    await row.getByRole('button').click()
    await row.locator('[data-team-task-owner]').filter({ hasText: 'Unowned' }).waitFor()
    await row.getByText('Created by the root agent', { exact: true }).waitFor()
    expect(await row.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    await scaffold.ctx.agentTeams.updateTask(agent, {
      taskId: task.id, expectedRevision: task.revision, action: 'claim',
    })
    await row.getByRole('img', { name: 'In progress', exact: true }).waitFor()
    await row.locator('[data-team-task-owner]').filter({ hasText: 'Owner: lead' }).waitFor()
    await board.getByRole('heading', { name: 'Shared tasks 1 in progress', exact: true }).waitFor()
    expect(await panel.getByRole('button', { name: /^(New task|Edit|Complete|Reopen|Delete)$/u }).count()).toBe(0)
    expect(await panel.locator('input, select, textarea').count()).toBe(0)

    await compareOrRefreshGolden(PANEL_EXPECTED, await captureStableAria(page, '[data-subagent-action]', scaffold.workspaceCwd), MODE)
    expect(projectionReads).not.toHaveBeenCalled()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await trigger.click()
    await panel.waitFor({ state: 'detached' })
  }, 60_000)

  it('hides the roster while disabled and restores its tasks closed when re-enabled', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-disabled-board'))
    await page.getByRole('button', { name: /^Select model/u }).click()
    const toggle = page.getByRole('switch', { name: 'Enable agent teamwork', exact: true })
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await page.locator('[data-subagent-action]').waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Select model/u }).click()
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    const trigger = page.locator('[data-subagent-action]').getByRole('button', { name: /^1 subagent\b/u })
    await trigger.waitFor()
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await trigger.click()
    await page.locator('[data-subagent-panel]').getByText('Agent task', { exact: true }).waitFor()
    await trigger.click()
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the roster inside a narrow composer column and hides row status words visually', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-narrow-roster'))
    const seat = page.locator('[data-subagent-action]')
    const trigger = seat.getByRole('button', { name: /^1 subagent\b/u })
    const panel = page.locator('[data-subagent-panel]')
    const status = panel.getByText('External task', { exact: true })
    const viewport = page.viewportSize()!
    await trigger.click()
    await status.waitFor()
    expect(await status.evaluate(element => getComputedStyle(element).position)).not.toBe('absolute')
    try {
      await page.setViewportSize({ width: 390, height: 700 })
      await expect.poll(() => status.evaluate(element => getComputedStyle(element).position)).toBe('absolute')
      expect(await status.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
      expect(await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth
      })).toBe(true)
      expect(await trigger.locator('[data-subagent-count]').isVisible()).toBe(true)
      expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await page.setViewportSize(viewport)
      await trigger.click()
      await panel.waitFor({ state: 'detached' })
    }
  })

  it('keeps tasks ordered, opens one full detail at a time, and scrolls inside the roster', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-compact-details'))
    const agent = scaffold.ctx.agents.list()[0]!
    const completed = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Completed preparation', description: 'Preparation is complete.', writeScopes: [],
    })
    const claimed = await scaffold.ctx.agentTeams.updateTask(agent, {
      taskId: completed.id, expectedRevision: completed.revision, action: 'claim',
    })
    await scaffold.ctx.agentTeams.updateTask(agent, {
      taskId: completed.id, expectedRevision: claimed.revision, action: 'complete',
    })
    const blocker = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Dependency task', description: 'Finish this prerequisite first.', writeScopes: [],
    })
    const subject = 'Responsive task with a long title that remains fully readable when expanded at the minimum supported viewport'
    const description = 'Check every dependency and write scope before you start work.\n'.repeat(16).trim()
    const task = await scaffold.ctx.agentTeams.createTask(agent, {
      subject, description, blockedBy: [blocker.id], writeScopes: ['src/web/components'],
    })
    const trigger = page.locator('[data-subagent-action]').getByRole('button', { name: /^1 subagent\b/u })
    const panel = page.locator('[data-subagent-panel]')
    const board = panel.locator('[data-team-panel]')
    const row = board.locator(`[data-team-task="${task.id}"]`)
    const completedRow = board.locator(`[data-team-task="${completed.id}"]`)
    await trigger.click()
    await row.waitFor()
    try {
      expect(await board.locator('[data-team-task-details], article').count()).toBe(0)
      expect(await board.getByRole('button', { expanded: false }).count()).toBe(4)
      expect(await board.locator('[data-team-task]').evaluateAll(elements => elements.map(element => element.getAttribute('data-status'))))
        .toEqual(['in_progress', 'completed', 'pending', 'pending'])
      const counts = board.getByText('1 completed · 1 in progress · 2 pending', { exact: true })
      await counts.waitFor()
      expect(await panel.getByRole('button', { name: /^Show (more|less)$/u }).count()).toBe(0)
      await row.getByRole('img', { name: 'Blocked by dependencies', exact: true }).waitFor()
      await row.getByRole('button').click()
      const details = row.locator('[data-team-task-details]')
      expect(await details.locator('p:not([data-team-task-owner])').textContent()).toBe(description)
      expect(await details.locator('[data-team-task-owner]').textContent()).toBe('Owner: Unowned')
      expect(await details.locator(':scope > *').evaluateAll(elements => elements.map(element =>
        element.hasAttribute('data-team-task-owner') ? 'owner' : element.tagName))).toEqual(['P', 'owner'])
      expect(await details.locator('dl, dt, dd').count()).toBe(0)
      for (const omitted of [task.id, blocker.subject, 'Readiness', 'Write scopes', 'Write scope warnings', 'src/web/components']) {
        expect(await details.textContent()).not.toContain(omitted)
      }
      expect(await row.getByRole('button').getAttribute('aria-controls')).toBe(await details.getAttribute('id'))
      expect(await panel.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto')
      await expect.poll(() => panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await panel.hover()
      await page.mouse.wheel(0, 180)
      await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await panel.evaluate((element) => { element.scrollTo({ top: 0 }) })
      await compareOrRefreshGolden(RESIZE_EXPECTED, await captureStableAria(page, '[data-subagent-panel]', scaffold.workspaceCwd), MODE)
      await completedRow.getByRole('button').click()
      expect(await row.getAttribute('data-expanded')).toBe('false')
      expect(await row.locator('[data-team-task-details]').count()).toBe(0)
      expect(await board.locator('[data-team-task-details]').count()).toBe(1)
      expect(await completedRow.locator('[data-team-task-owner]').textContent()).toBe('Owner: lead')
      expect(await completedRow.locator('[data-team-task-details] p:not([data-team-task-owner])').textContent()).toBe(completed.description)
      expect(await completedRow.locator('[data-team-task-details]').textContent()).not.toContain(completed.id)
      await completedRow.getByRole('button').click()
      expect(await board.locator('[data-team-task-details]').count()).toBe(0)
    } finally {
      await trigger.click()
      await panel.waitFor({ state: 'detached' })
    }
  })

  it('confirms disabling after a recorded model request and keeps cancellation side-effect free', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-disable-confirmation'))
    const agent = scaffold.ctx.agents.list()[0]!
    const selection = agent.model.current()
    if (selection === undefined) throw new Error('Team fixture has no selected model')
    agent.session.append('request/header', { header: { config: selection }, reason: 'initial' })
    await scaffold.ctx.sessions.flush(agent.session)
    const openConfirmation = async (): Promise<void> => {
      await page.getByRole('button', { name: /^Select model/u }).click()
      await page.getByRole('switch', { name: 'Enable agent teamwork', exact: true }).click()
      await page.getByRole('dialog', { name: 'Disable agent teamwork?', exact: true }).waitFor()
    }
    await openConfirmation()
    const dialog = page.getByRole('dialog', { name: 'Disable agent teamwork?', exact: true })
    await assertWarningDialogLayout(dialog)
    expect(await page.getByRole('menu', { name: 'Model and reasoning effort', exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('checkbox').count()).toBe(0)
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'disable-confirmation.expected.md'),
      await captureStableAria(page, '[aria-modal="true"]', scaffold.workspaceCwd), MODE)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByRole('button', { name: /^Select model/u }).evaluate(element => element === document.activeElement)).toBe(true)
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(true)
    await openConfirmation()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByRole('button', { name: /^Select model/u }).evaluate(element => element === document.activeElement)).toBe(true)
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(true)
    await openConfirmation()
    await dialog.getByRole('button', { name: 'Disable', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByRole('button', { name: /^Select model/u }).evaluate(element => element === document.activeElement)).toBe(true)
    await expect.poll(() => scaffold.ctx.agentTeams.isEnabled(agent)).toBe(false)
    await page.getByRole('button', { name: /^Select model/u }).click()
    await page.getByRole('switch', { name: 'Enable agent teamwork', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentTeams.isEnabled(agent)).toBe(true)
    expect(await dialog.count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(agent.session.ownEvents().filter(event => event.type === 'command/run' || event.type === 'command/done')).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })

  it('leaves the composer when the last shared task is deleted and no member runs', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-last-task'))
    const agent = scaffold.ctx.agents.list()[0]!
    const trigger = page.locator('[data-subagent-action]').getByRole('button', { name: /^1 subagent\b/u })
    await trigger.click()
    const panel = page.locator('[data-subagent-panel]')
    await panel.locator('[data-team-panel]').waitFor()
    for (const task of scaffold.ctx.agentTeams.listTasks(agent).toReversed()) {
      if (task.status === 'deleted') continue
      await scaffold.ctx.agentTeams.updateTask(agent, {
        taskId: task.id, expectedRevision: task.revision, action: 'delete',
      })
    }
    await page.locator('[data-subagent-action]').waitFor({ state: 'detached' })
    expect(await page.getByText('No shared tasks yet. Create them through the conversation.').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'task.expected.md', 'resize.expected.md', 'info.expected.md', 'task-only.expected.md',
      'disable-confirmation.expected.md', 'collaboration.zh.expected.md',
      'command-error.en.expected.md', 'command-error.zh.expected.md',
    ])
  })
})

it.each(RECEIPT_LOCALES)('toggles teamwork in $language without command records or Chat changes after reload', async (locale) => {
  await withTeamReceiptPage(locale, async (page, scaffold, tripwire) => {
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('Team receipt fixture has no Agent')
    const chat = page.locator('[data-chat-flow]').first()
    const recordedReady = await captureStableAria(page, '[data-chat-flow]', scaffold.workspaceCwd)
    expect(recordedReady).toContain('Ready.')
    expect(recordedReady).toContain('Open the task board.')
    const captureLayout = () => chat.evaluate((element) => {
      const flow = element.getBoundingClientRect()
      return {
        height: flow.height,
        rows: [...element.querySelectorAll('[data-chat-flow-key]')].map((row) => {
          const bounds = row.getBoundingClientRect()
          return { kind: row.getAttribute('data-chat-flow-kind'), top: bounds.top - flow.top, height: bounds.height }
        }),
      }
    })
    const recordedLayout = await captureLayout()
    const commandEvents = () => agent.session.snapshotEvents()
      .filter(event => event.type === 'command/run' || event.type === 'command/done')
    expect(commandEvents()).toEqual([])
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, '/')
    const suggestions = page.getByRole('listbox', { name: locale.suggestions, exact: true })
    await suggestions.getByRole('option').first().waitFor()
    const candidate = suggestions.getByRole('option').filter({ hasText: locale.commandLabel })
    expect(await candidate.count()).toBe(0)
    await writeComposerDraft(page, input, '/tea')
    await expect.poll(() => suggestions.getByRole('option').count()).toBe(0)
    expect(await candidate.count()).toBe(0)
    await input.press('Escape')
    await suggestions.waitFor({ state: 'hidden' })
    await writeComposerDraft(page, input, '')
    expect(commandEvents()).toEqual([])
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(false)
    const assertChatUnchanged = async (): Promise<void> => {
      await chat.getByText('Ready.', { exact: true }).waitFor()
      expect(await page.locator('[data-team-command], [data-chat-flow-kind="command"], [data-command-input]').count()).toBe(0)
      expect(await captureStableAria(page, '[data-chat-flow]', scaffold.workspaceCwd)).toBe(recordedReady)
      await expect.poll(captureLayout).toEqual(recordedLayout)
    }
    for (const enabled of [true, false]) {
      await page.getByRole('button', { name: locale.modelButton }).click()
      const toggle = page.getByRole('switch', { name: locale.toggle, exact: true })
      await toggle.click()
      await expect.poll(() => toggle.getAttribute('aria-checked')).toBe(String(enabled))
      await expect.poll(() => scaffold.ctx.agentTeams.isEnabled(agent)).toBe(enabled)
      expect(scaffold.ctx.commands.list(agent).some(command => command.name === 'team')).toBe(false)
      expect(commandEvents()).toEqual([])
      await page.keyboard.press('Escape')
      await assertChatUnchanged()
    }
    await scaffold.ctx.sessions.flush(agent.session)
    const recordedCommands = commandEvents()
    expect(recordedCommands).toEqual([])
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await assertChatUnchanged()
    expect(commandEvents()).toEqual(recordedCommands)
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(false)
    acknowledgeReloadConnectionLoss(tripwire, warningStart)

    // Historical receipts are read-only fixtures, not invocations of a registered command.
    for (const args of [' on', ' off']) {
      const commandId = CommandId(`historical-team-${args.trim()}`)
      agent.session.append('command/run', { commandId, name: 'team', args, source: { kind: 'user' } })
      agent.session.append('command/done', { commandId, kind: 'success', text: 'Team mode saved.' })
    }
    agent.session.append('command/run', {
      commandId: CommandId('historical-team-pending'), name: 'team', args: ' on', source: { kind: 'user' },
    })
    await scaffold.ctx.sessions.flush(agent.session)
    const historicalCommands = commandEvents()
    expect(historicalCommands.map(event => event.type)).toEqual([
      'command/run', 'command/done', 'command/run', 'command/done', 'command/run',
    ])
    const historicalWarningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await assertChatUnchanged()
    expect(commandEvents()).toEqual(historicalCommands)
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(false)
    acknowledgeReloadConnectionLoss(tripwire, historicalWarningStart)
  })
})

it.each(RECEIPT_LOCALES)('renders historical Team failures in $language without a success receipt after reload', async (locale) => {
  await withTeamReceiptPage(locale, async (page, scaffold, tripwire) => {
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('Team failure fixture has no Agent')
    const commandId = CommandId('historical-team-error')
    agent.session.append('command/run', { commandId, name: 'team', args: ' invalid', source: { kind: 'user' } })
    agent.session.append('command/done', { commandId, kind: 'error', text: 'Use /team on or /team off.' })
    await scaffold.ctx.sessions.flush(agent.session)
    const row = page.locator('[data-team-command]')
    const captureFailure = async (): Promise<string> => {
      await row.getByText(locale.failure, { exact: true }).waitFor()
      expect(await row.count()).toBe(1)
      expect(await row.getAttribute('data-state')).toBe('error')
      expect(await row.getByText(locale.title, { exact: true }).count()).toBe(1)
      expect(await row.getByText(locale.enabled, { exact: true }).count()).toBe(0)
      expect(await row.getByText(locale.disabled, { exact: true }).count()).toBe(0)
      expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(false)
      const collapsed = await captureStableAria(page, '[data-team-command]', scaffold.workspaceCwd)
      const disclosure = row.getByRole('button', { expanded: false })
      await disclosure.click()
      await row.getByRole('button', { expanded: true }).waitFor()
      await row.getByText('Use /team on or /team off.', { exact: true }).waitFor()
      const expanded = await captureStableAria(page, '[data-team-command]', scaffold.workspaceCwd)
      return `## Failed receipt\n\n${collapsed}\n\n## Raw error\n\n${expanded}`
    }
    const failure = await captureFailure()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, `command-error.${locale.code}.expected.md`), failure, MODE)
    await scaffold.ctx.sessions.flush(agent.session)
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    expect(await captureFailure()).toBe(failure)
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
  })
})

it('shows the Chinese empty subagent section above compact shared tasks', async () => {
  await withTeamReceiptPage(RECEIPT_LOCALES[1], async (page, scaffold) => {
    const agent = scaffold.ctx.agents.list()[0]!
    await scaffold.ctx.agentTeams.setEnabled(agent, true)
    await scaffold.ctx.agentTeams.createTask(agent, {
      subject: '准备协作', description: '先准备共享任务，再创建子智能体。',
    })
    await page.getByRole('button', { name: '0 个子智能体', exact: true }).click()
    const panel = page.locator('[data-subagent-panel]')
    await panel.getByText('暂无子智能体', { exact: true }).waitFor()
    await panel.getByRole('heading', { name: '共享任务 1 待处理', exact: true }).waitFor()
    expect(await panel.locator('[data-team-task-details]').count()).toBe(0)
  })
})

it('uses the Chinese collaboration name in the switch and disable confirmation', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('Chinese Team fixture has no Agent')
    await scaffold.ctx.agentTeams.setEnabled(agent, true)
    const selection = agent.model.current()
    if (selection === undefined) throw new Error('Chinese Team fixture has no model')
    agent.session.append('request/header', { header: { config: selection }, reason: 'initial' })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByRole('button', { name: /^选择模型/u }).click()
    const toggle = page.getByRole('switch', { name: '启用智能体团队协作', exact: true })
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await page.getByRole('button', { name: '关于智能体团队协作', exact: true }).waitFor()
    expect(await toggle.evaluate(element => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth)).toBe(true)
    const menu = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await toggle.click()
    const dialog = page.getByRole('dialog', { name: '确认停用智能体团队协作？', exact: true })
    await dialog.waitFor()
    await dialog.getByText('对话过程中停用智能体团队协作，将停止共享任务工具和团队协调指令。', { exact: true }).waitFor()
    await assertWarningDialogLayout(dialog)
    const confirmation = await captureStableAria(page, '[aria-modal="true"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'collaboration.zh.expected.md'),
      `## Menu\n\n${menu}\n\n## Confirmation\n\n${confirmation}`, MODE)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(scaffold.ctx.agentTeams.isEnabled(agent)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
