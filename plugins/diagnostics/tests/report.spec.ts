/** The diagnostic report must never carry the person's paths, keys or email, and must read the end of a large log. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatReport, readLogTail, redact } from '../report.mjs'

const places = { home: '/Users/ana', janHome: '/Users/ana/jan' }

describe('redact', () => {
  it('shortens the Jan folder and home folder, the longer path first', () => {
    expect(redact('read /Users/ana/jan/logs/jan.log and /Users/ana/Desktop/x.md', places))
      .toBe('read <JAN_HOME>/logs/jan.log and ~/Desktop/x.md')
    expect(redact('C:\\Users\\ana\\file.txt', { home: 'C:\\Users\\ana' })).toBe('~\\file.txt')
  })

  it('removes provider keys, tokens, URL credentials and email addresses', () => {
    const text = [
      'key sk-proj-abcdefghijklmnopqrstuv',
      'gh ghp_abcdefghijklmnopqrstuvwxyz0123',
      'Authorization: Bearer abc.def-ghi',
      `jwt ${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcDEFghiJKLmno'].join('.')}`,
      `url https://bob:${'hun' + 'ter2'}@example.com/v1?model=x&api_key=SECRET1&page=2`,
      '{"apiKey": "plain-secret", "password":"pw1"} token=t0k',
      'mail ana.lee@example.org',
    ].join('\n')
    const out = redact(text, places)
    for (const secret of ['sk-proj-', 'ghp_', 'abc.def-ghi', 'eyJhbGci', 'hunter2', 'SECRET1', 'plain-secret', 'pw1', 't0k', 'ana.lee']) {
      expect(out).not.toContain(secret)
    }
    expect(out).toContain('model=x&api_key=<redacted>&page=2')
    expect(out).toContain('<email>')
  })

  it('keeps ordinary diagnostics that only look similar', () => {
    const text = 'max tokens: 4096, keyboard=us, session 3f2a91c0, CONTEXT_WINDOW_EXCEEDED'
    expect(redact(text, places)).toBe(text)
  })
})

describe('formatReport', () => {
  it('redacts every part of the report, including failures and the log', () => {
    const text = formatReport({
      now: new Date('2026-11-21T10:00:00Z'), version: '0.2.2', uptime: 600,
      system: { platform: 'darwin', release: '25.2.0', arch: 'arm64', node: 'v24.1.0' },
      memory: { rss: 200 * 1024 * 1024, free: 4 * 1024 ** 3, total: 16 * 1024 ** 3 },
      failedPlugins: ['broken-plugin'],
      focus: { code: 'AUTH', message: 'key sk-abcdefghijklmnopqrstu rejected' },
      failures: [{ time: Date.parse('2026-11-21T09:59:00Z'), session: 'abcdef1234567890', code: 'SERVER', message: 'from ana@example.com' }],
      log: '2026-11-21 [warn] reading /Users/ana/jan/sessions/a.jsonl',
      logPath: '/Users/ana/jan/logs/jan.log',
    }, places)
    expect(text).toContain('Jan: 0.2.2')
    expect(text).toContain('Plugins that failed to start: broken-plugin')
    expect(text).toContain('AUTH  key <redacted> rejected')
    expect(text).toContain('chat abcdef12  SERVER  from <email>')
    expect(text).toContain('Log (end of <JAN_HOME>/logs/jan.log):')
    expect(text).toContain('reading <JAN_HOME>/sessions/a.jsonl')
    expect(text).not.toContain('/Users/ana')
  })
})

describe('readLogTail', () => {
  let dir: string | undefined
  afterEach(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }) })

  it('keeps whole lines from the end of a log larger than the limit', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jan-diagnostics-'))
    const path = join(dir, 'jan.log')
    await writeFile(path, Array.from({ length: 1000 }, (_, i) => `line ${String(i)} ${'x'.repeat(40)}`).join('\n') + '\n')
    const tail = await readLogTail(path, { maxBytes: 4096, maxLines: 50 })
    const lines = tail?.split('\n') ?? []
    expect(lines).toHaveLength(50)
    expect(lines.at(-1)).toMatch(/^line 999 x+$/)
    expect(lines.every(line => /^line \d+ x{40}$/.test(line))).toBe(true)
  })

  it('answers undefined for a log that does not exist', async () => {
    expect(await readLogTail(join(tmpdir(), 'no-such-dir-jan', 'jan.log'))).toBeUndefined()
  })
})
