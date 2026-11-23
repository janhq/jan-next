// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { describeElement, withElementProbe } from '../src/element-probe.ts'

afterEach(() => { document.body.replaceChildren() })

it('identifies a duplicate element with a unique selector and a bounded HTML excerpt', () => {
  const host = document.createElement('section')
  host.id = 'component'
  const target = document.createElement('p')
  target.textContent = 'first'
  const duplicate = document.createElement('p')
  duplicate.textContent = 'a'.repeat(5000)
  host.append(target, duplicate)
  document.body.append(host)
  const info = describeElement(duplicate)
  expect(document.querySelector(info.selector)).toBe(duplicate)
  expect(info.html).toMatch(/^<p>a+/u)
  expect(info.html.length).toBeLessThan(2500)
})

it('runs as a standalone page script and answers a point query with the element there', () => {
  const page = new TextEncoder().encode('<!doctype html><p>page</p>')
  const bytes = withElementProbe(page)
  expect([...bytes.subarray(0, page.length)]).toEqual([...page])
  const source = /<script>([\s\S]*)<\/script>/u.exec(new TextDecoder().decode(bytes.subarray(page.length)))?.[1]
  expect(source).toBeDefined()
  const card = document.createElement('div')
  card.className = 'card'
  document.body.append(card, document.createElement('div'))
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 30, height: 40 }))
  const elementFromPoint = vi.fn(() => card)
  document.elementFromPoint = elementFromPoint
  const reply = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
  // The page script sees only its own globals; serialization must not leave references behind.
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
  new Function(source as string)()
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'jan-element-probe', id: 'q1', x: 15, y: 25 } }))
  expect(elementFromPoint).toHaveBeenCalledWith(15, 25)
  expect(reply).toHaveBeenCalledWith({ type: 'jan-element-probe-reply', id: 'q1', hit: {
    selector: 'html > body > div:nth-of-type(1)', html: '<div class="card"></div>', bounds: { x: 10, y: 20, width: 30, height: 40 },
  } }, '*')
})
