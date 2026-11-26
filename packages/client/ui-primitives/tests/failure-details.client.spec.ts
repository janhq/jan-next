import { describe, expect, it, vi } from 'vitest'
import { buildFailureDetails, captureFailure, registerFailureEnvironment } from '../src/failure-details.ts'

const time = '2026-11-24T10:00:00.000Z'

function failure(error: unknown) {
  return captureFailure('session.pin', error, { timestamp: time, version: '1.2.3', platform: 'macOS', connection: 'connecting' })
}

describe('failure details', () => {
  it('snapshots the connection and uses the Host release if the client build is unstamped', () => {
    vi.stubEnv('JAN_CLIENT_VERSION', undefined)
    let connection = 'reconnecting'
    const dispose = registerFailureEnvironment(() => ({ version: '1.2.3', connection }))
    try {
      const snapshot = captureFailure('session.pin', new Error('lost'))
      connection = 'connected'
      expect(snapshot).toMatchObject({ connection: 'reconnecting', version: '1.2.3' })
    } finally {
      dispose()
      vi.unstubAllEnvs()
    }
  })

  it('captures RemoteError fields and lists the causes outermost first', () => {
    const error = Object.assign(new Error('wrapper', { cause: new Error('inner failure', { cause: new Error('root failure') }) }), {
      code: 'workspace/conflict', details: { retryable: false },
    })
    const snapshot = failure(error)
    error.message = 'changed after capture'
    const report = buildFailureDetails(snapshot, 'diagnostic log line')
    for (const fact of ['session.pin', time, '1.2.3', 'macOS', 'connecting', 'workspace/conflict', 'wrapper', 'retryable', 'diagnostic log line']) {
      expect(report).toContain(fact)
    }
    expect(report).toContain('failure-details.client.spec.ts')
    expect(report.indexOf('wrapper')).toBeLessThan(report.indexOf('inner failure'))
    expect(report.indexOf('inner failure')).toBeLessThan(report.indexOf('root failure'))
    expect(report).not.toContain('changed after capture')
  })

  it('removes credentials from the operation, message, data, stack, causes, and log', () => {
    const secrets = ['bearer-secret', 'query-secret', 'key-secret with spaces', 'auth-secret with spaces',
      'header-secret', 'stack-secret', 'cause-secret', 'log-secret', 'embedded-secret', 'nested-secret', 'pair-secret',
      'sk-abcdefghijklmnopqrstuv']
    const error = Object.assign(new Error(`Bearer ${secrets[0]} then https://example.com/?token=${secrets[1]}&page=2 ${secrets[11]}`, {
      cause: new Error(`Authorization: Basic ${secrets[6]}`),
    }), {
      data: { apiKey: secrets[2], authorization: secrets[3], safe: { 'x-api-key': secrets[4], counter: 42 },
        headers: [['Authorization', secrets[10]]], note: `response: {"api_key":"${secrets[8]}"}`, password: { value: secrets[9] } },
      stack: `Error: failed\n    at https://example.com/?token=${secrets[5]}`,
    })
    const snapshot = captureFailure('pin Bearer operation-secret', error)
    const report = buildFailureDetails(snapshot, `host\nX-Api-Key: ${secrets[7]}\ncompleted`)
    for (const secret of [...secrets, 'operation-secret']) {
      expect(JSON.stringify(snapshot)).not.toContain(secret)
      expect(report).not.toContain(secret)
    }
    for (const fact of ['<redacted>', 'page=2', 'counter', '42', 'completed']) expect(report).toContain(fact)
  })

  it('drops partial inputs, limits long sections, keeps the newest whole log lines, and stops on cycles', () => {
    const huge = 'x'.repeat(100_000)
    const getter = vi.fn(() => { throw new Error('should not execute') })
    const data = Object.defineProperty({ huge }, 'untrusted', { enumerable: true, get: getter })
    const error = Object.assign(new Error(huge), { data, stack: `stack\n${huge}` })
    error.cause = error
    const log = `old line\nBearer ${'z'.repeat(30_000)}\n${Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')}`
    const report = buildFailureDetails(failure(error), log)
    expect(report.length).toBeLessThanOrEqual(24 * 1024)
    expect(report).toContain('line 59')
    expect(report).not.toMatch(/old line|\bz{10}|\nline 0\n/)
    expect(getter).not.toHaveBeenCalled()
  })
})
