import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { conversationWindowMoveHandler, conversationWindowStore, readConversationWindowIds } from '../src/conversation-windows.ts'

function event(url = 'jan-app://app/', top = true): IpcMainInvokeEvent {
  const frame = { url }
  return { senderFrame: frame, sender: { id: 8, mainFrame: top ? frame : {} } } as IpcMainInvokeEvent
}

describe('desktop conversation window IPC', () => {
  it('opens only the validated Session passed by an owned app main frame', async () => {
    const open = vi.fn(async () => {})
    const handle = conversationWindowMoveHandler(id => id === 8, open)
    await handle(event(), 'session-255ab253-163b-444e-bd7c-2f5afb66f99b')
    expect(open).toHaveBeenCalledExactlyOnceWith('session-255ab253-163b-444e-bd7c-2f5afb66f99b')
  })

  it('rejects unowned, nonapp, subframe and malformed requests before opening a window', async () => {
    const open = vi.fn(async () => {})
    const handle = conversationWindowMoveHandler(id => id === 8, open)
    await expect(handle(event('https://example.test/'), 'session-valid')).rejects.toThrow(/renderer/)
    await expect(handle(event('jan-app://app/', false), 'session-valid')).rejects.toThrow(/renderer/)
    await expect(conversationWindowMoveHandler(() => false, open)(event(), 'session-valid')).rejects.toThrow(/renderer/)
    for (const bad of ['', '../session-valid', 'bad\nvalue', {}, 'a'.repeat(257)]) {
      await expect(handle(event(), bad)).rejects.toThrow(/Session id/)
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('reopens the last saved window list and ignores a damaged or foreign one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jan-windows-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    expect(readConversationWindowIds(dir)).toEqual([])
    const save = conversationWindowStore(dir)
    void save(['first'])
    await save(['first', 'second'])
    expect(readConversationWindowIds(dir)).toEqual(['first', 'second'])
    await writeFile(join(dir, 'conversation-windows.json'), '{')
    expect(readConversationWindowIds(dir)).toEqual([])
    await writeFile(join(dir, 'conversation-windows.json'), JSON.stringify({ windows: ['kept', '../escape', 7] }))
    expect(readConversationWindowIds(dir)).toEqual(['kept'])
  })
})
