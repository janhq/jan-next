/**
 * Pre-send checks pause a flagged plain message once: the draft stays and the
 * notice shows; sending the same draft again goes through, an edited draft is
 * checked again.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@janhq/cordis'
import type { SubmitOutcome } from '../src/client/contract/input.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

const commandAttachments = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => token,
}

function shellWith(sendCheck: (text: string) => string | undefined) {
  const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
  const shell = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandAttachments, sendCheck })
  return { shell, sink }
}

describe('send checks', () => {
  it('pauses the first send of a flagged draft and sends it on the second', () => {
    const { shell, sink } = shellWith(text => text.length > 5 ? 'too long' : undefined)
    shell.setDraft('a long draft')
    shell.submit()
    expect(sink).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('a long draft')
    expect(shell.notices.getSnapshot()).toMatchObject({ level: 'error', text: 'too long' })

    shell.submit()
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('checks an edited draft again', () => {
    const { shell, sink } = shellWith(text => text.length > 5 ? 'too long' : undefined)
    shell.setDraft('a long draft')
    shell.submit()
    shell.setDraft('a longer draft')
    shell.submit()
    expect(sink).not.toHaveBeenCalled()
  })

  it('sends a draft that passes the checks without a notice', () => {
    const { shell, sink } = shellWith(() => undefined)
    shell.setDraft('hi')
    shell.submit()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(shell.notices.getSnapshot()).toBeNull()
  })
})
