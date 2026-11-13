/**
 * The work panel beside a chat: which tab shows and which file is previewed.
 * Global rather than per thread: the panel is a place in the window, and it
 * stays where the user left it as they move between chats.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

export const WORK_PANEL_DEFAULT_W = 320

export type WorkTab = 'progress' | 'changes' | 'files' | 'preview'

type State = {
  open: boolean
  tab: WorkTab
  /** Path the Preview tab shows, as the agent wrote it (relative to the folder). */
  previewPath: string | null
  /** Bumped by Reload so the preview reads the file again. */
  previewNonce: number
  /** Panel width in px, dragged by its left edge. */
  width: number
  setWidth: (width: number) => void
  show: (tab: WorkTab) => void
  preview: (path: string) => void
  reload: () => void
  close: () => void
  toggle: () => void
}

export const useWorkPanel = create<State>()(
  persist(
    (set) => ({
      open: false,
      tab: 'progress',
      previewPath: null,
      previewNonce: 0,
      width: WORK_PANEL_DEFAULT_W,
      setWidth: (width) => set({ width }),
      show: (tab) => set({ open: true, tab }),
      preview: (path) =>
        set((s) => ({
          open: true,
          tab: 'preview',
          previewPath: path,
          previewNonce: s.previewNonce + 1,
        })),
      reload: () => set((s) => ({ previewNonce: s.previewNonce + 1 })),
      close: () => set({ open: false }),
      toggle: () => set((s) => ({ open: !s.open })),
    }),
    {
      name: localStorageKey.workPanel,
      storage: createJSONStorage(() => backendStorage),
      // Rehydrated in hydrateBackendStores() once the ServiceHub is ready.
      skipHydration: true,
      // Only the layout survives a restart; a preview names one chat's file.
      partialize: (s) => ({
        open: s.open,
        tab: s.tab === 'preview' ? 'files' : s.tab,
        width: s.width,
      }),
    }
  )
)
