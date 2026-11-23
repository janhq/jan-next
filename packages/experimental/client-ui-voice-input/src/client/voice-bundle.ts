/** Observe and enable the installed Voice Input bundle through Plugin Manager. */
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@janhq/jan-client-store'

/** The optional bundle's profile selection, separate from preparation state. */
export type VoiceBundleState = 'checking' | 'disabled' | 'enabled' | 'unmanaged' | 'error' | 'restart'

/** Plugin Manager name used for setup and settings navigation. */
export const VOICE_BUNDLE = '@janhq/jan-experimental-voice-input-bundle'

/**
 * Track the same persisted bundle selection as the Plugins page, without starting any preparation.
 * @param ctx - client runtime with the Remote service.
 * @returns observable selection and the existing management operations.
 */
export function observeVoiceBundle(ctx: Context): {
  state: SnapshotStore<VoiceBundleState>
  refresh: () => Promise<void>
  enable: () => Promise<void>
} {
  const state = createSnapshotStore<VoiceBundleState>('unmanaged')
  let manager: Context['remote']['pluginManager'] | undefined
  let revision = 0
  let disposed = false
  const refresh = async (): Promise<void> => {
    const request = ++revision
    try {
      const result = await manager?.listBundles()
      if (disposed || request !== revision) return
      if (result && !result.ok) { state.set('error'); return }
      const bundle = result?.value.find((item: { name: string; enabled: boolean; availability: string }) => item.name === VOICE_BUNDLE)
      if (bundle?.enabled && state.getSnapshot() === 'restart') return
      state.set(!bundle || bundle.availability === 'missing' ? 'unmanaged' : bundle.enabled ? 'enabled' : 'disabled')
    } catch {
      if (!disposed && request === revision) state.set('error')
    }
  }
  ctx.inject(['remote.pluginManager'], (scope) => {
    scope.effect(function* () {
      manager = scope.remote.pluginManager
      state.set('checking')
      yield () => {
        manager = undefined
        revision++
        if (!disposed) state.set('unmanaged')
      }
      yield scope.remote.$on('plugin-manager/changed', () => { void refresh() })
      void refresh()
    })
  })
  ctx.on('connection/reset', () => { void refresh() })
  ctx.effect(() => () => { disposed = true })
  return {
    state,
    refresh,
    enable: async (): Promise<void> => {
      if (!manager) throw new Error('Plugin Manager is unavailable')
      const result = await manager.setBundleEnabled(VOICE_BUNDLE, true)
      if (!result.ok) throw result.error
      if (disposed) return
      if (result.value.application === 'restart-required') {
        revision++
        state.set('restart')
        throw new Error(result.value.restartReason)
      }
      if (result.value.application !== 'applied') throw new Error(result.value.error?.diagnostic ?? result.value.error?.code)
      revision++
      state.set('enabled')
    },
  }
}
