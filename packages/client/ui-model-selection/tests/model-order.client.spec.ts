import { describe, expect, it } from 'vitest'
import { compareModelNames, compareNewest } from '../src/client/model-order.ts'

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

  it('lists a minor version above its major and ignores bracketed variant tags', () => {
    const names = ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-5-5[1m]', 'claude-opus-4-6']
    expect([...names].sort(compareModelNames)).toEqual(['claude-opus-5-5[1m]', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-6'])
  })
})

describe('compareNewest', () => {
  it('orders search matches by version across families, newest first', () => {
    const names = ['claude-opus-4-6', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-8', 'TinyLlama']
    expect([...names].sort(compareNewest)).toEqual([
      'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-6', 'TinyLlama',
    ])
  })
})
