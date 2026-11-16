import type { UnloadResult } from './engine-types'

/** What a local engine reports for a loaded model. */
export interface LocalModelProps {
  /** The context window the model was launched with. */
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  isSleeping?: boolean
  modalities?: { vision: boolean; video: boolean; audio: boolean }
}

/** The runtime queries the app makes of a local inference engine. */
export interface LocalEngineService {
  /** Undefined until the model is loaded. */
  getModelProps(modelId: string): Promise<LocalModelProps | undefined>
  unload(modelId: string): Promise<UnloadResult>
}

/** A compute device the llama.cpp engine can run on. */
export interface EngineDevice {
  id: string
  name: string
  mem: number
  free: number
}

export interface LlamacppService extends LocalEngineService {
  getDevices(): Promise<EngineDevice[]>
  /** Restarts the engine when the machine's devices changed since it started. */
  reconcileEngineDevices(): Promise<'unchanged' | 'restarted' | 'busy'>
}
