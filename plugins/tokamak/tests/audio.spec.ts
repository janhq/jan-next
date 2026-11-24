import { describe, expect, it } from 'vitest'
import { replyError } from '../api.mjs'
import { decodeTranscription, speechBody, systemOneBody, transcriptionForm, wavSeconds } from '../audio.mjs'
import { defaultPath, numberedPaths } from '../session-files.mjs'

/** A 16-bit mono WAV header over `samples` silent samples at `rate` Hz. */
function wav(rate: number, samples: number, dataSize = samples * 2): Uint8Array {
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => { for (const [index, char] of [...value].entries()) bytes[at + index] = char.charCodeAt(0) }
  text(0, 'RIFF'); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, dataSize, true)
  return bytes
}

describe('Tokamak replies in plain words', () => {
  it('turns refusals a user can act on into instructions, and quotes other errors', () => {
    const guardrail = JSON.stringify({ error: { message: 'cannot screen audio', code: 'guardrail_policy_unsupported' } })
    expect(replyError('transcription', 403, guardrail)).toMatch(/admin can allow unscreened voice/)
    expect(replyError('speech', 402, '{}')).toMatch(/balance is too low/)
    expect(replyError('classification', 422, JSON.stringify({ detail: { error_type: 'validation', message: 'criteria missing' } })))
      .toBe('Tokamak classification request failed (HTTP 422): criteria missing')
    expect(replyError('image', 502, 'Bad gateway')).toBe('Tokamak image request failed (HTTP 502): Bad gateway')
  })
})

describe('Speech and transcription shapes', () => {
  it('refuses text, voices and speeds the speech endpoint would reject', () => {
    expect(() => speechBody({ text: '  ' })).toThrow(/text is required/)
    expect(() => speechBody({ text: 'x'.repeat(4097) })).toThrow(/up to 4096/)
    expect(() => speechBody({ text: 'hi', voice: 'nova' })).toThrow(/voice must be one of/)
    expect(() => speechBody({ text: 'hi', speed: 2 })).toThrow(/0.25 to 1.5/)
    expect(speechBody({ text: ' Hello. ', speed: 1.2 })).toEqual({ input: 'Hello.', voice: 'marin', response_format: 'wav', speed: 1.2 })
  })

  it('reads the duration of a WAV, including a streamed one with an unknown data size', () => {
    expect(wavSeconds(wav(24_000, 48_000))).toBe(2)
    expect(wavSeconds(wav(24_000, 12_000, 0xffffffff))).toBe(0.5)
    expect(wavSeconds(new Uint8Array(10))).toBeUndefined()
  })

  it('sends the language hint only when one is chosen', () => {
    expect(transcriptionForm('openai/gpt-transcribe', new Uint8Array(4), 'a.wav', 'auto').has('language')).toBe(false)
    expect(transcriptionForm('openai/gpt-transcribe', new Uint8Array(4), 'a.wav', 'vi').get('language')).toBe('vi')
    expect(decodeTranscription({ text: ' hi ', usage: { seconds: 3 } })).toEqual({ text: 'hi', seconds: 3 })
  })
})

describe('System One questions', () => {
  it('names the malformed question before any request', () => {
    expect(() => systemOneBody('jev/jev-latest', { state: 'x', questions: {} })).toThrow(/at least one question/)
    expect(() => systemOneBody('jev/jev-latest', { state: 'x', questions: { team: { type: 'choice', instructions: 'Which?' } } })).toThrow(/questions.team.criteria/)
    expect(() => systemOneBody('jev/jev-latest', { state: 'x', questions: { mood: { type: 'score', instructions: 'How?', criteria: ['calm'] } } })).toThrow(/2 to 10 levels/)
    expect(systemOneBody('jev/jev-latest', { state: 'x', questions: { urgent: { type: 'noul', instructions: 'Urgent?' } } }).model).toBe('jev/jev-latest')
  })
})

describe('Saved file names', () => {
  it('names files from the text and numbers extra files before the extension', () => {
    expect(defaultPath('images', 'A Flappy Cat, 3D!', '.png')).toBe('images/a-flappy-cat-3d.png')
    expect(defaultPath('images', '!!!', '.png')).toBe('images/image.png')
    expect(defaultPath('audio', 'Xin chào', '.wav')).toBe('audio/xin-chao.wav')
    expect(numberedPaths('out/cat.png', 3)).toEqual(['out/cat.png', 'out/cat-2.png', 'out/cat-3.png'])
    expect(numberedPaths('v1.2/cat', 2)).toEqual(['v1.2/cat', 'v1.2/cat-2'])
  })
})
