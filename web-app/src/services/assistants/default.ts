/**
 * Default Assistants Service - assistants live as JSON files in the data folder
 */

import type { Assistant } from '@janhq/core'
import type { AssistantsService } from './types'
import { Assistants } from './store'

// Migrations and default seeding run once, on first use.
let store: Promise<Assistants> | undefined
const assistants = () =>
  (store ??= (async () => {
    const s = new Assistants()
    await s.prepare()
    return s
  })().catch((e) => {
    store = undefined
    throw e
  }))

export class DefaultAssistantsService implements AssistantsService {
  async getAssistants(): Promise<Assistant[] | null> {
    return (await assistants()).getAssistants()
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    await (await assistants()).createAssistant(assistant)
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    await (await assistants()).deleteAssistant(assistant)
  }
}
