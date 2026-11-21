import { expect, it } from 'vitest'
import { registerApi } from '../index.mjs'

type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }

async function request(options?: { maxBodyBytes: number }) {
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined
  registerApi({
    connection: { requestRejection: () => undefined },
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler } },
  }, 'sample', { upload: () => 'accepted' }, options)
  if (handler === undefined) throw new Error('Plugin did not register its route')
  const payload = Buffer.from(JSON.stringify({ method: 'upload', params: { data: 'x'.repeat(1024 * 1024) } }))
  let status = 0
  await handler({
    method: 'POST', headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield payload },
  }, { writeHead: value => { status = value }, end: () => {} })
  return status
}

it('raises the body limit only for the route that opts in', async () => {
  expect(await request()).toBe(413)
  expect(await request({ maxBodyBytes: 2 * 1024 * 1024 })).toBe(200)
  expect(await request({ maxBodyBytes: 512 * 1024 })).toBe(413)
})
