import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { mountProjectHome, repositoryOf } from '../project-home.mjs'

type Reply = { status: number; body: { error?: string; result?: unknown } }
type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }

async function projectHome(events = [], inheritedEventCount = 0) {
  const root = await mkdtemp(join(tmpdir(), 'jan-project-home-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const settings = await mkdtemp(join(tmpdir(), 'jan-project-settings-'))
  onTestFinished(() => rm(settings, { recursive: true, force: true }))
  const workspace = { id: 'project', path: root, sessionIds: events.length === 0 ? [] : ['session'] }
  let prompt
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined
  mountProjectHome({
    get: (key: string) => ({
      workspaceRegistry: { get: (id: string) => id === 'project' ? workspace : undefined, list: () => [workspace] },
      janHomePath: (...segments: string[]) => join(settings, ...segments),
      sessionQuery: { observeSession: async () => ({ events, inheritedEventCount, cursor: events.length - 1, source: 'live', [Symbol.dispose]() {} }) },
    })[key],
    inject: (_, callback) => callback({ systemPrompt: { context: section => { prompt = section.text } } }),
    effect: (register: () => void) => register(),
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler } },
    connection: { requestRejection: () => undefined },
  })
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<Reply> => {
    if (handler === undefined) throw new Error('Project home did not register its route')
    const payload = Buffer.from(JSON.stringify({ method, params: { workspaceId: 'project', ...params } }))
    let reply: Reply | undefined
    let status = 0
    await handler({
      method: 'POST', headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield payload },
    }, {
      writeHead: value => { status = value },
      end: body => { reply = { status, body: JSON.parse(body) } },
    })
    if (reply === undefined) throw new Error('Project home did not return a reply')
    return reply
  }
  return { root, call, context: () => prompt({ agent: { session: { header: { cwd: root }, id: 'session' } } }) }
}

it('adds a project file larger than the generic plugin request limit', async () => {
  const { root, call } = await projectHome()
  const bytes = Buffer.alloc(1024 * 1024, 0xa5)
  const result = await call('addFile', { name: 'report.bin', data: bytes.toString('base64') })
  expect(result).toEqual({ status: 200, body: { result: { added: 'report.bin' } } })
  expect((await readFile(join(root, 'report.bin'))).equals(bytes)).toBe(true)
})

it('enforces the instruction byte limit on the text that will actually be saved', async () => {
  const { root, call } = await projectHome()
  const file = join(root, 'AGENTS.md')
  await writeFile(file, 'previous instructions\n')
  const opened = (await call('readText', { kind: 'instructions' })).body.result as { modified: number }
  const result = await call('save', { kind: 'instructions', text: 'a'.repeat(65_536), modified: opened.modified })
  expect(result.status).toBe(400)
  expect(result.body.error).toMatch(/KB/)
  expect(await readFile(file, 'utf8')).toBe('previous instructions\n')
})

it('refuses to save over instructions changed after the editor opened them', async () => {
  const { root, call } = await projectHome()
  const file = join(root, 'AGENTS.md')
  await writeFile(file, 'first\n', { flush: true })
  const opened = (await call('readText', { kind: 'instructions' })).body.result as { text: string; modified: number }
  expect(opened.text).toBe('first\n')
  await new Promise(resolve => setTimeout(resolve, 20))
  await writeFile(file, 'edited elsewhere\n')
  const result = await call('save', { kind: 'instructions', text: 'stale draft', modified: opened.modified })
  expect(result.status).toBe(400)
  expect(await readFile(file, 'utf8')).toBe('edited elsewhere\n')
})

it.skipIf(process.platform === 'win32')('lists a circular symlink without losing project instructions and memory', async () => {
  const { root, call } = await projectHome()
  await writeFile(join(root, 'AGENTS.md'), 'project instructions\n')
  await symlink('loop', join(root, 'loop'))
  const result = await call('read')
  expect(result.status).toBe(200)
  expect(result.body.result).toMatchObject({
    instructions: 'project instructions\n',
    files: expect.arrayContaining([expect.objectContaining({ name: 'loop' })]),
  })
})

it('reads the branch and a browsable origin of a Git project, and nothing outside one', async () => {
  const { root, call } = await projectHome()
  expect((await call('read')).body.result).toMatchObject({ git: null })
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'feature/x'])
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:janhq/jan.git'])
  expect((await call('read')).body.result).toMatchObject({
    git: { branch: 'feature/x', repository: { host: 'github.com', name: 'janhq/jan', url: 'https://github.com/janhq/jan', github: true } },
  })
})

