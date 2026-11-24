import type { AskUserQuestionItem } from '@janhq/jan-user-questions/types'

/**
 * Split the recommendation suffix for display without changing the submitted label.
 * @param label - original option label supplied with the question.
 * @returns the display label and whether a recommendation suffix was removed.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/**
 * Derive defaults from all marked choices in a multi-select question, or only the first choice otherwise.
 * @param question - question with its original options and selection mode.
 * @returns original labels of the recommended choices, in option order.
 */
export function recommendedOptions(question: AskUserQuestionItem): string[] {
  const options = question.options ?? []
  const selected: string[] = []
  for (const option of options) {
    if (parseRecommendedLabel(option.label).recommended) selected.push(option.label)
    if (question.multiSelect !== true) break
  }
  return selected
}
