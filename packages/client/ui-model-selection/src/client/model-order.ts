/**
 * Picker order for model names: names of one family sit together in reading
 * order, and inside a family the newest version comes first, so
 * `claude-haiku-5-5` lists above `claude-haiku-4-5-20251001`.
 */

/** A run of numbers joined by version separators, such as `4-5-20251001` or `4.1`. */
const VERSION_RUN = /\d+(?:[.\-_]\d+)*/g

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Split a model name into its family (the name with every version run
 * collapsed to `#`) and the numbers of its version runs, in order.
 */
function versionKey(name: string): { family: string; numbers: number[] } {
  const numbers: number[] = []
  const family = name.replace(VERSION_RUN, (run) => {
    for (const part of run.split(/[.\-_]/)) numbers.push(Number(part))
    return '#'
  })
  return { family, numbers }
}

/**
 * Compare two model labels for the picker: family ascending, then version
 * descending (a dated snapshot of the same version sorts after the undated
 * name), then the label itself.
 * @param a - first display label.
 * @param b - second display label.
 * @returns negative when `a` lists first.
 */
export function compareModelNames(a: string, b: string): number {
  const left = versionKey(a)
  const right = versionKey(b)
  const family = collator.compare(left.family, right.family)
  if (family !== 0) return family
  const length = Math.min(left.numbers.length, right.numbers.length)
  for (let index = 0; index < length; index++) {
    const difference = (right.numbers[index] ?? 0) - (left.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.numbers.length !== right.numbers.length) return left.numbers.length - right.numbers.length
  return collator.compare(a, b)
}
