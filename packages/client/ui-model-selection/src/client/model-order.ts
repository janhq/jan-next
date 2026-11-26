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

/**
 * Display names for one provider's models: a router name such as
 * `anthropic/claude-opus-5-5` drops its vendor prefix unless that would make
 * two rows read the same.
 * @param models - one provider's catalog models.
 * @returns each model id's display name.
 */
export function displayNames(models: readonly { id: string; name: string }[]): Map<string, string> {
  const short = (name: string): string => name.slice(name.lastIndexOf('/') + 1) || name
  const counts = new Map<string, number>()
  for (const model of models) counts.set(short(model.name), (counts.get(short(model.name)) ?? 0) + 1)
  return new Map(models.map(model => [model.id, counts.get(short(model.name)) === 1 ? short(model.name) : model.name]))
}

/**
 * One provider's models in the order every model picker lists them.
 * @param models - one provider's catalog models.
 * @returns a sorted copy, ordered by {@link compareModelNames} over display names.
 */
export function pickerOrder<M extends { id: string; name: string }>(models: readonly M[]): M[] {
  const names = displayNames(models)
  const label = (model: M): string => names.get(model.id) ?? model.name
  return [...models].sort((a, b) => compareModelNames(label(a), label(b)))
}
