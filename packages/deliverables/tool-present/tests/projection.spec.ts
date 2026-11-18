/** The presented-files projection indexes every delivery of a Session for cross-Session listing. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import { ToolCallId } from '@janhq/jan-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionLogOffset } from '@janhq/jan-session'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import * as presentedFilesProjection from '../src/projection.ts'
import { applyPresentedFiles, type PresentedFilesState } from '../src/projection.ts'

const empty = (inherited = 0): PresentedFilesState => ({ inheritedEventCount: inherited as SessionLogOffset, files: [] })
let counter = 0
function presented(seq: number, turn: number, files: unknown[], time = 1_000 * seq): SessionEvent {
  return { type: 'deliverables/presented', seq, time, data: { turn, callId: ToolCallId(`call-${++counter}`), files } } as SessionEvent
}

describe('presentedFiles projection reducer', () => {
  it('accumulates files across turns and nested calls with their open coordinates', () => {
    let state = empty()
    state = applyPresentedFiles(state, presented(3, 1, [{ path: '/w/report.docx', description: 'Report' }, { path: '/w/data.xlsx' }]))
    // A nested present call inside the same turn is a second event with its own call id.
    state = applyPresentedFiles(state, presented(5, 1, [{ path: '/w/slides.pptx' }]))
    state = applyPresentedFiles(state, presented(9, 2, [{ path: '/w/chart.png' }]))
    expect(state.files).toEqual([
      { path: '/w/report.docx', description: 'Report', turn: 1, seq: 3, index: 0, time: 3_000 },
      { path: '/w/data.xlsx', turn: 1, seq: 3, index: 1, time: 3_000 },
      { path: '/w/slides.pptx', turn: 1, seq: 5, index: 0, time: 5_000 },
      { path: '/w/chart.png', turn: 2, seq: 9, index: 0, time: 9_000 },
    ])
  })

  it('keeps one entry per path, addressed by its latest declaration', () => {
    let state = applyPresentedFiles(empty(), presented(3, 1, [{ path: '/w/a.md' }, { path: '/w/b.md' }]))
    state = applyPresentedFiles(state, presented(8, 2, [{ path: '/w/a.md', description: 'Final' }]))
    expect(state.files.map(file => [file.path, file.seq, file.index, file.description])).toEqual([
      ['/w/b.md', 3, 1, undefined],
      ['/w/a.md', 8, 0, 'Final'],
    ])
  })

  it('returns the same state for events that are not deliveries', () => {
    const state = applyPresentedFiles(empty(), presented(2, 1, [{ path: '/w/a.md' }]))
    const other = { type: 'turn/start', seq: 4, time: 4_000, data: { turn: 2 } } as SessionEvent
    const call = { type: 'tool/call', seq: 5, time: 5_000, data: { turn: 2, step: 0, callId: ToolCallId('x'), name: 'present', arguments: '{}' } } as SessionEvent
    expect(applyPresentedFiles(state, other)).toBe(state)
    expect(applyPresentedFiles(state, call)).toBe(state)
  })

  it('skips malformed declarations and deliveries with none valid', () => {
    const state = empty()
    expect(applyPresentedFiles(state, presented(2, 1, [{ path: '  ' }, { path: 3 }, null, { path: '/w/a.md', description: 4 }]))).toBe(state)
    expect(applyPresentedFiles(state, presented(3, 1, 'nope' as never))).toBe(state)
    const mixed = applyPresentedFiles(state, presented(4, 1, [{ path: '' }, { path: '/w/ok.md' }]))
    expect(mixed.files).toEqual([{ path: '/w/ok.md', turn: 1, seq: 4, index: 1, time: 4_000 }])
  })

  it('leaves a fork-inherited prefix to the parent Session index', () => {
    const state = applyPresentedFiles(empty(6), presented(5, 1, [{ path: '/w/inherited.md' }]))
    expect(state.files).toEqual([])
    expect(applyPresentedFiles(state, presented(6, 2, [{ path: '/w/own.md' }])).files.map(file => file.path)).toEqual(['/w/own.md'])
  })
})

describe('presentedFiles projection registration', () => {
  const cleanups: Array<() => Promise<unknown>> = []
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })

  it('registers the distinct files as a summary key of a live Session when mounted', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(presentedFilesProjection)
    const id = SessionId('present-projection')
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: '/w', isSeeded: false })
    session.append('turn/start', { turn: 1 })
    session.append('deliverables/presented', { turn: 1, callId: ToolCallId('c1'), files: [{ path: '/w/a.pdf' }] })
    session.append('deliverables/presented', { turn: 1, callId: ToolCallId('c2'), files: [{ path: '/w/b.csv', description: 'Rows' }] })
    expect(ctx.sessionProjections.summaryKeys().has('presentedFiles')).toBe(true)
    const { values } = ctx.sessionProjections.snapshot(session, ctx.sessionProjections.summaryKeys())
    const files = values.presentedFiles ?? []
    expect(files.map(file => file.path)).toEqual(['/w/a.pdf', '/w/b.csv'])
    expect(files[0]!.seq).toBeLessThan(files[1]!.seq)
  })
})
