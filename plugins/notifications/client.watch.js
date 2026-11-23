window.__ModuleLoader__.load({
  id: '@janhq/jan-notifications',
  chunk: 'client.watch.js',
  factory() {
    /**
     * Turn Session status changes into notification decisions.
     * A running-to-idle transition reads the latest durable turn outcome; a
     * cancelled turn is not a completion. Errors without a turn still notify.
     * An error that arrives while the Session is not running (activation failed) fails at once.
     * Each newly pending interaction key is one "waiting" event. A Session notifies only once an
     * earlier snapshot listed it, so the first snapshot and late catalog rows replay no old state.
     * @param {{
     *   tracked: (sessionId: string) => boolean,
     *   emit: (event: { kind: 'finished' | 'failed' | 'waiting', sessionId: string }) => void,
     *   readOutcome: (sessionId: string) => Promise<{seq: number, kind: string} | undefined>,
     * }} options - `tracked` excludes subagent Sessions; `emit` receives each event once.
     */
    function createStatusWatcher({ tracked, emit, readOutcome }) {
      /** @type {Map<string, boolean | undefined>} */
      const running = new Map()
      /** @type {Map<string, string>} */
      const pending = new Map()
      const failed = new Set()
      const reads = new Map()
      const reportedThrough = new Map()

      return {
        /** @param {ReadonlyMap<string, { running: boolean | undefined, pendingInteraction: { key: string } | undefined }>} snapshot */
        observe(snapshot) {
          for (const [sessionId, status] of snapshot) {
            const known = running.has(sessionId)
            const wasRunning = running.get(sessionId)
            running.set(sessionId, status.running)
            if (status.running !== false) reads.delete(sessionId)
            const key = status.pendingInteraction?.key
            const previousKey = pending.get(sessionId)
            if (key === undefined) pending.delete(sessionId)
            else pending.set(sessionId, key)
            if (!known || !tracked(sessionId)) continue
            if (key !== undefined && key !== previousKey) emit({ kind: 'waiting', sessionId })
            if (wasRunning === true && status.running === false) {
              const hadError = failed.delete(sessionId)
              const read = readOutcome(sessionId)
              reads.set(sessionId, read)
              void read.then((outcome) => {
                if (reads.get(sessionId) !== read) return
                reads.delete(sessionId)
                if (!tracked(sessionId)) return
                if (outcome === undefined || outcome.seq <= (reportedThrough.get(sessionId) ?? -1)) {
                  if (hadError) emit({ kind: 'failed', sessionId })
                  return
                }
                reportedThrough.set(sessionId, outcome.seq)
                if (outcome.kind === 'error' || (hadError && outcome.kind !== 'aborted')) emit({ kind: 'failed', sessionId })
                else if (outcome.kind === 'completed' || outcome.kind === 'max-tokens') emit({ kind: 'finished', sessionId })
              })
            }
          }
          for (const sessionId of running.keys()) {
            if (snapshot.has(sessionId)) continue
            running.delete(sessionId)
            pending.delete(sessionId)
            failed.delete(sessionId)
            reads.delete(sessionId)
            reportedThrough.delete(sessionId)
          }
        },
        dispose() { reads.clear() },
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
