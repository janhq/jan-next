window.__ModuleLoader__.load({
  id: '@janhq/jan-notifications',
  chunk: 'client.watch.js',
  factory() {
    /**
     * Turn Session status changes into notification decisions.
     * A Session that stops running after an `api-session/error` failed; otherwise it finished.
     * An error that arrives while the Session is not running (activation failed) fails at once.
     * Each newly pending interaction key is one "waiting" event. A Session notifies only once an
     * earlier snapshot listed it, so the first snapshot and late catalog rows replay no old state.
     * @param {{
     *   tracked: (sessionId: string) => boolean,
     *   emit: (event: { kind: 'finished' | 'failed' | 'waiting', sessionId: string }) => void,
     * }} options - `tracked` excludes subagent Sessions; `emit` receives each event once.
     */
    function createStatusWatcher({ tracked, emit }) {
      /** @type {Map<string, boolean | undefined>} */
      const running = new Map()
      /** @type {Map<string, string>} */
      const pending = new Map()
      const failed = new Set()

      return {
        /** @param {ReadonlyMap<string, { running: boolean | undefined, pendingInteraction: { key: string } | undefined }>} snapshot */
        observe(snapshot) {
          for (const [sessionId, status] of snapshot) {
            const known = running.has(sessionId)
            const wasRunning = running.get(sessionId)
            running.set(sessionId, status.running)
            const key = status.pendingInteraction?.key
            const previousKey = pending.get(sessionId)
            if (key === undefined) pending.delete(sessionId)
            else pending.set(sessionId, key)
            if (!known || !tracked(sessionId)) continue
            if (key !== undefined && key !== previousKey) emit({ kind: 'waiting', sessionId })
            if (wasRunning === true && status.running === false) {
              emit({ kind: failed.delete(sessionId) ? 'failed' : 'finished', sessionId })
            }
          }
          for (const sessionId of running.keys()) {
            if (snapshot.has(sessionId)) continue
            running.delete(sessionId)
            pending.delete(sessionId)
            failed.delete(sessionId)
          }
        },
        /** @param {string} sessionId - Session whose Agent reported an error. */
        error(sessionId) {
          if (running.get(sessionId) === true) failed.add(sessionId)
          else if (tracked(sessionId)) emit({ kind: 'failed', sessionId })
        },
      }
    }

    return { createStatusWatcher }
  },
})
