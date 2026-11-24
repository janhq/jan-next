import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyAiExport, parseAiExport, planAiExport } from '../ai-export.mjs'
import { installExportSkills } from '../skills.mjs'

const documentOf = (...bots) => JSON.stringify({ format: 'grok-bot-export', version: 1, bots })
const routine = { name: 'Digest', instruction: 'Summarize updates', trigger: 'schedule', schedule_cron: '0 9 * * *' }

test('merges complete split documents without dropping distinct routines with the same name', () => {
  const first = documentOf({ name: ' Atlas ', title: 'Old title', instructions: 'Keep {notes} and "quotes".', routines: [routine], memories: ['Remember me'] })
  const second = documentOf({ name: 'atlas', title: 'Researcher', instructions: 'Check sources.', routines: [{ ...routine, paused: true }, routine],
    memories: [' Remember me '], skills: [{ name: 'Review', instructions: 'Read the source.' }, { name: 'Review', instruction: 'Read the source.' }] })
  const [bot] = parseAiExport([`\ufeffExport below:\n\`\`\`json\n${first}\n\`\`\`\nNext file follows.`, `Here it is. ${second} Finished.`])
  assert.equal(bot.name, 'Atlas')
  assert.equal(bot.title, 'Researcher')
  assert.deepEqual(bot.instructions, ['Keep {notes} and "quotes".', 'Check sources.'])
  assert.deepEqual(bot.memories, ['Remember me'])
  assert.equal(bot.routines.length, 2)
  assert.equal(bot.skills.length, 1)
  assert.equal(bot.skills[0].instruction, 'Read the source.')
})

test('ignores numbered Markdown citations around complete exports', () => {
  const exported = documentOf({ name: 'Atlas' })
  const [bot] = parseAiExport([`See [1] for the export:\n\n\`\`\`json\n${exported}\n\`\`\`\n\nRead more [2](https://example.com/help).`])
  assert.equal(bot.name, 'Atlas')
})

test('refuses a truncated or unsupported split and credential material without exposing it', () => {
  const good = documentOf({ name: 'Atlas' })
  assert.throws(() => parseAiExport([good, good.slice(0, -1)]), /invalid-export/)
  assert.throws(() => parseAiExport([good, good.replace('"version":1', '"version":2')]), /unsupported-export/)
  assert.throws(() => parseAiExport([documentOf({ name: 'Atlas', instructions: 'api_key=private-value' })]), /^Error: export-credentials$/)
  assert.throws(() => parseAiExport([documentOf({ name: 'Atlas', authorization: 'private-value' })]), /^Error: export-credentials$/)
  assert.throws(() => parseAiExport([documentOf({ name: 'Atlas', instructions: '\n'.repeat(600_000) })]), /export-too-large/)
})

test('plans unsupported triggers and unsafe endpoints separately and adds approved endpoints disabled', async () => {
  const plan = planAiExport(parseAiExport([documentOf({ name: 'Atlas', routines: [routine, { ...routine, name: 'Alerts', trigger: 'slack' },
    { ...routine, name: 'Code', trigger: 'github' }, { ...routine, name: 'No timing', schedule_cron: 'soon' }], apps: [
    { name: 'Public Tools', mcp_url: 'https://tools.example.com/mcp' }, { name: 'No server' },
    { name: 'Old server', mcp_url: 'http://tools.example.com/mcp' },
    { name: 'Signed', mcp_url: 'https://tools.example.com/mcp?token=private-value' },
    { name: 'Userinfo', mcp_url: 'https://secret@tools.example.com/mcp' },
    { name: 'Template', mcp_url: 'https://tools.example.com/${secret}' },
  ] })]), { timeZone: 'UTC', bot: { validateRoutine: row => row.schedule_cron === 'soon' ? { reason: 'invalid-cron' } : { expression: row.schedule_cron, timeZone: 'UTC' } }, mcp: {} })
  assert.equal(plan.bots[0].routines.length, 1)
  assert.deepEqual(plan.skipped.map(row => row.reason), ['slack-trigger', 'github-trigger', 'invalid-cron', 'no-mcp-url', 'unsupported-mcp-url', 'unsafe-mcp-url', 'unsafe-mcp-url', 'unsafe-mcp-url'])
  assert.doesNotMatch(JSON.stringify(plan), /private-value|secret@|\$\{secret\}/)
  const outcome = await applyAiExport(plan, { botIds: [plan.bots[0].id], appIds: [plan.apps[0].id] }, {
    bot: { importBot: async () => ({ botId: 'stored', sessionId: 'session-stored', routines: [] }) },
    mcp: { importMissing: async record => {
      assert.deepEqual(record, { 'public-tools': { transport: 'streamable-http', url: 'https://tools.example.com/mcp', enabled: false } })
      return { added: ['public-tools'] }
    } },
  })
  assert.equal(outcome.bots[0].sessionId, 'session-stored')
  assert.equal(outcome.apps[0].status, 'imported')
  assert.doesNotMatch(JSON.stringify(outcome), /https:/)
})

test('installs user-only skills exclusively and refuses a linked skills directory outside Jan home', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jan-ai-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const janHome = join(root, 'jan'), outside = join(root, 'outside')
  await mkdir(janHome); await mkdir(outside)
  const entry = { name: 'Read reports', description: 'Read "weekly" reports', instruction: 'Read the report.' }
  let refreshed = 0
  const skills = { refresh() { refreshed++ } }
  assert.equal((await installExportSkills([entry], { janHome, skills }))[0].status, 'imported')
  assert.match(await readFile(join(janHome, 'skills', 'read-reports', 'SKILL.md'), 'utf8'), /disable-model-invocation: true\n---\n\nRead the report\./)
  assert.equal((await installExportSkills([{ ...entry, instruction: 'Different' }], { janHome, skills }))[0].status, 'already-here')
  assert.equal(refreshed, 1)
  await rm(join(janHome, 'skills'), { recursive: true })
  await symlink(outside, join(janHome, 'skills'), 'junction')
  assert.equal((await installExportSkills([entry], { janHome, skills }))[0].reason, 'skills-outside-home')
})

test('ships matching translated export labels and prompts in eight locales', () => {
  let dictionaries
  runInNewContext(readFileSync(new URL('../client.locale.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { ({ dictionaries } = factory()) } } },
  })
  assert.deepEqual(Object.keys(dictionaries), ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
  for (const [locale, copy] of Object.entries(dictionaries)) {
    for (const key of Object.keys(dictionaries.en)) assert.ok(typeof copy[key] === 'string' && copy[key].length > 0, `${locale}: ${key}`)
    assert.match(copy.exportPrompt, /grok-bot-export[\s\S]+schedule_cron/)
  }
})
