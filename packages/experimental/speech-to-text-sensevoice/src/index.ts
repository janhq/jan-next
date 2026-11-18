/** Optional local SenseVoice provider; activation performs no downloads or model loading. */
import { isAbsolute } from 'node:path'
import type { Context } from '@janhq/cordis'
import type {} from '@janhq/jan-experimental-speech-to-text'
import type {} from '@janhq/jan-subprocess'
import type { SpeechProviderId } from '@janhq/jan-experimental-speech-to-text/types'
import { Config } from './config.ts'
import { SenseVoiceWorker } from './recognizer.ts'
import { languages } from './input.ts'

export { Config } from './config.ts'
export const name = 'experimental-speech-to-text-sensevoice'
export const inject = ['speechToText', 'subprocess']

declare module '@janhq/cordis' {
  interface Context {
    /** Mounted SenseVoice provider, including while its download or worker is settling. */
    senseVoiceWorker: SenseVoiceWorker
  }
}

/**
 * Register the local recognizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const path of [config.dataRoot, config.modelDirectory, config.vadModelPath]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`SenseVoice paths must be absolute: ${path}`)
  }
  for (const origin of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(origin)
  const worker = new SenseVoiceWorker(ctx, config)
  ctx.provide('senseVoiceWorker', worker)
  const estimatedBytes = config.precision === 'int8' ? 1_000_000_000 : 2_000_000_000
  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: { id: config.providerId as SpeechProviderId, name: `SenseVoiceSmall (${config.precision.toUpperCase()})`, location: 'host-local', languages, downloadSources: worker.downloadSources,
        setupEstimate: { recommendedDiskBytes: estimatedBytes, expectedMemoryBytes: estimatedBytes,
          minimumMinutes: 1, maximumMinutes: 10 } },
      preparation: worker,
      transcribe: async (input, signal) => await worker.transcribe(input, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
}
