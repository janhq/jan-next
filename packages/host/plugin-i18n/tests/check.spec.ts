import { describe, expect, it } from 'vitest'
import { checkTranslation, placeholdersOf } from '../src/check.ts'

describe('placeholdersOf', () => {
  it('lists {name} tokens as a sorted multiset', () => {
    expect(placeholdersOf('{b} and {a} and {b}')).toEqual(['{a}', '{b}', '{b}'])
    expect(placeholdersOf('{not a token} {1}')).toEqual(['{1}'])
  })
})

describe('checkTranslation', () => {
  it('accepts a translation that keeps placeholders, code spans, and links', () => {
    expect(checkTranslation('Open `/cad` for {name} at https://x.test/a', '{name} のために https://x.test/a で `/cad` を開く')).toBeUndefined()
  })

  it('rejects a changed, dropped, or added placeholder', () => {
    expect(checkTranslation('Hello {name}', 'こんにちは {nome}')).toBe('placeholders')
    expect(checkTranslation('Hello {name}', 'こんにちは')).toBe('placeholders')
    expect(checkTranslation('Hello', 'こんにちは {name}')).toBe('placeholders')
    expect(checkTranslation('{a} {a}', '{a}')).toBe('placeholders')
  })

  it('rejects empty output, a rewritten code span, an invented link, and invisible characters', () => {
    expect(checkTranslation('Hello', '  ')).toBe('empty')
    expect(checkTranslation('Run `ls`', '実行 `dir`')).toBe('code-span')
    expect(checkTranslation('Docs', 'ドキュメント https://evil.test')).toBe('url')
    expect(checkTranslation('Docs', 'ド\u200Bキュメント')).toBe('control-characters')
  })

  it('rejects runaway output', () => {
    expect(checkTranslation('Hi', 'x'.repeat(1000))).toBe('too-long')
  })
})
