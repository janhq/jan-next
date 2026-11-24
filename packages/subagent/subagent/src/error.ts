/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @janhq/jan-subagent
 */

import { HarnessError } from '@janhq/jan-llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
