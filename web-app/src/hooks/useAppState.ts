import { create } from 'zustand'

export type ModelLoadProgress = {
  modelId: string
  value: number
  stage?: string
  stages?: string[]
}

type AppErrorMessage = {
  message?: string
  title?: string
  subtitle: string
}

type AppState = {
  loadingModel?: boolean
  serverStatus: 'running' | 'stopped' | 'pending'
  errorMessage?: AppErrorMessage
  modelLoadProgress?: ModelLoadProgress
  activeModels: string[]

  loadingModels: Record<string, boolean>
  modelLoadProgressByThread: Record<string, ModelLoadProgress>
  oomError?: string
  backendError?: string

  setOomError: (line: string | undefined) => void
  setBackendError: (line: string | undefined) => void

  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateLoadingModel: (loading: boolean) => void
  setErrorMessage: (error: AppErrorMessage | undefined) => void
  updateModelLoadProgress: (progress: ModelLoadProgress | undefined) => void
  setActiveModels: (models: string[]) => void
  removeActiveModel: (modelId: string) => void

  updateThreadLoadingModel: (threadId: string, loading: boolean) => void
  updateThreadModelLoadProgress: (
    threadId: string,
    progress: ModelLoadProgress | undefined
  ) => void
  clearThreadState: (threadId: string) => void
}

export const useAppState = create<AppState>()((set) => ({
  loadingModel: false,
  serverStatus: 'stopped',
  activeModels: [],
  loadingModels: {},
  modelLoadProgressByThread: {},
  setOomError: (line) => set({ oomError: line }),
  setBackendError: (line) => set({ backendError: line }),
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
  setServerStatus: (value) => set({ serverStatus: value }),
  setErrorMessage: (error) => {
    set(() => ({
      errorMessage: error,
    }))
  },
  updateModelLoadProgress: (progress) => {
    set(() => ({
      modelLoadProgress: progress,
    }))
  },
  setActiveModels: (models: string[]) => {
    set(() => ({
      activeModels: models,
    }))
  },
  removeActiveModel: (modelId: string) => {
    set((state) => ({
      activeModels: state.activeModels.filter((id) => id !== modelId),
    }))
  },

  updateThreadLoadingModel: (threadId, loading) =>
    set((state) => {
      const next = { ...state.loadingModels }
      if (loading) next[threadId] = true
      else delete next[threadId]
      return { loadingModels: next }
    }),
  updateThreadModelLoadProgress: (threadId, progress) =>
    set((state) => {
      const next = { ...state.modelLoadProgressByThread }
      if (progress) next[threadId] = progress
      else delete next[threadId]
      return { modelLoadProgressByThread: next }
    }),
  clearThreadState: (threadId) =>
    set((state) => {
      const loadingModels = { ...state.loadingModels }
      const modelLoadProgressByThread = { ...state.modelLoadProgressByThread }
      delete loadingModels[threadId]
      delete modelLoadProgressByThread[threadId]
      return { loadingModels, modelLoadProgressByThread }
    }),
}))

export const useIsThreadActive = (threadId: string | undefined) =>
  useAppState((state) => (threadId ? threadId in state.loadingModels : false))
