// Pure placement and formatting rules of the status bar, kept apart from React
// so the bar, its menus and its settings page agree on one ordering.
window.__ModuleLoader__.load({
  id: '@janhq/jan-status-bar',
  chunk: 'client.layout.js',
  factory() {
    const SIDES = ['left', 'right']
    const STEP = 10

    /**
     * Every registered item with its effective side, position and visibility.
     * An item sits on the side of the slot it registered into until the user
     * moves it; it keeps its registration `order` until the user drags it.
     * @param {{ left: readonly { options: { id?: string, order?: number } }[], right: readonly { options: { id?: string, order?: number } }[] }} entries - slot entries per default side.
     * @param {Record<string, { hidden?: boolean, side?: 'left' | 'right', order?: number }>} placements - the user's placements by id.
     * @returns {{ id: string, slot: 'left' | 'right', side: 'left' | 'right', order: number, hidden: boolean, rank: number }[]} items in display order, left side first.
     */
    function arrange(entries, placements) {
      const seen = new Set()
      const items = []
      for (const slot of SIDES) {
        for (const entry of entries[slot]) {
          const id = entry.options.id
          if (typeof id !== 'string' || seen.has(id)) continue
          seen.add(id)
          const placement = placements[id] ?? {}
          items.push({
            id, slot,
            side: SIDES.includes(placement.side) ? placement.side : slot,
            order: Number.isFinite(placement.order) ? placement.order : entry.options.order ?? 0,
            hidden: placement.hidden === true,
            rank: items.length,
          })
        }
      }
      return items.sort((a, b) => SIDES.indexOf(a.side) - SIDES.indexOf(b.side) || a.order - b.order || a.rank - b.rank)
    }

    /**
     * Config operations that put one item at `index` among the items of `side`.
     * Only the items on that side are renumbered, so placements elsewhere stay as the user left them.
     * @param {ReturnType<typeof arrange>} items - current arrangement.
     * @param {string} id - item being placed.
     * @param {'left' | 'right'} side - destination side.
     * @param {number} index - position among that side's items, counted without the moved item.
     * @returns {{ op: 'set', path: string[], value: unknown }[]} operations for the `items` field.
     */
    function placeAt(items, id, side, index) {
      const moved = items.find(item => item.id === id)
      if (!moved) return []
      const row = items.filter(item => item.side === side && item.id !== id)
      row.splice(Math.max(0, Math.min(index, row.length)), 0, moved)
      const ops = []
      row.forEach((item, position) => {
        const order = (position + 1) * STEP
        if (item.order !== order) ops.push({ op: 'set', path: ['items', item.id, 'order'], value: order })
      })
      if (moved.side !== side) ops.push({ op: 'set', path: ['items', id, 'side'], value: side })
      return ops
    }

    /**
     * Where a meter's colour starts to warn.
     * @param {number | null | undefined} percent - load.
     * @param {number} warnAt - amber threshold.
     * @param {number} criticalAt - red threshold.
     * @returns {'ok' | 'warn' | 'critical' | undefined} undefined without a reading.
     */
    function levelOf(percent, warnAt, criticalAt) {
      if (typeof percent !== 'number') return undefined
      if (percent >= Math.max(warnAt, criticalAt)) return 'critical'
      if (percent >= warnAt) return 'warn'
      return 'ok'
    }

    /**
     * @param {number} bytes - size.
     * @returns {string} GB above 1 GiB, MB below, one decimal for GB.
     */
    function formatBytes(bytes) {
      return bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)} GB` : `${Math.round(bytes / 2 ** 20)} MB`
    }

    /**
     * Agents working and chats waiting on the user, from the Session status map.
     * @param {ReadonlyMap<string, { running?: boolean, pendingInteraction?: unknown }>} statuses - status by Session id.
     * @returns {{ working: number, waiting: number, next: string | undefined }} counts and the chat to open first.
     */
    function attention(statuses) {
      let working = 0
      let waiting = 0
      let firstWaiting
      let firstWorking
      for (const [sessionId, status] of statuses) {
        if (status.pendingInteraction !== undefined) {
          waiting++
          firstWaiting ??= sessionId
        } else if (status.running === true) {
          working++
          firstWorking ??= sessionId
        }
      }
      return { working, waiting, next: firstWaiting ?? firstWorking }
    }

    return { arrange, placeAt, levelOf, formatBytes, attention }
  },
})
