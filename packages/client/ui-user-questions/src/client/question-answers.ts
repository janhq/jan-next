import type { AskUserQuestionItem } from '@janhq/jan-user-questions/types'

/** Split the recommendation suffix for display without changing the submitted label. */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** All marked choices in a multi-select question, or the marked first choice otherwise. */
export function recommendedOptions(question: AskUserQuestionItem): string[] {
  const options = question.options ?? []
  const selected: string[] = []
  for (const option of options) {
    if (parseRecommendedLabel(option.label).recommended) selected.push(option.label)
    if (question.multiSelect !== true) break
  }
  return selected
}
