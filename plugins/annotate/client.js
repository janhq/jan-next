window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  factory(require) {
    const React = require('react')
    const { Button, Tooltip, IconListPenOutlineRegular, IconInspectOutlineRegular, IconEditOutlineRegular,
      IconPaperclipOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const { createElement: h, useEffect, useRef, useState } = React
    const id = 'jan-annotate'
    const pickBinding = { code: 'KeyC', modifiers: ['primary', 'shift'] }
    const grabBinding = { code: 'KeyC', modifiers: ['primary'] }
    // Every right-Sidebar tab, whatever its kind, carries the controls at its strip's end.
    const SHELL_SLOTS = ['sidebar.right.pane.tab.actions']
    const INLINE_SLOTS = ['conversation.image.preview.actions', 'conversation.chat.image.actions', 'deliverables.preview.actions']
    const ACTIONS = [
      { id: 'pick', icon: IconListPenOutlineRegular, binding: pickBinding },
      { id: 'grab', icon: IconInspectOutlineRegular, binding: grabBinding },
      { id: 'draw', icon: IconEditOutlineRegular },
      { id: 'attach', icon: IconPaperclipOutlineRegular },
    ]
    const square = { width: '28px', padding: 0, justifyContent: 'center' }

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
      const current = useRef()
      const [view, setView] = useState()
      const [error, setError] = useState(false)
      const close = () => {
        current.current?.abort()
        current.current = undefined
        setView(undefined)
      }
      const start = (mode) => {
        setError(false)
        close()
        const surface = targetOf(getSurface())
        if (!visible(surface)) { setError(true); return }
        activate(close)
        const controller = new AbortController()
        current.current = controller
        const captureRegion = globalThis.janDesktop?.captureRegion
        const image = directImage(surface)
        // Only a whole-surface capture needs a share up front; pick and grab ask once an element is chosen.
        const requestDisplay = (mode === 'draw' || mode === 'attach') && !image && captureRegion === undefined
          ? startDisplayCapture() : undefined
        // Own a declined or abandoned share before the lazy Cordis chunk is ready.
        requestDisplay?.catch(() => {})
        const release = () => { void requestDisplay?.then(stream => stream.getTracks().forEach(track => track.stop()), () => {}) }
        controller.signal.addEventListener('abort', release, { once: true })
        setView({ pending: mode })
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
      // Every action is one visible control: nothing hides behind a menu.
      return h('span', { role: 'group', 'aria-label': t('title'),
        style: { display: 'inline-flex', alignItems: 'center', gap: '2px', alignSelf: 'start' } },
        ACTIONS.map(action => h(Tooltip, { key: action.id, label: t(action.id), side: 'bottom', delayMs: 300, portal: true,
          shortcutKeys: action.binding && getKeys(action.binding) },
        h(Button, { type: 'button', variant: compact ? 'toolbar' : 'ghost', size: 'sm', style: square,
          'aria-label': t(action.id), 'aria-busy': view?.pending === action.id || undefined,
          'data-annotate-action': action.id, onClick: () => start(action.id) },
        h(action.icon, { size: 16, 'aria-hidden': true })))),
        error && h(Tooltip, { label: t('openError'), side: 'bottom', portal: true },
          h('span', { role: 'alert', 'aria-label': t('openError'), tabIndex: 0,
            style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary)' } })),
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
