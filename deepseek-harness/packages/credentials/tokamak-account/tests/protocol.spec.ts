import { expect, it } from 'vitest'
import { loginOrigin } from '../src/index.ts'
import { apiRoot, buildAuthorizeUrl, clampInterval, modelIds, normalizeBaseUrl, pollStatusIsTransient, webRoot } from '../src/protocol.ts'

it('normalizes base URLs, adding /v1 to bare hosts', () => {
  expect(normalizeBaseUrl('https://api.tokamak.sh', false)).toBe('https://api.tokamak.sh/v1')
  expect(normalizeBaseUrl('https://api.tokamak.sh/v1/', false)).toBe('https://api.tokamak.sh/v1')
  expect(normalizeBaseUrl('http://127.0.0.1:8787', true)).toBe('http://127.0.0.1:8787/v1')
  expect(() => normalizeBaseUrl('http://api.tokamak.sh', true)).toThrow()
  expect(() => normalizeBaseUrl('http://127.0.0.1:8787', false)).toThrow()
})

it('derives api and web roots like the Jan CLI', () => {
  expect(apiRoot('https://api.tokamak.sh/v1')).toBe('https://api.tokamak.sh')
  expect(webRoot('https://api.tokamak.sh/v1')).toBe('https://tokamak.sh')
  expect(webRoot('https://api-stag.tokamak.sh/v1')).toBe('https://stag.tokamak.sh')
  expect(webRoot('http://127.0.0.1:8787/v1')).toBe('http://127.0.0.1:8787')
  expect(webRoot('https://api.tokamak.sh/v1', 'https://web.example.test/')).toBe('https://web.example.test')
})

it('builds the approval URL with an optional wake redirect', () => {
  expect(buildAuthorizeUrl('https://tokamak.sh', 'ABCD-2345'))
    .toBe('https://tokamak.sh/cli/authorize?code=ABCD-2345')
  expect(buildAuthorizeUrl('https://tokamak.sh', 'ABCD-2345', { redirect: 'http://127.0.0.1:3080/done', state: 's' }))
    .toBe('https://tokamak.sh/cli/authorize?code=ABCD-2345&redirect=http%3A%2F%2F127.0.0.1%3A3080%2Fdone&state=s')
})

it('clamps the poll interval and classifies transient statuses', () => {
  expect(clampInterval(undefined)).toBe(5)
  expect(clampInterval(0)).toBe(5)
  expect(clampInterval(0.2)).toBe(1)
  expect(clampInterval(90)).toBe(30)
  for (const status of [408, 425, 429, 500, 503]) expect(pollStatusIsTransient(status)).toBe(true)
  for (const status of [400, 401, 403, 404]) expect(pollStatusIsTransient(status)).toBe(false)
})

it('accepts the model listing shapes Jan accepts', () => {
  expect(modelIds({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
  expect(modelIds([{ id: 'a' }])).toEqual(['a'])
  expect(modelIds(['a', 'b'])).toEqual(['a', 'b'])
  expect(modelIds({})).toEqual([])
})

it('wakes on the loopback host like Jan and ignores non-loopback UI origins', () => {
  expect(loginOrigin('http://localhost:3080')).toBe('http://127.0.0.1:3080')
  expect(loginOrigin('http://127.0.0.1:3080/')).toBe('http://127.0.0.1:3080')
  expect(loginOrigin('http://[::1]:3080')).toBe('http://[::1]:3080')
  expect(loginOrigin('http://192.168.1.5:3080')).toBeUndefined()
  expect(loginOrigin('https://harness.example.test')).toBeUndefined()
})
