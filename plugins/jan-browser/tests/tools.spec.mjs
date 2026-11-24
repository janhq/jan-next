import assert from 'node:assert/strict'
import { it } from 'node:test'
import { browserTools } from '../tools.mjs'

it('searches in a new Chrome tab rather than using Jan’s separate web search', async () => {
  const [method, params] = await new Promise(resolve => {
    const tools = browserTools(async (...input) => { resolve(input); return { content: [] } })
    void tools.find(tool => tool.name === 'browser_search').call({ query: 'dogs & cats' }, {})
  })
  assert.equal(method, 'browser_navigate')
  assert.deepEqual(params, { target: 'https://www.google.com/search?q=dogs+%26+cats', forceNewTabOpen: true })
})

it('extracts full accessibility text or returns only the unannotated screenshot', async () => {
  const plain = { type: 'image', mimeType: 'image/png', data: 'plain' }
  const overlay = { ...plain, data: 'overlay' }
  const text = { type: 'text', text: 'Heading "Example Domain"' }
  const calls = []
  const tools = browserTools(async (method, args) => {
    calls.push([method, args])
    return { content: [text, plain, overlay] }
  })
  assert.deepEqual(await tools.find(t => t.name === 'browser_extract').call({ fullPage: true }, {}), { content: [text] })
  assert.deepEqual(await tools.find(t => t.name === 'browser_screenshot').call({}, {}), { content: [plain] })
  assert.deepEqual(calls, [
    ['browser_snapshot', { fullPage: true, detail: 'all' }],
    ['browser_snapshot', { fullPage: false }],
  ])
})
