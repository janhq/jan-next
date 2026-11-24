import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCronInput } from '@janhq/jan-schedule'
import { TEMPLATES } from '../templates.mjs'

const LOCALES = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

test('every template fits the bot registry, the agent writer and Scheduled', () => {
  assert.equal(new Set(TEMPLATES.map(row => row.id)).size, TEMPLATES.length)
  for (const template of TEMPLATES) {
    assert.match(template.id, /^[a-z][a-z0-9-]{0,63}$/u)
    assert.ok(Number.isInteger(template.avatar.shape) && template.avatar.shape >= 0 && template.avatar.shape <= 3, template.id)
    assert.match(template.avatar.color, /^#[0-9a-f]{6}$/iu)
    assert.ok(template.description.length > 0 && template.description.length <= 500, template.id)
    // The agent file also carries front matter; leave room under the 64 KiB read limit.
    assert.ok(Buffer.byteLength(template.instructions) < 32 * 1024, template.id)
    assert.doesNotMatch(template.instructions + template.description, /[\u2013\u2014\u2192]/u, `${template.id} uses plain dashes and arrows`)
    for (const source of template.sources) {
      assert.ok(['github', 'slack', 'discord'].includes(source.kind), template.id)
      assert.ok(Number.isInteger(source.everyMinutes) && source.everyMinutes >= 5 && source.everyMinutes <= 1440, template.id)
    }
    for (const routine of template.routines) {
      assert.equal(parseCronInput({ expression: routine.cron, time_zone: 'UTC' }).expression, routine.cron, `${template.id}/${routine.key}`)
      assert.ok(routine.prompt.length <= 4000)
      for (const locale of LOCALES) assert.ok(routine.titles[locale]?.trim() && routine.titles[locale].length <= 120, `${locale} ${routine.key}`)
    }
    for (const locale of LOCALES) {
      const copy = template.copy[locale]
      assert.ok(copy?.name.trim() && copy.name.length <= 80, `${locale} ${template.id} name`)
      assert.ok(copy.role.trim() && copy.role.length <= 100, `${locale} ${template.id} role`)
      assert.ok(copy.summary.trim(), `${locale} ${template.id} summary`)
    }
  }
})
