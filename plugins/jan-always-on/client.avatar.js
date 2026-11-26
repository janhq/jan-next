window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on',
  chunk: 'client.avatar.js',
  factory(require) {
    const { createElement: h, useEffect, useMemo, useRef } = require('react')
    const CELEBRATE_MS = 4000
    // Open Bot Avatar's chat silhouette, adapted under MIT. See LICENSE.open-bot-avatar.
    const definition = { version: 1, id: 'chat', name: 'Chat', body: {
      path: 'M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z',
    }, eyes: { x: 50, y: 42, spacing: 18, scale: 1.25 } }
    const definitions = [definition, ...[
      ['round', 'M50 12A38 38 0 1 1 50 88A38 38 0 1 1 50 12Z'],
      ['square', 'M30 14H70Q86 14 86 30V70Q86 86 70 86H30Q14 86 14 70V30Q14 14 30 14Z'],
      ['capsule', 'M40 22H60A28 28 0 0 1 60 78H40A28 28 0 0 1 40 22Z'],
    ].map(([id, path]) => ({ ...definition, id, name: id, body: { path }, eyes: { ...definition.eyes, y: 49 } }))]

    const palette = ['#42688f', '#8c553d', '#75558b', '#467568', '#676d3e', '#915571', '#436b83', '#974c4c']
    const defaultSquad = [
      { id: 'round', shape: 1, color: '#FF7A59' },
      { id: 'chat', shape: 0, color: 'var(--dsw-alias-brand-primary)' },
      { id: 'square', shape: 2, color: '#7C5CFF' },
      { id: 'capsule', shape: 3, color: '#5AC8FA' },
    ]

    /** Give bots without a saved avatar a stable shape and color. */
    function appearanceFor(name) {
      let hash = 0
      for (const ch of name.trim().toLowerCase()) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0
      return { shape: hash % definitions.length, color: palette[(hash >>> 2) % palette.length], locked: false }
    }

    /** The Bots roster and mode picker put recently active bots first. */
    const compareBotRecency = (a, b) => (b.latest?.at ?? b.createdAt) - (a.latest?.at ?? a.createdAt)

    const modeSquadCss = `
      .jao-mode-squad { display: block; container-type: inline-size; }
      .jao-mode-lineup { display: flex; justify-content: flex-end; align-items: center; }
      .jao-mode-avatar {
        display: block; position: relative; flex: none; inline-size: 28px; block-size: 28px;
        animation: jao-mode-bob calc(var(--ds-transition-duration-ambient) * 1.2) var(--ds-ease-pulse) infinite;
        animation-delay: calc(var(--ds-transition-duration-slow) * var(--jao-squad-index) * -1.4);
      }
      .jao-mode-avatar + .jao-mode-avatar { margin-inline-start: clamp(-12px, calc((100cqw - 112px) / 3), -4px); }
      @container (width < 76px) { .jao-mode-avatar:nth-child(n + 4) { display: none; } }
      @container (width < 60px) { .jao-mode-avatar:nth-child(n + 3) { display: none; } }
      @container (width < 44px) { .jao-mode-avatar:nth-child(n + 2) { display: none; } }
      @keyframes jao-mode-bob { 50% { transform: translateY(-1px); } }
      @media (prefers-reduced-motion: reduce) { .jao-mode-avatar { animation: none; } }
    `

    function modeEyeColor(color) {
      const ink = 'var(--dsw-static-neutral-bluish-1000)'
      if (window.CSS?.supports('color', 'contrast-color(red)')) return `contrast-color(${color})`
      // The scene renderer also accepts theme colors on browsers without contrast-color().
      if (!color.startsWith('#')) return 'var(--dsw-alias-label-primary-foreground)'
      const channels = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
      const luminance = channels.reduce((value, channel, i) => value
        + [0.2126, 0.7152, 0.0722][i] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0)
      return luminance < 0.179 ? 'var(--dsw-static-neutral-bluish-00)' : ink
    }

    /** Mount the shared avatar renderer only while the mode picker row is open. */
    function ModeSquad({ rows, mountBotAvatar }) {
      const host = useRef(null)
      const lineup = useRef(null)
      const avatars = useMemo(() => rows?.length
        ? rows.toSorted(compareBotRecency).slice(0, 4).map(bot => ({ id: bot.id, ...(bot.avatar ?? appearanceFor(bot.name)) }))
        : defaultSquad, [rows])

      useEffect(() => {
        const squad = host.current
        const row = squad.closest('button[role="menuitem"]')
        const hover = window.matchMedia('(hover: hover)')
        let hovered = hover.matches && row.matches(':hover')
        let focused = row.matches(':focus-visible')
        const pose = () => ({ mood: hovered || focused ? 'happy' : 'neutral' })
        const mounted = avatars.map(({ shape, color }, i) => mountBotAvatar(lineup.current.children[i], {
          definition: definitions[shape], color, eyeColor: modeEyeColor(color), state: 'idle', label: '',
          depth: 1.5, ...pose(),
        }))
        const update = () => {
          const next = pose()
          for (const avatar of mounted) avatar.update(next)
        }
        const enter = event => { if (event.pointerType !== 'touch' && hover.matches) { hovered = true; update() } }
        const leave = () => { hovered = false; update() }
        const focus = () => { focused = row.matches(':focus-visible'); update() }
        const blur = () => { focused = false; update() }
        const changeHover = () => { hovered = hover.matches && row.matches(':hover'); update() }
        row.addEventListener('pointerenter', enter)
        row.addEventListener('pointerleave', leave)
        row.addEventListener('focus', focus)
        row.addEventListener('blur', blur)
        hover.addEventListener('change', changeHover)
        return () => {
          row.removeEventListener('pointerenter', enter)
          row.removeEventListener('pointerleave', leave)
          row.removeEventListener('focus', focus)
          row.removeEventListener('blur', blur)
          hover.removeEventListener('change', changeHover)
          for (const avatar of mounted) avatar.destroy()
        }
      }, [avatars, mountBotAvatar])

      return h('span', { className: 'jao-mode-squad', 'aria-hidden': true, ref: host },
        h('style', null, modeSquadCss),
        h('span', { className: 'jao-mode-lineup', ref: lineup }, avatars.map(({ id }, i) =>
          h('span', { key: id, className: 'jao-mode-avatar', style: { '--jao-squad-index': i } }))))
    }

    // The scene keeps both eyes in the DOM, including while ambient animation is stopped.
    const gazeStyles = `
      @media (prefers-reduced-motion: no-preference) {
        [data-jao-gaze] [data-avatar-scene] [data-eye] {
          translate: var(--jao-eye-x, 0px) var(--jao-eye-y, 0px);
        }
      }
    `
    const centeredGaze = { x: 0, y: 0 }
    let gaze

    function createGazeTracker() {
      const avatars = new Set()
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
      const style = document.createElement('style')
      style.textContent = gazeStyles
      document.head.append(style)
      let frame = 0, cursorX, cursorY

      const paint = () => {
        frame = 0
        // Measure every host before writing any transforms.
        for (const avatar of avatars) {
          const { left, top, width, height } = avatar.element.getBoundingClientRect()
          const dx = cursorX - (left + width / 2), dy = cursorY - (top + height / 2)
          const scale = width && height ? Math.min(3, Math.max(1, width * .065)) / Math.max(48, Math.hypot(dx, dy)) : 0
          avatar.nextX = Math.round(dx * scale * 20) / 20
          avatar.nextY = Math.round(dy * scale * 20) / 20
        }
        for (const avatar of avatars) setOffset(avatar, avatar.nextX, avatar.nextY)
      }
      const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
      const pointerMove = event => {
        if (motion.matches || event.pointerType === 'touch') return
        cursorX = event.clientX
        cursorY = event.clientY
        schedule()
      }
      const changeMotion = () => {
        if (motion.matches) {
          cancelAnimationFrame(frame)
          frame = 0
          cursorX = cursorY = undefined
        }
        for (const avatar of avatars) {
          if (motion.matches) setOffset(avatar, 0, 0)
          avatar.refreshMotion()
        }
      }
      document.addEventListener('pointermove', pointerMove, { passive: true })
      motion.addEventListener('change', changeMotion)
      return {
        avatars, motion,
        add(avatar) {
          avatars.add(avatar)
          avatar.element.setAttribute('data-jao-gaze', '')
          if (cursorX !== undefined) schedule()
        },
        destroy() {
          cancelAnimationFrame(frame)
          document.removeEventListener('pointermove', pointerMove)
          motion.removeEventListener('change', changeMotion)
          style.remove()
        },
      }
    }

    function setOffset(avatar, x, y) {
      if (avatar.x !== x) avatar.element.style.setProperty('--jao-eye-x', `${avatar.x = x}px`)
      if (avatar.y !== y) avatar.element.style.setProperty('--jao-eye-y', `${avatar.y = y}px`)
    }

    /** Load the renderer. Mounted avatars share the cursor and respect system reduced motion. */
    async function loadAvatarRenderer() {
      const { mountAvatar } = await require.async('./client.open-bot-avatar.js')
      return (element, { still, ...options }) => {
        const tracker = gaze ??= createGazeTracker()
        const motionOptions = () => {
          const reducedMotion = tracker.motion.matches || !!still
          return { reducedMotion, lookAt: reducedMotion ? centeredGaze : null }
        }
        const renderer = mountAvatar(element, { ...options, ...motionOptions(), renderer: 'scene' })
        const avatar = { element, x: 0, y: 0, refreshMotion: () => renderer.update(motionOptions()) }
        tracker.add(avatar)
        return {
          update({ still: nextStill = still, ...partial }) {
            still = nextStill
            renderer.update({ ...partial, ...motionOptions() })
          },
          destroy() {
            if (!tracker.avatars.delete(avatar)) return
            element.removeAttribute('data-jao-gaze')
            element.style.removeProperty('--jao-eye-x')
            element.style.removeProperty('--jao-eye-y')
            if (!tracker.avatars.size) {
              tracker.destroy()
              gaze = undefined
            }
            renderer.destroy()
          },
        }
      }
    }

    /** Map the activity snapshot to a renderer pose and a localized status. */
    function avatarAppearance(snapshot) {
      const { enabled = true, paused, approvals, activeRun, events, lastRun, lastDeliveryAgeMs = null, pending, blocked } = snapshot
      const pose = (state, labelKey, still = false, mood = 'neutral') => ({ state, mood, still, labelKey })
      if (!enabled || paused) return pose('idle', enabled ? 'paused' : 'off', true)
      if (blocked || approvals?.length) return pose('blocked', 'deferred')
      if (activeRun === 'working') return pose('working', 'avatarWorking')
      if (activeRun === 'thinking') return pose('thinking', 'avatarThinking')
      if (pending || events?.some(event => event.status === 'pending')) return pose('waiting', 'pending')
      if (lastRun === 'failed') return pose('blocked', 'failed')
      if (lastDeliveryAgeMs !== null && lastDeliveryAgeMs < CELEBRATE_MS) return pose('done', 'sent', false, 'happy')
      return pose('idle', 'avatarIdle')
    }

    // The renderer's static mode accepts only hex, not computed legacy rgb() values.
    function hexColor(value) {
      const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
      return rgb ? `#${rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}` : value || undefined
    }

    /** Render beside the status line and own the renderer, theme observer and delivery deadline. */
    function Avatar({ snapshot, t, mountBotAvatar, name = t('title'), appearance }) {
      const host = useRef(null)
      const mounted = useRef(null)
      const options = useRef(null)
      const { state, mood, still, labelKey } = avatarAppearance(snapshot)
      const customColor = useRef(null)
      customColor.current = appearance?.color
      const shape = definitions[appearance?.shape] ?? definition
      const label = `${name}: ${t(labelKey)}`
      const idleLabel = `${name}: ${t('avatarIdle')}`
      options.current = { state, mood, still, label, definition: shape }

      useEffect(() => {
        const element = host.current
        let color, eyeColor
        const syncTheme = () => {
          const themed = getComputedStyle(document.body)
          const nextColor = customColor.current ?? hexColor(themed.getPropertyValue('--dsw-alias-brand-primary').trim())
          const nextEyeColor = hexColor(themed.getPropertyValue('--dsw-alias-label-primary-foreground').trim())
          if (color === nextColor && eyeColor === nextEyeColor && mounted.current) return
          color = nextColor
          eyeColor = nextEyeColor
          if (mounted.current) mounted.current.update({ color, eyeColor })
          else mounted.current = mountBotAvatar(element, { color, eyeColor, ...options.current })
        }
        syncTheme()
        const observer = new MutationObserver(syncTheme)
        observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] })
        return () => {
          observer.disconnect()
          mounted.current.destroy()
          mounted.current = null
        }
      }, [mountBotAvatar])

      useEffect(() => {
        const color = appearance?.color ?? hexColor(getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim())
        mounted.current.update({ definition: shape, color, state, mood, still, label })
        if (state !== 'done') return
        const timeout = setTimeout(() => {
          mounted.current.update({ state: 'idle', mood: 'neutral', label: idleLabel })
        }, CELEBRATE_MS - snapshot.lastDeliveryAgeMs)
        return () => clearTimeout(timeout)
      }, [mountBotAvatar, shape, appearance?.color, state, mood, still, label, idleLabel, snapshot.lastDeliveryAgeMs])

      return h('span', { className: 'jao-avatar', 'data-still': still ? '' : undefined, ref: host })
    }

    return { Avatar, ModeSquad, appearanceFor, avatarAppearance, compareBotRecency, definition, loadAvatarRenderer, palette }
  },
})
