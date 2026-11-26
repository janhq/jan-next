import { expect, it } from 'vitest'
import { registerApi } from '../index.mjs'

type Request = AsyncIterable<Buffer> & { method: 'POST'; headers: { 'content-type': string } }
type Response = { writeHead(status: number): void; end(body: string): void }

async function answer(thrown: unknown) {
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined
  registerApi({
    connection: { requestRejection: () => undefined },
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler } },
  }, 'sample', { fail: () => { throw thrown } })
  if (handler === undefined) throw new Error('Plugin did not register its route')
  const payload = Buffer.from(JSON.stringify({ method: 'fail', params: {} }))
  let status = 0
  let body = ''
  await handler({
    method: 'POST', headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield payload },
  }, { writeHead: value => { status = value }, end: value => { body = value } })
  return { status, body: JSON.parse(body) as unknown }
}

it('answers an operation error with its own 4xx or 5xx status, and 400 otherwise', async () => {
  expect(await answer(Object.assign(new Error('Saving failed.'), { status: 503 }))).toEqual({ status: 503, body: { error: 'Saving failed.' } })
  expect(await answer(Object.assign(new Error('Unknown task.'), { status: 404 }))).toEqual({ status: 404, body: { error: 'Unknown task.' } })
  expect((await answer(new Error('Invalid request.'))).status).toBe(400)
  expect((await answer(Object.assign(new Error('Odd'), { status: 200 }))).status).toBe(400)
})
