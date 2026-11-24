import type { ChangeRequestFailureContext } from '@janhq/jan-experimental-forge/types'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import { describe, expect, it } from 'vitest'
import { buildFailureContext, MAX_FAILURE_CONTEXT_CHARS } from '../src/client/failure-context.ts'
import { en } from '../src/client/locales.ts'
import { check, snapshot } from './client-fixtures.client.ts'

const t = makeTranslate(en)
const lint = check('lint', { state: 'failure', url: 'https://checks.test/lint', output: { title: 'Wrong type', summary: 'Expected number' } })
const build = check('build', { state: 'failure' })
const context: ChangeRequestFailureContext = {
  snapshot: snapshot(154, { title: 'Fix parser', checks: [lint, check('passing'), build], checksRollup: 'failure', reviewDecision: 'changes-requested' }),
  logs: [{ url: 'https://checks.test/lint', step: 'Run lint', text: 'Failed on input.go', truncated: false }],
  reviews: [{ author: 'mona', body: 'See lines', comments: [{ path: 'parser.ts', line: 12, body: 'Avoid a cast' }] }],
  failures: [], truncated: false,
}

describe('failure context block', () => {
  it('keeps identity, review locations, failed check output, and matching logs in deterministic order', () => {
    const text = buildFailureContext(context, { kind: 'all' }, t)
    for (const value of [context.snapshot.url, context.snapshot.headSha, '154', 'Fix parser', 'Wrong type', 'Expected number', 'Failed on input.go', 'parser.ts:12', 'Avoid a cast']) {
      expect(text).toContain(value)
    }
    expect(text).not.toContain('passing')
    expect(text).toEqual(buildFailureContext({ ...context, snapshot: { ...context.snapshot, checks: [build, lint] } }, { kind: 'all' }, t))
    expect(text.indexOf('build')).toBeLessThan(text.indexOf('lint'))
  })

  it('keeps a single-check or review action scoped to its subject', () => {
    const selected = buildFailureContext(context, { kind: 'check', name: lint.name, workflow: lint.workflow, url: lint.url }, t)
    expect(selected).toContain('Wrong type')
    expect(selected).not.toContain('build')
    expect(selected).not.toContain('Avoid a cast')
    const reviews = buildFailureContext(context, { kind: 'review' }, t)
    expect(reviews).toContain('parser.ts:12')
    expect(reviews).not.toContain('Wrong type')
  })

  it('caps the complete block, preserves a log tail, and marks omitted text', () => {
    const large = { ...context, logs: [{ ...context.logs[0]!, text: '😀'.repeat(MAX_FAILURE_CONTEXT_CHARS) + 'last error' }] }
    const text = buildFailureContext(large, { kind: 'all' }, t)
    expect(text.length).toBeLessThanOrEqual(MAX_FAILURE_CONTEXT_CHARS)
    expect(text).toContain('last error')
    expect(text).toContain(en['change.failure.trimmed'])
    expect(text).toContain('parser.ts:12')
    expect(text.isWellFormed()).toBe(true)
    expect(buildFailureContext(context, { kind: 'all' }, t)).not.toContain(en['change.failure.trimmed'])
  })
})
