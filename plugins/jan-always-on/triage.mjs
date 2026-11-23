// Fast pre-check of new source items with Jev (Tokamak System One), before they wake the bot.
// It only ever drops items Jev is confident the bot does not care about; anything else, and
// every failure (no Tokamak key, timeout, an answer that does not check out), keeps every item.

/** An item whose relevance Jev puts below this is dropped. Measured answers sit near 0.05 for noise and 0.95 for hits. */
export const DROP_BELOW = 0.2
const BATCH = 20
const TIMEOUT_MS = 3000

/**
 * @param {{ request(body: object, signal: AbortSignal): Promise<unknown>, profile(): { name?: string, role?: string, description?: string } | undefined }} options
 *   `request` posts a System One body and returns its parsed reply; `profile` reads the bot's current profile.
 * @returns {(items: Array<{ id: string, text: string }>, signal?: AbortSignal) => Promise<Set<string>>} ids to drop.
 */
export function createTriage({ request, profile }) {
  return async (items, signal) => {
    const bot = profile()
    const criteria = [bot?.role, bot?.description].filter(text => typeof text === 'string' && text.trim()).join('. ')
    // Without a role or description there is nothing to judge against.
    if (!items.length || !criteria) return new Set()
    const deadline = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...signal ? [signal] : []])
    try {
      const batches = []
      for (let start = 0; start < items.length; start += BATCH) batches.push(items.slice(start, start + BATCH))
      const answers = await Promise.all(batches.map(async batch => {
        const state = { bot: `${bot?.name ?? 'Bot'}: ${criteria}` }
        const questions = {}
        batch.forEach((item, index) => {
          state[`item_${index}`] = item.text
          questions[`item_${index}`] = { type: 'noul', instructions: `Given bot, would this bot want to act on or report item_${index}?` }
        })
        const reply = /** @type {{ answers?: Record<string, { noul?: unknown }> }} */ (await request({ state, questions }, deadline))
        return batch.map((item, index) => [item.id, reply?.answers?.[`item_${index}`]?.noul])
      }))
      const drop = new Set()
      for (const [id, p] of answers.flat()) {
        // A missing or malformed probability keeps the item.
        if (typeof p === 'number' && p >= 0 && p <= 1 && p < DROP_BELOW) drop.add(id)
      }
      return drop
    } catch {
      return new Set()
    }
  }
}
