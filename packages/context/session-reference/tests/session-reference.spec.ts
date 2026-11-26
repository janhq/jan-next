import { describe, expect, it, vi } from 'vitest'
import { executeToolFixture } from '@janhq/jan-tool-testkit'
import * as NativeToolExecutor from '@janhq/jan-tool-executor-native'
import ToolRuntime from '@janhq/jan-tools'
import { Context } from '@janhq/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@janhq/jan-agent'
import { CompactionId, compactCheckpointSource } from '@janhq/jan-compaction'
import { createDeveloperMessage, createMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@janhq/jan-llm'
import type { ContextFormed } from '@janhq/jan-llm'
import SessionStore, { Session, SessionId, SessionSeq } from '@janhq/jan-session'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import SessionQueryEngine from '@janhq/jan-session-query'
import SessionTitleService from '@janhq/jan-session-title'
import SystemPrompt from '@janhq/jan-system-prompt'
import SessionReferenceResolver, {
  decodeSessionReferenceUri,
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
  parseSessionReferenceText,
  READ_CHAT_TOOL,
  type Config,
  type SessionReferenceErrorCode,
} from '@janhq/jan-session-reference'
import { MAX_MESSAGE_CHARS, MAX_READ_BYTES, MAX_READ_LIMIT, readChatTool } from '../src/read-chat.ts'

declare module '@janhq/jan-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
    'workspace': { kind: 'workspace' } & ContextFormed
  }
}

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // The live registry and the title unit it hosts: discovery labels an
  // attached session from its projection cut, never from its log.
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  // Shipped base values: this suite only needs the unit the service registers.
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver, config)
  return ctx
}

/**
 * Stand in for the projection cache with a fixed checkpoint table: the
 * resolver reads `cachedSnapshot` alone, and the point under test is which
 * sessions still reach a log fold.
 */
function withProjectionCache(
  ctx: Context,
  rows: Record<string, string | null | {
    title?: string | null
    subagent?: {
      readonly mode: 'one-shot' | 'continuable'
      readonly label?: string
      readonly seq: SessionSeq
    } | null
  }>,
): void {
  ctx.provide('sessionProjectionCache', {
    cachedSnapshot: (meta: { id: SessionId }) => {
      const row = rows[meta.id]
      if (!(meta.id in rows)) return undefined
      return {
        asOfSeq: SessionSeq(0),
        values: row !== null && typeof row === 'object' ? row : { title: row },
      }
    },
  })
}

function fakeAgent(session: Session): Agent {
  return { id: session.id, session, options: {} } as Agent
}

