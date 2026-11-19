// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest'

type Bounds = { x: number; y: number; width: number; height: number }
type OverlayMath = {
  elementDetails(element: Element, bounds: Bounds): { selector: string; html: string; bounds: Bounds }
  paintMark(context: object, stroke: { tool: string; points: readonly { x: number; y: number }[]; text?: string }, scale: number, ink: string, font?: string): void
}
let capture: OverlayMath
beforeAll(async () => {
  // The shipped lazy source is registered through Cordis, not a native ESM export.
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
    load({ factory }: { factory: (load: () => object) => OverlayMath }) { capture = factory(() => ({})) },
  } })
  try {
    await import('../client.overlay.js')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(window, '__ModuleLoader__')
    else Object.defineProperty(window, '__ModuleLoader__', previous)
  }
})

it('identifies a duplicate element with a unique selector and a bounded HTML excerpt', () => {
  const host = document.createElement('section')
  host.id = 'component'
  const target = document.createElement('p')
  target.textContent = 'first'
  const duplicate = document.createElement('p')
  duplicate.textContent = 'a'.repeat(5000)
  host.append(target, duplicate)
  document.body.append(host)
  try {
    const info = capture.elementDetails(duplicate, { x: 4, y: 5, width: 200, height: 100 })
    expect(document.querySelector(info.selector)).toBe(duplicate)
    expect(info.html).toMatch(/^<p>a+/u)
    expect(info.html.length).toBeLessThan(2500)
    expect(info.bounds).toEqual({ x: 4, y: 5, width: 200, height: 100 })
  } finally { host.remove() }
})

it('keeps erase operations on the annotation layer and restores compositing after the stroke', () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() }
  capture.paintMark(ctx, { tool: 'eraser', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }, 2, '#e66')
  expect(ctx).toMatchObject({ globalCompositeOperation: 'destination-out', lineWidth: 36 })
  expect(ctx.moveTo).toHaveBeenCalledWith(10, 10)
  expect(ctx.lineTo).toHaveBeenCalledWith(20, 20)
  expect(ctx.restore).toHaveBeenCalledOnce()
})

it('renders drawing text in the current interface font and accent', () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn() }
  capture.paintMark(ctx, { tool: 'text', points: [{ x: 10, y: 20 }], text: 'Review' }, 2, 'purple', 'Inter, sans-serif')
  expect(ctx).toMatchObject({ font: '500 32px Inter, sans-serif', fillStyle: 'purple' })
  expect(ctx.fillText).toHaveBeenCalledWith('Review', 10, 20)
})
