import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@janhq/jan-agent'
import { createUserMessage, LlmAdapter } from '@janhq/jan-llm'
import type { GenerateOptions, StreamChunk } from '@janhq/jan-llm'
import { SessionId, type SessionId as SessionIdValue } from '@janhq/jan-session'
import type {} from '@janhq/jan-subagent'
import type {} from '@janhq/jan-workspace'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/sidebar-subagent-activity', import.meta.url))
const RUNNING_OWNER_EXPECTED = join(SNAPSHOT_DIR, 'owner-running.expected.md')
const MODE = webSnapshotMode()
const HOLD_PROVIDER = 'web-test-hold'
const HOLD_MODEL = 'hold'

/** Model stub that completes the owner turn, then holds its delegated child open. */
class StagedAdapter extends LlmAdapter {
  activeCalls = 0
  private calls = 0

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls === 0) {
      this.calls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.calls += 1
    const signal = options.signal
    if (signal === undefined) throw new Error('staged Web adapter requires a turn signal')
    this.activeCalls += 1
    try {
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('holding Web adapter aborted'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
    } finally {
      this.activeCalls -= 1
    }
  }
}

async function waitForRunningChild(
  scaffold: WebScaffold,
  adapter: StagedAdapter,
  childId: SessionIdValue,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (adapter.activeCalls !== 1 || scaffold.ctx.agents.get(childId)?.status !== 'running') {
    if (Date.now() >= deadline) throw new Error('held child did not enter its running model call')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

async function expectWithinViewport(locator: Locator, label: string): Promise<void> {
  await expect.poll(() => locator.evaluate((element) => {
    const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
    return width > 0 && height > 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight && left >= 0
  }), { message: `${label} should fit inside the viewport` }).toBe(true)
}

describe('web e2e: sidebar subagent activity', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let parentHandle: AgentHandle
  let childId: SessionIdValue
  let adapter: StagedAdapter
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    adapter = new StagedAdapter()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([HOLD_PROVIDER], adapter),
      'sidebar subagent activity staged adapter',
    )
    const cwd = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(cwd)
    parentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('sidebar-activity-owner'),
      meta: { cwd },
      agentOptions: { provider: HOLD_PROVIDER, model: HOLD_MODEL },
    })
    parentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Delegate a background job.' }],
      source: { kind: 'user' },
    }))
    await parentHandle.agent.whenIdle()
    const started = await scaffold.ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'sidebar activity child',
      signal: new AbortController().signal,
      prompt: [{ type: 'text', text: 'Hold this delegated task open.' }],
      parent: parentHandle.agent,
    })
    childId = started.childId
    await waitForRunningChild(scaffold, adapter, childId)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('connected Web workspace was not registered')
    await workspace.attachSession(parentHandle.agent.session.id)
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    const child = childId === undefined ? undefined : scaffold?.ctx.agents.get(childId)
    if (child !== undefined) {
      child.cancel({ kind: 'user' })
      await child.whenIdle().catch((error: unknown) => failures.push(error))
    }
    await browser?.close().catch((error: unknown) => failures.push(error))
    await parentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'sidebar subagent activity teardown failed')
  })

  it('pins a running descendant on its visible idle owner row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-subagent-activity'))
    const sidebar = page.getByRole('tree', { name: 'Sessions' })
    const ownerRow = sidebar.getByRole('treeitem', { name: /1 subagent running Delegate a background job/ })
    await ownerRow.waitFor({ timeout: 10_000 })
    expect(parentHandle.agent.status).toBe('idle')
    await compareOrRefreshGolden(
      RUNNING_OWNER_EXPECTED,
      await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd),
      MODE,
    )
    expect(await ownerRow.locator('[data-state="ongoing"]').count()).toBe(1)
    await ownerRow.click()
    await page.getByRole('dialog', { name: 'New chats use Full access', exact: true })
      .getByRole('button', { name: 'Got it', exact: true }).click()
    const composer = page.locator('[data-composer-seat]')
    const roster = composer.getByRole('region', { name: 'Subagents', exact: true })
    const rosterTrigger = roster.getByRole('button', { name: /^1 subagent.*1 in progress$/ })
    const rosterSpinner = rosterTrigger.locator('[data-state="ongoing"]')
    const members = roster.locator('[data-subagent-panel]')
    const runningMember = members.getByRole('button', { name: /^running sidebar activity child$/i })
    await rosterSpinner.waitFor({ timeout: 10_000 })
    await expect.poll(async () => {
      const rosterBox = await roster.boundingBox()
      const inputBox = await composer.locator('[data-composer-card]').boundingBox()
      return rosterBox !== null && inputBox !== null && rosterBox.y + rosterBox.height <= inputBox.y
    }, { message: 'the subagent roster should sit above the composer input' }).toBe(true)
    await rosterTrigger.click()
    await runningMember.locator('[data-state="ongoing"]').waitFor()
    await rosterTrigger.click()
    await members.waitFor({ state: 'hidden' })
    // This directly created owner has no tool preset; the fixture collects its own job.
    scaffold.ctx.effect(() => scaffold.ctx.jobs.attachController('composer dock fixture'), 'composer dock job controller')
    const completion = Promise.withResolvers<{ status: 'completed' }>()
    const ownerId = parentHandle.agent.id
    const jobId = scaffold.ctx.jobs.start({
      kind: 'bash', label: 'Concurrent background work', owner: ownerId,
      run(handle) {
        handle.append('Background work is running.\n')
        return { done: completion.promise, cancel: () => { completion.resolve({ status: 'completed' }) } }
      },
    })
    const viewport = page.viewportSize()!
    try {
      const jobTrigger = composer.locator('[data-composer-dock]').getByRole('button', { name: '1 running', exact: true })
      const jobLabel = jobTrigger.getByText('1 running', { exact: true })
      const jobSpinner = jobTrigger.locator('[data-state="ongoing"]')
      await jobLabel.waitFor()
      await jobSpinner.waitFor()

      await rosterTrigger.focus()
      await page.setViewportSize({ width: 390, height: 700 })
      await expectWithinViewport(rosterTrigger, 'Subagent roster button')
      await expectWithinViewport(jobTrigger, 'Running jobs pill')
      expect(await rosterTrigger.evaluate(element => element === document.activeElement)).toBe(true)
      await rosterSpinner.waitFor()
      await jobLabel.waitFor()
      await jobSpinner.waitFor()

      await rosterTrigger.click()
      await runningMember.locator('[data-state="ongoing"]').waitFor()
      await expectWithinViewport(members, 'Subagent member list')
      const keepRunningJobs = { runningJobs: 'keep' } as const
      const rosterAria = await captureStableAria(page, '[data-composer-seat] [data-subagent-action]', scaffold.workspaceCwd, keepRunningJobs)
      const jobsPillAria = await captureStableAria(page, '[data-composer-dock] button[aria-label="1 running"]', scaffold.workspaceCwd, keepRunningJobs)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'compact-running.expected.md'), `${rosterAria}\n${jobsPillAria}`, MODE)
      await saveFailureShot(page, 'web-e2e-compact-running-controls')
      await rosterTrigger.click()
      await members.waitFor({ state: 'hidden' })

      await jobTrigger.click()
      const jobs = page.getByRole('list', { name: 'Background jobs', exact: true })
      const runningJob = jobs.getByRole('listitem').filter({ hasText: 'Concurrent background work' })
      await runningJob.locator('[data-state="ongoing"]').waitFor()
      await expectWithinViewport(page.locator('[data-menu-material]').filter({ has: jobs }), 'Background jobs menu')
      await page.keyboard.press('Escape')
      await jobs.waitFor({ state: 'hidden' })

      await page.setViewportSize(viewport)
      await ownerRow.waitFor()
      await expectWithinViewport(rosterTrigger, 'Restored subagent roster button')
      await expectWithinViewport(jobTrigger, 'Restored running jobs pill')
      await rosterSpinner.waitFor()
      await jobLabel.waitFor()
      await jobSpinner.waitFor()
    } finally {
      completion.resolve({ status: 'completed' })
      await scaffold.ctx.jobs.wait(jobId, 5_000, ownerId)
      await page.keyboard.press('Escape')
      await page.setViewportSize(viewport)
    }
    await assertFixtureInventory(SNAPSHOT_DIR, ['owner-running.expected.md', 'compact-running.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
