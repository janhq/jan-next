// @vitest-environment jsdom
/** Tool-result thumbnail extraction and the expandable read_image metadata card. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDisclosure } from '@janhq/jan-client-ui-chat/src/client/chat/use-disclosure.ts'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { contextMenuHook, bindSnapshotSelector, makeTranslate } from '@janhq/jan-client-test-runtime'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { zh as commonZh } from '@janhq/jan-client-locale/src/locales/zh.ts'
import type { StartedToolCall, ToolResultNode } from '@janhq/jan-client-ui-chat/client'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { MessageImageLoader } from '@janhq/jan-client-ui-conversation/client'
import { zh } from '@janhq/jan-client-ui-conversation/src/client/locales.ts'
import { PartialArguments } from '@janhq/jan-util-values'
import { AttachmentId, type ImageAttachmentRef } from '@janhq/jan-attachment'
import type { ToolTreeProps } from '../src/client/contract/slots.ts'
import { imageCardModel, toolResultImages } from '../src/client/tool/models/image-card-model.ts'
import { ReadImageRow } from '../src/client/tool/toolviews/read-image-row.tsx'

afterEach(cleanup)

const SID = 's1' as SessionId
const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)
const ARGS = '{"file_path":"shots/card.png"}'

/** The envelope read_image writes beside its image block. */
const ENVELOPE = '<path>shots/card.png</path>\n<type>image</type>\n<content>\nimage/png image, 1496x260 px, 24588 bytes\n</content>'

/** The durable reference read_image persists through presentationMeta. */
const sampleImage: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:fe6d588c8d5a8e93c743d80524b9376634ca1cc262db9e1d21c9e4c18fc856cc'),
  mediaType: 'image/png',
  bytes: 24_588,
  width: 1496,
  height: 260,
  name: 'card.png',
}

/** The persisted presentationMeta payload: the path only. */
const imageMeta = (over?: Record<string, unknown>) => ({ path: 'shots/card.png', ...over })

/** Result content with the image block replaced, for reference-side cases. */
const withImage = (attachment: unknown) => [
  { type: 'text', text: ENVELOPE },
  { type: 'image', attachment },
]

const running = (over?: Partial<StartedToolCall>): StartedToolCall => {
  const argsRaw = over?.argsRaw ?? ARGS
  return {
    phase: 'start' as const, args: PartialArguments.fromText(argsRaw), callId: 'c1', name: 'read_image', argsRaw,
    turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
  }
}

/**
 * A settled read_image node carrying the REAL content shape: [text envelope, image
 * block]. A text-only fixture would hide that the row must not flatten the image
 * block into JSON under the picture.
 */
const settled = (over?: Partial<ToolResultNode>): ToolResultNode => {
  const call = over?.call === undefined ? { name: 'read_image', argsRaw: ARGS } : over.call
  return {
    kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
    name: call?.name ?? '', args: call === null ? PartialArguments.EMPTY : PartialArguments.fromText(call.argsRaw),
    call,
    callTime: 1_000,
    content: [
      { type: 'text', text: ENVELOPE },
      { type: 'image', attachment: sampleImage },
    ],
    isError: false,
    meta: imageMeta(), subCalls: [], ...over,
  }
}

const loadImage: MessageImageLoader = vi.fn(() => Promise.reject(new Error('not used')))

