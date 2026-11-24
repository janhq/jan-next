import { expect, it, onTestFinished, vi } from 'vitest'
import { createTokamakApi } from '../api.mjs'

it('checks request authorization after resolving the token, before sending the body', async () => {
  const token = Promise.withResolvers<string>()
  const ctx = { get: () => ({ resolveToken: () => token.promise }) }
  const api = createTokamakApi(ctx as never, 'https://example.com')
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}))
  onTestFinished(() => { fetch.mockRestore() })
  let allowed = true
  const request = api.request('/systemone', 'classification', { json: { text: 'watched item' }, beforeSend() {
    if (!allowed) throw new Error('Cloud classification is no longer allowed')
  } })
  allowed = false
  token.resolve('test-token')
  await expect(request).rejects.toThrow('Cloud classification is no longer allowed')
  expect(fetch).not.toHaveBeenCalled()
})
