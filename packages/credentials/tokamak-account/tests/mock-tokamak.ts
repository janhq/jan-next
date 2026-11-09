/**
 * Minimal in-process Tokamak mock: CLI sessions, token polling, `/v1/models`, key revocation and
 * an OpenAI-compatible streaming `/v1/chat/completions`. Used by tests and `pnpm tsx …/mock-tokamak.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

export interface MockSession {
  challenge: string
  clientName: string
  userCode: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  polls: number
  minted?: { key: string; id: string }
}

export interface MockTokamak {
  readonly origin: string
  readonly sessions: Map<string, MockSession>
  readonly revoked: string[]
  readonly chatAuth: string[]
  /** Next poll statuses to serve as raw HTTP codes (e.g. 429) before the real answer. */
  readonly pollFailures: number[]
  approve(sessionId?: string): void
  deny(sessionId?: string): void
  /** Toggle 404 on session creation to simulate a deployment without device sign-in. */
  unsupported: boolean
  /** Approve automatically on the first poll (manual dev runs). */
  autoApprove: boolean
  /** Approve when a session reaches this many polls. */
  approveOnPoll: number | undefined
  /** Number of upcoming polls to leave hanging without a response. */
  hangPolls: number
  /** Make `GET /v1/models` fail with this HTTP status. */
  failModels: number | false
  /** Approve any poll arriving at or after this time (ms since epoch). */
  approveAfter: number | undefined
  /** Poll interval (seconds) advertised to clients. */
  interval: number
  /** Revoke a key server-side, as deleting it on tokamak.sh would. */
  revokeKey(key: string): void
  key: string
  close(): Promise<void>
}

export async function startMockTokamak(port = 0): Promise<MockTokamak> {
  const sessions = new Map<string, MockSession>()
  const keys = new Set<string>()
  let minted = 0
  const mock: MockTokamak = {
    origin: '', sessions, revoked: [], chatAuth: [], pollFailures: [], unsupported: false, autoApprove: false, approveOnPoll: undefined, hangPolls: 0, failModels: false, approveAfter: undefined, interval: 1,
    revokeKey(key) { keys.delete(key) },
    /** Most recently minted key; each approval mints a new one. */
    key: '',
    approve(id) { lastSession(id).status = 'approved' },
    deny(id) { lastSession(id).status = 'denied' },
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }),
  }
  const lastSession = (id?: string): MockSession => {
    const session = id === undefined ? [...sessions.values()].at(-1) : sessions.get(id)
    if (session === undefined) throw new Error('mock-tokamak: no session')
    return session
  }
  /** Writes a JSON reply; returns true so handlers can `return json(...)`. */
  const json = (res: ServerResponse, status: number, body: unknown): true => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    return true
  }
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) as Record<string, unknown> : {}
  }
  const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://mock')
      if (req.method === 'POST' && url.pathname === '/auth/cli/sessions') {
        if (mock.unsupported) return json(res, 404, { error: 'not found' })
        const body = await readBody(req)
        const id = `sess_${randomBytes(6).toString('hex')}`
        const code = `${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`
        sessions.set(id, { challenge: String(body.code_challenge), clientName: String(body.client_name), userCode: code, status: 'pending', polls: 0 })
        return json(res, 201, { session_id: id, user_code: code, expires_in: 600, interval: mock.interval })
      }
      if (req.method === 'POST' && url.pathname === '/auth/cli/sessions/token') {
        if (mock.hangPolls > 0) { mock.hangPolls--; return }
        const failure = mock.pollFailures.shift()
        if (failure !== undefined) return json(res, failure, { error: 'injected' })
        const body = await readBody(req)
        const session = sessions.get(String(body.session_id))
        if (session === undefined) return json(res, 404, { error: 'unknown session' })
        const verifier = String(body.code_verifier)
        if (createHash('sha256').update(verifier).digest('base64url') !== session.challenge) {
          return json(res, 400, { error: 'verifier mismatch' })
        }
        session.polls++
        if (mock.autoApprove || (mock.approveOnPoll !== undefined && session.polls >= mock.approveOnPoll)
          || (mock.approveAfter !== undefined && Date.now() >= mock.approveAfter)) session.status = 'approved'
        if (session.status !== 'approved') return json(res, 200, { status: session.status, interval: mock.interval })
        // Mint once per session; repeated polls of an approved session return the same key.
        if (session.minted === undefined) {
          minted++
          session.minted = { key: `sk_live_mock_${minted}_${randomBytes(6).toString('hex')}`, id: `key_mock_${minted}` }
          keys.add(session.minted.key)
          mock.key = session.minted.key
        }
        return json(res, 200, {
          status: 'approved',
          api_key: { key: session.minted.key, id: session.minted.id, expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString() },
          user: { email: 'dev@example.invalid' },
        })
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/auth/api-keys/')) {
        const token = bearer(req)
        if (token === undefined || !keys.has(token)) return json(res, 401, { error: 'user context missing' })
        keys.delete(token)
        // (the real route revokes the key named in the path; the mock keys are 1:1 with ids)
        mock.revoked.push(decodeURIComponent(url.pathname.slice('/auth/api-keys/'.length)))
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        if (mock.failModels !== false) return json(res, mock.failModels, { error: 'injected' })
        const token = bearer(req)
        if (token === undefined || !keys.has(token)) return json(res, 401, { error: 'invalid key' })
        return json(res, 200, { object: 'list', data: [{ id: 'tokamak-1-preview', object: 'model' }, { id: 'anthropic/claude-opus-5', object: 'model' }] })
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const token = bearer(req)
        mock.chatAuth.push(token ?? '')
        if (token === undefined || !keys.has(token)) return json(res, 401, { error: { message: 'invalid key' } })
        const body = await readBody(req)
        const model = String(body.model)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
          `data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        res.write(chunk({ role: 'assistant', content: 'Hello from ' }))
        res.write(chunk({ content: 'mock Tokamak.' }))
        res.write(chunk({}, 'stop'))
        res.end('data: [DONE]\n\n')
        return
      }
      json(res, 404, { error: 'auth route not found' })
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end() })
  })
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock-tokamak: no address')
  ;(mock as { origin: string }).origin = `http://127.0.0.1:${address.port}`
  return mock
}

// Manual dev server: `pnpm tsx packages/credentials/tokamak-account/tests/mock-tokamak.ts [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockTokamak(Number(process.argv[2] ?? 8787))
  mock.autoApprove = true
  console.log(`mock Tokamak on ${mock.origin} (auto-approves sign-ins)`)
}