it('turns common remote forms into a web address and rejects the rest', () => {
  expect(repositoryOf('https://github.com/janhq/jan.git')?.url).toBe('https://github.com/janhq/jan')
  expect(repositoryOf('ssh://git@gitlab.example.com:2222/team/sub/app.git')).toEqual(
    { host: 'gitlab.example.com', name: 'team/sub/app', url: 'https://gitlab.example.com/team/sub/app', github: false })
  expect(repositoryOf('https://user:[PASSWORD_IN_URL]@github.com/janhq/jan')?.url).toBe('https://github.com/janhq/jan')
  expect(repositoryOf('/srv/git/local.git')).toBeNull()
  expect(repositoryOf('../sibling')).toBeNull()
})

it('previews HTML as source, and does not traverse outside the selected directory', async () => {
  const { root, call } = await projectHome()
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs', 'index.html'), '<p>example</p>')
  expect((await call('browse', { parts: ['docs'] })).body.result).toMatchObject({ files: [{ name: 'index.html' }] })
  expect((await call('preview', { parts: ['docs', 'index.html'] })).body.result).toMatchObject({ kind: 'code', lang: 'html', text: '<p>example</p>' })
  expect((await call('preview', { parts: ['..', 'index.html'] })).status).toBe(400)
})

it.skipIf(process.platform === 'win32')('never previews a symlink to an unlinked folder', async () => {
  const { root, call } = await projectHome()
  await symlink(tmpdir(), join(root, 'outside'))
  expect((await call('browse', { parts: ['outside'] })).status).toBe(400)
})

it('persists linked folders and identity; unlinking revokes browsing and removes the agent hint', async () => {
  const { root, call, context } = await projectHome()
  const linked = await mkdtemp(join(tmpdir(), 'jan-linked-folder-'))
  onTestFinished(() => rm(linked, { recursive: true, force: true }))
  await writeFile(join(linked, 'notes.md'), '# Linked')
  expect((await call('linkFolder', { path: linked })).status).toBe(200)
  expect((await call('linkFolder', { path: root })).status).toBe(400)
  expect((await call('saveIdentity', { name: 'Research', color: '#596cbc', icon: { kind: 'emoji', value: '🦊' } })).status).toBe(200)
  const stored = (await call('read')).body.result as { linkedFolders: { id: string; path: string }[] }
  expect(stored).toMatchObject({ identity: { name: 'Research', color: '#596cbc', icon: { kind: 'emoji', value: '🦊' } }, linkedFolders: [{ path: expect.stringContaining('jan-linked-folder-') }] })
  const folderId = stored.linkedFolders[0]!.id
  expect((await call('preview', { folderId, parts: ['notes.md'] })).body.result).toMatchObject({ kind: 'markdown', text: '# Linked' })
  expect(context()).toContain(stored.linkedFolders[0]!.path)
  expect((await call('unlinkFolder', { folderId })).status).toBe(200)
  expect((await call('browse', { folderId, parts: [] })).status).toBe(400)
  expect(context()).toBe('')
})

it('lists configured names and source paths without returning MCP secrets', async () => {
  const { root, call } = await projectHome()
  await mkdir(join(root, '.vscode'))
  await writeFile(join(root, '.vscode', 'mcp.json'), '{ "servers": { "example": { "command": "secret" } }, }')
  await writeFile(join(root, 'package.json'), JSON.stringify({ jan: { profile: { bundles: ['my-plugin'] } } }))
  const { body } = await call('read')
  expect(body.result).toMatchObject({ inventory: {
    mcp: [{ name: 'example', path: join(root, '.vscode', 'mcp.json'), loaded: false }],
    plugins: [{ name: 'my-plugin', path: join(root, 'package.json'), loaded: false }],
  } })
  expect(JSON.stringify(body)).not.toContain('secret')
})

it('counts owned turns only and replaces duplicate usage within an attempt', async () => {
  const event = (type, time, turn, fields = {}) => ({ type, time, data: { turn, ...fields } })
  const usage = (inputTokens, outputTokens, cacheReadTokens = 0) => ({ step: 0, usage: { inputTokens, outputTokens, cacheReadTokens } })
  // Attempts keep usage only in their durable stream, as the Session writer records it.
  const attempt = (inputTokens, outputTokens) => ({ step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens, outputTokens } } }] })
  const { call } = await projectHome([
    event('turn/start', 0, 0), event('assistant/message', 90, 0, usage(200, 100)), event('turn/end', 100, 0),
    event('turn/start', 1000, 1), event('assistant/attempt', 1050, 1, attempt(8, 1)),
    event('llm/retry-started', 1060, 1, { step: 0 }), event('assistant/attempt', 1110, 1, attempt(9, 1)),
    event('assistant/message', 1190, 1, usage(10, 2, 3)), event('turn/end', 1200, 1),
    event('turn/start', 2000, 2),
  ], 3)
  expect((await call('usage')).body.result).toMatchObject({ inputTokens: 21, outputTokens: 3, workingMs: 200, cost: null })
})
