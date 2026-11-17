import { test } from 'node:test'
import assert from 'node:assert/strict'
import { janProviders, providerProfile, keyRef, janMcpServers, assistantPresetId, janAssistants, derivePreset } from '../settings.mjs'

const providerState = providers => ({ 'model-provider': JSON.stringify({ state: { providers } }) })

test('brings keyed built-ins and every custom provider, never local engines or OAuth logins', () => {
  const rows = janProviders(providerState([
    { provider: 'llamacpp', base_url: '', models: [{ id: 'qwen' }] },
    { provider: 'openai', base_url: 'https://api.openai.com/v1', models: [{ id: 'gpt-4o' }] },
    { provider: 'groq', base_url: 'https://api.groq.com/openai/v1', models: [{ id: 'llama' }] },
    { provider: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [] },
    { provider: 'My LM Studio', base_url: 'http://127.0.0.1:1234/v1', models: [{ id: 'qwen3', name: 'Qwen 3' }] },
  ]), ['groq', 'gemini', 'auth:auth:openai'])
  assert.deepEqual(rows.map(row => [row.id, row.route, row.hasKey, row.catalog]), [
    ['groq', 'groq', true, true],
    ['gemini', 'google', true, true],
    ['My LM Studio', 'my-lm-studio', false, false],
  ])
  assert.deepEqual(rows[2].models, [{ id: 'qwen3', name: 'Qwen 3' }])
})

test('a custom provider without a usable endpoint is left behind', () => {
  assert.deepEqual(janProviders(providerState([{ provider: 'broken', base_url: 'not a url', models: [] }]), []), [])
})

test('catalog routes only name the key; custom routes declare endpoint and models', () => {
  assert.equal(keyRef('my-lm-studio'), 'MY_LM_STUDIO_API_KEY')
  assert.deepEqual(providerProfile({ route: 'groq', catalog: true, models: [] }, 'GROQ_API_KEY'), { apiKeyEnv: 'GROQ_API_KEY' })
  assert.deepEqual(providerProfile({ id: 'My LM Studio', route: 'my-lm-studio', catalog: false, baseURL: 'http://127.0.0.1:1234/v1', models: [{ id: 'qwen3', name: 'Qwen 3' }] }, undefined), {
    displayName: 'My LM Studio', api: 'openai-completions', baseURL: 'http://127.0.0.1:1234/v1', models: [{ id: 'qwen3', name: 'Qwen 3' }],
  })
})

test('MCP servers arrive under valid unique names with Jan-only fields dropped', () => {
  const { servers, skipped } = janMcpServers({ mcpServers: {
    'Jan Browser MCP': { command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'abc' }, active: true, description: 'Browser' },
    'figma:figma': { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer t' }, active: false },
    'figma-figma': { command: 'uvx', args: [] },
    legacy: { type: 'sse', url: 'https://old.example/sse' },
    templated: { command: 'npx', env: { KEY: '${KEY}' } },
  } })
  assert.deepEqual(Object.keys(servers), ['Jan-Browser-MCP', 'figma-figma', 'figma-figma-2'])
  assert.deepEqual(servers['Jan-Browser-MCP'], { command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'abc' } })
  assert.deepEqual(servers['figma-figma'], { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer t' } })
  assert.deepEqual(skipped.map(row => row.sourceName), ['legacy', 'templated'])
})

test('assistants become presets keyed by a stable id', () => {
  assert.equal(assistantPresetId('7k88j8'), 'jan-assistant-7k88j8')
  assert.equal(assistantPresetId('bad id!'), assistantPresetId('bad id!'))
  assert.match(assistantPresetId('bad id!'), /^jan-assistant-[0-9a-f]{16}$/)
  const rows = janAssistants([{ id: 'jan', name: 'Jan', description: 'Helper', instructions: 'Answer briefly.', parameters: { top_p: 0.6 } }])
  assert.deepEqual(rows, [{ id: 'jan-assistant-jan', source: 'jan', name: 'Jan', description: 'Helper', instructions: 'Answer briefly.' }])
})

// Jan's default assistant prompt as Jan ships it (web-app/src/hooks/useAssistant.ts).
const JAN_PROMPT = `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`

test("Jan's default prompt loses only the bullet Claude refuses; an edited prompt arrives as written", () => {
  const refused = '   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.'
  const reworded = '   - Before calling a tool, briefly say what you are about to do and why.'
  const identity = 'You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).'
  const edited = `${JAN_PROMPT}\n\nAlways answer in haiku.`
  const [current, v2, custom] = janAssistants([
    { id: 'jan', instructions: JAN_PROMPT },
    { id: 'old', instructions: `${identity}\n\n${JAN_PROMPT}` },
    { id: 'mine', instructions: edited },
  ])
  assert.equal(current.instructions, JAN_PROMPT.replace(refused, reworded))
  assert.equal(v2.instructions, `${identity}\n\n${JAN_PROMPT.replace(refused, reworded)}`)
  assert.equal(custom.instructions, edited)
})

test('a derived preset swaps only the persona text, kept literal', () => {
  const base = { id: 'standard', plugins: [{ id: 'persona', name: '@janhq/jan-persona', config: { prefix: 'You are a coding agent.' } }, { id: 'tool-fs', name: '@janhq/jan-tool-fs' }] }
  const preset = derivePreset(base, { id: 'jan-assistant-jan', name: 'Jan', description: '', instructions: 'Use {{current_date}}.' })
  assert.deepEqual(preset.plugins[0], { id: 'persona', name: '@janhq/jan-persona', config: { prefix: 'Use {{current_date}}.', interpolate: false } })
  assert.equal(preset.plugins[1], base.plugins[1])
  assert.equal(derivePreset(base, { id: 'x', name: 'Empty', description: '', instructions: '' }).plugins[0], base.plugins[0])
})
