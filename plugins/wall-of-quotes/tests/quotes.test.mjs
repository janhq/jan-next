import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

let chunk
runInNewContext(readFileSync(new URL('../client.quotes.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { chunk = value } } },
})
assert.equal(chunk.id, '@janhq/jan-wall-of-quotes')
assert.equal(chunk.chunk, 'client.quotes.js')
const { builtInQuotes, pickQuote } = chunk.factory()
const own = [{ text: 'A custom line', author: '' }]
const stock = [{ text: 'A built-in line', author: 'Someone' }]

test('selects only enabled nonempty lists', () => {
  assert.equal(pickQuote({ builtIn: true, custom: false, quotes: own }, stock, () => 0).text, stock[0].text)
  assert.equal(pickQuote({ builtIn: false, custom: true, quotes: own }, stock, () => 0).text, own[0].text)
  assert.equal(pickQuote({ builtIn: true, custom: true, quotes: own }, stock, () => 0).text, stock[0].text)
  assert.equal(pickQuote({ builtIn: true, custom: true, quotes: own }, stock, () => 0.99).text, own[0].text)
})

test('returns no quote if both lists are off or the enabled lists are empty', () => {
  assert.equal(pickQuote({ builtIn: false, custom: false, quotes: own }, stock), null)
  assert.equal(pickQuote({ builtIn: false, custom: true, quotes: [] }, stock), null)
  assert.equal(pickQuote({ builtIn: true, custom: false, quotes: own }, []), null)
  assert.equal(pickQuote({ builtIn: true, custom: true, quotes: [] }, []), null)
})

test('does not repeat the previous quote when another enabled quote is available', () => {
  const previous = stock[0]
  const preferences = { builtIn: true, custom: true, quotes: [{ ...previous }, ...own] }
  assert.equal(pickQuote(preferences, stock, () => 0, previous), own[0])
  assert.equal(pickQuote(preferences, stock, () => 0.5, previous), own[0])
})

test('allows a repeat when all enabled entries are the same quote', () => {
  const previous = stock[0]
  assert.equal(pickQuote({ builtIn: true, custom: false, quotes: own }, stock, () => 0, previous), previous)
  const same = [{ ...previous }]
  assert.equal(pickQuote({ builtIn: true, custom: true, quotes: same }, stock, () => 0, previous), previous)
})

test('built-in quotes have short text, nonempty author and no duplicates', () => {
  assert.ok(builtInQuotes.length >= 75 && builtInQuotes.length <= 90)
  const seen = new Set()
  for (const quote of builtInQuotes) {
    assert.ok(typeof quote.text === 'string' && quote.text.trim() && quote.text.length < 140)
    assert.ok(typeof quote.author === 'string' && quote.author.trim())
    assert.ok(!seen.has(quote.text))
    seen.add(quote.text)
  }
})

test('registers the hero and the built-in settings without loading the quote list', () => {
  let entry
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { entry = value } } },
    document: {
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { append() {} },
    },
  })
  assert.equal(entry.id, chunk.id)
  const require = () => ({})
  require.async = () => assert.fail('The quote list should load only when a view needs it')
  const plugin = entry.factory(require)
  assert.equal(plugin.name, 'jan-wall-of-quotes')
  const names = []
  const form = {}
  const dispose = () => {}
  plugin.apply({
    configForms: {
      get: id => { assert.equal(id, plugin.name); return form },
      whileServed: ([id], register) => { assert.equal(id, plugin.name); return register() },
    },
    locale: { bind: () => key => key, register: () => dispose },
    slots: {
      inject: (_name, register) => register(),
      register: entry => {
        names.push(entry.name)
        assert.equal(entry.inject().hooks.quoteSettings, form)
        if (entry.name === 'conversation.hero.headline') assert.ok(entry.priority < -1)
        return dispose
      },
    },
    logger: () => ({}),
    effect: effect => effect(),
  })
  assert.deepEqual(names, ['conversation.hero.headline', 'plugins.item', 'plugins.detail.actions'])
})
