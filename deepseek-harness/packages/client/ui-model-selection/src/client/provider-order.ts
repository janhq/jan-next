/** Shared provider display order for the composer and command model pickers. */

/**
 * Put the desktop's local engine first, then account and official providers, preserving other order.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) =>
    (left.id === 'ow-llamacpp' ? 0 : left.id === 'deepseek-account' ? 1 : left.id === 'deepseek-official' ? 2 : 3)
    - (right.id === 'ow-llamacpp' ? 0 : right.id === 'deepseek-account' ? 1 : right.id === 'deepseek-official' ? 2 : 3))
}
