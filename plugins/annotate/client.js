window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  factory(require) {
    const React = require('react')
    const { Button, Menu, IconEditOutlineRegular, IconChevronDownOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const { createElement: h, useEffect, useRef, useState } = React
    const id = 'jan-annotate'
    const pickBinding = { code: 'KeyC', modifiers: ['primary', 'shift'] }
    const grabBinding = { code: 'KeyC', modifiers: ['primary'] }
    const SHELL_SLOTS = ['sidebar.right.tab.browser.actions', 'sidebar.right.tab.document.view-actions']
    const INLINE_SLOTS = ['conversation.image.preview.actions', 'conversation.chat.image.actions', 'deliverables.preview.actions']

    function visible(element) {
      if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
      const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
      return width > 0 && height > 0 && top < innerHeight && left < innerWidth && right > 0 && bottom > 0
    }

    function targetOf(element) {
      // A document preview may expose its enclosing scrollport instead of the replaced visual.
      return element?.querySelector('iframe, webview, img:only-child') ?? element
    }

    function directImage(element) {
      if (element.localName !== 'img') return false
      const source = new URL(element.currentSrc || element.src, location.href)
      return source.origin === location.origin || source.protocol === 'data:' || element.crossOrigin !== null
    }

    function startDisplayCapture() {
      const media = navigator.mediaDevices
      if (!media?.getDisplayMedia || !media.setCaptureHandleConfig || !globalThis.CropTarget) return undefined
      // A unique, same-origin handle prevents accidentally attaching some other tab or window.
      const handle = crypto.randomUUID()
      media.setCaptureHandleConfig({ handle, permittedOrigins: [location.origin] })
      const stream = media.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false,
        preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' })
      return stream.then(value => {
        if (value.getVideoTracks()[0]?.getCaptureHandle?.()?.handle === handle) return value
        for (const track of value.getTracks()) track.stop()
        throw new Error('Current tab was not shared')
      }).finally(() => { media.setCaptureHandleConfig({ handle: '', permittedOrigins: [] }) })
    }

    function Launcher({ sessionId, getSurface, t, watch, activate, setGrab, getKeys, append, compact }) {
      const anchor = useRef(null)
      const current = useRef()
      const [open, setOpen] = useState(false)
      const [view, setView] = useState()
      const [error, setError] = useState(false)
      const close = () => {
        current.current?.abort()
        current.current = undefined
        setView(undefined)
      }
      const start = (mode) => {
        setOpen(false)
        setError(false)
        close()
        const surface = targetOf(getSurface())
        if (!visible(surface)) { setError(true); return }
        activate(close)
        const controller = new AbortController()
        current.current = controller
        const captureRegion = globalThis.janDesktop?.captureRegion
        const image = directImage(surface)
        const requestDisplay = mode !== 'draw' || image || captureRegion !== undefined
          ? undefined : startDisplayCapture()
        // Own a declined or abandoned share before the lazy Cordis chunk is ready.
        requestDisplay?.catch(() => {})
        const release = () => { void requestDisplay?.then(stream => stream.getTracks().forEach(track => track.stop()), () => {}) }
        controller.signal.addEventListener('abort', release, { once: true })
        setView({ pending: true })
        // require.async is the source-plugin spelling of package-local import() in Jan's module registry.
        void require.async('./client.overlay.js').then(({ Overlay }) => {
          if (controller.signal.aborted) return
          setView({ Overlay, props: { mode, surface, image, captureRegion, requestDisplay, startDisplayCapture,
            getSurface: () => targetOf(getSurface()), signal: controller.signal, close, t,
            save: (text, file) => append(sessionId, text, file), setGrab, grabKeys: getKeys(grabBinding) } })
        }, () => {
          if (controller.signal.aborted) return
          close()
          setError(true)
        })
      }
      const latest = useRef(start)
      latest.current = start
      useEffect(() => {
        if (sessionId === undefined) return undefined
        const off = watch({ getSurface: () => targetOf(getSurface()), compact, start: () => latest.current('pick') })
        return () => { off(); current.current?.abort() }
      }, [getSurface, watch, compact, sessionId])
      if (sessionId === undefined) return null
      const Overlay = view?.Overlay
      const entries = [
        { id: 'pick', label: t('pick'), shortcut: { keys: getKeys(pickBinding) } },
        { id: 'grab', label: t('grab'), shortcut: { keys: getKeys(grabBinding) } },
        { id: 'draw', label: t('draw') },
      ]
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', alignSelf: 'start' } },
        h(Menu, { open, anchorRef: anchor, portal: true, dense: true, autoFocus: true, align: 'end',
          anchor: h(Button, { ref: anchor, type: 'button', variant: 'toolbar', size: 'sm', title: t('title'),
            'aria-label': t('title'), 'aria-haspopup': 'menu', 'aria-expanded': open,
            'aria-busy': view?.pending || undefined, onClick: () => setOpen(value => !value) },
          h(IconEditOutlineRegular, { size: 14, 'aria-hidden': true }), compact ? null : t('title'),
          h(IconChevronDownOutlineRegular, { size: 12, 'aria-hidden': true })),
          items: entries, onClose: () => setOpen(false), onSelect: start }),
        error && h('span', { role: 'alert' }, t('openError')),
        Overlay !== undefined && h(Overlay, view.props))
    }

    return {
      name: id,
      inject: ['slots', 'locale', 'conversation', 'shortcuts'],
      apply(ctx) {
        const copy = require.async('./client.locale.js')
        const surfaces = new Set()
        let closeActive
        const shortcuts = ctx.shortcuts
        const pick = shortcuts.describeBinding(pickBinding)
        const grab = shortcuts.describeBinding(grabBinding)
        const getKeys = binding => (binding === pickBinding ? pick : grab).keys
        const match = (gesture, { binding }) => gesture.code === binding.code
          && ['control', 'alt', 'shift', 'meta'].every(key => gesture[key] === binding.modifiers.includes(key))
        let handleGrab
        const activate = (close) => { closeActive?.(); closeActive = close }
        function setGrab(grab) {
          handleGrab = grab
          return () => { if (handleGrab === grab) handleGrab = undefined }
        }
        const watch = (surface) => {
          surfaces.add(surface)
          return () => { surfaces.delete(surface) }
        }
        const append = (sessionId, text, image) => ctx.conversation.appendDraft(sessionId, text, image ? [image] : [])
        let live = true
        ctx.effect(() => () => { live = false; closeActive?.() })
        void copy.then(({ dictionaries }) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(id, dictionaries))
          const t = ctx.locale.bind(id)
          ctx.effect(() => shortcuts.registerFixed({ id: 'annotate.pick', label: () => t('pick'),
            keys: getKeys(pickBinding), bindings: [pickBinding], group: 'application' }))
          ctx.effect(() => shortcuts.observeFixedInput((input) => {
            if (input.type !== 'keydown') return
            const { gesture, context } = input
            if (gesture.defaultPrevented || gesture.composing || gesture.repeat) return
            if (context.region !== 'page') return
            if (handleGrab && match(gesture, grab)) {
              if (handleGrab()) input.consume()
              return
            }
            if (context.modal !== null || !match(gesture, pick)) return
            const candidates = []
            let target
            for (const item of surfaces) {
              const element = item.getSurface()
              if (!visible(element)) continue
              if (element.contains(context.target)) target = item
              if (!item.compact || candidates.length === 0) candidates.push(item)
            }
            target ??= candidates.find(item => !item.compact) ?? candidates[0]
            if (target) { input.consume(); target.start() }
          }))
          for (const [names, compact] of [[SHELL_SLOTS, false], [INLINE_SLOTS, true]]) for (const name of names) {
            ctx.slots.inject(name, () => ctx.slots.register({
              name, id, locale: id,
              inject: () => ({ watch, activate, setGrab, getKeys, append, compact }),
            }, Launcher))
          }
        }).catch(error => { if (live) ctx.logger('jan-annotate').error(error) })
      },
    }
  },
})
