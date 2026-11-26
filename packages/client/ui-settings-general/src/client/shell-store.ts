/** Shared settings viewing state for its mouse and command entry points. */
import { defineStore, type EngineStoreHandle } from '@janhq/jan-client-store'
import type { SettingsSearchTarget } from './settings-search.ts'

type State = { open: boolean; activeId: string | undefined; reveal: SettingsSearchTarget | undefined; revealSequence: number }
type Actions = {
  open(draft: State): void
  close(draft: State): void
  select(draft: State, id: string): void
  openSection(draft: State, id: string): void
  openTarget(draft: State, target: SettingsSearchTarget): void
}

/** Declared Settings viewing store shared with the navigation service. */
export type SettingsShellStore = EngineStoreHandle<State, Actions>

/**
 * Declare the settings dialog state and its complete mutation API.
 * @returns one root-scoped store handle for the settings shell.
 */
export function createSettingsShellStore(): SettingsShellStore {
  return defineStore({
    init: (): State => ({ open: false, activeId: undefined, reveal: undefined, revealSequence: 0 }),
    actions: {
      open: (d) => { d.open = true },
      close: (d) => { d.open = false; d.activeId = undefined; d.reveal = undefined },
      select: (d, id: string) => { d.activeId = id; d.reveal = undefined },
      openSection: (d, id: string) => { d.activeId = id; d.open = true; d.reveal = undefined },
      openTarget: (d, target) => {
        d.open = true
        d.activeId = target.sectionId
        d.reveal = target
        d.revealSequence += 1
      },
    },
  })
}