function expectCode(code: SessionReferenceErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

function checkpointSource(id: string) {
  return compactCheckpointSource(CompactionId(id))
}

function appendConversation(session: Session): void {
  session.append(
    'system/message',
    { turn: 1, step: 1, message: createSystemMessage('system prompt secret') },
    { surfaceOp: 'append' },
  )
  const oldUser = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'old user' }], source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  const oldAssistant = session.append(
    'assistant/message',
    {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'old assistant' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: '<compacted-summary>checkpoint</compacted-summary>' }],
      source: checkpointSource('conversation'),
    }),
    {
      surfaceOp: { op: 'replace', startSeq: oldUser.seq, endSeq: oldAssistant.seq },
      sourceEventSeqs: [oldUser.seq, oldAssistant.seq],
    },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'recent user' }], source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'workspace secret' }], source: { kind: 'workspace' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'human steer' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'plugin steer' }],
      source: { kind: 'test' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'tool/result',
    {
      turn: 2, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call'),
        content: [{ type: 'text', text: 'tool output' }],
        isError: false,
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append(
    'assistant/message',
    {
      stream: [],
      turn: 2,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'visible answer' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'plugin-generated user' }], source: { kind: 'test' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'reasoning', text: 'empty projected user' }], source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'reasoning', text: 'empty projected steering' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'assistant/message',
    {
      stream: [],
      turn: 2,
      step: 2,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'empty projected assistant' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('assistant/attempt', {
    turn: 2,
    step: 2,
    stream: [{
      type: 'text-chunks',
      time0: 0,
      index: 0,
      dt: [],
      texts: ['unfinished answer'],
    }],
  })
}


describe('session reference URI and inline mentions', () => {
  it('round-trips arbitrary session ids and replaces mentions with readable labels', () => {
    const sessionId = SessionId('unicode/引号"/slash\\/line\n')
    const uri = encodeSessionReferenceUri(sessionId)
    expect(decodeSessionReferenceUri(uri)).toBe(sessionId)

    const mention = formatSessionReferenceMention({ sessionId, label: '源]会话' })
    const parsed = parseSessionReferenceText(`compare ${mention} and ${uri}`)
    expect(parsed.text).toBe(`compare @源]会话 and @${sessionId}`)
    expect(parsed.references).toEqual([
      { sessionId, label: '源]会话' },
      { sessionId, label: sessionId },
    ])
    expect(formatSessionReferenceMention({ sessionId })).toContain(`@[${sessionId.replaceAll('\\', '\\\\').replaceAll(']', '\\]')}]`)

    const punctuation = parseSessionReferenceText(`see ${uri}. and \`${uri}\``)
    expect(punctuation.text).toBe(`see @${sessionId}. and \`@${sessionId}\``)
    expect(punctuation.references).toEqual([
      { sessionId, label: sessionId },
      { sessionId, label: sessionId },
    ])

    expect(parseSessionReferenceText('what is a jan-session: URI?')).toEqual({
      text: 'what is a jan-session: URI?',
      references: [],
    })
    expect(parseSessionReferenceText('see jan-session:%%%')).toEqual({
      text: 'see jan-session:%%%',
      references: [],
    })
  })

  it('rejects malformed explicit references and base64url-shaped bare candidates', () => {
    expect(() => decodeSessionReferenceUri('https://example.test')).toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    expect(() => parseSessionReferenceText('see jan-session:IiJ')).toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    expect(() => parseSessionReferenceText('@[bad](jan-session:%%%)')).toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    const nonString = `jan-session:${Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url')}`
    expect(() => decodeSessionReferenceUri(nonString)).toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    expect(() => decodeSessionReferenceUri('jan-session:IiJ')).toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
  })
})

function appendText(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('session reference discovery and preparation', () => {
  it('matches candidate metadata and titles before ranking by cwd', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same', createdAt: 10 } })
    ctx.sessions.create(SessionId('other'), { meta: { cwd: '/else', createdAt: 40 } })
    ctx.sessions.create(SessionId('none'), { meta: { createdAt: 30 } })
    ctx.sessions.create(SessionId('same'), { meta: { cwd: '/same', createdAt: 20 } })
    const sameLater = ctx.sessions.create(SessionId('same-later'), { meta: { cwd: '/same', createdAt: 25 } })
    sameLater.append('session/title', {
      title: 'Latest title',
      messageSeqs: [],
      source: { kind: 'fallback' },
    })

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target))).resolves.toEqual([
      { sessionId: SessionId('same-later'), label: 'Latest title', displayTitle: 'Latest title', cwd: '/same', sameWorkspace: true, createdAt: 25 },
      { sessionId: SessionId('same'), label: 'same', displayTitle: 'same', cwd: '/same', sameWorkspace: true, createdAt: 20 },
      { sessionId: SessionId('none'), label: 'none', displayTitle: 'none', sameWorkspace: false, createdAt: 30 },
      { sessionId: SessionId('other'), label: 'other', displayTitle: 'other', cwd: '/else', sameWorkspace: false, createdAt: 40 },
    ])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'els', 1)).resolves.toEqual([
      { sessionId: SessionId('other'), label: 'other', displayTitle: 'other', cwd: '/else', sameWorkspace: false, createdAt: 40 },
    ])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'LATEST', 1)).resolves.toEqual([
      { sessionId: SessionId('same-later'), label: 'Latest title', displayTitle: 'Latest title', cwd: '/same', sameWorkspace: true, createdAt: 25 },
    ])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), '', 0))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))

    let releaseList: (() => void) | undefined
    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseList = resolve })
      return []
    })
    const controller = new AbortController()
    const pending = ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), '', undefined, controller.signal)
    await vi.waitFor(() => { expect(releaseList).toBeTypeOf('function') })
    const cancelledList = expect(pending).rejects.toThrow(expectCode('SESSION_REFERENCE_CANCELLED'))
    controller.abort('autocomplete superseded')
    await cancelledList
    releaseList?.()
    await Promise.resolve()
    listSessions.mockRestore()
  })

  it('reads an attached session\'s current title, ahead of any checkpoint', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const live = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/same' } })
    live.append('session/title', { title: 'Old title', messageSeqs: [], source: { kind: 'fallback' } })
    // The durable checkpoint is write-behind, so it still holds the old value.
    withProjectionCache(ctx, { live: 'Old title' })
    live.append('session/title', { title: 'Renamed mid turn', messageSeqs: [], source: { kind: 'user' } })
    const readTitles = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots')

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'renamed'))
      .resolves.toEqual([
        { sessionId: live.id, label: 'Renamed mid turn', displayTitle: 'Renamed mid turn', cwd: '/same', sameWorkspace: true, createdAt: live.header.createdAt },
      ])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'old title')).resolves.toEqual([])
    expect(readTitles).not.toHaveBeenCalled()
    readTitles.mockRestore()
  })

  it('labels a cold session from its checkpoint and reads no log', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const cold = { id: SessionId('cold'), createdAt: 10, cwd: '/same' }
    withProjectionCache(ctx, { cold: 'Cold checkpoint' })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header: cold, live: false, persisted: true },
    ] as never)
    const readTitles = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots')

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'checkpoint'))
      .resolves.toEqual([
        { sessionId: cold.id, label: 'Cold checkpoint', displayTitle: 'Cold checkpoint', cwd: '/same', sameWorkspace: true, createdAt: 10 },
      ])
    expect(readTitles).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('keeps the projected title as the mention label and prefers the subagent label for display', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const child = { id: SessionId('child'), createdAt: 10, cwd: '/same' }
    withProjectionCache(ctx, {
      child: {
        title: 'Investigate startup',
        subagent: { mode: 'continuable', label: 'researcher', seq: SessionSeq(2) },
      },
    })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header: child, live: false, persisted: true },
    ] as never)

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'researcher'))
      .resolves.toEqual([{
        sessionId: child.id,
        label: 'Investigate startup',
        displayTitle: 'researcher',
        cwd: '/same',
        sameWorkspace: true,
        createdAt: 10,
      }])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'investigate'))
      .resolves.toHaveLength(1)
    await expect(ctx.sessionReferenceResolver.remoteExportCandidates(
      fakeAgent(target), 'researcher', new AbortController().signal,
    )).resolves.toEqual([expect.objectContaining({
      mention: formatSessionReferenceMention({ sessionId: child.id, label: 'researcher' }),
    })])
  })

  it('falls back to the projected title when a subagent projection has no label', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const child = { id: SessionId('child'), createdAt: 10, cwd: '/same' }
    withProjectionCache(ctx, {
      child: {
        title: 'Projected title',
        subagent: { mode: 'continuable', seq: SessionSeq(2) },
      },
    })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header: child, live: false, persisted: true },
    ] as never)

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'child'))
      .resolves.toEqual([expect.objectContaining({
        sessionId: child.id,
        label: 'Projected title',
        displayTitle: 'Projected title',
      })])
  })

  it('labels a cold seeded session from its cached title and an uncached one by id, without a log read', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const forked = {
      version: 0,
      id: SessionId('forked'),
      createdAt: 10,
      cwd: '/same',
      isSeeded: true,
    }
    const uncached = { ...forked, id: SessionId('uncached'), createdAt: 20 }
    // The cache binds the fork's lifecycle by its header alone; the resolver
    // needs no cut to read it. A session the cache never checkpointed keeps
    // its title in its log only.
    withProjectionCache(ctx, { forked: 'Forked title' })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockResolvedValue([
      { header: forked, live: false, persisted: true },
      { header: uncached, live: false, persisted: true },
    ] as never)
    const readTitles = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots')

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target))).resolves.toEqual([
      { sessionId: forked.id, label: 'Forked title', displayTitle: 'Forked title', cwd: '/same', sameWorkspace: true, createdAt: 10 },
      { sessionId: uncached.id, label: uncached.id, displayTitle: uncached.id, cwd: '/same', sameWorkspace: true, createdAt: 20 },
    ])
    // The cached title finds the fork; the uncached session's own title cannot
    // find it, and discovery still never opens a log.
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'forked title')).resolves.toEqual([
      expect.objectContaining({ sessionId: forked.id }),
    ])
    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'anything')).resolves.toEqual([])
    expect(readTitles).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('labels every session by id when no projection face is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(TestSessionQueryEngine)
    await ctx.plugin(SessionReferenceResolver)
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same' } })
    const other = ctx.sessions.create(SessionId('other'), { meta: { cwd: '/same' } })
    other.append('session/title', { title: 'Unreadable', messageSeqs: [], source: { kind: 'fallback' } })

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target))).resolves.toEqual([
      { sessionId: other.id, label: other.id, displayTitle: other.id, cwd: '/same', sameWorkspace: true, createdAt: other.header.createdAt },
    ])
  })

  it('serves the Remote face with the configured limit and canonical mentions', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same', createdAt: 10 } })
    ctx.sessions.create(SessionId('source]'), { meta: { cwd: '/same', createdAt: 20 } })
    const candidates = await ctx.sessionReferenceResolver.remoteExportCandidates(
      fakeAgent(target),
      '',
      new AbortController().signal,
    )
    expect(candidates).toEqual([{
      sessionId: SessionId('source]'),
      label: 'source]',
      displayTitle: 'source]',
      cwd: '/same',
      sameWorkspace: true,
      createdAt: 20,
      mention: formatSessionReferenceMention({ sessionId: SessionId('source]'), label: 'source]' }),
    }])

    vi.spyOn(ctx.sessionReferenceResolver, 'listCandidates').mockResolvedValueOnce([{
      sessionId: SessionId('fallback'),
      label: 'Fallback title',
      sameWorkspace: false,
      createdAt: 30,
    }])
    await expect(ctx.sessionReferenceResolver.remoteExportCandidates(
      fakeAgent(target), '', new AbortController().signal,
    )).resolves.toEqual([expect.objectContaining({
      mention: formatSessionReferenceMention({ sessionId: SessionId('fallback'), label: 'Fallback title' }),
    })])
  })

  it('prepares direct mentions at pre-step and keeps ordinary and plugin messages unchanged', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.create(SessionId('source'))
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'source fact' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const agent = fakeAgent(target)
    const direct = createUserMessage({
      content: [{
        type: 'text',
        text: `compare ${formatSessionReferenceMention({ sessionId: source.id, label: 'Research' })} now`,
      }, { type: 'reasoning', text: 'preserve this non-text block' }],
      source: { kind: 'user' },
    })
    const ordinary = createUserMessage({
      content: [{ type: 'text', text: 'ordinary prompt' }],
      source: { kind: 'user' },
    })
    const plugin = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: source.id, label: 'Ignored' }) }],
      source: { kind: 'test' },
    })
    const signal = new AbortController().signal

    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { modelSelection: { provider: 'seed', model: 'seed' }, messages: [direct, ordinary, plugin], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct, ordinary, plugin] }),
    )

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected entered pre-step')
    expect(decision.messages).toHaveLength(4)
    expect(decision.messages[0]).toMatchObject({
      id: direct.id,
      content: [
        { type: 'text', text: 'compare @Research now' },
        { type: 'reasoning', text: 'preserve this non-text block' },
      ],
    })
    expect(decision.messages[0]).not.toBe(direct)
    expect(decision.messages[1]?.source).toMatchObject({
      kind: 'session-reference',
      references: [{ sessionId: source.id, label: 'Research' }],
    })
    expect(decision.messages[2]).toBe(ordinary)
    expect(decision.messages[3]).toBe(plugin)
  })

  it('does not prepare a rejected pre-step and rejects malformed direct mentions', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const agent = fakeAgent(target)
    const malformed = createUserMessage({
      content: [{ type: 'text', text: '@[bad](jan-session:not-canonical)' }],
      source: { kind: 'user' },
    })
    const readSurface = vi.spyOn(ctx.sessionQuery, 'readSurface')
    const signal = new AbortController().signal

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { modelSelection: { provider: 'seed', model: 'seed' }, messages: [malformed], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )).resolves.toEqual({ kind: 'reject' })
    expect(readSurface).not.toHaveBeenCalled()

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { modelSelection: { provider: 'seed', model: 'seed' }, messages: [malformed], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [malformed] }),
    )).rejects.toThrow(/invalid session reference URI/)
  })

  it('still matches an unlabeled session on its own metadata', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    // No cwd, no title event: nothing but the id identifies it.
    const source = ctx.sessions.create(SessionId('source'))

    await expect(ctx.sessionReferenceResolver.listCandidates(fakeAgent(target), 'source')).resolves.toEqual([
      { sessionId: source.id, label: source.id, displayTitle: source.id, sameWorkspace: false, createdAt: source.header.createdAt },
    ])
  })

  it('points at mentioned chats by label, id and folder without reading them', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/target' } })
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/source' } })
    const loose = ctx.sessions.create(SessionId('loose'))
    appendConversation(source)
    const readSurface = vi.spyOn(ctx.sessionQuery, 'readSurface')

    const prepared = await ctx.sessionReferenceResolver.prepare(
      fakeAgent(target),
      [{ type: 'text', text: 'use @Research' }],
      [{ sessionId: source.id, label: 'Research "notes"' }, { sessionId: loose.id }, { sessionId: SessionId('gone') }],
    )
    expect(prepared.content).toEqual([{ type: 'text', text: 'use @Research' }])
    const context = prepared.additionalContext
    if (context?.content[0]?.type !== 'text') throw new Error('expected text context')
    expect(context.source).toEqual({
      kind: 'session-reference',
      form: 'recall',
      version: 2,
      references: [
        { sessionId: 'source', label: 'Research "notes"', cwd: '/source', inputIndex: 0 },
        { sessionId: 'loose', label: 'loose', cwd: null, inputIndex: 1 },
        { sessionId: 'gone', label: 'gone', cwd: null, inputIndex: 2 },
      ],
    })
    const text = context.content[0].text
    expect(text).toMatch(/^## Mentioned chats\n/u)
    expect(text).toContain(`call ${READ_CHAT_TOOL} with its session_id`)
    expect(text).toContain('- "Research \\"notes\\"" (session_id: source, project folder: /source)')
    expect(text).toContain('- "loose" (session_id: loose, project folder: none)')
    expect(text).toContain('- "gone" (session_id: gone, project folder: unknown; the chat may have been deleted)')
    expect(text).not.toContain('visible answer')
    expect(readSurface).not.toHaveBeenCalled()
  })

  it('deduplicates before enforcing the cap and rejects self, excess, and cancellation', async () => {
    const ctx = await harness({ maxReferences: 2 })
    const target = ctx.sessions.create(SessionId('target'))
    const one = ctx.sessions.create(SessionId('one'))
    const two = ctx.sessions.create(SessionId('two'))
    const agent = fakeAgent(target)
    const content = [{ type: 'text' as const, text: 'go' }]

    const withoutReferences = await ctx.sessionReferenceResolver.prepare(agent, content, [])
    expect(withoutReferences).toEqual({ content })
    expect(withoutReferences.content).not.toBe(content)

    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [
      { sessionId: one.id, label: 'first' },
      { sessionId: one.id, label: 'ignored duplicate' },
      { sessionId: two.id },
    ])).resolves.toMatchObject({ additionalContext: { source: { references: [{ label: 'first' }, { label: 'two' }] } } })
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: target.id }]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_SELF_REFERENCE'))
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [null as never]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [1 as never]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: 1 } as never]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [
      { sessionId: one.id }, { sessionId: two.id }, { sessionId: SessionId('three') },
    ])).rejects.toThrow(expectCode('SESSION_REFERENCE_TOO_MANY'))

    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions')
    listSessions.mockRejectedValueOnce('non-error listing failure')
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: one.id }], new AbortController().signal))
      .rejects.toThrow(/non-error listing failure/)
    const offline = new Error('index offline')
    listSessions.mockRejectedValueOnce(offline)
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: one.id }], new AbortController().signal))
      .rejects.toBe(offline)

    const duringList = new AbortController()
    listSessions.mockImplementationOnce(async () => {
      duringList.abort('cancelled during listing')
      return []
    })
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: one.id }], duringList.signal))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_CANCELLED'))

    let releaseList: (() => void) | undefined
    listSessions.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseList = resolve })
      return []
    })
    const hanging = new AbortController()
    const pending = ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: one.id }], hanging.signal)
    await vi.waitFor(() => { expect(releaseList).toBeTypeOf('function') })
    const cancelledList = expect(pending).rejects.toThrow(expectCode('SESSION_REFERENCE_CANCELLED'))
    hanging.abort('cancelled while the listing remained pending')
    await cancelledList
    releaseList?.()
    await Promise.resolve()
    listSessions.mockRestore()

    const abort = new AbortController()
    abort.abort('host cancelled')
    await expect(ctx.sessionReferenceResolver.prepare(agent, content, [{ sessionId: one.id }], abort.signal))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_CANCELLED'))
  })

  it('keeps target replay independent of later source mutation and deletion', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.prepare(SessionId('source'))
    const detachSource = ctx.sessions.enter(source)
    ctx.sessions.announce(source)
    appendText(source, 'durable referenced fact')
    const prepared = await ctx.sessionReferenceResolver.prepare(
      fakeAgent(target),
      [{ type: 'text', text: 'use @source' }],
      [{ sessionId: source.id }],
    )
    const context = prepared.additionalContext
    if (context === undefined) throw new Error('expected prepared context')
    target.append('user/message', createUserMessage({ content: prepared.content, source: { kind: 'user' } }), { surfaceOp: 'append' })
    target.append('user/message', context, { surfaceOp: 'append' })
    const before = target.deriveMessages()
    appendText(source, 'later source mutation')
    detachSource()

    expect(ctx.sessions.get(source.id)).toBeUndefined()
    expect(target.deriveMessages()).toEqual(before)
    expect(JSON.stringify(before)).not.toContain('durable referenced fact')
    expect(Session.create(SessionId('replayed-target'), target.snapshotEvents()).deriveMessages()).toEqual(before)
  })

  it('rejects direct invalid configuration before service publication', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(TestSessionQueryEngine)
    expect(() => new SessionReferenceResolver(ctx, { maxReferences: 0 }))
      .toThrow(expectCode('SESSION_REFERENCE_INVALID_CONFIG'))

    const oversizedCtx = new Context()
    await oversizedCtx.plugin(SessionStore)
    await oversizedCtx.plugin(TestSessionQueryEngine)
    expect(() => new SessionReferenceResolver(oversizedCtx, { maxReferences: 4 }))
      .toThrow(expectCode('SESSION_REFERENCE_INVALID_CONFIG'))

    const defaultCtx = new Context()
    await defaultCtx.plugin(SessionStore)
    await defaultCtx.plugin(TestSessionQueryEngine)
    expect(() => new SessionReferenceResolver(defaultCtx)).not.toThrow()
  })
})

