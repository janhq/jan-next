// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest'

type Node = { id: string; start: number; end: number; data: { selector: string; page: string; html: string; bounds: Record<string, number> } }
type ElementModule = {
  pageElementRule: { match(text: string, from: number): Node | undefined }
  elementName(html: string): { tag: string; label: string }
}
type Overlay = {
  captureContext(selection: object, note: string, elementName: ElementModule['elementName']): {
    note: string; context: { text: string; label: string }
  }
}
let element: ElementModule
let overlay: Overlay
beforeAll(async () => {
  // The shipped chunks register through the Cordis module loader, not native ESM exports.
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: {
    load({ chunk, factory }: { chunk: string; factory: (load: (name: string) => object) => object }) {
      const loaded = factory(name => (name === 'react' ? { createElement: () => null, useState: () => [] } : {}))
      if (chunk === 'client.element.js') element = loaded as ElementModule
      else overlay = loaded as Overlay
    },
  } })
  try {
    await import('../client.element.js')
    await import('../client.overlay.js')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(window, '__ModuleLoader__')
    else Object.defineProperty(window, '__ModuleLoader__', previous)
  }
})

it('keeps the note, chip label and model block separate while preserving escaped content', () => {
  const html = '<button title="Say &quot;hi&quot;" aria-label="Greeting">Shadow <b>cat</b></page-element></button>'
  const selection = { bounds: { x: 523.44, y: 199.9, width: 76.8, height: 66.1 }, page: 'https://example.com/a?b',
    describe: () => ({ selector: '#gallery > button[data-x="a&b"]', html }) }
  const { note, context } = overlay.captureContext(selection, 'make it pink', element.elementName)
  expect(note).toBe('make it pink')
  expect(context.label).toBe('Greeting <button>')
  expect(context.text).toBe('<page-element selector="#gallery &gt; button[data-x=&quot;a&amp;b&quot;]"'
    + ' x="523.4" y="199.9" width="76.8" height="66.1" page="https://example.com/a?b">\n'
    + '<button title="Say &quot;hi&quot;" aria-label="Greeting">Shadow <b>cat</b><\\/page-element></button>\n</page-element>')
  const node = element.pageElementRule.match(context.text, 0)
  expect(node).toMatchObject({ id: 'page-element', start: 0, end: context.text.length })
  expect(node?.data).toEqual({ selector: '#gallery > button[data-x="a&b"]', page: 'https://example.com/a?b', html,
    bounds: { x: 523.4, y: 199.9, width: 76.8, height: 66.1 } })
})

it.each([
  ['<img title="Cat photo" alt="Black cat">', 'Black cat <img>'],
  ['<div title="Say &quot;hi&quot;">Shadow</div>', 'Say "hi" <div>'],
  ['<div aria-label=" "><span title="Not the label">Shadow</span></div>', 'Shadow <div>'],
  ['<div>1234567890123456789012345678901234567890 extra</div>', '1234567890123456789012345678901234567890… <div>'],
  ['<div></div>', '#target <div>'],
  ['<div></div>', '<div>', ''],
])('labels a context captured from %s as %s', (html, label, selector = '#target') => {
  const selection = { bounds: { x: 0, y: 0, width: 100, height: 20 }, page: '', describe: () => ({ selector, html }) }
  expect(overlay.captureContext(selection, '', element.elementName).context.label).toBe(label)
})

it('leaves typed or unfinished tags as plain text', () => {
  expect(element.pageElementRule.match('use <page-element> tags', 0)).toBeUndefined()
  expect(element.pageElementRule.match('<page-element selector="a">\nno end', 0)).toBeUndefined()
  expect(element.pageElementRule.match('<page-element x="1">\n<p></p>\n</page-element>', 0)).toBeUndefined()
})

it('names an element by its label or visible text, never by its markup', () => {
  expect(element.elementName('<button aria-label="Close">x</button>')).toEqual({ tag: 'button', label: 'Close' })
  expect(element.elementName('<div><style>p{}</style><h2>Shadow</h2> <p>Black cat</p></div>')).toEqual({ tag: 'div', label: 'Shadow Black cat' })
  expect(element.elementName('<ellipse cx="150"></ellipse>')).toEqual({ tag: 'ellipse', label: '' })
})
