import { describe, expect, it } from 'vitest'
import { decodeReply, defaultPath, editForm, imageOptions, numberedPaths, replyError } from '../images.mjs'

describe('Tokamak Images API shapes', () => {
  it('rejects options the image model does not accept before any request', () => {
    expect(() => imageOptions({ prompt: '  ' })).toThrow(/prompt/)
    expect(() => imageOptions({ prompt: 'cat', size: '512x512' })).toThrow(/size must be one of/)
    expect(() => imageOptions({ prompt: 'cat', n: 5 })).toThrow(/n must be 1 to 4/)
    expect(imageOptions({ prompt: ' cat ', quality: 'low', n: 2 })).toEqual({ prompt: 'cat', quality: 'low', n: 2 })
  })

  it('sends every source image as image[] and the mask once, as the edits endpoint expects', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const form = editForm('openai/gpt-image-2', { prompt: 'merge them', size: '1024x1024' }, [
      { data: png, mediaType: 'image/png', name: 'a.png' },
      { data: png, mediaType: 'image/jpeg', name: 'b.jpg' },
    ], { data: png, mediaType: 'image/png', name: 'mask.png' })
    expect(form.get('model')).toBe('openai/gpt-image-2')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.getAll('image[]').map(file => (file as File).name)).toEqual(['a.png', 'b.jpg'])
    expect(new Uint8Array(await (form.get('mask') as File).arrayBuffer())).toEqual(png)
  })

  it('decodes base64 images with the format and size the provider settled on', () => {
    const reply = decodeReply({
      data: [{ b64_json: Buffer.from('jpeg-bytes').toString('base64'), generation_id: 'g1' }],
      output_format: 'jpeg', size: '1536x1024', quality: 'medium',
    }, 'exec-1')
    expect(reply).toMatchObject({ size: '1536x1024', quality: 'medium', generationIds: ['g1'], executionId: 'exec-1' })
    expect(reply.images[0]!.mediaType).toBe('image/jpeg')
    expect(Buffer.from(reply.images[0]!.data).toString()).toBe('jpeg-bytes')
    expect(() => decodeReply({ data: [] }, null)).toThrow(/no image/)
  })

  it('quotes the provider error message rather than the raw JSON', () => {
    expect(replyError(400, JSON.stringify({ error: { message: 'Invalid size' } }))).toBe('Tokamak image request failed (HTTP 400): Invalid size')
    expect(replyError(502, 'Bad gateway')).toBe('Tokamak image request failed (HTTP 502): Bad gateway')
  })

  it('names files from the prompt and numbers extra images before the extension', () => {
    expect(defaultPath('A Flappy Cat, 3D!', '.png')).toBe('images/a-flappy-cat-3d.png')
    expect(defaultPath('!!!', '.png')).toBe('images/image.png')
    expect(numberedPaths('out/cat.png', 3)).toEqual(['out/cat.png', 'out/cat-2.png', 'out/cat-3.png'])
    expect(numberedPaths('v1.2/cat', 2)).toEqual(['v1.2/cat', 'v1.2/cat-2'])
  })
})
