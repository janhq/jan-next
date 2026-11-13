import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

interface DshSettingsState {
  /** New chats run on DeepSeek Harness instead of the built-in agent. */
  enabled: boolean
  /** The deepseek-harness checkout (built, with `pnpm install` done). */
  root: string
  /** Folder the agent's bash and file tools work in; empty means a private one. */
  workspace: string
  setEnabled: (enabled: boolean) => void
  setRoot: (root: string) => void
  setWorkspace: (workspace: string) => void
}

export const useDshSettings = create<DshSettingsState>()(
  persist(
    (set) => ({
      enabled: false,
      root: '',
      workspace: '',
      setEnabled: (enabled) => set({ enabled }),
      setRoot: (root) => set({ root }),
      setWorkspace: (workspace) => set({ workspace }),
    }),
    {
      name: localStorageKey.settingDsh,
      storage: createJSONStorage(() => backendStorage),
      // Rehydrated in hydrateBackendStores() once the ServiceHub is ready.
      skipHydration: true,
    }
  )
)
