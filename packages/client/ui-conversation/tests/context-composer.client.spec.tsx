// @vitest-environment jsdom
import { Context } from '@janhq/cordis'
import { $nodesOfType } from 'lexical'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { parseStoredDraft } from '../src/client/draft.ts'
import { ContextNode, REMOVE_CONTEXT_COMMAND } from '../src/client/input/editor/ContextNode.tsx'
import { SessionInputShell, type SessionInputDeps } from '../src/client/input/facade.ts'

const context = {
  text: '<page-element selector="a">\n<b>x</b>\n</page-element>',
  label: 'x <b>',
}
const draft = `pink\n${context.text}`

function makeShell(
  defaultSink: SessionInputDeps['defaultSink'] = async () => ({ kind: 'success' }),
): SessionInputShell {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const shell = new SessionInputShell({
    actx: ctx,
    defaultSink,
    commandAttachments: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: token => token,
    },
  })
  onTestFinished(() => { shell.dispose() })
  shell.refreshLexiconSubscription()
  return shell
}

function contextLabels(shell: SessionInputShell): string[] {
  return shell.editor.getEditorState().read(() => $nodesOfType(ContextNode).map(node => node.getLabel()))
}

describe('context chip composer lifecycle', () => {
  it('appends one labeled chip without changing the context text in the draft', () => {
    const shell = makeShell()
    expect(shell.appendDraft('pink', [], [context])).toBe(true)
    expect(contextLabels(shell)).toEqual([context.label])
    expect(shell.snapshot.draft).toBe(draft)
  })

  it('restores a persisted chip but rejects context text that no longer matches the draft', () => {
    const original = makeShell()
    original.appendDraft('pink', [], [context])

    const stored = parseStoredDraft(JSON.parse(JSON.stringify(original.draftSnapshot)))
    if (stored === undefined) throw new Error('Expected the draft with a context chip to parse')
    expect(stored.contexts).toEqual([{ offset: 'pink\n'.length, length: context.text.length, ...context }])

    const restored = makeShell()
    restored.setDraft(stored)
    expect(contextLabels(restored)).toEqual([context.label])
    expect(restored.draftSnapshot).toEqual(stored)

    const tampered = { ...stored, text: draft.replace('<b>x</b>', '<b>y</b>') }
    expect(parseStoredDraft(tampered)).toBeUndefined()
  })

  it('submits the verbatim context text rather than the chip label', async () => {
    const sink = vi.fn<SessionInputDeps['defaultSink']>(async () => ({ kind: 'success' }))
    const shell = makeShell(sink)
    shell.appendDraft('pink', [], [context])
    shell.submit()

    await vi.waitFor(() => { expect(sink.mock.calls[0]?.[0]).toBe(draft) })
  })

  it('removes the whole context chip and leaves the surrounding draft intact', async () => {
    const shell = makeShell()
    shell.appendDraft('pink', [], [context])
    const key = shell.editor.getEditorState().read(() => $nodesOfType(ContextNode)[0]?.getKey())
    if (key === undefined) throw new Error('Expected an inserted context chip')

    expect(shell.editor.dispatchCommand(REMOVE_CONTEXT_COMMAND, key)).toBe(true)
    await vi.waitFor(() => {
      expect(contextLabels(shell)).toEqual([])
      expect(shell.snapshot.draft).toBe('pink')
    })
  })
})
