/**
 * Attach-time image check: the selected model declares it cannot read images
 * while the draft holds one. The Host refuses such a send, so the composer
 * says so as soon as the image lands, and names a model that can read it.
 */
import type { ModelDirectoryState } from './directory.ts'
import { refusalOf, type ModelRefusal } from './capability-check.ts'

/** A draft image the selected model cannot read. */
export type ImageRefusal = ModelRefusal

/**
 * Decide whether the selected model refuses the draft's images.
 * @param directory - the session's model directory snapshot.
 * @param hasImage - whether the draft holds an image attachment.
 * @returns the refusal, or undefined when there is no image, no selection, or the model reads images or does not say.
 */
export function imageRefusalOf(directory: ModelDirectoryState, hasImage: boolean): ImageRefusal | undefined {
  return hasImage ? refusalOf(directory, model => model.imageInput) : undefined
}