describe('read_chat', () => {
  async function toolHarness() {
    const ctx = await harness()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/target' } })
    const agent = fakeAgent(target)
    const read = async (args: Record<string, unknown>, options: { agent?: Agent | undefined; signal?: AbortSignal } = { agent }) => {
      const result = await executeToolFixture(ctx, {
        name: READ_CHAT_TOOL,
        callId: ToolCallId('read'),
        arguments: args,
        signal: options.signal ?? new AbortController().signal,
        ...options.agent === undefined ? {} : { agent: options.agent },
      })
      return result.isError ? { error: result.error.message, code: result.error.info?.code } : { text: result.value as string }
    }
    /** Record a user mention of `source` in the target the way the pre-step does. */
    const mention = async (source: Session, label: string) => {
      const prepared = await ctx.sessionReferenceResolver.prepare(agent, [], [{ sessionId: source.id, label }])
      target.append('user/message', prepared.additionalContext!, { surfaceOp: 'append' })
    }
    return { ctx, target, agent, read, mention }
  }

  it('reads only chats the user mentioned, as their visible user and assistant text', async () => {
    const { ctx, read, mention, target } = await toolHarness()
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/source' } })
    appendConversation(source)
    source.append('developer/message', {
      turn: 3, step: 1,
      message: createDeveloperMessage({ content: [{ type: 'tool-removal', toolName: 'private_tool' }], source: { kind: 'test' } }),
    }, { surfaceOp: 'append' })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'nested pointer must not propagate' }],
      source: { kind: 'session-reference', form: 'recall', version: 2, references: [] },
    }), { surfaceOp: 'append' })

    expect(await read({ session_id: 'source', include_history: true }))
      .toMatchObject({ code: 'SESSION_REFERENCE_NOT_MENTIONED' })
    // A session id the model writes itself grants nothing.
    appendText(target, `read ${source.id}`)
    expect(await read({ session_id: 'source' })).toMatchObject({ code: 'SESSION_REFERENCE_NOT_MENTIONED' })
    expect(await read({ session_id: 'source' }, { agent: undefined })).toMatchObject({ code: 'SESSION_REFERENCE_NOT_MENTIONED' })

    await mention(source, 'Research')
    expect(await read({ session_id: 'source' })).toEqual({
      text: [
        'Chat "Research" (session_id: source, project folder: /source): 4 messages.',
        '',
        '#0 user:\n<compacted-summary>checkpoint</compacted-summary>',
        '',
        '#1 user:\nrecent user',
        '',
        '#2 user:\nhuman steer',
        '',
        '#3 assistant:\nvisible answer',
      ].join('\n'),
    })
  })

  it('recalls checkpointed-away text from its own history and from a mentioned chat', async () => {
    const { ctx, target, read, mention } = await toolHarness()
    const source = ctx.sessions.create(SessionId('source'))
    appendConversation(target)
    appendConversation(source)
    await mention(source, 'Research')

    expect((await read({ session_id: 'source', query: 'old' })).text).toContain('No messages match.')
    for (const args of [{}, { session_id: 'source', include_history: true }]) {
      const { text } = await read({ ...args, query: 'old' })
      expect(text).toContain('(recorded history)')
      expect(text).toContain('#0 user:\nold user')
      expect(text).toContain('#1 assistant:\nold assistant')
      expect(text).not.toContain('<compacted-summary>')
    }
  })

  it('continues a filtered history page in the same mentioned chat', async () => {
    const { ctx, target, read, mention } = await toolHarness()
    const source = ctx.sessions.create(SessionId('archive'))
    appendConversation(source)
    appendText(target, 'old text from a different chat')
    await mention(source, 'Archive')

    const first = (await read({ session_id: 'archive', include_history: true, query: 'old', limit: 1 })).text!
    expect(first).toContain('#1 assistant:\nold assistant')
    const next = first.match(/call read_chat with (\{[^\n]+\})\.$/u)?.[1]
    expect(next).toBeDefined()
    const second = (await read(JSON.parse(next!) as Record<string, unknown>)).text
    expect(second).toContain('Chat "Archive" (recorded history):')
    expect(second).toContain('#0 user:\nold user')
    expect(second).not.toContain('different chat')
  })

  it('shows the match after characters that expand when lowercased', async () => {
    const { target, read } = await toolHarness()
    appendText(target, `${'İ'.repeat(2100)} Needle ${'other text '.repeat(700)}`)

    const { text } = await read({ query: 'needle' })
    expect(text).toContain('1 of 1 messages contain "needle"')
    expect(text).toMatch(/#0 user:\n.* Needle /u)
    expect(text?.length).toBeLessThan(MAX_MESSAGE_CHARS + 150)
  })

  it('pages back from the newest message, narrows by query, and says when nothing matches', async () => {
    const { ctx, read, mention } = await toolHarness()
    const source = ctx.sessions.create(SessionId('source'))
    for (const text of ['alpha one', 'beta two', 'Alpha three', 'gamma four']) appendText(source, text)
    const empty = ctx.sessions.create(SessionId('empty'))
    await mention(source, 'Notes')
    await mention(empty, 'Empty')

    const page = await read({ session_id: 'source', limit: 2 })
    expect(page.text).toBe([
      'Chat "Notes" (session_id: source, project folder: none): 4 messages.',
      '', '#2 user:\nAlpha three', '', '#3 user:\ngamma four',
      '', '2 earlier messages remain: call read_chat with {"session_id":"source","limit":2,"before":2}.',
    ].join('\n'))
    expect((await read({ session_id: 'source', limit: 1, before: 2 })).text)
      .toMatch(/#1 user:\nbeta two\n\n1 earlier message remains: call read_chat with \{"session_id":"source","limit":1,"before":1\}\.$/u)
    expect((await read({ session_id: 'source', query: ' ALPHA ' })).text).toBe([
      'Chat "Notes" (session_id: source, project folder: none): 2 of 4 messages contain "ALPHA".',
      '', '#0 user:\nalpha one', '', '#2 user:\nAlpha three',
    ].join('\n'))
    expect((await read({ session_id: 'source', query: 'delta' })).text)
      .toBe('Chat "Notes" (session_id: source, project folder: none): 0 of 4 messages contain "delta".\n\nNo messages match.')
    expect((await read({ session_id: 'source', before: 0 })).text).toMatch(/4 messages\.\n\nNo messages match\.$/u)
    expect((await read({ session_id: 'empty' })).text).toMatch(/0 messages\.\n\nThis chat has no messages yet\.$/u)
  })

  it('cuts long messages and stops a page at its byte budget', async () => {
    const { ctx, read, mention } = await toolHarness()
    const source = ctx.sessions.create(SessionId('source'))
    appendText(source, '界'.repeat(MAX_MESSAGE_CHARS + 5))
    for (let index = 0; index < 6; index++) appendText(source, `${index}${'界'.repeat(MAX_MESSAGE_CHARS - 1)}`)
    await mention(source, 'Long')
    const page = (await read({ session_id: 'source', limit: MAX_READ_LIMIT })).text!
    expect(Buffer.byteLength(page, 'utf8')).toBeLessThan(MAX_READ_BYTES + 200)
    expect(page).toMatch(/\d earlier messages remain: call read_chat with \{"session_id":"source","limit":50,"before":\d\}\.$/u)
    expect((await read({ session_id: 'source', before: 1 })).text).toContain(`${'界'.repeat(MAX_MESSAGE_CHARS)} [... 5 more characters]`)
  })

  it('rejects bad cursors and limits, and reports a chat it cannot read', async () => {
    const { ctx, read, mention } = await toolHarness()
    const source = ctx.sessions.create(SessionId('source'))
    await mention(source, 'Source')
    expect(await read({ session_id: 'source', limit: 0 })).toMatchObject({ code: 'SESSION_REFERENCE_INVALID_REFERENCE' })
    expect(await read({ session_id: 'source', limit: MAX_READ_LIMIT + 1 })).toMatchObject({ code: 'SESSION_REFERENCE_INVALID_REFERENCE' })
    expect(await read({ session_id: 'source', before: -1 })).toMatchObject({ code: 'SESSION_REFERENCE_INVALID_REFERENCE' })

    const readSurface = vi.spyOn(ctx.sessionQuery, 'readSurface')
    readSurface.mockRejectedValueOnce(new Error('session was not found'))
    expect(await read({ session_id: 'source' })).toEqual({
      error: 'The chat "Source" could not be read: session was not found', code: 'SESSION_REFERENCE_READ_FAILED',
    })
    readSurface.mockRejectedValueOnce('storage offline')
    expect(await read({ session_id: 'source' })).toMatchObject({ error: 'The chat "Source" could not be read: storage offline' })

    const abort = new AbortController()
    readSurface.mockImplementationOnce(async (id) => {
      abort.abort('cancelled during read')
      readSurface.mockRestore()
      return ctx.sessionQuery.readSurface(id)
    })
    expect(await read({ session_id: 'source' }, { agent: fakeAgent(ctx.sessions.get(SessionId('target'))!), signal: abort.signal }))
      .toHaveProperty('error')
  })

  it('presents reads and searches, and leaves with the resolver', async () => {
    const { ctx } = await toolHarness()
    const definition = readChatTool(ctx)
    expect(definition.presentCall?.({ session_id: 's' })).toEqual({ card: 'generic', kind: 'read', title: 'Read a mentioned chat' })
    expect(definition.output.render({ session_id: 's' }, 'page')).toEqual([{ type: 'text', text: 'page' }])
    // Reads never mutate a chat, so parallel calls are safe.
    expect(definition.isConcurrencySafe?.({ session_id: 's' })).toBe(true)
    expect(definition.presentCall?.({ session_id: 's', query: 'plan' }))
      .toEqual({ card: 'generic', kind: 'search', title: 'Search a mentioned chat', rawInput: 'plan' })
    expect(ctx.tools.get(READ_CHAT_TOOL)).toBeDefined()
  })
})
