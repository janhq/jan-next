import { expect, it } from 'vitest'
import { windowCaptureRect } from '../src/window-capture.ts'

it('clamps a CSS-to-window capture request to the app content area', () => {
  expect(windowCaptureRect({ x: -15, y: 20.4, width: 100.5, height: 400 }, { width: 320, height: 240 }))
    .toEqual({ x: 0, y: 20, width: 86, height: 220 })
  expect(windowCaptureRect({ x: 400, y: 0, width: 20, height: 20 }, { width: 320, height: 240 })).toBeNull()
})

it.each([null, {}, { x: Infinity, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }])(
  'rejects invalid renderer input: %j', (input) => {
    expect(windowCaptureRect(input, { width: 320, height: 240 })).toBeNull()
  },
)
