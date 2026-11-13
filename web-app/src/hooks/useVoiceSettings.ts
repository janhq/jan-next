import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

/** Kokoro presets offered in Settings; must match `VOICES` in core/speech/mod.rs. */
export const VOICES = [
  { id: 'af_heart', name: 'Heart', accent: 'US' },
  { id: 'af_bella', name: 'Bella', accent: 'US' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US' },
  { id: 'af_sky', name: 'Sky', accent: 'US' },
  { id: 'af_nova', name: 'Nova', accent: 'US' },
  { id: 'af_aoede', name: 'Aoede', accent: 'US' },
  { id: 'af_kore', name: 'Kore', accent: 'US' },
  { id: 'af_jessica', name: 'Jessica', accent: 'US' },
  { id: 'af_sarah', name: 'Sarah', accent: 'US' },
  { id: 'af_alloy', name: 'Alloy', accent: 'US' },
  { id: 'af_river', name: 'River', accent: 'US' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'UK' },
  { id: 'bf_alice', name: 'Alice', accent: 'UK' },
  { id: 'bf_lily', name: 'Lily', accent: 'UK' },
] as const

export const DEFAULT_VOICE = 'af_heart'

interface VoiceSettingsState {
  voice: string
  setVoice: (voice: string) => void
}

export const useVoiceSettings = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      voice: DEFAULT_VOICE,
      setVoice: (voice) => set({ voice }),
    }),
    {
      name: localStorageKey.settingVoice,
      storage: createJSONStorage(() => backendStorage),
      // Rehydrated in hydrateBackendStores() once the ServiceHub is ready.
      skipHydration: true,
    }
  )
)
