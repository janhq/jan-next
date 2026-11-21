import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { mountProjectHome } from '../project-home.mjs'

type Reply = { status: number; body: { error?: string; result?: unknown } }
type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }

async function projectHome() {
  const root = await mkdtemp(join(tmpdir(), 'jan-project-home-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined
  mountProjectHome({
    get: () => ({ get: (id: string) => id === 'project' ? { path: root } : undefined }),
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
  return { root, call }
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
  const result = await call('save', { kind: 'instructions', text: 'a'.repeat(65_536) })
  expect(result.status).toBe(400)
  expect(await readFile(file, 'utf8')).toBe('previous instructions\n')
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
