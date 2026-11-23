// @vitest-environment jsdom
import { createRequire } from 'node:module'
import type * as ReactAPI from 'react'
import { fireEvent, render } from '@testing-library/react'
import * as uiPrimitives from '@janhq/jan-client-ui-primitives'
import { beforeAll, expect, it, vi } from 'vitest'

const requireFromRenderer = createRequire(import.meta.resolve('@testing-library/react'))
const React: typeof ReactAPI = requireFromRenderer('react')
const ReactDOM: object = requireFromRenderer('react-dom')

type Bounds = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type Mark = { tool: string; points: readonly Point[]; text?: string; angle?: number; scale?: number }
type OverlayMath = {
  Overlay: ReactAPI.ComponentType<{
    mode: 'draw'
    surface: HTMLElement
    getSurface: () => HTMLElement
    signal: AbortSignal
    captureRegion: () => Promise<Uint8Array>
    close: () => void
    t: (key: string) => string
  }>
  paintMark(context: object, stroke: Mark, scale: number, ink: string, font?: string): void
  markBounds(mark: Mark, measure: (mark: Mark) => number): Bounds
  resized(mark: Mark, bounds: Bounds, corner: number, delta: Point, measure: (mark: Mark) => number): Mark
  touches(mark: Mark, bounds: Bounds, pointer: Point, reach: number): boolean
  toolForKey(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): string | undefined
}
let capture: OverlayMath
beforeAll(async () => {
  // The shipped lazy source is registered through Cordis, not a native ESM export.
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
    load({ factory }: { factory: (load: (name: string) => object) => OverlayMath }) {
      const modules = { react: React, 'react-dom': ReactDOM, '@janhq/jan-client-ui-primitives': uiPrimitives }
      capture = factory(name => modules[name as keyof typeof modules])
    },
  } })
  try {
    await import('../client.overlay.js')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(window, '__ModuleLoader__')
    else Object.defineProperty(window, '__ModuleLoader__', previous)
  }
})

/** Where a mark's box corner lands on screen once the mark turns about its box centre. */
function screenCorner(mark: Mark, corner: 0 | 1 | 2 | 3): Point {
  const b = capture.markBounds(mark, () => 0)
  const local = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }][corner]
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  const angle = mark.angle ?? 0
  const [x, y] = [local.x - c.x, local.y - c.y]
  return { x: c.x + x * Math.cos(angle) - y * Math.sin(angle), y: c.y + x * Math.sin(angle) + y * Math.cos(angle) }
}

it('resizes a rotated shape from the dragged corner while the opposite corner stays put on screen', () => {
  const mark = { tool: 'rectangle', points: [{ x: 100, y: 100 }, { x: 200, y: 160 }], angle: Math.PI / 6, scale: 1 }
  const before = screenCorner(mark, 0)
  const dragged = screenCorner(mark, 2)
  const next = capture.resized(mark, capture.markBounds(mark, () => 0), 2, { x: 90, y: 100 }, () => 0)
  const after = screenCorner(next, 0)
  expect(after.x).toBeCloseTo(before.x, 6)
  expect(after.y).toBeCloseTo(before.y, 6)
  expect(screenCorner(next, 2).x).toBeCloseTo(dragged.x + 90, 6)
  expect(screenCorner(next, 2).y).toBeCloseTo(dragged.y + 100, 6)
})

