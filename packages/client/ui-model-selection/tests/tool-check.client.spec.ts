/**
 * Tool-use check: only a model that declares it cannot use tools is refused,
 * and the offered switch prefers a model from the same provider that declares it can.
 */
import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { toolRefusalOf } from '../src/client/tool-check.ts'

type Entry = { id: string; name: string; toolUse?: boolean; reasoning?: { efforts: []; defaultEffort?: string } }

function directory(current: string | null, groups: Record<string, Entry[]>): ModelDirectoryState {
  const [provider, model] = current?.split('/') ?? []
  return {
    current: current === null ? null : { provider, model },
    groups: Object.entries(groups).map(([id, models]) => ({ id, name: id, models })),
  } as never
}

describe('toolRefusalOf', () => {
  it('stays quiet when the model uses tools, does not say, or nothing is selected', () => {
    expect(toolRefusalOf(directory('local/qwen', { local: [{ id: 'qwen', name: 'Qwen', toolUse: true }] }))).toBeUndefined()
    // A remote model whose route says nothing must never be flagged.
    expect(toolRefusalOf(directory('cloud/haiku', { cloud: [{ id: 'haiku', name: 'Haiku' }] }))).toBeUndefined()
    expect(toolRefusalOf(directory(null, { local: [{ id: 'nano', name: 'Nano', toolUse: false }] }))).toBeUndefined()
  })

  it('refuses a model that cannot use tools and offers one from the same provider first', () => {
    const state = directory('local/nano', {
      cloud: [{ id: 'agent', name: 'Cloud Agent', toolUse: true }],
      local: [
        { id: 'nano', name: 'Jan nano', toolUse: false },
        { id: 'unknown', name: 'Unknown' },
        { id: 'qwen', name: 'Qwen3 8B', toolUse: true, reasoning: { efforts: [], defaultEffort: 'medium' } },
      ],
    })
    expect(toolRefusalOf(state)).toEqual({
      model: 'Jan nano',
      alternative: { name: 'Qwen3 8B', selection: { provider: 'local', model: 'qwen', reasoningEffort: 'medium' } },
    })
  })

  it('offers another provider when its own has none, and names no alternative when none declares tools', () => {
    const elsewhere = directory('local/nano', {
      local: [{ id: 'nano', name: 'Jan nano', toolUse: false }],
      cloud: [{ id: 'agent', name: 'Cloud Agent', toolUse: true }],
    })
    expect(toolRefusalOf(elsewhere)?.alternative).toEqual({ name: 'Cloud Agent', selection: { provider: 'cloud', model: 'agent' } })
    const none = directory('local/nano', { local: [{ id: 'nano', name: 'Jan nano', toolUse: false }], cloud: [{ id: 'x', name: 'X' }] })
    expect(toolRefusalOf(none)).toEqual({ model: 'Jan nano' })
  })
})