describe('imageCardModel', () => {
  it('derives the card from settled image metadata and its raw envelope', () => {
    expect(imageCardModel(settled())).toEqual({
      path: 'shots/card.png',
      images: [{ attachment: sampleImage }],
      extraText: null,
    })
  })

  it('omits an absent display name rather than carrying undefined through', () => {
    const unnamed = { ...sampleImage }
    delete (unnamed as { name?: string }).name
    const attachment = imageCardModel(settled({ content: withImage(unnamed) } as never))?.images[0]?.attachment
    expect(attachment).not.toHaveProperty('name')
  })

  it('keeps the recorded path unshortened', () => {
    expect(imageCardModel(settled({ meta: imageMeta({ path: 'G:\\breeze\\shots\\card.png' }) }))?.path)
      .toBe('G:\\breeze\\shots\\card.png')
  })

  it('accepts any non-empty attachment id, because the shape is provider-owned', () => {
    // The id is opaque and provider-owned: consumers must not parse that
    // representation, so pattern-checking the local content-address form would
    // reject a legitimate id minted by an alternative store.
    for (const id of ['b3:0123456789abcdef', 'blake3-xof:zzz', 'opaque-provider-token']) {
      expect(imageCardModel(settled({ content: withImage({ ...sampleImage, attachmentId: id }) } as never))
        ?.images[0]?.attachment.attachmentId).toBe(id)
    }
  })

  it('keeps blocks a post-execute hook appended instead of dropping them', () => {
    // The card derives from the settled content, and the content is what a
    // post-execute hook rewrites: appended text and image blocks must stay
    // visible under the gallery, not be silently dropped.
    const appended = { ...sampleImage, attachmentId: 'sha256:appended-extra', name: 'appended.png' }
    const model = imageCardModel(settled({
      content: [
        { type: 'text', text: ENVELOPE },
        { type: 'image', attachment: sampleImage },
        { type: 'text', text: 'analysis: the card area is empty' },
        { type: 'image', attachment: appended },
      ],
    } as never))
    expect(model?.extraText).toBe('analysis: the card area is empty')
    expect(model?.images).toEqual([{ attachment: sampleImage }, { attachment: appended }])
  })

  it('declines when the content carries a block type the card does not render', () => {
    // ContentBlock is merge-extensible: a post-execute hook appending e.g. a
    // reasoning block must not be silently hidden — the card declines to the
    // generic form, which shows the flattened content.
    for (const extra of [
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-call', callId: 'x' },
      { type: 'text' },
      { type: 'text', text: 7 },
      'not-an-object',
      7,
    ]) {
      const node = settled({ content: [...settled().content, extra] } as never)
      expect(() => imageCardModel(node)).not.toThrow()
      expect(imageCardModel(node)).toBeNull()
    }
  })

  it('preserves originalDimensions and declines a malformed pair', () => {
    // The store records input dimensions when normalization downsampled the
    // image; the card must carry them through to the gallery renderer.
    const withDims = { ...sampleImage, originalDimensions: { width: 3000, height: 2000 } }
    expect(imageCardModel(settled({ content: withImage(withDims) } as never))
      ?.images[0]?.attachment.originalDimensions).toEqual({ width: 3000, height: 2000 })
    for (const bad of [
      { ...sampleImage, originalDimensions: null },
      { ...sampleImage, originalDimensions: 'big' },
      { ...sampleImage, originalDimensions: { width: 0, height: 1 } },
      { ...sampleImage, originalDimensions: { width: 1 } },
    ]) {
      expect(imageCardModel(settled({ content: withImage(bad) } as never))).toBeNull()
    }
  })

  it('declines a root call with missing or malformed metadata, and falls back for a nested one', () => {
    // Metadata arrives unvalidated on replay, so an obsolete or hand-edited log
    // must never crash the tool message. A ROOT call whose meta does not match
    // declines to the generic card — malformed tool data must not render a
    // card showing the author-typed path. Only a nested call (which
    // persists no meta by design) falls back to its own file_path argument.
    for (const meta of [undefined, null, 'meta', [{ path: 'a.png' }], {}, { path: '' }, { path: 7 }]) {
      expect(() => imageCardModel(settled({ meta }))).not.toThrow()
      expect(imageCardModel(settled({ meta }))).toBeNull()
    }
    const nested = imageCardModel(settled({ parentCallId: 'parent', meta: undefined }))
    expect(nested).not.toBeNull()
    expect(nested?.path).toBe('shots/card.png')
  })

  it('declines a malformed attachment reference in the content', () => {
    // The reference is read from the result's own image block, which is wire data
    // like every other field.
    const bad: unknown[] = [
      null, 'ref', [],
      {},
      { ...sampleImage, attachmentId: '' },
      { ...sampleImage, attachmentId: 7 },
      { ...sampleImage, mediaType: 7 },
      { ...sampleImage, mediaType: '' },
      { ...sampleImage, mediaType: 'text/html' },
      { ...sampleImage, width: 'wide' },
      { ...sampleImage, bytes: 0 },
      { ...sampleImage, height: 1.5 },
      { ...sampleImage, name: 5 },
    ]
    for (const attachment of bad) {
      const node = settled({ content: withImage(attachment) } as never)
      expect(() => imageCardModel(node)).not.toThrow()
      expect(imageCardModel(node)).toBeNull()
    }
  })

  it('declines when the content carries no image block at all', () => {
    expect(imageCardModel(settled({ content: [{ type: 'text', text: ENVELOPE }] } as never))).toBeNull()
  })

  it('declines when no content block matches the image envelope', () => {
    // `singleResultText` accepts only a lone text block and an image read returns
    // two, so this derivation matches its own envelope by shape. Content another
    // layer prepended must not be mistaken for it.
    expect(imageCardModel(settled({ content: [{ type: 'text', text: 'hook preamble' }] } as never))).toBeNull()
    expect(imageCardModel(settled({ content: [] }))).toBeNull()
  })

  it('declines a running call and an error result, and derives a nested call from its own path', () => {
    // The image card is result-side only: a running call has no content.
    expect(imageCardModel(running())).toBeNull()
    expect(imageCardModel(settled({ isError: true }))).toBeNull()
    // A nested call (a read_image dispatched from inside run_code) settles as a
    // ToolResultNode too and renders the card; it persists no presentationMeta,
    // so the path falls back to the call's file_path argument.
    const nested = imageCardModel(settled({ parentCallId: 'parent', meta: undefined }))
    expect(nested).not.toBeNull()
    expect(nested?.path).toBe('shots/card.png')
    expect(nested?.images).toHaveLength(1)
    // Persisted meta still wins over the argument when a nested call has one.
    const withMeta = imageCardModel(settled({ parentCallId: 'parent', meta: { path: 'shots/persisted.png' } }))
    expect(withMeta?.path).toBe('shots/persisted.png')
  })

  it('declines a call head that is not read_image', () => {
    expect(imageCardModel(settled({ call: { name: 'read', argsRaw: ARGS } }))).toBeNull()
    expect(imageCardModel(settled({ call: { name: 'read_image', argsRaw: '{"file_path":"  "}' } }))).toBeNull()
  })
})