it('clicking a resize handle without dragging leaves the mark and undo history unchanged', async () => {
  const strokeRect = vi.fn()
  const context = { arc: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), fill: vi.fn(),
    lineTo: vi.fn(), moveTo: vi.fn(), rect: vi.fn(), restore: vi.fn(), rotate: vi.fn(), save: vi.fn(), stroke: vi.fn(),
    strokeRect, translate: vi.fn() }
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    // Selection chrome draws its own padded rectangle, separate from the exported mark.
    return (this.hasAttribute('aria-hidden') ? context : { ...context, strokeRect: vi.fn() }) as never
  })
  vi.stubGlobal('createImageBitmap', async () => ({ width: 400, height: 300, close() {} }))
  const surface = document.body.appendChild(document.createElement('div'))
  const bounds = () => new DOMRect(0, 0, 400, 300)
  surface.getBoundingClientRect = bounds
  const view = render(React.createElement(capture.Overlay, {
    mode: 'draw', surface, getSurface: () => surface, signal: new AbortController().signal,
    captureRegion: async () => new Uint8Array(0), close: vi.fn(), t: key => key,
  }))
  try {
    const canvas = await view.findByRole<HTMLCanvasElement>('img', { name: 'canvas' })
    canvas.getBoundingClientRect = bounds
    canvas.setPointerCapture = vi.fn()
    const press = (x: number, y: number) => fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: x, clientY: y })
    const release = (x: number, y: number) => fireEvent.pointerUp(canvas, { pointerId: 1, clientX: x, clientY: y })
    fireEvent.click(view.getByRole('button', { name: 'rectangle' }))
    press(100, 100)
    release(200, 160)

    fireEvent.click(view.getByRole('button', { name: 'select' }))
    press(150, 130)
    release(151, 131)
    expect(strokeRect).toHaveBeenLastCalledWith(101, 101, 100, 60)
    // The bottom-right handle starts 6px outside the mark. Press off its centre to include the grab offset.
    press(209, 165)
    release(209, 165)
    expect(strokeRect).toHaveBeenLastCalledWith(101, 101, 100, 60)

    press(209, 165)
    release(219, 170)
    expect(strokeRect).toHaveBeenLastCalledWith(101, 101, 110, 65)

    // Undo the resize, move, and draw. The stationary click added no extra step.
    const undo = view.getByRole('button', { name: 'undo' })
    fireEvent.click(undo)
    fireEvent.click(undo)
    fireEvent.click(undo)
    expect(view.getByRole<HTMLButtonElement>('button', { name: 'add' }).disabled).toBe(true)
  } finally {
    view.unmount()
    surface.remove()
    getContext.mockRestore()
    vi.unstubAllGlobals()
  }
})

it('erases a shape only where its outline is, also once it is rotated', () => {
  const mark = { tool: 'rectangle', points: [{ x: 0, y: 0 }, { x: 100, y: 40 }], angle: Math.PI / 2, scale: 1 }
  const b = capture.markBounds(mark, () => 0)
  // Turned a quarter about (50, 20), the top edge now runs vertically through x = 70.
  expect(capture.touches(mark, b, { x: 70, y: 20 }, 4)).toBe(true)
  expect(capture.touches(mark, b, { x: 50, y: 20 }, 4)).toBe(false)
  expect(capture.touches(mark, b, { x: 50, y: 0 }, 4)).toBe(false)
})

it('renders drawing text in the current interface font and accent', () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn() }
  capture.paintMark(ctx, { tool: 'text', points: [{ x: 10, y: 20 }], text: 'Review' }, 2, 'purple', 'Inter, sans-serif')
  expect(ctx).toMatchObject({ font: '500 32px Inter, sans-serif', fillStyle: 'purple' })
  expect(ctx.fillText).toHaveBeenCalledWith('Review', 10, 20)
})

it('picks drawing tools with Excalidraw keys, but leaves modified presses to their own shortcuts', () => {
  expect(['v', 'P', 'r', 'o', 'a', 'e', 't'].map(key => capture.toolForKey({ key })))
    .toEqual(['select', 'pen', 'rectangle', 'ellipse', 'arrow', 'eraser', 'text'])
  expect(['1', '7', '2', '4', '5', '0', '8'].map(key => capture.toolForKey({ key })))
    .toEqual(['select', 'pen', 'rectangle', 'ellipse', 'arrow', 'eraser', 'text'])
  expect(capture.toolForKey({ key: 'a', metaKey: true })).toBeUndefined()
  expect(capture.toolForKey({ key: 'r', ctrlKey: true })).toBeUndefined()
  expect(capture.toolForKey({ key: 't', altKey: true })).toBeUndefined()
  expect(capture.toolForKey({ key: 'x' })).toBeUndefined()
})
