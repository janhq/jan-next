window.__ModuleLoader__.load({
  id: '@janhq/jan-tokamak',
  factory(require) {
    const React = require('react')
    const { Tooltip, IconPlayOutlineRegular, IconStopFillRegular } = require('@janhq/jan-client-ui-primitives')
    const { createElement: h, useEffect, useRef, useState } = React
    const id = 'jan-tokamak'
    /** Longest text one speech request reads; longer replies are read in parts. */
    const MAX_PART = 3800

    const STYLE = ''
      + '.jan-tokamak-action{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--jan-content-font-delta,0px));height:calc(28px + var(--jan-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}'
      + '.jan-tokamak-action svg{width:calc(15px + var(--jan-content-font-delta,0px));height:calc(15px + var(--jan-content-font-delta,0px))}'
      + '.jan-tokamak-action[data-active]{color:var(--dsw-alias-state-business-primary)}'
      + '@media (hover:hover){.jan-tokamak-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}'
      + '.jan-tokamak-status{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}'
      + '.jan-tokamak-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}'
      + '.jan-tokamak-voice{position:relative;display:inline-flex;align-items:center;gap:6px}'
      + '.jan-tokamak-bubble{position:absolute;bottom:calc(100% + 8px);right:0;z-index:20;width:max-content;max-width:min(360px,70vw);display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-primary,#fff));box-shadow:0 4px 16px rgba(0,0,0,.14);font-size:12px;line-height:1.45;color:var(--dsw-alias-state-error-primary);white-space:normal}'
      + '.jan-tokamak-dismiss{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0}'
      + '@keyframes jan-tokamak-pulse{0%,100%{opacity:1}50%{opacity:.45}}'
      + '.jan-tokamak-voice[data-live] .jan-tokamak-action{color:var(--dsw-alias-state-business-primary);animation:jan-tokamak-pulse 1.6s ease-in-out infinite}'

    async function call(method, params) {
      const response = await fetch('/jan-api/tokamak', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    /** What a person would hear: code blocks, markup and link targets removed. */
    function speakable(text) {
      return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/[*_~|]+/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim()
    }

    /** Parts of at most MAX_PART characters, cut after a sentence or line where possible. */
    function parts(text) {
      const out = []
      let rest = text
      while (rest.length > MAX_PART) {
        const window = rest.slice(0, MAX_PART)
        const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('。'))
        const at = cut > MAX_PART / 2 ? cut + 1 : MAX_PART
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at)
      }
      if (rest.trim()) out.push(rest.trim())
      return out
    }

    function audioOf(base64) {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    }

    // One reply reads at a time; starting another stops the current one.
    let stopCurrent

    function ReadAloud({ text, t }) {
      const [state, setState] = useState('idle')
      const [error, setError] = useState()
      const run = useRef()
      useEffect(() => () => run.current?.stop(), [])
      const stop = () => { run.current?.stop() }
      const start = () => {
        stopCurrent?.()
        setError(undefined)
        const words = speakable(text)
        if (!words) { setError(t('nothingToRead')); return }
        let stopped = false
        let audio
        const urls = []
        const own = { stop() {
          stopped = true
          audio?.pause()
          for (const url of urls) URL.revokeObjectURL(url)
          if (stopCurrent === own.stop) stopCurrent = undefined
          if (run.current === own) run.current = undefined
          setState('idle')
        } }
        run.current = own
        stopCurrent = own.stop
        setState('preparing')
        void (async () => {
          try {
            const chunks = parts(words)
            // Ask for the next part while the current one plays.
            let next = call('speak', { text: chunks[0] })
            for (let index = 0; index < chunks.length; index++) {
              const { audio: base64 } = await next
              if (stopped) return
              if (index + 1 < chunks.length) next = call('speak', { text: chunks[index + 1] })
              const url = audioOf(base64)
              urls.push(url)
              audio = new Audio(url)
              setState('playing')
              await new Promise((resolve, reject) => {
                audio.onended = resolve
                audio.onerror = () => reject(new Error('audio playback failed'))
                audio.onpause = resolve
                audio.play().catch(reject)
              })
              if (stopped) return
            }
            own.stop()
          } catch (failure) {
            if (stopped) return
            own.stop()
            setError(t('readFailed', { reason: failure instanceof Error ? failure.message : String(failure) }))
          }
        })()
      }
      const active = state !== 'idle'
      const label = active ? t('stopReading') : t('readAloud')
      return h(React.Fragment, null,
        h(Tooltip, { label: state === 'preparing' ? t('preparing') : label, side: 'bottom' },
          h('button', { type: 'button', className: 'jan-tokamak-action', 'aria-label': label, 'aria-pressed': active,
            'aria-busy': state === 'preparing' || undefined, 'data-active': active || undefined,
            onClick: active ? stop : start },
          active ? h(IconStopFillRegular, null) : h(IconPlayOutlineRegular, null))),
        error && h('span', { className: 'jan-tokamak-error', role: 'status' }, error))
    }

    function VoiceGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M2 7v2M5 5v6M8 3v10M11 5v6M14 7v2' }))
    }

    function VoiceConversation({ sessionId, t, append }) {
      const [state, setState] = useState('idle')
      const [error, setError] = useState()
      const live = useRef()
      useEffect(() => () => live.current?.end(false), [])
      const start = async () => {
        setError(undefined)
        setState('connecting')
        const lines = []
        let pc
        let stream
        let ended = false
        const player = new Audio()
        player.autoplay = true
        const end = (keep) => {
          if (ended) return
          ended = true
          live.current = undefined
          pc?.close()
          for (const track of stream?.getTracks() ?? []) track.stop()
          player.srcObject = null
          setState('idle')
          if (keep && lines.length > 0) {
            const text = `${t('transcriptTitle')}:\n${lines.map(([who, said]) => `${who === 'user' ? t('you') : t('jan')}: ${said}`).join('\n')}`
            append(sessionId, text)
          }
        }
        live.current = { end }
        const fail = (reason) => { end(true); setError(t('talkFailed', { reason })) }
        try {
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (_error) { end(false); setError(t('micDenied')); return }
          const { token, callsUrl } = await call('voiceSession', {})
          if (ended) return
          pc = new RTCPeerConnection()
          pc.ontrack = (event) => { player.srcObject = event.streams[0] }
          pc.addTrack(stream.getAudioTracks()[0], stream)
          const events = pc.createDataChannel('oai-events')
          events.onmessage = (message) => {
            let event
            try { event = JSON.parse(message.data) } catch { return }
            if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) lines.push(['user', event.transcript.trim()])
            else if (event.type === 'response.output_audio_transcript.done' && event.transcript?.trim()) lines.push(['jan', event.transcript.trim()])
            else if (event.type === 'input_audio_buffer.speech_started') setState('listening')
            else if (event.type === 'response.output_audio.delta' || event.type === 'output_audio_buffer.started') setState('speaking')
            else if (event.type === 'response.done' || event.type === 'output_audio_buffer.stopped') setState('listening')
            else if (event.type === 'error') fail(event.error?.message || 'error')
          }
          pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (!ended) fail(pc.connectionState) } }
          await pc.setLocalDescription(await pc.createOffer())
          const answer = await fetch(callsUrl, { method: 'POST', body: pc.localDescription.sdp, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/sdp' } })
          const sdp = await answer.text()
          if (!answer.ok) {
            let reason = sdp
            let code
            try { const body = JSON.parse(sdp); reason = body.error?.message ?? sdp; code = body.error?.code } catch { /* plain text */ }
            // A refusal the user can act on is said in plain words; others quote Tokamak.
            if (code === 'guardrail_policy_unsupported') { end(false); setError(t('voiceBlocked')); return }
            if (answer.status === 402) { end(false); setError(t('noCredit')); return }
            fail(reason.trim() || `HTTP ${answer.status}`)
            return
          }
          if (ended) return
          await pc.setRemoteDescription({ type: 'answer', sdp })
          setState('listening')
        } catch (failure) {
          if (!ended) fail(failure instanceof Error ? failure.message : String(failure))
        }
      }
      const active = state !== 'idle'
      const label = active ? t('endTalk') : t('talk')
      const status = state === 'connecting' ? t('connecting') : state === 'speaking' ? t('speaking') : state === 'listening' ? t('listening') : undefined
      return h('span', { className: 'jan-tokamak-voice', 'data-live': active || undefined },
        h(Tooltip, { label, side: 'top' },
          h('button', { type: 'button', className: 'jan-tokamak-action', 'aria-label': label, 'aria-pressed': active,
            'aria-busy': state === 'connecting' || undefined, onClick: () => { if (active) live.current?.end(true); else void start() } },
          active ? h(IconStopFillRegular, null) : h(VoiceGlyph, null))),
        status && h('span', { className: 'jan-tokamak-status', role: 'status' }, status),
        // Floats above the button, so a long message never widens the toolbar or hides Send.
        error && h('span', { className: 'jan-tokamak-bubble', role: 'alert' }, error,
          h('button', { type: 'button', className: 'jan-tokamak-dismiss', 'aria-label': t('dismiss'), onClick: () => setError(undefined) }, '\u00d7')))
    }

    return {
      name: id,
      inject: ['slots', 'locale', 'conversation'],
      apply(ctx) {
        const style = document.createElement('style')
        style.textContent = STYLE
        document.head.append(style)
        ctx.effect(() => () => style.remove())
        let live = true
        ctx.effect(() => () => { live = false; stopCurrent?.() })
        const append = (sessionId, text) => ctx.conversation.appendDraft(sessionId, text)
        void require.async('./client.locale.js').then(({ dictionaries }) => {
          if (!live) return
          ctx.effect(() => ctx.locale.register(id, dictionaries))
          ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
            name: 'conversation.chat.assistant-actions', id: 'read-aloud', order: 5, locale: id,
          }, ReadAloud))
          ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
            name: 'conversation.input.right', id: 'voice-conversation', locale: id, inject: sessionId => ({ append, sessionId }),
          }, VoiceConversation))
        }).catch(error => { if (live) ctx.logger(id).error(error) })
      },
    }
  },
})
