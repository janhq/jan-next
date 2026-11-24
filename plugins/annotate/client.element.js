// Sent-message presentation of a grabbed page element: the `<page-element>` block becomes one chip,
// with the selector, box and HTML behind a click. The message text and the model input keep the block.
window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  chunk: 'client.element.js',
  factory(require) {
    const { createElement: h, useState } = require('react')
    const OPEN = '<page-element '
    const CLOSE = '</page-element>'
    const ATTRIBUTE = /([a-z]+)="([^"]*)"/gu

    function unescape(value) {
      return value.replace(/&#10;/gu, '\n').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&amp;/gu, '&')
    }

    /** Parse one block starting at `start`; undefined when the text there is not a complete block. */
    function parseAt(text, start) {
      const head = text.indexOf('>', start + OPEN.length)
      if (head < 0 || text.slice(start + OPEN.length, head).includes('\n')) return undefined
      const close = text.indexOf(CLOSE, head)
      if (close < 0) return undefined
      const attrs = {}
      for (const [, key, value] of text.slice(start + OPEN.length, head).matchAll(ATTRIBUTE)) attrs[key] = unescape(value)
      if (typeof attrs.selector !== 'string' || attrs.selector === '') return undefined
      const html = text.slice(head + 1, close).replace(/^\n/u, '').replace(/\n$/u, '').replace(/<\\\/page-element>/giu, CLOSE)
      const number = key => (Number.isFinite(Number(attrs[key])) ? Number(attrs[key]) : 0)
      return {
        end: close + CLOSE.length,
        data: { selector: attrs.selector, page: attrs.page ?? '', html,
          bounds: { x: number('x'), y: number('y'), width: number('width'), height: number('height') } },
      }
    }

    /** UserText rule: the nearest complete block at or after `from`. */
    const pageElementRule = {
      id: 'page-element',
      order: 20,
      match(text, from) {
        for (let start = text.indexOf(OPEN, from); start >= 0; start = text.indexOf(OPEN, start + 1)) {
          const parsed = parseAt(text, start)
          if (parsed) return { id: 'page-element', start, end: parsed.end, data: parsed.data }
        }
        return undefined
      },
    }

    /** Name the element from its own label attributes or the text in its captured HTML. */
    function elementName(html) {
      const tag = /^<([a-z][\w-]*)/iu.exec(html)?.[1]?.toLowerCase() ?? 'element'
      const template = document.createElement('template')
      template.innerHTML = html
      const element = template.content.firstElementChild
      if (element?.localName.toLowerCase() !== tag) return { tag, label: '' }
      const label = element.getAttribute('aria-label')?.trim() || element.getAttribute('alt')?.trim() || element.getAttribute('title')?.trim()
      if (label) return { tag, label }
      if (element.matches('style, script, [hidden]')) return { tag, label: '' }
      for (const hidden of element.querySelectorAll('style, script, [hidden]')) hidden.remove()
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const parts = []
      for (let text = walker.nextNode(); text; text = walker.nextNode()) parts.push(text.nodeValue)
      const shown = parts.join(' ').replace(/\s+/gu, ' ').trim()
      return { tag, label: shown.length > 40 ? `${shown.slice(0, 40)}…` : shown }
    }

    const chip = {
      display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', boxSizing: 'border-box',
      padding: '2px 8px 2px 6px', margin: '2px 0', borderRadius: 'var(--dsw-radius-sm)', border: 'none',
      background: 'var(--dsw-alias-bg-mask-1, color-mix(in srgb, currentColor 6%, transparent))',
      color: 'inherit', font: 'inherit', fontSize: '0.92em', lineHeight: 1.5, cursor: 'pointer', textAlign: 'start',
      verticalAlign: 'baseline',
    }
    const tagStyle = { fontFamily: 'var(--ds-font-family-code)', fontSize: '0.85em', color: 'var(--dsw-alias-label-secondary)' }
    const panel = {
      display: 'grid', gap: '6px', margin: '6px 0 2px', padding: '10px 12px', borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-base)', boxShadow: 'inset 0 0 0 var(--jan-hairline-width, 0.5px) var(--dsw-alias-border-l2)',
      fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'normal',
    }
    const code = { fontFamily: 'var(--ds-font-family-code)', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }
    const pre = { ...code, margin: 0, whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }

    function Glyph() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flex: 'none', color: 'var(--dsw-alias-label-secondary)' } },
      h('path', { d: 'M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5' }),
      h('path', { d: 'M8 8l5.5-5.5M9.5 2.5h4v4' }))
    }

    /** One grabbed element as a chip; interactive messages open its details on click. */
    function PageElement({ node, interactive, t }) {
      const [open, setOpen] = useState(false)
      const { selector, page, html, bounds } = node.data
      const { tag, label } = elementName(html)
      const title = label ? `${label}` : selector
      const face = [h(Glyph, { key: 'g' }),
        h('span', { key: 'l', style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
        h('span', { key: 't', style: tagStyle }, `<${tag}>`)]
      const round = value => Math.round(value)
      return h('span', { 'data-page-element': '', style: { display: open ? 'block' : 'inline' } },
        interactive
          ? h('button', { type: 'button', style: chip, title: selector, 'aria-expanded': open,
            'aria-label': t('elementChip', { name: title }), onClick: () => setOpen(value => !value) }, face)
          : h('span', { style: { ...chip, cursor: 'default' }, title: selector }, face),
        open && h('span', { style: panel },
          page && h('span', null, `${t('page')}: `, h('span', { style: code }, page)),
          h('span', null, `${t('selector')}: `, h('span', { style: code }, selector)),
          h('span', null, `${t('size')}: `, h('span', { style: code }, `${round(bounds.width)} x ${round(bounds.height)}`)),
          h('pre', { style: pre }, html)))
    }

    return { pageElementRule, PageElement, elementName }
  },
})
