// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import type { JobsSnapshot, JobView, ObservedJob } from '@janhq/jan-api-job-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import { JobCallStatus, type JobCallStatusProps } from '../src/client/JobCallStatus.tsx'
import { latestLine } from '../src/client/live-line.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SESSION = 'session' as SessionId
const t = makeTranslate(en) as JobCallStatusProps['t']
const STARTED = 1_700_000_000_000

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm install',
    status: 'running',
    startedAt: STARTED,
    output: { total: 0, earliest: 0 },
    toolCall: { callId: 'call-1', rootCallId: 'call-1' } as NonNullable<JobView['toolCall']>,
    ...over,
  }
}

function mount(
  jobs: readonly JobView[],
  observed: Readonly<Record<string, ObservedJob>> = {},
  owner: { callId?: string; settledAt?: number } = {},
) {
  const state: JobsSnapshot = { rows: { [SESSION]: jobs }, observed }
  const observe = vi.fn(() => () => {})
  const watchRows = vi.fn(() => () => {})
  function useJobs<T>(select: (value: JobsSnapshot) => T): T {
    return select(state)
  }
  const props = {
    sessionId: SESSION, callId: owner.callId ?? 'call-1', toolName: 'bash', settledAt: owner.settledAt,
    useJobs, observe, watchRows, t,
  } as unknown as JobCallStatusProps
  const view = render(<JobCallStatus {...props} />)
  return { view, observe, watchRows }
}

function observedText(text: string): Record<string, ObservedJob> {
  return { 'bash-1': { jobId: 'bash-1' as JobView['id'], text, gapBefore: false, streaming: true } }
}

describe('latestLine', () => {
  it('shows what a terminal shows: the rewrite after the last carriage return, escapes dropped', () => {
    expect(latestLine('resolving\nprogress 10%\rprogress 40%\r\u001B[32mprogress 70%\u001B[0m')).toBe('progress 70%')
  })

  it('skips trailing blank lines and a trailing carriage return', () => {
    expect(latestLine('step 1\r\nstep 2\r\n\n')).toBe('step 2')
    expect(latestLine('downloading 3/9\r')).toBe('downloading 3/9')
  })

  it('has nothing to show for whitespace or escapes alone', () => {
    expect(latestLine(' \n\u001B[2K\r\n')).toBeUndefined()
  })
})

describe('JobCallStatus', () => {
  it('shows the latest output line of the running job behind this call and observes it', () => {
    const { observe } = mount([job()], observedText('Fetching\rProgress: resolved 812, downloaded 40'))
    expect(screen.getByText('Progress: resolved 812, downloaded 40')).toBeTruthy()
    expect(observe).toHaveBeenCalledWith(SESSION, 'bash-1')
  })

  it('prefers the producer progress line over raw output', () => {
    mount([job({ progress: '3/10 packages' })], observedText('noise'))
    expect(screen.getByText('3/10 packages')).toBeTruthy()
    expect(screen.queryByText('noise')).toBeNull()
  })

  it('renders nothing for a call that started no job, and does not observe others', () => {
    const { view, observe } = mount([job()], observedText('other output'), { callId: 'call-2' })
    expect(view.container.textContent).toBe('')
    expect(observe).not.toHaveBeenCalled()
  })

  it('marks a job that outlived its call as running in the background with its own clock, replacing the call duration', () => {
    vi.useFakeTimers({ now: STARTED + 65_000 })
    const { view } = mount([job()], observedText('listening on :3000'), { settledAt: STARTED + 200 })
    expect(screen.getByText('In background')).toBeTruthy()
    expect(screen.getByText('listening on :3000')).toBeTruthy()
    expect(screen.getByText(/1.*5/)).toBeTruthy()
    expect(view.container.querySelector('[data-tool-status-clock]')?.textContent).toContain('In background')
  })

  it('shows a backgrounded job final state without output, and nothing for a foreground job that settled with its call', () => {
    const settled = job({ status: 'failed', finishedAt: STARTED + 30_000, detail: 'exit code: 1' })
    const background = mount([settled], {}, { settledAt: STARTED + 200 })
    expect(screen.getByText(en['status.failed'])).toBeTruthy()
    background.view.unmount()
    const foreground = mount([job({ status: 'completed', finishedAt: STARTED + 30_000 })], {}, { settledAt: STARTED + 30_050 })
    expect(foreground.view.container.textContent).toBe('')
  })

  it('keeps the call duration for a live foreground job: the output line carries no clock', () => {
    const { view } = mount([job()], observedText('downloading 3/15'))
    expect(screen.getByText('downloading 3/15')).toBeTruthy()
    expect(view.container.querySelector('[data-tool-status-clock]')).toBeNull()
  })
})
