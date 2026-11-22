window.__ModuleLoader__.load({
  id: '@janhq/jan-annotate',
  factory(require) {
    const React = require('react')
    const { Button, Tooltip, IconListPenOutlineRegular, IconInspectOutlineRegular, IconPenOutlineRegular,
      IconPaperclipOutlineRegular } = require('@janhq/jan-client-ui-primitives')
    const { createElement: h, useEffect, useRef, useState } = React
    const id = 'jan-annotate'
    const pickBinding = { code: 'KeyC', modifiers: ['primary', 'shift'] }
    const grabBinding = { code: 'KeyC', modifiers: ['primary'] }
    // Every right-Sidebar tab, whatever its kind, carries the controls at its strip's end.
    const SHELL_SLOTS = ['sidebar.right.pane.tab.actions']
    const INLINE_SLOTS = ['conversation.image.preview.actions', 'conversation.chat.image.actions', 'deliverables.preview.actions',
      'deliverables.live.actions']
    // A composer thumbnail is already a draft image: it offers Draw alone, as a badge like its remove control.
    const BADGE_SLOTS = ['conversation.input.attachment.actions']
    // A reply that embeds a live surface (a generated widget) carries the strip among its own actions.
    const EMBED_SLOT = 'conversation.chat.assistant-actions'
    const EMBED = '[data-chat-embed]'
    // Pick and grab hand the agent a selector and HTML, which only mean something for a web page or code;
    // slides, CAD, images and PDFs offer just the whole-surface actions.
    const ACTIONS = [
      { id: 'pick', icon: IconListPenOutlineRegular, binding: pickBinding, element: true },
      { id: 'grab', icon: IconInspectOutlineRegular, binding: grabBinding, element: true },
      { id: 'draw', icon: IconPenOutlineRegular },
      { id: 'attach', icon: IconPaperclipOutlineRegular },
    ]
    const CODE = '[data-code-preview], [data-textpreview-plain]'
    const square = { width: '28px', padding: 0, justifyContent: 'center' }
    // Inline size comes from the stylesheet so it follows the conversation text size like the turn's actions.
    const inlineSquare = { padding: 0, justifyContent: 'center' }

    function visible(element) {
      if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
      const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
      return width > 0 && height > 0 && top < innerHeight && left < innerWidth && right > 0 && bottom > 0
    }

    function targetOf(element) {
      // A tab or viewer exposes its whole body; draw on its framed page or previewed image, never on an icon inside it.
      return element?.querySelector('iframe, webview, [data-image-preview] img') ?? element
    }

    function hasElements(element) {
      const target = targetOf(element)
      if (!target) return false
      if (target.localName === 'iframe' || target.localName === 'webview' || target.matches(EMBED)) return true
      return target.matches(CODE) || target.querySelector(CODE) !== null
    }

    function useElements(getSurface) {
      const [elements, setElements] = useState(false)
      useEffect(() => {
        const surface = getSurface()
        if (!surface) return undefined
        const update = () => { setElements(hasElements(surface)) }
        update()
        // A tab mounts its body after the strip renders, and one tab can switch between a page and a file.
        const observer = new MutationObserver(update)
        observer.observe(surface, { childList: true, subtree: true })
        return () => { observer.disconnect() }
      }, [getSurface])
      return elements
    }

    function directImage(element) {
      if (element.localName !== 'img') return false
      const source = new URL(element.currentSrc || element.src, location.href)
      // A composer preview is a blob URL this document created, so it draws into a canvas untainted.
      return source.origin === location.origin || source.protocol === 'data:' || source.protocol === 'blob:'
        || element.crossOrigin !== null
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

    function Launcher({ sessionId, getSurface, t, watch, activate, setGrab, getKeys, append, compact, badge, loadOverlay }) {
      const current = useRef()
      const [view, setView] = useState()
      const [error, setError] = useState(false)
      const elements = useElements(getSurface)
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
        void loadOverlay().then(([{ Overlay }, { elementName }]) => {
          if (controller.signal.aborted) return
          setView({ Overlay, props: { mode, surface, image, captureRegion, requestDisplay, startDisplayCapture,
            getSurface: () => targetOf(getSurface()), signal: controller.signal, close, t,
            save: (text, file, contexts) => append(sessionId, text, file, contexts), elementName, setGrab, grabKeys: getKeys(grabBinding) } })
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
        const off = watch({ getSurface: () => targetOf(getSurface()), elements: () => hasElements(getSurface()), compact,
          start: () => latest.current('pick') })
        return () => { off(); current.current?.abort() }
      }, [getSurface, watch, compact, sessionId])
      if (sessionId === undefined) return null
      const Overlay = view?.Overlay
      // Every action is one visible control: nothing hides behind a menu. 8px between them, as between
      // the turn's own actions and the strip's split and panel controls.
      return h('span', { role: 'group', 'aria-label': t('title'),
        style: { display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'start' } },
        ACTIONS.filter(action => badge ? action.id === 'draw' : elements || !action.element).map(action => h(Tooltip, {
          key: action.id, label: t(action.id), side: 'bottom', delayMs: 300, portal: true,
          shortcutKeys: action.binding && getKeys(action.binding) },
        // Ghost everywhere: inline, the strip sits beside the turn's own ghost actions (copy, replay, share) and must read as one row.
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', style: compact ? inlineSquare : square,
          'aria-label': t(action.id), 'aria-busy': view?.pending === action.id || undefined,
          'data-annotate-action': action.id, 'data-annotate-inline': (compact && !badge) || undefined,
          'data-annotate-badge': badge || undefined, onClick: () => start(action.id) },
        h(action.icon, { size: 16, 'aria-hidden': true })))),
        error && h(Tooltip, { label: t('openError'), side: 'bottom', portal: true },
          h('span', { role: 'alert', 'aria-label': t('openError'), tabIndex: 0,
            style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary)' } })),
        Overlay !== undefined && h(Overlay, view.props))
    }

    /** The strip for a reply's embed, shown once the embed exists: a card mounts after the actions row renders. */
    function EmbedLauncher({ getEmbed, ...props }) {
      const [present, setPresent] = useState(() => getEmbed() !== null)
      useEffect(() => {
        if (present) return undefined
        let frame = 0
        const observer = new MutationObserver(() => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            if (getEmbed() !== null) setPresent(true)
          })
        })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => { observer.disconnect(); cancelAnimationFrame(frame) }
      }, [present, getEmbed])
      return present ? h(Launcher, { ...props, getSurface: getEmbed }) : null
    }

    return {
      name: id,
      inject: ['slots', 'locale', 'conversation', 'shortcuts', 'uiConversation'],
      apply(ctx) {
        const copy = require.async('./client.locale.js')
        const element = require.async('./client.element.js')
        const loadOverlay = () => Promise.all([require.async('./client.overlay.js'), element])
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
        const append = (sessionId, text, image, contexts) => ctx.conversation.appendDraft(sessionId, text, image ? [image] : [], contexts ?? [])
        let live = true
        ctx.effect(() => () => { live = false; closeActive?.() })
        // Every strip matches its neighbours' icon actions with a 15px glyph: inline, the turn's actions
        // (ui-chat MessageIconActions: tertiary ink, secondary on hover); in a tab strip, the kit's split
        // and the panel chrome (secondary ink, hover only fills the background).
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = 'button[data-annotate-action]{color:var(--dsw-alias-label-secondary)}'
            + 'button[data-annotate-action] svg{width:15px;height:15px}'
            + 'button[data-annotate-inline][data-annotate-action]{color:var(--dsw-alias-label-tertiary);'
            + 'width:calc(28px + var(--jan-content-font-delta, 0px));height:calc(28px + var(--jan-content-font-delta, 0px))}'
            + 'button[data-annotate-inline][data-annotate-action] svg{width:calc(15px + var(--jan-content-font-delta, 0px));'
            + 'height:calc(15px + var(--jan-content-font-delta, 0px))}'
            + '@media (hover:hover){button[data-annotate-inline][data-annotate-action]:hover:not(:disabled){color:var(--dsw-alias-label-secondary)}}'
            // The composer thumbnail's remove control: an 18px contrast disc.
            + 'button[data-annotate-badge][data-annotate-action]{width:18px;height:18px;min-width:0;min-height:0;padding:0;'
            + 'border-radius:50%;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted)}'
            + 'button[data-annotate-badge][data-annotate-action] svg{width:11px;height:11px}'
          document.head.append(style)
          return () => { style.remove() }
        })
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
              if (!item.elements() || !visible(element)) continue
              if (element.contains(context.target)) target = item
              if (!item.compact || candidates.length === 0) candidates.push(item)
            }
            target ??= candidates.find(item => !item.compact) ?? candidates[0]
            if (target) { input.consume(); target.start() }
          }))
          for (const [names, compact, badge] of [[SHELL_SLOTS, false, false], [INLINE_SLOTS, true, false], [BADGE_SLOTS, true, true]]) {
            for (const name of names) {
              ctx.slots.inject(name, () => ctx.slots.register({
                name, id, locale: id,
                inject: () => ({ watch, activate, setGrab, getKeys, append, compact, badge, loadOverlay }),
              }, Launcher))
            }
          }
          ctx.slots.inject(EMBED_SLOT, () => ctx.slots.register({
            name: EMBED_SLOT, id, locale: id, order: 20,
            inject: () => ({ watch, activate, setGrab, getKeys, append, compact: true, badge: false, loadOverlay }),
          }, EmbedLauncher))
          // A sent grab shows as one chip; its selector and HTML open on click.
          void element.then(({ pageElementRule, PageElement }) => {
            if (!live) return
            ctx.uiConversation.userText.register(pageElementRule)
            ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
              name: 'conversation.user.text.node', key: 'page-element', priority: 100, locale: id,
            }, PageElement))
          })
        }).catch(error => { if (live) ctx.logger('jan-annotate').error(error) })
      },
    }
  },
})
