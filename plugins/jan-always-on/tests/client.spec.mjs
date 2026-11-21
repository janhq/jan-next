import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function loadChunk(file, require) {
  let value
  runInNewContext(source(file), { window: { __ModuleLoader__: { load({ factory }) { value = factory(require) } } } }, { filename: file })
  return value
}

test('ships all bot dialogue and activity keys in eight product languages', () => {
  const copy = loadChunk('client.copy.js')
  assert.deepEqual(Object.keys(copy), ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
  const ui = source('client.bots.js')
  const literals = [...ui.matchAll(/\bt\('([^']+)'\)/g)].map(match => match[1])
  for (const [locale, strings] of Object.entries(copy)) {
    for (const key of [...new Set([...Object.keys(copy.en), ...literals])]) {
      assert.ok(typeof strings[key] === 'string' && strings[key].trim(), `${locale} must translate ${key}`)
    }
    assert.notEqual(strings.create, strings.save)
    assert.notEqual(strings.routines, strings.memory)
  }
})

test('derives a repeatable default avatar from a bot name', () => {
  const modules = { react: {}, '@janhq/jan-client-ui-primitives': {} }
  const { appearanceFor } = loadChunk('client.bots.js', id => modules[id])
  assert.deepEqual(appearanceFor('  NOVA  '), appearanceFor('Nova'))
  assert.notDeepEqual(appearanceFor('Nova'), appearanceFor('Archivist'))
  assert.match(appearanceFor('Nova').color, /^#[0-9a-f]{6}$/)
})
