/**
 * Picker order for model names: names of one family sit together in reading
 * order, and inside a family the newest version comes first, so
 * `claude-haiku-5-5` lists above `claude-haiku-5` and `claude-haiku-4-5-20251001`.
 */

/** A run of numbers joined by version separators, such as `4-5-20251001` or `4.1`. */
const VERSION_RUN = /\d+(?:[.\-_]\d+)*/g

/** A bracketed variant tag such as `[1m]` (a context size, not a version). */
const TAG = /\[[^\]]*\]/g

/** Version parts at or above this are dates of a snapshot, not minor versions. */
const SNAPSHOT_PART = 1000

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Parsed labels; catalogs are small and their labels repeat across every keystroke's sort. */
const parsed = new Map<string, { readonly family: string; readonly numbers: readonly number[] }>()

/**
 * Split a model name into its family (the name with every version run
 * collapsed to `#`) and the numbers of its version runs, in order. Bracketed
 * tags are dropped from both.
 */
function versionKey(name: string): { readonly family: string; readonly numbers: readonly number[] } {
  const cached = parsed.get(name)
  if (cached !== undefined) return cached
  const numbers: number[] = []
  const family = name.replace(TAG, '').replace(VERSION_RUN, (run) => {
    for (const part of run.split(/[.\-_]/)) numbers.push(Number(part))
    return '#'
  })
  const key = { family, numbers }
  parsed.set(name, key)
  return key
}

/**
 * Newest first. Where one version extends the other, a further minor part is
 * newer (`5-5` before `5`) while a date part is a snapshot of the same
 * version and lists after it (`4-5` before `4-5-20251001`).
 */
function compareVersions(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.length === right.length) return 0
  const longer = left.length > right.length ? left : right
  const newer = (longer[length] ?? 0) < SNAPSHOT_PART
  return (longer === left) === newer ? -1 : 1
}

/**
 * Compare two model labels for the picker: family ascending, then version
 * descending, then the label itself.
 * @param a - first display label.
 * @param b - second display label.
 * @returns negative when `a` lists first.
 */
export function compareModelNames(a: string, b: string): number {
  const left = versionKey(a)
  const right = versionKey(b)
  return collator.compare(left.family, right.family) || compareVersions(left.numbers, right.numbers) || collator.compare(a, b)
}

/**
 * Compare two model labels by version alone, newest first, across families:
 * `claude-opus-5-5` before `claude-opus-5` before `claude-opus-4-8`. Equal
 * versions, and names without a version, fall back to the picker's name order.
 * @param a - first display label.
 * @param b - second display label.
 * @returns negative when `a` lists first.
 */
export function compareNewest(a: string, b: string): number {
  const left = versionKey(a).numbers
  const right = versionKey(b).numbers
  if (left.length === 0 || right.length === 0) return compareModelNames(a, b)
  return compareVersions(left, right) || compareModelNames(a, b)
}
