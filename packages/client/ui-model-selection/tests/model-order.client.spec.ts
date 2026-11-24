import { describe, expect, it } from 'vitest'
import { compareModelNames } from '../src/client/model-order.ts'

describe('compareModelNames', () => {
  it('lists the newest version of a family first and keeps families in reading order', () => {
    const names = [
      'claude-haiku-4-5-20251001', 'gpt-4.1', 'claude-sonnet-4-5', 'claude-haiku-5-5', 'gpt-5', 'claude-haiku-4-5', 'claude-sonnet-5-5',
    ]
    expect([...names].sort(compareModelNames)).toEqual([
      'claude-haiku-5-5', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5', 'claude-sonnet-4-5',
      'gpt-5', 'gpt-4.1',
    ])
  })
})
