window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  chunk: 'client.overlay.js',
  factory(require) {
    const { createElement: h, useCallback, useEffect, useRef, useState } = require('react')
    const { createPortal } = require('react-dom')
    const { Button, InlineEditor, Input, Modal } = require('@janhq/jan-client-ui-primitives')
    const shell = { display: 'grid', gap: '12px', padding: '16px', boxSizing: 'border-box', minHeight: 0, overflow: 'auto' }
    const tools = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }
    const textStyle = { fontSize: '13px', lineHeight: '18px', letterSpacing: '-0.13px', margin: 0 }
    const muted = { ...textStyle, color: 'var(--dsw-alias-label-secondary)' }
    const ink = { ...textStyle, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }
    const titleStyle = { fontSize: '16px', lineHeight: '24px', letterSpacing: '-0.32px', fontWeight: 500,
      color: 'var(--dsw-alias-label-primary)', margin: 0 }
    const frameStyle = { position: 'relative', maxHeight: 'min(53dvh, 620px)', maxWidth: '100%', overflow: 'hidden', margin: 'auto', borderRadius: '12px' }
    const HIGHLIGHT = 'var(--dsw-alias-state-business-primary)'
    const elevation = '0 1px 2px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 8%, transparent), '
      + '0 6px 16px -4px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 12%, transparent)'
    const overlayStyle = { position: 'fixed', inset: 0, zIndex: 90 }
    const toolsWithDrag = ['pen', 'rectangle', 'ellipse', 'arrow', 'eraser']
    const dialogStyle = document.createElement('style')
    dialogStyle.textContent = '.jan-annotation-dialog[role="dialog"]{width:min(880px,100%);max-height:100%;padding:0;border-radius:24px;'
      + 'background:var(--dsw-alias-bg-overlay);box-shadow:' + elevation + '}'
      + '.jan-annotation-dialog .jan-annotation-note{min-height:52px;padding:8px;border-radius:12px;border-color:var(--dsw-alias-border-l2);'
      + 'font:inherit;letter-spacing:inherit;background:var(--dsw-alias-bg-base)}'
      + '.jan-annotation-dialog .jan-annotation-note:focus{border-color:var(--dsw-alias-state-business-primary)}'
    document.head.append(dialogStyle)

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

    /** Describe only the chosen element and keep the composer excerpt bounded. */
    function elementDetails(element, bounds) {
      const document = element.ownerDocument
      const parts = []
      for (let node = element; node; node = node.parentElement) {
        const id = node.id
        const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : /^[\w-]+$/u.test(id) ? id : ''
        if (escaped && document.querySelectorAll(`#${escaped}`).length === 1) {
          parts.unshift(`#${escaped}`)
          break
        }
        const name = node.localName
        const siblings = node.parentElement?.children
        if (!siblings) { parts.unshift(name); break }
        let index = 0
        let count = 0
        for (const sibling of siblings) {
          if (sibling.localName !== name) continue
          count++
          if (sibling === node) index = count
        }
        parts.unshift(count > 1 ? `${name}:nth-of-type(${index})` : name)
      }
      const html = element.outerHTML
      return { selector: parts.join(' > '), html: html.length <= 2400 ? html : `${html.slice(0, 2400)}…`, bounds }
    }

    function documentOf(surface) {
      return surface.localName === 'webview' ? null
        : surface.localName === 'iframe' ? surface.contentDocument : surface.ownerDocument
    }

    function hitAt(surface, x, y, layer) {
      const source = documentOf(surface)
      if (source === null) return null
      const framed = source !== document
      const parent = boundsOf(surface)
      const offsetX = framed ? parent.x + surface.clientLeft : 0
      const offsetY = framed ? parent.y + surface.clientTop : 0
      layer.style.pointerEvents = 'none'
      const hit = source.elementFromPoint(x - offsetX, y - offsetY)
      layer.style.removeProperty('pointer-events')
      if (!hit || (!framed && !surface.contains(hit))) return null
      const surfaceBounds = visibleBounds(surface)
      const crop = surfaceBounds && intersection(boundsOf(hit, offsetX, offsetY), surfaceBounds)
      return crop && { hit, crop, bounds: boundsOf(hit), source }
    }

    function captureContext(selection, note, t) {
      const { hit, bounds, source } = selection
      const detail = elementDetails(hit, bounds)
      const number = value => Math.round(value * 10) / 10
      const sourceUrl = new URL(source.URL)
      sourceUrl.username = sourceUrl.password = sourceUrl.search = sourceUrl.hash = ''
      const page = source !== document && /^(https?):$/u.test(sourceUrl.protocol) ? `${t('page')}: ${sourceUrl.href}\n` : ''
      return `${note ? `${note}\n\n` : ''}${t('context')}\n${page}${t('selector')}: ${detail.selector}\n${t('bounds')}: ${JSON.stringify(Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, number(value)])))}\n${t('html')}:\n${detail.html}`
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
      return h('label', { style: { ...ink, display: 'grid', gap: '4px' } }, t('note'),
        h(InlineEditor, { className: 'jan-annotation-note', label: t('note'), value, onChange: change, onSave: submit, onCancel: close }))
    }

    function ActionDialog({ t, title, close, children }) {
      return h(Modal, { open: true, title, onClose: close, headless: true,
        shortcutModal: 'jan-annotate', backdropBlur: false, className: 'jan-annotation-dialog' },
      h('div', { style: shell }, children))
    }

    function Status({ t, message, error, retry, fallback }) {
      return h('div', { style: { display: 'grid', gap: '8px' } },
        h('p', { role: error ? 'alert' : 'status', style: error ? { ...muted, color: 'var(--dsw-alias-state-error-primary)' } : muted }, t(message)),
        (retry || fallback) && h('div', { style: tools },
          retry && h(Button, { type: 'button', size: 'sm', variant: 'primary', onClick: retry, 'data-modal-autofocus': true }, t('retry')),
          fallback && h(Button, { type: 'button', size: 'sm', onClick: fallback }, t('draw'))))
    }

    /** Paint one history operation onto the transparent ink layer, never onto the source image. */
    function paintMark(ctx, { tool, points, text }, scale, inkColor, fontFamily) {
      const first = points[0]
      const end = points.at(-1)
      ctx.save()
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      ctx.strokeStyle = ctx.fillStyle = inkColor
      ctx.lineWidth = (tool === 'eraser' ? 18 : 3) * scale
      ctx.lineCap = ctx.lineJoin = 'round'
      if (tool === 'text') {
        ctx.font = `500 ${16 * scale}px ${fontFamily}`
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
            const angle = Math.atan2(end.y - first.y, end.x - first.x)
            const head = Math.min(Math.hypot(end.y - first.y, end.x - first.x), 14 * scale)
            ctx.lineTo(end.x, end.y)
            ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
            ctx.moveTo(end.x, end.y)
            ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
          } else {
            if (points.length === 1) ctx.lineTo(first.x + .01, first.y)
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
          }
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    function Drawing({ bitmap, t, note, setNote, close, commit, error }) {
      const [tool, setTool] = useState('pen')
      const [text, setText] = useState('')
      const [count, setCount] = useState(0)
      const [pending, setPending] = useState(false)
      const [encodeError, setEncodeError] = useState(false)
      const base = useRef(null)
      const inkLayer = useRef(null)
      const history = useRef([])
      const stroke = useRef(null)
      const brush = useRef()
      const showBase = useCallback((canvas) => {
        base.current = canvas
        if (!canvas) return
        const theme = getComputedStyle(canvas)
        brush.current = { color: theme.getPropertyValue('--dsw-alias-brand-primary').trim(), font: theme.fontFamily }
        canvas.getContext('2d').drawImage(bitmap, 0, 0)
      }, [bitmap])
      const point = (event) => {
        const canvas = event.currentTarget
        const box = canvas.getBoundingClientRect()
        const scale = canvas.width / box.width
        return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale, scale }
      }
      const paint = (active) => {
        const canvas = inkLayer.current
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const { color, font } = brush.current
        for (const mark of history.current) paintMark(ctx, mark, mark.scale, color, font)
        if (active) paintMark(ctx, active, active.scale, color, font)
      }
      const retain = (mark) => {
        history.current.push(mark)
        setCount(history.current.length)
      }
      const down = (event) => {
        if (event.button !== 0 || pending || stroke.current) return
        const origin = point(event)
        if (tool === 'text') {
          if (!text.trim()) return
          const mark = { tool, text: text.trim(), points: [origin], scale: origin.scale }
          retain(mark)
          paint()
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        stroke.current = { tool, points: [origin], scale: origin.scale, pointer: event.pointerId }
        paint(stroke.current)
      }
      const move = (event) => {
        const active = stroke.current
        if (!active || active.pointer !== event.pointerId) return
        const next = point(event)
        if (active.tool === 'pen' || active.tool === 'eraser') active.points.push(next)
        else active.points[1] = next
        paint(active)
      }
      const end = (event, keep) => {
        const active = stroke.current
        if (!active || active.pointer !== event.pointerId) return
        if (keep) {
          const next = point(event)
          if (active.tool === 'pen' || active.tool === 'eraser') active.points.push(next)
          else active.points[1] = next
          retain(active)
        }
        stroke.current = null
        paint()
      }
      const undo = () => { history.current.pop(); setCount(history.current.length); paint() }
      const save = async () => {
        if (count === 0 || pending) return
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
      return h(ActionDialog, { title: t('draw'), t, close },
        h('div', { style: { ...tools, justifyContent: 'space-between' } }, h('h2', { style: titleStyle }, t('draw')),
          h(Button, { type: 'button', size: 'sm', onClick: close }, t('cancel'))),
        h('div', { role: 'group', 'aria-label': t('tools'), style: tools },
          [...toolsWithDrag, 'text'].map(name => h(Button, { key: name, type: 'button', size: 'sm',
            variant: tool === name ? 'outline' : 'ghost', 'aria-pressed': tool === name,
            onClick: () => setTool(name) }, t(name))),
          h(Button, { type: 'button', size: 'sm', disabled: count === 0 || pending, onClick: undo }, t('undo'))),
        tool === 'text' && h(Input, { placeholder: t('textHint'), 'aria-label': t('textHint'), value: text,
          onChange: event => setText(event.target.value) }),
        h('div', { style: { ...frameStyle, aspectRatio: `${bitmap.width} / ${bitmap.height}`,
          width: `min(100%, ${bitmap.width}px, calc(min(53dvh, 620px) * ${bitmap.width / bitmap.height}))` } },
        h('canvas', { ref: showBase, width: bitmap.width, height: bitmap.height, style: { display: 'block', width: '100%' } }),
        h('canvas', { ref: inkLayer, width: bitmap.width, height: bitmap.height, role: 'img', 'aria-label': t('canvas'),
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: tool === 'text' ? 'text' : 'crosshair', touchAction: 'none' },
          onPointerDown: down, onPointerMove: move, onPointerUp: event => end(event, true), onPointerCancel: event => end(event, false),
          onLostPointerCapture: event => end(event, false) })),
        h(Notes, { t, value: note, change: setNote, close, submit: save }),
        (error || encodeError) && h(Status, { t, message: error || 'encodeError', error: true }),
        h('div', { style: { ...tools, justifyContent: 'end' } },
          h(Button, { type: 'button', size: 'sm', variant: 'primary', disabled: count === 0 || pending, onClick: save }, t('add'))))
    }

    function Overlay({ mode, surface, image, captureRegion, requestDisplay, startDisplayCapture, getSurface, signal, close, t, save, setGrab, grabKeys }) {
      const opaque = documentOf(surface) === null
      const [view, setView] = useState(mode === 'draw' ? 'capture' : opaque ? 'opaque' : 'pick')
      const [note, setNote] = useState('')
      const [bitmap, setBitmap] = useState()
      const [error, setError] = useState()
      const [selected, setSelected] = useState()
      const selection = useRef()
      const picker = useRef(null)
      const point = useRef()
      const currentView = useRef(view)
      currentView.current = view
      const previousFocus = useRef(document.activeElement)
      const busy = useRef(false)
      const stillCurrent = () => !signal.aborted && surface.isConnected && getSurface() === surface
      const commit = (text, png, fileName = 'annotated-screenshot.png') => {
        if (!stillCurrent()) return
        try {
          const result = save(text, png && new File([png], fileName, { type: 'image/png' }))
          if (result === 'added') { close(); return }
          setError(result === 'blocked' ? 'composerBlocked' : 'composerUnavailable')
        } catch (_error) { setError('composerError') }
      }
      const runCapture = async (kind, request, chosen, text) => {
        if (busy.current) return
        busy.current = true
        setError(undefined)
        setView(kind === 'grab' ? 'grabbing' : 'capture')
        if (picker.current) picker.current.style.visibility = 'hidden'
        try {
          // No interaction chrome may appear in the pixels being copied.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          if (!stillCurrent() || (chosen && !chosen.hit.isConnected)) return
          const png = await capture({ surface, bounds: chosen?.crop ?? visibleBounds(surface), captureRegion, request, signal,
            forceCrop: !image || (kind === 'grab' && chosen.hit !== surface) })
          if (!stillCurrent()) return
          if (kind === 'grab') {
            setSelected({ text, png })
            setView('grabbed')
          } else {
            const image = await createImageBitmap(png)
            if (!stillCurrent()) { image.close(); return }
            setBitmap(image)
            setView('draw')
          }
        } catch (_error) {
          if (!signal.aborted) { setError('captureError'); setView(kind === 'grab' ? 'grab-error' : 'draw-error') }
        } finally { busy.current = false }
      }
      const draw = (request) => { void runCapture('draw', request) }
      const pickNeedsShare = !captureRegion && !image
      const requestDraw = () => draw(pickNeedsShare ? startDisplayCapture() : undefined)
      const grab = (chosen = selection.current) => {
        if (!chosen || !stillCurrent()) return false
        selection.current = chosen
        const text = captureContext(chosen, '', t)
        void runCapture('grab', pickNeedsShare ? startDisplayCapture() : undefined, chosen, text)
        return true
      }
      const invokeGrab = useRef(grab)
      invokeGrab.current = grab
      useEffect(() => {
        if (mode === 'draw') draw(requestDisplay)
        // The launcher provides an already user-activated share request for the first capture.
      }, [])
      useEffect(() => () => bitmap?.close(), [bitmap])
      useEffect(() => {
        const focus = previousFocus.current
        return () => { if (focus?.isConnected && !document.activeElement?.closest('[role="dialog"]')) focus.focus({ preventScroll: true }) }
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
            const hovered = hitAt(surface, event.clientX, event.clientY, picker.current)
            point.current = hovered
            selection.current = hovered
            setSelected(hovered)
          },
          onClick: (event) => {
            const chosen = hitAt(surface, event.clientX, event.clientY, picker.current)
            if (!chosen) return
            selection.current = chosen
            if (mode === 'grab') grab(chosen)
            else { setSelected(elementDetails(chosen.hit, chosen.bounds)); setView('note') }
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
        : view === 'grabbed' || view === 'grab-error' || (view === 'opaque' && mode === 'grab') ? 'grab' : 'draw'
      const commitSelection = () => {
        if (view === 'note') {
          if (note.trim()) commit(captureContext(selection.current, note.trim(), t))
        } else {
          commit(note.trim() ? `${note.trim()}\n\n${selected.text}` : selected.text, selected.png, 'selected-element.png')
        }
      }
      return h(ActionDialog, { title: t(title), t, close },
        h('div', { style: { ...tools, justifyContent: 'space-between' } }, h('h2', { style: titleStyle }, t(title)),
          h(Button, { type: 'button', size: 'sm', onClick: close }, t('cancel'))),
        view === 'opaque' && h(Status, { t, message: 'opaque', fallback: requestDraw }),
        (view === 'grab-error' || view === 'draw-error') && h(Status, { t, message: 'captureError', error: true,
          retry: view === 'grab-error' ? () => grab() : requestDraw }),
        (view === 'note' || view === 'grabbed') && h('div', { style: { display: 'grid', gap: '10px' } },
          h('code', { style: { ...ink, fontFamily: 'inherit', whiteSpace: 'pre-wrap', maxHeight: '28dvh', overflow: 'auto' } },
            view === 'note' ? selected.selector : selected.text),
          h(Notes, { t, value: note, change: setNote, close, submit: commitSelection }),
          error && h(Status, { t, message: error, error: true }),
          h('div', { style: { ...tools, justifyContent: 'end' } },
            view === 'note' && h(Button, { type: 'button', size: 'sm', onClick: () => grab() }, t('grab')),
            h(Button, { type: 'button', size: 'sm', variant: 'primary', disabled: view === 'note' && !note.trim(),
              onClick: commitSelection }, t('add')))))
    }

    return { Overlay, elementDetails, paintMark }
  },
})
