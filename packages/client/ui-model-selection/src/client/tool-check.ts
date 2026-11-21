/**
 * Tool-use check: the selected model declares it cannot call tools (a local
 * model whose chat template has no tool support). Every Jan mode works through
 * tools, so the composer says so as soon as the model is selected, before the
 * user writes a task, and names a model that can use tools.
 */
import type { ModelDirectoryState } from './directory.ts'
import { refusalOf, type ModelRefusal } from './capability-check.ts'

/**
 * Decide whether the selected model refuses tools.
 * @param directory - the session's model directory snapshot.
 * @returns the refusal, or undefined without a selection or when the model uses tools or does not say.
 */
export function toolRefusalOf(directory: ModelDirectoryState): ModelRefusal | undefined {
  return refusalOf(directory, model => model.toolUse)
}
