import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { mountAgentSettings } from '../agent-settings.mjs'

type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }

it('lists and opens account skills without selecting the host launch directory as a project', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jan-account-skill-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const accountSkill = join(temp, 'SKILL.md')
  await writeFile(accountSkill, 'account skill instructions')
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined
  const configured = { name: 'report', path: accountSkill }
  const project = { name: 'report', path: join(temp, 'project', 'SKILL.md') }
  await mountAgentSettings({
    fiber: { entry: {} },
    get: (name: string) => name === 'configEditor' || name === 'credentials' ? {} : undefined,
    provide: () => {},
    effect: (register: () => void) => register(),
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler } },
    connection: { requestRejection: () => undefined },
    skills: {
      snapshot: ({ cwd }: { cwd?: string } = {}) => ({ skills: [cwd === undefined ? configured : project] }),
      get: (name: string, { cwd }: { cwd?: string } = {}) => name === 'report' ? (cwd === undefined ? configured : project) : undefined,
    },
  }, {})
  async function request(method: string, params = {}) {
    if (handler === undefined) throw new Error('Agent settings did not register its route')
    let status = 0
    let body = ''
    await handler({
      method: 'POST', headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method, params })) },
    }, { writeHead: value => { status = value }, end: value => { body = value } })
    return { status, body: JSON.parse(body) }
  }
  expect(await request('list')).toMatchObject({ status: 200, body: { result: { skills: { skills: [configured] } } } })
  expect(await request('readSkill', { name: 'report' })).toMatchObject({
    status: 200, body: { result: { text: 'account skill instructions' } },
  })
})
