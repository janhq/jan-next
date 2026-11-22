window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  chunk: 'client.overlay.js',
  factory(require) {
    const { createElement: h, useCallback, useEffect, useReducer, useRef, useState } = require('react')
    const { createPortal } = require('react-dom')
    const { Button, InlineEditor, Modal, Tooltip, IconCloseOutlineRegular, IconPenOutlineRegular, IconRectangleOutlineRegular,
      IconEllipseOutlineRegular, IconArrowOutlineRegular, IconEraserOutlineRegular, IconTextOutlineRegular, IconCursorOutlineRegular,
      IconUndoOutlineRegular, IconRedoOutlineRegular, IconTrashOutlineRegular, ELEMENT_PROBE_ATTRIBUTE, describeElement,
      probeFrameElement } = require('@janhq/jan-client-ui-primitives')
    const shell = { display: 'grid', gap: '16px', padding: '20px', boxSizing: 'border-box', minHeight: 0, overflow: 'auto' }
    const tools = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }
    const textStyle = { fontSize: '13px', lineHeight: '18px', letterSpacing: '-0.13px', margin: 0 }
    const muted = { ...textStyle, color: 'var(--dsw-alias-label-secondary)' }
    const ink = { ...textStyle, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }
    const titleStyle = { fontSize: '16px', lineHeight: '24px', letterSpacing: '-0.32px', fontWeight: 500,
      color: 'var(--dsw-alias-label-primary)', margin: 0 }
    // The Draw dialog's title, tools, stage padding, note and buttons take about 500px; the picture gets what the viewport leaves.
    const FRAME_HEIGHT = 'min(53dvh, 620px, calc(100dvh - 500px))'
    const frameStyle = { position: 'relative', maxHeight: FRAME_HEIGHT, maxWidth: '100%', overflow: 'hidden', margin: 'auto', borderRadius: '8px' }
    const HIGHLIGHT = 'var(--dsw-alias-state-business-primary)'
    const elevation = '0 1px 2px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 8%, transparent), '
      + '0 6px 16px -4px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 12%, transparent)'
    const overlayStyle = { position: 'fixed', inset: 0, zIndex: 90 }
    const DRAW_TOOLS = ['select', 'pen', 'rectangle', 'ellipse', 'arrow', 'eraser', 'text']
    const TOOL_ICONS = { select: IconCursorOutlineRegular, pen: IconPenOutlineRegular, rectangle: IconRectangleOutlineRegular,
      ellipse: IconEllipseOutlineRegular, arrow: IconArrowOutlineRegular, eraser: IconEraserOutlineRegular, text: IconTextOutlineRegular }
    // Excalidraw's tool keys: a letter and its toolbar number, without modifiers.
    const TOOL_KEYS = { select: ['v', '1'], pen: ['p', '7'], rectangle: ['r', '2'], ellipse: ['o', '4'], arrow: ['a', '5'], eraser: ['e', '0'], text: ['t', '8'] }
    /** @returns the drawing tool a bare key press picks, or undefined for any other key or one held with a modifier. */
    function toolForKey({ key, metaKey, ctrlKey, altKey }) {
      if (metaKey || ctrlKey || altKey) return undefined
      return DRAW_TOOLS.find(name => TOOL_KEYS[name].includes(key.toLowerCase()))
    }
    const square = { width: '28px', padding: 0, justifyContent: 'center' }
    // The tools sit in one segment on the input surface, like the composer's controls; the picture sits on the same surface.
    const segment = { display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-base)', boxShadow: 'inset 0 0 0 var(--jan-hairline-width, 0.5px) var(--dsw-alias-border-l2)' }
    const stage = { containerType: 'inline-size', padding: '12px', borderRadius: '12px', background: 'var(--dsw-alias-bg-base)',
      boxShadow: 'inset 0 0 0 var(--jan-hairline-width, 0.5px) var(--dsw-alias-border-l2)' }
    const dialogStyle = document.createElement('style')
    dialogStyle.textContent = '.jan-annotation-dialog[role="dialog"]{width:min(520px,100%);max-height:100%;padding:0;border-radius:20px;'
      + 'background:var(--dsw-alias-bg-overlay);box-shadow:' + elevation + '}'
      + '.jan-annotation-dialog .jan-annotation-note{min-height:72px;padding:10px 12px;border-radius:12px;border-color:var(--dsw-alias-border-l2);'
      + 'font:inherit;letter-spacing:inherit;background:var(--dsw-alias-bg-base)}'
      + '.jan-annotation-dialog .jan-annotation-note:focus{border-color:var(--dsw-alias-state-business-primary)}'
      + '.jan-annotation-dialog details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}'
      + '.jan-annotation-dialog.jan-annotation-wide[role="dialog"]{width:min(880px,100%)}'
    document.head.append(dialogStyle)

    /** Fit a bitmap inside its container's width and the frame's height cap, keeping its ratio. */
    function fitted(bitmap) {
      const ratio = bitmap.width / bitmap.height
      const width = `min(100cqw, ${bitmap.width}px, calc(${FRAME_HEIGHT} * ${ratio}))`
      return { width, height: `calc(${width} / ${ratio})` }
    }

    function boundsOf(node, x = 0, y = 0) {
      const bounds = node.getBoundingClientRect()
      return { x: bounds.left + x, y: bounds.top + y, width: bounds.width, height: bounds.height }
    }

    function intersection(a, b) {
      const x = Math.max(a.x, b.x)
      const y = Math.max(a.y, b.y)
      const width = Math.min(a.x + a.width, b.x + b.width) - x
      const height = Math.min(a.y + a.height, b.y + b.height) - y
      return width > 0 && height > 0 ? { x, y, width, height } : null
    }

    function visibleBounds(node) {
      let bounds = intersection(boundsOf(node), { x: 0, y: 0, width: innerWidth, height: innerHeight })
      for (let parent = node.parentElement; parent && bounds; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const clippedX = /^(auto|scroll|hidden|clip)$/u.test(style.overflowX)
        const clippedY = /^(auto|scroll|hidden|clip)$/u.test(style.overflowY)
        if (!clippedX && !clippedY) continue
        const rect = boundsOf(parent)
        bounds = intersection(bounds, {
          x: clippedX ? rect.x + parent.clientLeft : 0, y: clippedY ? rect.y + parent.clientTop : 0,
          width: clippedX ? parent.clientWidth : innerWidth, height: clippedY ? parent.clientHeight : innerHeight,
        })
      }
      return bounds
    }

    function documentOf(surface) {
      return surface.localName === 'webview' ? null
        : surface.localName === 'iframe' ? surface.contentDocument : surface.ownerDocument
    }

    /** An opaque preview page that answers point queries itself (ui-primitives element probe). */
    function probed(surface) {
      return surface.localName === 'iframe' && surface.contentDocument === null && surface.hasAttribute(ELEMENT_PROBE_ATTRIBUTE)
    }

    /**
     * The element under a point. `bounds` are in the element's own viewport, `crop` is the visible part on
     * screen; `describe` reads its selector and HTML only once it is chosen.
     */
    async function hitAt(surface, x, y, layer) {
      const parent = boundsOf(surface)
      const offsetX = parent.x + surface.clientLeft
      const offsetY = parent.y + surface.clientTop
      const surfaceBounds = visibleBounds(surface)
      if (probed(surface)) {
        const found = await probeFrameElement(surface, x - offsetX, y - offsetY)
        if (!found || !surface.isConnected) return null
        const shifted = { ...found.bounds, x: found.bounds.x + offsetX, y: found.bounds.y + offsetY }
        const crop = surfaceBounds && intersection(shifted, surfaceBounds)
        const detail = { selector: found.selector, html: found.html }
        return crop && { crop, bounds: found.bounds, page: '', describe: () => detail, live: () => surface.isConnected, whole: false }
      }
      const source = documentOf(surface)
      if (source === null) return null
      const framed = source !== document
      layer.style.pointerEvents = 'none'
      const hit = source.elementFromPoint(framed ? x - offsetX : x, framed ? y - offsetY : y)
      layer.style.removeProperty('pointer-events')
      if (!hit || (!framed && !surface.contains(hit))) return null
      const crop = surfaceBounds && intersection(framed ? boundsOf(hit, offsetX, offsetY) : boundsOf(hit), surfaceBounds)
      const sourceUrl = new URL(source.URL)
      sourceUrl.username = sourceUrl.password = sourceUrl.search = sourceUrl.hash = ''
      const page = framed && /^(https?):$/u.test(sourceUrl.protocol) ? sourceUrl.href : ''
      return crop && { crop, bounds: boundsOf(hit), page, describe: () => describeElement(hit), live: () => hit.isConnected,
        whole: hit === surface }
    }

    /** Quote an attribute value for the context tag; the renderer reverses exactly these escapes. */
    function attribute(value) {
      return String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/\n/gu, '&#10;')
    }

    /** Split the editable note from the page-element block and its draft chip label. */
    function captureContext(selection, note, elementName) {
      const { bounds, page } = selection
      const { selector, html } = selection.describe()
      const { tag, label } = elementName(html)
      const name = label || selector
      const number = value => Math.round(value * 10) / 10
      const attrs = [['selector', selector], ['x', number(bounds.x)], ['y', number(bounds.y)],
        ['width', number(bounds.width)], ['height', number(bounds.height)], ...(page ? [['page', page]] : [])]
      const excerpt = html.replace(/<\/page-element>/giu, '<\\/page-element>')
      const text = `<page-element ${attrs.map(([key, value]) => `${key}="${attribute(value)}"`).join(' ')}>\n${excerpt}\n</page-element>`
      return { note, context: { text, label: name ? `${name} <${tag}>` : `<${tag}>` } }
    }

    function toBlob(canvas) {
      return new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'))
    }

    function makeImageCanvas(width, height) {
      // Bound export memory while retaining legible strokes on large images.
      const scale = Math.min(1, 4096 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      return canvas
    }

    async function captureImage(image) {
      await image.decode()
      const canvas = makeImageCanvas(image.naturalWidth, image.naturalHeight)
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      return await toBlob(canvas)
    }

    async function captureDisplay(request, bounds, signal) {
      if (request === undefined) throw new Error('Tab capture is not available')
      const stream = await request
      if (signal.aborted) {
        for (const track of stream.getTracks()) track.stop()
        signal.throwIfAborted()
      }
      const region = document.createElement('div')
      region.setAttribute('aria-hidden', 'true')
      Object.assign(region.style, { position: 'fixed', pointerEvents: 'none', margin: 0,
        left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
      document.body.append(region)
      const video = document.createElement('video')
      video.muted = true
      const stop = () => { for (const track of stream.getTracks()) track.stop() }
      signal.addEventListener('abort', stop, { once: true })
      try {
        // A shared tab can letterbox its viewport. Crop at the compositor
        // rather than guessing where unrelated pixels start in the video.
        await stream.getVideoTracks()[0].cropTo(await CropTarget.fromElement(region))
        signal.throwIfAborted()
        video.srcObject = stream
        await video.play()
        signal.throwIfAborted()
        const canvas = makeImageCanvas(video.videoWidth, video.videoHeight)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        return await toBlob(canvas)
      } finally {
        region.remove()
        signal.removeEventListener('abort', stop)
        stop()
        video.srcObject = null
      }
    }

    async function capture({ surface, bounds, captureRegion, request, signal, forceCrop = false }) {
      signal.throwIfAborted()
      if (!forceCrop && surface.localName === 'img') return await captureImage(surface)
      if (!bounds) throw new Error('Capture area is not visible')
      if (captureRegion) return new Blob([await captureRegion(bounds)], { type: 'image/png' })
      return await captureDisplay(request, bounds, signal)
    }

    function Notes({ t, value, change, close, submit }) {
      return h('label', { style: { ...muted, display: 'grid', gap: '6px' } }, t('note'),
        h(InlineEditor, { className: 'jan-annotation-note', label: t('note'), value, onChange: change, onSave: submit, onCancel: close }))
    }

    /** A titled sheet: the title and a close control on one row, then the body. */
    function ActionDialog({ t, title, close, wide = false, children }) {
      return h(Modal, { open: true, title, onClose: close, headless: true, shortcutModal: 'jan-annotate', backdropBlur: false,
        className: wide ? 'jan-annotation-dialog jan-annotation-wide' : 'jan-annotation-dialog' },
      h('div', { style: shell },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
          h('h2', { style: titleStyle }, title),
          h(Button, { type: 'button', size: 'sm', 'aria-label': t('close'), title: t('close'), onClick: close,
            style: { width: '28px', padding: 0, justifyContent: 'center' } }, h(IconCloseOutlineRegular, { size: 16, 'aria-hidden': true }))),
        children))
    }

    /** The chosen element in one line: its own tag first, its nearest ancestors after, the full path on hover. */
    function ElementChip({ t, selector }) {
      const parts = selector.split(' > ')
      const own = parts.at(-1)
      const near = parts.slice(-3, -1).join(' > ')
      return h('div', { title: selector, style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0,
        padding: '8px 12px', borderRadius: '10px', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)' } },
      h('span', { style: { ...muted, flex: 'none' } }, t('context')),
      h('code', { style: { ...ink, fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)', fontSize: '12px', flex: 'none' } },
        own.startsWith('#') ? own : `<${own.replace(/:.*/u, '')}>`),
      near && h('span', { style: { ...muted, fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        direction: 'rtl', textAlign: 'left' } }, `\u200E${near}`))
    }

    function Status({ t, message, error, retry, fallback }) {
      return h('div', { style: { display: 'grid', gap: '8px' } },
        h('p', { role: error ? 'alert' : 'status', style: error ? { ...muted, color: 'var(--dsw-alias-state-error-primary)' } : muted }, t(message)),
        (retry || fallback) && h('div', { style: tools },
          retry && h(Button, { type: 'button', size: 'sm', variant: 'primary', onClick: retry, 'data-modal-autofocus': true }, t('retry')),
          fallback && h(Button, { type: 'button', size: 'sm', onClick: fallback }, t('draw'))))
    }

    /** Turn a point about a centre by an angle in radians. */
    function turn(p, c, angle) {
      if (!angle) return p
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const x = p.x - c.x
      const y = p.y - c.y
      return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos }
    }

    const fontSize = (mark, scale) => mark.size ?? 16 * scale
    const centerOf = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

    /** A mark's unrotated box in screenshot pixels; `measure` returns a text mark's width in its font. */
    function markBounds(mark, measure) {
      if (mark.tool === 'text') {
        const { x, y } = mark.points[0]
        return { x, y, width: measure(mark), height: fontSize(mark, mark.scale) * 1.25 }
      }
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const { x, y } of mark.points) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
      return { x: left, y: top, width: right - left, height: bottom - top }
    }

    function within(b, p, pad) {
      return p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad
    }

    function segmentDistance(p, a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = dx * dx + dy * dy
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }

    /** The polyline a mark draws, in its unrotated frame. */
    function outline(mark, b) {
      const [first, end = first] = mark.points
      if (mark.tool === 'rectangle') {
        const right = b.x + b.width
        const bottom = b.y + b.height
        return [{ x: b.x, y: b.y }, { x: right, y: b.y }, { x: right, y: bottom }, { x: b.x, y: bottom }, { x: b.x, y: b.y }]
      }
      if (mark.tool === 'ellipse') {
        const c = centerOf(b)
        return Array.from({ length: 49 }, (_, i) => ({ x: c.x + b.width / 2 * Math.cos(i * Math.PI / 24),
          y: c.y + b.height / 2 * Math.sin(i * Math.PI / 24) }))
      }
      if (mark.tool === 'arrow') return [first, end]
      return mark.points
    }

    /** Whether a point lies on what a mark draws, within reach; a text mark counts its whole box. */
    function touches(mark, b, p, reach) {
      const q = turn(p, centerOf(b), -(mark.angle ?? 0))
      if (mark.tool === 'text') return within(b, q, reach)
      const line = outline(mark, b)
      if (line.length === 1) return Math.hypot(q.x - line[0].x, q.y - line[0].y) <= reach
      for (let i = 1; i < line.length; i++) if (segmentDistance(q, line[i - 1], line[i]) <= reach) return true
      return false
    }

    /** Corner handles 0-3 (clockwise from top left) and the rotation handle of a mark; `unit` is one CSS pixel. */
    function handlesOf(mark, b, unit) {
      const pad = 6 * unit
      const c = centerOf(b)
      const left = b.x - pad
      const top = b.y - pad
      const right = b.x + b.width + pad
      const bottom = b.y + b.height + pad
      return [{ id: 0, x: left, y: top }, { id: 1, x: right, y: top }, { id: 2, x: right, y: bottom }, { id: 3, x: left, y: bottom },
        { id: 'rotate', x: c.x, y: top - 22 * unit }].map(handle => ({ ...turn(handle, c, mark.angle ?? 0), id: handle.id }))
    }

    /**
     * Scale a mark from the corner opposite `corner` to the pointer. A mark turns about its box centre, which
     * resizing moves, so the result shifts back until the anchor corner keeps its place on screen.
     */
    function resized(mark, b, corner, p, measure) {
      const angle = mark.angle ?? 0
      const c0 = centerOf(b)
      const corners = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
      const anchor = corners[(corner + 2) % 4]
      const dragged = corners[corner]
      const q = turn(p, c0, -angle)
      const factor = (to, from, at) => (from === at ? 1 : (to - at) / (from - at))
      let next
      if (mark.tool === 'text') {
        // Text keeps its proportions: the vertical drag sets the font size.
        const s = Math.max(0.25, Math.abs(factor(q.y, dragged.y, anchor.y)))
        const width = b.width * s
        const height = b.height * s
        next = { ...mark, size: fontSize(mark, mark.scale) * s,
          points: [{ x: anchor.x === b.x ? anchor.x : anchor.x - width, y: anchor.y === b.y ? anchor.y : anchor.y - height }] }
      } else {
        const sx = factor(q.x, dragged.x, anchor.x)
        const sy = factor(q.y, dragged.y, anchor.y)
        next = { ...mark, points: mark.points.map(({ x, y }) => ({ x: anchor.x + (x - anchor.x) * sx, y: anchor.y + (y - anchor.y) * sy })) }
      }
      const c1 = centerOf(markBounds(next, measure))
      const moved = { x: c1.x - c0.x, y: c1.y - c0.y }
      const turned = turn(moved, { x: 0, y: 0 }, angle)
      const dx = turned.x - moved.x
      const dy = turned.y - moved.y
      return dx === 0 && dy === 0 ? next : { ...next, points: next.points.map(({ x, y }) => ({ x: x + dx, y: y + dy })) }
    }

    /** Paint one mark onto the transparent ink layer, never onto the source image; `center` turns a rotated mark. */
    function paintMark(ctx, mark, scale, inkColor, fontFamily, center) {
      const { tool, points, text, angle } = mark
      const first = points[0]
      const end = points.at(-1)
      ctx.save()
      if (angle && center) {
        ctx.translate(center.x, center.y)
        ctx.rotate(angle)
        ctx.translate(-center.x, -center.y)
      }
      ctx.strokeStyle = ctx.fillStyle = inkColor
      ctx.lineWidth = 3 * scale
      ctx.lineCap = ctx.lineJoin = 'round'
      if (tool === 'text') {
        ctx.font = `500 ${fontSize(mark, scale)}px ${fontFamily}`
        ctx.textBaseline = 'top'
        ctx.fillText(text, first.x, first.y)
      } else if (tool === 'rectangle') {
        ctx.strokeRect(first.x, first.y, end.x - first.x, end.y - first.y)
      } else {
        ctx.beginPath()
        if (tool === 'ellipse') {
          ctx.ellipse((first.x + end.x) / 2, (first.y + end.y) / 2,
            Math.abs(end.x - first.x) / 2, Math.abs(end.y - first.y) / 2, 0, 0, 2 * Math.PI)
        } else {
          ctx.moveTo(first.x, first.y)
          if (tool === 'arrow') {
            const direction = Math.atan2(end.y - first.y, end.x - first.x)
            const head = Math.min(Math.hypot(end.y - first.y, end.x - first.x), 14 * scale)
            ctx.lineTo(end.x, end.y)
            ctx.lineTo(end.x - head * Math.cos(direction - Math.PI / 6), end.y - head * Math.sin(direction - Math.PI / 6))
            ctx.moveTo(end.x, end.y)
            ctx.lineTo(end.x - head * Math.cos(direction + Math.PI / 6), end.y - head * Math.sin(direction + Math.PI / 6))
          } else {
            if (points.length === 1) ctx.lineTo(first.x + .01, first.y)
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
          }
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    /** The selection box, its stem and handles, on the chrome layer the export leaves out. */
    function paintSelection(ctx, mark, b, unit, color, fill) {
      const c = centerOf(b)
      const pad = 6 * unit
      ctx.save()
      ctx.strokeStyle = color
      ctx.fillStyle = fill
      ctx.lineWidth = unit
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(mark.angle ?? 0)
      ctx.translate(-c.x, -c.y)
      ctx.strokeRect(b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad)
      ctx.beginPath()
      ctx.moveTo(c.x, b.y - pad)
      ctx.lineTo(c.x, b.y - pad - 17 * unit)
      ctx.stroke()
      ctx.restore()
      for (const handle of handlesOf(mark, b, unit)) {
        ctx.beginPath()
        if (handle.id === 'rotate') ctx.arc(handle.x, handle.y, 5 * unit, 0, 2 * Math.PI)
        else ctx.rect(handle.x - 4 * unit, handle.y - 4 * unit, 8 * unit, 8 * unit)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }

    function IconButton({ label, icon, keys, ...props }) {
      return h(Tooltip, { label, side: 'bottom', delayMs: 300, portal: true, shortcutKeys: keys },
        h(Button, { type: 'button', size: 'sm', style: square, 'aria-label': label, ...props }, h(icon, { size: 16, 'aria-hidden': true })))
    }

    function editable(target) {
      return target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null
    }

    /**
     * Marks stay separate layers over the untouched screenshot until export: each can be selected, moved,
     * resized, turned or deleted, and every edit replaces the list whole, so undo and redo restore it exactly.
     */
    function Drawing({ bitmap, t, note, setNote, close, commit, error }) {
      const [tool, setTool] = useState('pen')
      // The text being typed in place: where it sits in screenshot pixels and, when it edits a mark, that mark's id.
      const [editing, setEditing] = useState()
      const editingRef = useRef()
      editingRef.current = editing
      const [, render] = useReducer(n => n + 1, 0)
      const [cursor, setCursor] = useState('default')
      const [pending, setPending] = useState(false)
      const [encodeError, setEncodeError] = useState(false)
      const base = useRef(null)
      const inkLayer = useRef(null)
      const chrome = useRef(null)
      const doc = useRef({ marks: [], past: [], future: [], selected: undefined, serial: 0 })
      const gesture = useRef(null)
      const brush = useRef()
      const showBase = useCallback((canvas) => {
        base.current = canvas
        if (!canvas) return
        const theme = getComputedStyle(canvas)
        const token = name => theme.getPropertyValue(name).trim()
        brush.current = { color: token('--dsw-alias-brand-primary'), font: theme.fontFamily,
          select: token('--dsw-alias-state-business-primary'), fill: token('--dsw-alias-bg-overlay') }
        canvas.getContext('2d').drawImage(bitmap, 0, 0)
      }, [bitmap])
      const measure = (mark) => {
        const ctx = inkLayer.current.getContext('2d')
        ctx.save()
        ctx.font = `500 ${fontSize(mark, mark.scale)}px ${brush.current.font}`
        const width = ctx.measureText(mark.text).width
        ctx.restore()
        return width
      }
      const paint = () => {
        const { color, font, select, fill } = brush.current
        const { marks, selected } = doc.current
        const ink = inkLayer.current.getContext('2d')
        ink.clearRect(0, 0, bitmap.width, bitmap.height)
        const live = gesture.current?.kind === 'draw' ? [...marks, gesture.current.mark] : marks
        // The mark being retyped shows only in its field, never twice.
        const hidden = editingRef.current?.id
        for (const mark of live) {
          if (mark.id !== hidden) paintMark(ink, mark, mark.scale, color, font, mark.angle ? centerOf(markBounds(mark, measure)) : undefined)
        }
        const top = chrome.current.getContext('2d')
        top.clearRect(0, 0, bitmap.width, bitmap.height)
        const current = marks.find(mark => mark.id === selected)
        if (current) {
          const unit = bitmap.width / chrome.current.getBoundingClientRect().width
          paintSelection(top, current, markBounds(current, measure), unit, select, fill)
        }
      }
      const update = (changes) => {
        Object.assign(doc.current, changes)
        paint()
        render()
      }
      const keep = id => (doc.current.marks.some(mark => mark.id === id) ? id : undefined)
      /** Keep the list an edit replaced, so undo can return to it; a new edit drops what undo had set aside. */
      const record = (before) => {
        if (before === doc.current.marks) return
        doc.current.past.push(before)
        doc.current.future = []
      }
      /** Step one edit through history: undo moves from `past` to `future`, redo back. */
      const step = (from, to) => {
        if (from.length === 0 || gesture.current) return
        to.push(doc.current.marks)
        doc.current.marks = from.pop()
        update({ selected: keep(doc.current.selected) })
      }
      const undo = () => { step(doc.current.past, doc.current.future) }
      const redo = () => { step(doc.current.future, doc.current.past) }
      const remove = (id) => {
        const before = doc.current.marks
        doc.current.marks = before.filter(mark => mark.id !== id)
        record(before)
        update({ selected: undefined })
      }
      const pickTool = (name) => {
        setTool(name)
        if (name !== 'select') update({ selected: undefined })
      }
      const point = (event) => {
        const canvas = event.currentTarget
        const box = canvas.getBoundingClientRect()
        const scale = canvas.width / box.width
        return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale, scale }
      }
      const hitMark = p => doc.current.marks.findLast((mark) => {
        const b = markBounds(mark, measure)
        return within(b, turn(p, centerOf(b), -(mark.angle ?? 0)), 4 * p.scale)
      })
      const handleAt = (p) => {
        const current = doc.current.marks.find(mark => mark.id === doc.current.selected)
        return current && handlesOf(current, markBounds(current, measure), p.scale)
          .find(handle => Math.hypot(handle.x - p.x, handle.y - p.y) <= 8 * p.scale)
      }
      const cursorAt = (p) => {
        const handle = handleAt(p)
        if (handle) return handle.id === 'rotate' ? 'grab' : handle.id % 2 === 0 ? 'nwse-resize' : 'nesw-resize'
        return hitMark(p) ? 'move' : 'default'
      }
      const erase = (p) => {
        const marks = doc.current.marks.filter(mark => !touches(mark, markBounds(mark, measure), p, 8 * p.scale))
        if (marks.length !== doc.current.marks.length) update({ marks })
      }
      const down = (event) => {
        if (event.button !== 0 || pending || gesture.current) return
        const p = point(event)
        const before = doc.current.marks
        if (tool === 'text') {
          // A click while a field is open places that text; the next click starts another.
          if (editingRef.current) { finishText(true); return }
          const hit = hitMark(p)
          const mark = hit?.tool === 'text' ? hit : undefined
          const next = mark
            ? { x: mark.points[0].x, y: mark.points[0].y, scale: mark.scale, size: fontSize(mark, mark.scale), value: mark.text, id: mark.id }
            : { x: p.x, y: p.y, scale: p.scale, size: 16 * p.scale, value: '' }
          editingRef.current = next
          setEditing(next)
          update({ selected: undefined })
          event.preventDefault()
          return
        }
        const start = { pointer: event.pointerId, before, origin: p }
        if (tool === 'select') {
          const handle = handleAt(p)
          const current = before.find(mark => mark.id === doc.current.selected)
          if (handle) {
            gesture.current = { ...start, kind: handle.id === 'rotate' ? 'rotate' : 'resize', corner: handle.id, mark: current,
              bounds: markBounds(current, measure) }
          } else {
            const hit = hitMark(p)
            if (hit) gesture.current = { ...start, kind: 'move', mark: hit }
            update({ selected: hit?.id })
          }
        } else if (tool === 'eraser') {
          gesture.current = { ...start, kind: 'erase' }
          erase(p)
        } else {
          gesture.current = { ...start, kind: 'draw', mark: { id: ++doc.current.serial, tool, points: [p], scale: p.scale } }
          paint()
        }
        if (gesture.current) event.currentTarget.setPointerCapture(event.pointerId)
      }
      const apply = (active, p, snap) => {
        if (active.kind === 'draw') {
          if (active.mark.tool === 'pen') active.mark.points.push(p)
          else active.mark.points[1] = p
          paint()
          return
        }
        if (active.kind === 'erase') { erase(p); return }
        const { mark } = active
        let next
        if (active.kind === 'move') {
          const dx = p.x - active.origin.x
          const dy = p.y - active.origin.y
          next = { ...mark, points: mark.points.map(q => ({ x: q.x + dx, y: q.y + dy })) }
        } else if (active.kind === 'rotate') {
          const c = centerOf(active.bounds)
          const angle = Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2
          // Shift turns in 15-degree steps.
          next = { ...mark, angle: snap ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle }
        } else {
          next = resized(mark, active.bounds, active.corner, p, measure)
        }
        update({ marks: active.before.map(item => (item.id === mark.id ? next : item)) })
      }
      const move = (event) => {
        const active = gesture.current
        if (!active) {
          if (tool === 'select') setCursor(cursorAt(point(event)))
          return
        }
        if (active.pointer === event.pointerId) apply(active, point(event), event.shiftKey)
      }
      const end = (event, keep) => {
        const active = gesture.current
        if (!active || active.pointer !== event.pointerId) return
        if (keep) apply(active, point(event), event.shiftKey)
        gesture.current = null
        if (!keep) { update({ marks: active.before }); return }
        if (active.kind === 'draw') {
          const { mark } = active
          const b = markBounds(mark, measure)
          // A click without a drag leaves no shape; a pen click leaves a dot.
          if (mark.tool !== 'pen' && Math.hypot(b.width, b.height) < 2 * mark.scale) { paint(); return }
          doc.current.marks = [...active.before, mark]
        }
        record(active.before)
        update({})
      }
      /** Close the in-place field: keep places or rewrites its text (empty text removes an edited mark), otherwise it is dropped. */
      const finishText = (keep) => {
        const current = editingRef.current
        if (!current) return
        editingRef.current = undefined
        setEditing(undefined)
        const value = current.value.trim()
        const before = doc.current.marks
        if (keep && current.id !== undefined) {
          doc.current.marks = value
            ? before.map(mark => (mark.id === current.id ? { ...mark, text: value } : mark))
            : before.filter(mark => mark.id !== current.id)
        } else if (keep && value) {
          doc.current.marks = [...before, { id: ++doc.current.serial, tool: 'text', text: value,
            points: [{ x: current.x, y: current.y }], scale: current.scale }]
        }
        record(before)
        update({})
      }
      useEffect(() => {
        const key = (event) => {
          if (event.defaultPrevented || editable(event.target)) return
          const primary = event.metaKey || event.ctrlKey
          const letter = event.key.toLowerCase()
          if (primary && letter === 'z') {
            event.preventDefault()
            if (event.shiftKey) redo()
            else undo()
          } else if (primary && letter === 'y') {
            event.preventDefault()
            redo()
          } else if ((event.key === 'Delete' || event.key === 'Backspace') && doc.current.selected !== undefined) {
            event.preventDefault()
            remove(doc.current.selected)
          } else {
            const name = toolForKey(event)
            if (name === undefined) return
            event.preventDefault()
            pickTool(name)
          }
        }
        document.addEventListener('keydown', key)
        return () => { document.removeEventListener('keydown', key) }
      })
      const { marks, past, future, selected } = doc.current
      const mac = /Mac|iP(?:hone|ad)/u.test(navigator.platform)
      const save = async () => {
        if (marks.length === 0 || pending) return
        setPending(true)
        setEncodeError(false)
        try {
          const output = makeImageCanvas(bitmap.width, bitmap.height)
          const context = output.getContext('2d')
          context.drawImage(base.current, 0, 0)
          context.drawImage(inkLayer.current, 0, 0)
          const png = await toBlob(output)
          commit(note.trim(), png)
        } catch (_error) {
          setEncodeError(true)
        } finally { setPending(false) }
      }
      const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%' }
      return h(ActionDialog, { title: t('draw'), t, close, wide: true },
        h('div', { style: { ...tools, justifyContent: 'space-between' } },
          h('div', { role: 'group', 'aria-label': t('tools'), style: segment },
            DRAW_TOOLS.map(name => h(IconButton, { key: name, label: t(name), icon: TOOL_ICONS[name], keys: [TOOL_KEYS[name][0].toUpperCase()],
              variant: tool === name ? 'toolbar' : 'ghost', 'aria-pressed': tool === name, 'aria-keyshortcuts': TOOL_KEYS[name].join(' '),
              onClick: () => pickTool(name) }))),
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '2px' } },
            h(IconButton, { label: t('undo'), icon: IconUndoOutlineRegular, keys: mac ? ['⌘', 'Z'] : ['Ctrl', 'Z'],
              disabled: past.length === 0 || pending, onClick: undo }),
            h(IconButton, { label: t('redo'), icon: IconRedoOutlineRegular, keys: mac ? ['⇧', '⌘', 'Z'] : ['Ctrl', 'Y'],
              disabled: future.length === 0 || pending, onClick: redo }),
            h(IconButton, { label: t('deleteMark'), icon: IconTrashOutlineRegular, keys: ['⌫'],
              disabled: selected === undefined || pending, onClick: () => remove(selected) }))),
        // Explicit width and height (not aspect-ratio over a percentage) so the grid row holds the whole canvas.
        h('div', { style: stage },
          h('div', { style: { ...frameStyle, ...fitted(bitmap) } },
            h('canvas', { ref: showBase, width: bitmap.width, height: bitmap.height, style: { display: 'block', width: '100%', height: '100%' } }),
            h('canvas', { ref: inkLayer, width: bitmap.width, height: bitmap.height, 'aria-hidden': true, style: { ...layer, pointerEvents: 'none' } }),
            h('canvas', { ref: chrome, width: bitmap.width, height: bitmap.height, role: 'img', 'aria-label': t('canvas'),
              style: { ...layer, touchAction: 'none', cursor: tool === 'select' ? cursor : tool === 'text' ? 'text' : 'crosshair' },
              onPointerDown: down, onPointerMove: move, onPointerUp: event => end(event, true), onPointerCancel: event => end(event, false),
              // The click that opens a text field must not move focus off it again.
              onMouseDown: (event) => { if (tool === 'text') event.preventDefault() },
              onLostPointerCapture: event => end(event, false) }),
            // Text is typed where it lands, in the ink's own font and size, so the field is the mark until it is placed.
            editing && h('input', { key: `${editing.id ?? 'new'}:${editing.x}:${editing.y}`, autoFocus: true, value: editing.value,
              'aria-label': t('text'), placeholder: t('textHint'), spellCheck: false,
              onChange: (event) => { const value = event.target.value; setEditing(current => current && { ...current, value }) },
              onBlur: () => { finishText(true) },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finishText(true) }
                else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishText(false) }
              },
              style: { position: 'absolute', left: `${editing.x / editing.scale}px`, top: `${editing.y / editing.scale}px`,
                // Empty, the field fits its hint; typed, it fits the words.
                width: `${(editing.value === '' ? t('textHint').length : editing.value.length) + 1}ch`, maxWidth: `calc(100% - ${editing.x / editing.scale}px)`,
                boxSizing: 'content-box', margin: 0, padding: 0, border: 0, outline: `1px dashed ${brush.current?.select ?? HIGHLIGHT}`,
                outlineOffset: '2px', background: 'transparent', color: brush.current?.color, fontFamily: brush.current?.font,
                // Line height 1 puts the em box's top where the canvas paints with a top baseline, so placing does not jump.
                fontWeight: 500, fontSize: `${editing.size / editing.scale}px`, lineHeight: 1 } }))),
        h(Notes, { t, value: note, change: setNote, close, submit: save }),
        (error || encodeError) && h(Status, { t, message: error || 'encodeError', error: true }),
        h('div', { style: { ...tools, justifyContent: 'end', gap: '8px' } },
          h(Button, { type: 'button', size: 'sm', onClick: close }, t('cancel')),
          h(Button, { type: 'button', size: 'sm', variant: 'primary', disabled: marks.length === 0 || pending, onClick: save }, t('add'))))
    }

    function Overlay({ mode, surface, image, captureRegion, requestDisplay, startDisplayCapture, getSurface, signal, close, t, save,
      elementName, setGrab, grabKeys }) {
      const opaque = documentOf(surface) === null && !probed(surface)
      const [view, setView] = useState(mode === 'draw' || mode === 'attach' ? 'capture' : opaque ? 'opaque' : 'pick')
      const [note, setNote] = useState('')
      const [bitmap, setBitmap] = useState()
      const [error, setError] = useState()
      const [selected, setSelected] = useState()
      const [preview, setPreview] = useState()
      const selection = useRef()
      const picker = useRef(null)
      const point = useRef()
      // A probed page answers asynchronously; only the latest hover may paint.
      const hover = useRef(0)
      const currentView = useRef(view)
      currentView.current = view
      const previousFocus = useRef(document.activeElement)
      const busy = useRef(false)
      const stillCurrent = () => !signal.aborted && surface.isConnected && getSurface() === surface
      const commit = (text, png, fileName = 'annotated-screenshot.png', contexts) => {
        if (!stillCurrent()) return false
        try {
          const result = save(text, png && new File([png], fileName, { type: 'image/png' }), contexts)
          if (result === 'added') { close(); return true }
          setError(result === 'blocked' ? 'composerBlocked' : 'composerUnavailable')
        } catch (_error) { setError('composerError') }
        return false
      }
      const runCapture = async (kind, request, chosen, context) => {
        if (busy.current) return
        busy.current = true
        setError(undefined)
        setView(kind === 'grab' || kind === 'pick' ? 'grabbing' : 'capture')
        if (picker.current) picker.current.style.visibility = 'hidden'
        try {
          // No interaction chrome may appear in the pixels being copied.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          if (!stillCurrent() || (chosen && !chosen.live())) return
          const png = await capture({ surface, bounds: chosen?.crop ?? visibleBounds(surface), captureRegion, request, signal,
            forceCrop: !image || ((kind === 'grab' || kind === 'pick') && !chosen.whole) })
          if (!stillCurrent()) return
          if (kind === 'grab') {
            setSelected({ context, png })
            setView('grabbed')
          } else if (kind === 'pick') {
            setSelected({ ...chosen.describe(), png })
            setView('note')
          } else if (kind === 'attach') {
            // The whole tab goes to the chat as it looks; nothing to choose or mark up first.
            if (!commit('', png, 'screenshot.png')) setView('attach-error')
          } else {
            const image = await createImageBitmap(png)
            if (!stillCurrent()) { image.close(); return }
            setBitmap(image)
            setView('draw')
          }
        } catch (_error) {
          if (signal.aborted) return
          // A pick still works without its picture: the note and element go to the chat on their own.
          if (kind === 'pick') { setSelected(chosen.describe()); setView('note'); return }
          setError('captureError'); setView(kind === 'draw' ? 'draw-error' : `${kind}-error`)
        } finally { busy.current = false }
      }
      const draw = (request) => { void runCapture('draw', request) }
      const pickNeedsShare = !captureRegion && !image
      const requestDraw = () => draw(pickNeedsShare ? startDisplayCapture() : undefined)
      const attach = (request) => { void runCapture('attach', request) }
      const requestAttach = () => attach(pickNeedsShare ? startDisplayCapture() : undefined)
      const grab = (chosen = selection.current) => {
        if (!chosen || !stillCurrent()) return false
        selection.current = chosen
        const { context } = captureContext(chosen, '', elementName)
        void runCapture('grab', pickNeedsShare ? startDisplayCapture() : undefined, chosen, context)
        return true
      }
      const invokeGrab = useRef(grab)
      invokeGrab.current = grab
      useEffect(() => {
        if (mode === 'draw') draw(requestDisplay)
        if (mode === 'attach') attach(requestDisplay)
        // The launcher provides an already user-activated share request for the first capture.
      }, [])
      useEffect(() => () => bitmap?.close(), [bitmap])
      useEffect(() => {
        if ((view !== 'grabbed' && view !== 'note') || !selected?.png) return undefined
        const url = URL.createObjectURL(selected.png)
        setPreview(url)
        return () => { URL.revokeObjectURL(url); setPreview(undefined) }
      }, [view, selected])
      useEffect(() => {
        const focus = previousFocus.current
        // Cancel returns to the opener; a successful add leaves the keyboard in the composer, where the context went.
        return () => { if (focus?.isConnected && !document.activeElement?.closest('[role="dialog"], [contenteditable="true"]')) focus.focus({ preventScroll: true }) }
      }, [])
      useEffect(() => {
        if (view !== 'pick') return undefined
        picker.current?.focus({ preventScroll: true })
        return setGrab(() => currentView.current === 'pick' && invokeGrab.current())
      }, [setGrab, view])
      useEffect(() => {
        const check = () => { if (!stillCurrent()) close() }
        const observer = new MutationObserver(check)
        observer.observe(surface.parentNode ?? document.body, { childList: true })
        surface.addEventListener('load', check)
        return () => { surface.removeEventListener('load', check); observer.disconnect() }
      }, [surface])
      if (view === 'draw') return h(Drawing, { bitmap, t, note, setNote, close, commit, error })
      if (view === 'capture' || view === 'grabbing') return null
      if (view === 'pick') {
        const border = point.current?.crop
        return createPortal(h('div', { ref: picker, tabIndex: -1, 'aria-label': t(mode === 'grab' ? 'grab' : 'pick'),
          style: { ...overlayStyle, cursor: 'crosshair', outline: 'none' },
          onKeyDown: (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } },
          onPointerMove: (event) => {
            const ticket = ++hover.current
            void hitAt(surface, event.clientX, event.clientY, picker.current).then((hovered) => {
              if (ticket !== hover.current || currentView.current !== 'pick') return
              point.current = hovered
              selection.current = hovered
              setSelected(hovered)
            })
          },
          onClick: (event) => {
            void hitAt(surface, event.clientX, event.clientY, picker.current).then((chosen) => {
              if (!chosen || currentView.current !== 'pick' || !stillCurrent()) return
              selection.current = chosen
              if (mode === 'grab') grab(chosen)
              else if (pickNeedsShare) { setSelected(chosen.describe()); setView('note') }
              // Picture the element too, so the agent sees what the note is about; no share prompt is raised for it.
              else void runCapture('pick', undefined, chosen)
            })
          } },
        border && h('div', { 'aria-hidden': true, style: { position: 'fixed', pointerEvents: 'none', outline: `2px solid ${HIGHLIGHT}`,
          background: `color-mix(in srgb, ${HIGHLIGHT} 13%, transparent)`, left: border.x, top: border.y, width: border.width, height: border.height } }),
        h('div', { style: { ...tools, position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 32px)', padding: '8px 10px', borderRadius: '12px',
          background: 'var(--dsw-alias-bg-overlay)', boxShadow: elevation, cursor: 'default' },
          onPointerMove: event => event.stopPropagation(), onClick: event => event.stopPropagation() },
        h('p', { style: ink }, t(mode === 'grab' ? 'grabHint' : 'pickHint', { keys: grabKeys.join(' ') })),
        h(Button, { type: 'button', size: 'sm', onClick: close }, t('cancel')))), document.body)
      }
      const title = view === 'note' || (view === 'opaque' && mode === 'pick') ? 'pick'
        : view === 'grabbed' || view === 'grab-error' || (view === 'opaque' && mode === 'grab') ? 'grab'
          : view === 'attach-error' ? 'attach' : 'draw'
      const commitSelection = () => {
        const trimmedNote = note.trim()
        if (view === 'note') {
          if (!trimmedNote) return
          const { note: text, context } = captureContext(selection.current, trimmedNote, elementName)
          commit(text, selected.png, 'selected-element.png', [context])
        } else {
          commit(trimmedNote, selected.png, 'selected-element.png', [selected.context])
        }
      }
      const retry = { 'grab-error': () => grab(), 'draw-error': requestDraw, 'attach-error': requestAttach }[view]
      return h(ActionDialog, { title: t(title), t, close },
        view === 'opaque' && h(Status, { t, message: 'opaque', fallback: requestDraw }),
        retry && h(Status, { t, message: error ?? 'captureError', error: true, retry }),
        (view === 'grabbed' || view === 'note') && preview && h('img', { src: preview, alt: t('context'), style: { display: 'block', maxWidth: '100%',
          maxHeight: 'min(32dvh, 280px)', margin: '0 auto', objectFit: 'contain', borderRadius: '12px',
          border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)' } }),
        view === 'note' && h(ElementChip, { t, selector: selected.selector }),
        (view === 'note' || view === 'grabbed') && h(Notes, { t, value: note, change: setNote, close, submit: commitSelection }),
        view === 'grabbed' && h('details', null, h('summary', null, t('details')),
          h('pre', { style: { ...muted, fontSize: '12px', fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)',
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '160px', overflow: 'auto', marginTop: '6px' } }, selected.context.text)),
        (view === 'note' || view === 'grabbed') && error && h(Status, { t, message: error, error: true }),
        (view === 'note' || view === 'grabbed') && h('div', { style: { ...tools, gap: '8px' } },
          view === 'note' && h(Button, { type: 'button', size: 'sm', onClick: () => grab() }, t('grab')),
          h('span', { style: { flex: 1 } }),
          h(Button, { type: 'button', size: 'sm', onClick: close }, t('cancel')),
          h(Button, { type: 'button', size: 'sm', variant: 'primary', disabled: view === 'note' && !note.trim(),
            onClick: commitSelection }, t('add'))))
    }

    return { Overlay, captureContext, paintMark, resized, markBounds, touches, toolForKey }
  },
})
