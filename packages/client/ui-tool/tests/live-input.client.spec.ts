import { describe, expect, it } from 'vitest'
import { PartialArguments } from '@janhq/jan-util-values'
import { liveToolInput } from '../src/client/tool/models/live-input.ts'

describe('live tool input', () => {
  it.each([
    ['write', 'content'], ['edit', 'new_string'], ['apply_patch', 'input'],
    ['bash', 'command'], ['pwsh', 'command'], ['run_code', 'code'],
  ])('reads decoded %s text before the arguments finish', (tool, field) => {
    const args = new PartialArguments()
    expect(liveToolInput(tool, args)).toBe('')
    args.append(`{"${field}":"first\\`)
    expect(args.refresh()).toBe(true)
    expect(liveToolInput(tool, args)).toBe('first')
    args.append('nsecond')
    expect(args.refresh()).toBe(true)
    expect(liveToolInput(tool, args)).toBe('first\nsecond')
  })

  it('keeps both edit strings in order while the replacement streams', () => {
    const args = new PartialArguments()
    args.append('{"old_string":"before","new_string":"aft')
    expect(liveToolInput('edit', args)).toBe('before\naft')
  })

  it('shows streamed text fields for a custom tool without duplicating its description', () => {
    const args = new PartialArguments()
    args.append('{"description":"Paste a note","note":"part one","footer":"continued')
    expect(liveToolInput('custom_tool', args)).toBe('note: part one\nfooter: continued')
  })
})
