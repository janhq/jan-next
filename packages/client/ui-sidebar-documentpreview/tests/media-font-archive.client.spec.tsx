// @vitest-environment jsdom
/** Media, font, and zip renderers: suffix routing and the zip listing. */
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreviewRegistry } from '../src/client/document/registry.ts'
import { ArchiveBody, ARCHIVE_ROW_LIMIT, archiveEntries } from '../src/client/archive/ArchiveBody.tsx'
import { ARCHIVE_BODY_ID, ARCHIVE_EXTENSIONS, archiveBodyDefinition } from '../src/client/archive/index.ts'
import { en } from '../src/client/archive/locales.ts'
import { FONT_BODY_ID, FONT_EXTENSIONS, fontBodyDefinition } from '../src/client/font/index.ts'
import { AUDIO_EXTENSIONS, MEDIA_AUDIO_ID, MEDIA_VIDEO_ID, VIDEO_EXTENSIONS, mediaBodyDefinition } from '../src/client/media/index.ts'
import { MediaBody, type MediaBodyProps } from '../src/client/media/MediaBody.tsx'

const t = (key: keyof typeof en, values?: Record<string, string | number>): string =>
  en[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(values?.[name] ?? ''))

describe('media, font, and archive routing', () => {
  it('claims each suffix for exactly its renderer, streaming media without reading bytes', () => {
    const registry = new DocumentPreviewRegistry()
    const title = () => ''
    registry.register(mediaBodyDefinition(MEDIA_VIDEO_ID, VIDEO_EXTENSIONS, title))
    registry.register(mediaBodyDefinition(MEDIA_AUDIO_ID, AUDIO_EXTENSIONS, title))
    registry.register(fontBodyDefinition(title))
    registry.register(archiveBodyDefinition(title))
    const claims: [readonly string[], string][] = [
      [VIDEO_EXTENSIONS, MEDIA_VIDEO_ID], [AUDIO_EXTENSIONS, MEDIA_AUDIO_ID],
      [FONT_EXTENSIONS, FONT_BODY_ID], [ARCHIVE_EXTENSIONS, ARCHIVE_BODY_ID],
    ]
    for (const [extensions, id] of claims) {
      for (const extension of extensions) expect(registry.candidates(`/w/FILE.${extension.toUpperCase()}`).map(entry => entry.id)).toEqual([id])
    }
    expect(registry.candidates('/w/clip.avi')).toEqual([])
    expect(registry.getSnapshot().filter(entry => entry.loading === 'renderer').map(entry => entry.id)).toEqual([MEDIA_VIDEO_ID, MEDIA_AUDIO_ID])
  })

  it('mounts a fresh media player when reloading a failed source at the same URL', () => {
    const loaded = vi.fn()
    const failed = vi.fn()
    const file = { absolutePath: '/w/clip.mp4', version: '1' }
    const body = (revision: number) => {
      const props: Partial<MediaBodyProps> = {
        kind: 'video', content: { kind: 'renderer', revision, loaded, failed, reload: vi.fn() },
        useResource: (() => ({ status: 'live', value: file, failure: undefined })) as MediaBodyProps['useResource'],
      }
      const locale = { t: (key: string) => key }
      return <MediaBody {...props as MediaBodyProps} {...locale} />
    }
    const view = render(body(0))
    try {
      const first = view.container.querySelector('video')!
      const src = first.getAttribute('src')
      fireEvent.error(first)
      expect(failed).toHaveBeenCalledOnce()
      expect(view.getByRole('alert').textContent).toBe('failed')

      view.rerender(body(1))
      expect(view.queryByRole('alert')).toBeNull()
      const reloaded = view.container.querySelector('video')!
      expect(reloaded).not.toBe(first)
      expect(reloaded.getAttribute('src')).toBe(src)
      fireEvent.loadedMetadata(reloaded)
      expect(loaded).toHaveBeenCalledWith(file.version)
    } finally {
      view.unmount()
    }
  })
})

describe('zip listing', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)
  // The body reads only its bytes and `t`; the rest of the preview props stay out of the fixture.
  const body = (data: Uint8Array) => {
    const props: ComponentProps<typeof ArchiveBody> = { content: { kind: 'bytes', data }, t } as never
    return <ArchiveBody {...props} />
  }
  afterEach(cleanup)

  it('lists files by name with sizes and a summary, leaving out directories', () => {
    const data = zipSync({ 'z.txt': bytes('x'.repeat(2048)), 'dir/': new Uint8Array(), 'dir/b.png': bytes('png') })
    render(body(data))
    const rows = within(screen.getByRole('list', { name: en.title })).getAllByRole('listitem')
    expect(rows.map(row => row.querySelector('[title]')?.getAttribute('title'))).toEqual(['dir/b.png', 'z.txt'])
    expect(rows[1]?.textContent).toContain('2')
    expect(screen.getByText(/^2 files · /u)).toBeTruthy()
  })

  it('cuts very long listings and reports unreadable bytes', () => {
    const files = Object.fromEntries(Array.from({ length: ARCHIVE_ROW_LIMIT + 3 }, (_, index) => [`f${String(index).padStart(5, '0')}`, new Uint8Array(1)]))
    const { unmount } = render(body(zipSync(files)))
    expect(screen.getAllByRole('listitem')).toHaveLength(ARCHIVE_ROW_LIMIT)
    expect(screen.getByText('and 3 more')).toBeTruthy()
    unmount()
    expect(archiveEntries(bytes('not a zip'))).toBeUndefined()
    render(body(bytes('not a zip')))
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
  })
})
