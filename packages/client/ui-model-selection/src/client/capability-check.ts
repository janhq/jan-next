/**
 * Shared shape of the composer's capability checks: the selected model
 * declares it cannot do something the conversation needs, and the nearest
 * model that declares it can is offered instead. A model that does not say
 * is never refused and never offered.
 */
import type { ModelSelection } from '@janhq/jan-api-remotes/client'
import type { ModelCatalogModel } from '@janhq/jan-api-session-controller/types'
import type { ModelDirectoryState } from './directory.ts'

/** The selected model refuses a capability. */
export interface ModelRefusal {
  /** Display name of the selected model. */
  model: string
  /** The nearest model that declares the capability, preferring the selected provider; absent when none is loaded. */
  alternative?: { name: string; selection: ModelSelection }
}

/**
 * Decide whether the selected model refuses a capability, and which model to offer.
 * @param directory - the session's model directory snapshot.
 * @param answer - the capability's declared answer for one model: true, false, or undefined when it does not say.
 * @returns the refusal, or undefined without a selection or when the selected model does not answer false.
 */
export function refusalOf(
  directory: ModelDirectoryState, answer: (model: ModelCatalogModel) => boolean | undefined,
): ModelRefusal | undefined {
  const current = directory.current
  if (current === null) return undefined
  const group = directory.groups.find(entry => entry.id === current.provider)
  const model = group?.models.find(entry => entry.id === current.model)
  if (model === undefined || answer(model) !== false) return undefined
  const groups = group === undefined ? directory.groups : [group, ...directory.groups.filter(entry => entry !== group)]
  for (const candidate of groups) {
    const able = candidate.models.find(entry => answer(entry) === true)
    if (able === undefined) continue
    const effort = able.reasoning?.defaultEffort
    return {
      model: model.name,
      alternative: {
        name: able.name,
        selection: { provider: candidate.id, model: able.id, ...effort === undefined ? {} : { reasoningEffort: effort } },
      },
    }
  }
  return { model: model.name }
}
