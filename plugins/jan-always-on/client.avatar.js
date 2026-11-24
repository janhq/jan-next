window.__ModuleLoader__.load({
  id: '@janhq/jan-always-on',
  chunk: 'client.avatar.js',
  factory(require) {
    const { createElement: h, useEffect, useRef } = require('react')
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

    /** Load the private renderer and return (element, options) => { update, destroy }. */
    async function loadAvatarRenderer() {
      const { mountAvatar } = await require.async('./client.open-bot-avatar.js')
      return mountBotAvatar

      function mountBotAvatar(element, options) {
        return mountAvatar(element, { reducedMotion: 'system', ...options })
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

    return { Avatar, avatarAppearance, definition, loadAvatarRenderer }
  },
})
