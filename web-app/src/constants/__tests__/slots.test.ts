import { describe, it, expect } from 'vitest'
import {
  BACKGROUND_THREAD_ID,
  CHAT_SLOT_ID,
} from '@/constants/models'

// llama.cpp wraps an out-of-range id_slot modulo the slot count instead of
// rejecting it, so any pin above 0 silently lands back on slot 0 whenever the
// resolved count disagrees. Jan therefore reserves no slot and pins every
// surface to 0, separating them by thread_id instead -- which only works while
// those identities stay distinct.
describe('llama.cpp slot allocation', () => {
  it('keeps every surface on slot 0', () => {
    expect(CHAT_SLOT_ID).toBe(0)
  })

  it('gives every surface sharing the slot a distinct thread identity', () => {
    const chatThread = 'thread-abc'
    const identities = [chatThread, BACKGROUND_THREAD_ID]
    expect(new Set(identities).size).toBe(identities.length)
  })

})
