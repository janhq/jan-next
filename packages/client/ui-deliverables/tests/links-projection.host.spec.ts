/** The shared-links projection indexes the web links a chat's people and assistant wrote, for the Artifacts library. */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionLogOffset } from '@janhq/jan-session'
import { applySharedLinks, linkMentions, MAX_SESSION_LINKS, type SharedLinksState } from '../src/links-projection.ts'

const empty = (inherited = 0): SharedLinksState => ({ inheritedEventCount: inherited as SessionLogOffset, links: [] })
const text = (value: string) => [{ type: 'text', text: value }]
function user(seq: number, value: string, kind = 'user'): SessionEvent {
  return { type: 'user/message', seq, time: seq * 1_000, data: { role: 'user', source: { kind }, content: text(value) } } as unknown as SessionEvent
}
function assistant(seq: number, value: string): SessionEvent {
  return { type: 'assistant/message', seq, time: seq * 1_000, data: { turn: 1, step: 0, message: { role: 'assistant', content: text(value) }, stream: [] } } as unknown as SessionEvent
}

describe('linkMentions', () => {
  it('reads Markdown links with their text and bare URLs in the order written', () => {
    expect(linkMentions('See [the docs](https://jan.ai/docs "Docs") and https://github.com/janhq/jan.')).toEqual([
      { url: 'https://jan.ai/docs', title: 'the docs' },
      { url: 'https://github.com/janhq/jan', title: undefined },
    ])
  })

  it('keeps balanced parentheses in a URL and drops sentence punctuation around it', () => {
    expect(linkMentions('(see https://en.wikipedia.org/wiki/Jan_(software)), then https://example.com/a?b=1!').map(m => m.url)).toEqual([
      'https://en.wikipedia.org/wiki/Jan_(software)',
      'https://example.com/a?b=1',
    ])
  })

  it('skips images, code, and anything that is not an absolute web URL', () => {
    expect(linkMentions([
      '![chart](https://example.com/chart.png)',
      '`curl https://inline.example`',
      '```\nhttps://fenced.example\n```',
      'file:///etc/passwd mailto:a@b.c http:// ftp://x.example [x](javascript:alert(1))',
    ].join('\n'))).toEqual([])
  })

  it('does not use a URL as its own title', () => {
    expect(linkMentions('[https://jan.ai](https://jan.ai)')).toEqual([{ url: 'https://jan.ai/', title: undefined }])
  })
})

describe('sharedLinks projection reducer', () => {
  it('records links from the person and the assistant with who wrote them', () => {
    let state = applySharedLinks(empty(), user(2, 'Compare https://a.example and [B](https://b.example/x)'))
    state = applySharedLinks(state, assistant(4, 'Sources: [Alpha](https://a.example)'))
    expect(state.links).toEqual([
      { url: 'https://b.example/x', title: 'B', from: 'user', seq: 2, time: 2_000 },
      { url: 'https://a.example/', title: 'Alpha', from: 'assistant', seq: 4, time: 4_000 },
    ])
  })

  it('keeps an earlier title when a later mention is bare', () => {
    let state = applySharedLinks(empty(), assistant(2, '[Jan docs](https://jan.ai/docs)'))
    state = applySharedLinks(state, user(5, 'open https://jan.ai/docs again'))
    expect(state.links).toEqual([{ url: 'https://jan.ai/docs', title: 'Jan docs', from: 'user', seq: 5, time: 5_000 }])
  })

  it('ignores injected context, messages without links, other events, and the fork-inherited prefix', () => {
    const state = applySharedLinks(empty(6), user(7, 'https://kept.example'))
    expect(applySharedLinks(state, user(8, 'https://context.example', 'context'))).toBe(state)
    expect(applySharedLinks(state, user(9, 'no links here'))).toBe(state)
    expect(applySharedLinks(state, { type: 'turn/start', seq: 10, time: 1, data: { turn: 2 } } as SessionEvent)).toBe(state)
    expect(applySharedLinks(empty(6), user(5, 'https://inherited.example')).links).toEqual([])
  })

  it('keeps only the newest mentions once a chat holds many links', () => {
    const many = Array.from({ length: MAX_SESSION_LINKS + 5 }, (_, i) => `https://site${String(i)}.example`).join(' ')
    const state = applySharedLinks(empty(), assistant(3, many))
    expect(state.links).toHaveLength(MAX_SESSION_LINKS)
    expect(state.links[0]?.url).toBe('https://site5.example/')
  })
})
