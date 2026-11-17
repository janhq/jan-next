/**
 * Attach-time image check: the selected model declares it cannot read images
 * while the draft holds one. The Host refuses such a send, so the composer
 * says so as soon as the image lands, and names a model that can read it.
 */
import type { ModelSelection } from '@janhq/jan-api-remotes/client'
import type { ModelDirectoryState } from './directory.ts'

/** A draft image the selected model cannot read. */
export interface ImageRefusal {
  /** Display name of the selected model. */
  model: string
  /** The nearest model that reads images, preferring the selected provider; absent when none is loaded. */
  alternative?: { name: string; selection: ModelSelection }
}

/**
 * Decide whether the selected model refuses the draft's images.
 * @param directory - the session's model directory snapshot.
 * @param hasImage - whether the draft holds an image attachment.
 * @returns the refusal, or undefined when there is no image, no selection, or the model reads images or does not say.
 */
export function imageRefusalOf(directory: ModelDirectoryState, hasImage: boolean): ImageRefusal | undefined {
  const current = directory.current
  if (!hasImage || current === null) return undefined
  const group = directory.groups.find(entry => entry.id === current.provider)
  const model = group?.models.find(entry => entry.id === current.model)
  if (model?.imageInput !== false) return undefined
  const groups = group === undefined ? directory.groups : [group, ...directory.groups.filter(entry => entry !== group)]
  for (const candidate of groups) {
    const reader = candidate.models.find(entry => entry.imageInput === true)
    if (reader === undefined) continue
    const effort = reader.reasoning?.defaultEffort
    return {
      model: model.name,
      alternative: {
        name: reader.name,
        selection: { provider: candidate.id, model: reader.id, ...effort === undefined ? {} : { reasoningEffort: effort } },
      },
    }
  }
  return { model: model.name }
}