describe('toolResultImages', () => {
  it('keeps valid screenshots in output order without requiring a read_image envelope', () => {
    const second = { ...sampleImage, attachmentId: AttachmentId('screenshot-2') }
    const result = settled({
      call: { name: 'capture_screenshot', argsRaw: '{}' },
      content: [
        { type: 'text', text: 'Capture complete' },
        { type: 'image', attachment: sampleImage },
        { type: 'image', attachment: { ...sampleImage, width: 0 } },
        { type: 'image', attachment: second },
      ],
      isError: true,
      meta: undefined,
    })
    expect(toolResultImages(result.content)).toEqual([{ attachment: sampleImage }, { attachment: second }])
    expect(toolResultImages([{ type: 'text', text: 'No attachment' }])).toBeNull()
  })
})

describe('ReadImageRow keyed toolview', () => {
  const list = () => createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/w/app' } },
    current: SID,
    phase: 'ready',
    projectionsBySession: {}, jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState)

  const rowProps = (block: StartedToolCall | ToolResultNode): Parameters<typeof ReadImageRow>[0] => ({
    useDisclosure, callId: 'c1', toolName: 'read_image', ...('kind' in block ? { phase: 'result' as const, block } : { phase: block.phase, block }),
    openFile: vi.fn(), loadImage,
    useContextMenu: contextMenuHook(), resolveFilePath: path => path,
    sessionId: SID, useSessions: bindSnapshotSelector(list()),
    t,
  } as Parameters<typeof ReadImageRow>[0])

  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('classifies read_image into the read family so the row keeps its promises', () => {
    // Unclassified, read_image falls to `others`: a generic title and no filePath
    // (FILE_PATH_VARIANTS covers only read/write/edit), so the openable path the
    // row advertises would never be openable.
    const openFile = vi.fn()
    const view = render(<ReadImageRow {...rowProps(settled())} openFile={openFile} />)
    expect(view.container.querySelector('[data-variant]')?.getAttribute('data-variant')).toBe('read')
    const link = view.container.querySelector('button[class*="fileLink"]')
    expect(link).not.toBeNull()
    fireEvent.click(link!)
    expect(openFile).toHaveBeenCalledWith('shots/card.png')
  })

  it('never prints the raw attachment object under the picture', () => {
    const view = render(<ReadImageRow {...rowProps(settled())} />)
    toggleRow(view)
    const text = view.container.textContent ?? ''
    expect(text).not.toContain('"attachmentId"')
    expect(text).not.toContain('"type": "image"')
    expect(text).not.toContain('<path>')
    expect(text).not.toContain('image/png image')
  })

  it('shows the full path once, then the image size, under the picture', () => {
    const view = render(<ReadImageRow {...rowProps(settled({ meta: imageMeta({ path: '/w/app/shots/card.png' }) }))} />)
    toggleRow(view)
    const lines = [...view.container.querySelectorAll('[class*="imageMeta"] > div')].map(line => line.textContent)
    expect(lines).toEqual(['/w/app/shots/card.png', '1496x260px，24588 字节'])
  })

  it('names the original size of a downscaled image', () => {
    const downscaled = { ...sampleImage, originalDimensions: { width: 2992, height: 520 } }
    const view = render(<ReadImageRow {...rowProps(settled({ content: withImage(downscaled) } as never))} />)
    toggleRow(view)
    expect(view.container.textContent).toContain('1496x260px（由 2992x520px 缩小），24588 字节')
  })

  it('keeps appended non-envelope text under the picture', () => {
    const view = render(<ReadImageRow {...rowProps(settled({
      content: [...settled().content, { type: 'text', text: 'analysis: empty card' }],
    } as never))} />)
    toggleRow(view)
    expect(view.container.textContent).toContain('analysis: empty card')
  })

  it('expands to readable metadata independently of the optional thumbnail gallery', () => {
    const view = render(<ReadImageRow {...rowProps(settled())} />)
    expect(view.queryByText('1496x260px，24588 字节')).toBeNull()
    toggleRow(view)
    expect(view.getByText('1496x260px，24588 字节')).toBeTruthy()
  })

  it('a running call renders the summary row alone', () => {
    const view = render(<ReadImageRow {...rowProps(running())} />)
    expect(view.container.querySelector('[data-expandable]')).toBeNull()
  })

  it('a refusal renders its error without an image card', () => {
    // read_image refuses a text-only route, a missing attachment service, and an
    // unreadable file. Claiming the key means this row owns those shapes too.
    const view = render(<ReadImageRow {...rowProps(settled({
      isError: true,
      meta: undefined,
      content: [{ type: 'text', text: 'Error: model "x" does not declare image input' }],
    } as never))} />)
    expect(view.container.textContent).toContain('does not declare image input')
  })
})
