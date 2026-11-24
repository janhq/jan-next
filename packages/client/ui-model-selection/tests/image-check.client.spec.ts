/**
 * Attach-time image check: only a route that declares itself text-only refuses
 * a draft image, and the offered switch prefers a reader from the same provider.
 */
import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { imageRefusalOf } from '../src/client/image-check.ts'

type Entry = { id: string; name: string; imageInput?: boolean; reasoning?: { efforts: []; defaultEffort?: string } }

function directory(current: string, groups: Record<string, Entry[]>): ModelDirectoryState {
  const [provider, model] = current.split('/')
  return {
    current: { provider, model },
    groups: Object.entries(groups).map(([id, models]) => ({ id, name: id, models })),
  } as never
}

describe('imageRefusalOf', () => {
  it('stays quiet without an image or when the route does not declare its modalities', () => {
    const textOnly = directory('local/small', { local: [{ id: 'small', name: 'Small', imageInput: false }] })
    expect(imageRefusalOf(textOnly, false)).toBeUndefined()
    const unknown = directory('local/small', { local: [{ id: 'small', name: 'Small' }] })
    expect(imageRefusalOf(unknown, true)).toBeUndefined()
  })

  it('refuses a text-only route and offers a reader from the same provider first', () => {
    const state = directory('cloud/text', {
      other: [{ id: 'eyes', name: 'Other Eyes', imageInput: true }],
      cloud: [
        { id: 'text', name: 'Text', imageInput: false },
        { id: 'vision', name: 'Vision', imageInput: true, reasoning: { efforts: [], defaultEffort: 'high' } },
      ],
    })
    expect(imageRefusalOf(state, true)).toEqual({
      model: 'Text',
      alternative: { name: 'Vision', selection: { provider: 'cloud', model: 'vision', reasoningEffort: 'high' } },
    })
  })

  it('falls back to another provider, and offers nothing when no loaded model reads images', () => {
    const elsewhere = directory('cloud/text', {
      cloud: [{ id: 'text', name: 'Text', imageInput: false }],
      other: [{ id: 'eyes', name: 'Other Eyes', imageInput: true }],
    })
    expect(imageRefusalOf(elsewhere, true)?.alternative?.selection).toEqual({ provider: 'other', model: 'eyes' })
    const none = directory('cloud/text', { cloud: [{ id: 'text', name: 'Text', imageInput: false }] })
    expect(imageRefusalOf(none, true)).toEqual({ model: 'Text' })
  })
})
