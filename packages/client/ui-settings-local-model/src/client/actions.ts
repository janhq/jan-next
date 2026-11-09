/** Remote calls shared by the card and the first-run option; failures surface through the Host state. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-llama-cpp-controller/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LocalModelMirror } from './state.ts'

/** Operations a view may trigger. */
export interface LocalModelActions {
  install: () => void
  cancel: () => void
  start: () => void
  stop: () => void
  uninstall: () => void
}

/** Registration-side dependencies of both views. */
export interface LocalModelInjected {
  hooks: { localModel: SnapshotStore<LocalModelMirror> }
  actions: LocalModelActions
}

/**
 * Bind the Remote calls once.
 * @param ctx - context owning the mounted `llamaCpp` Remote.
 * @returns fire-and-forget actions.
 */
export function createActions(ctx: Context): LocalModelActions {
  const run = (call: () => Promise<{ ok: boolean; error?: unknown }>): void => {
    void call().then((result) => {
      if (!result.ok) ctx.logger?.warn?.(result.error)
    }, (error: unknown) => { ctx.logger?.warn?.(error) })
  }
  return {
    install: () => { run(() => ctx.remote.llamaCpp.beginInstall()) },
    cancel: () => { run(() => ctx.remote.llamaCpp.cancelInstall()) },
    start: () => { run(() => ctx.remote.llamaCpp.startServer()) },
    stop: () => { run(() => ctx.remote.llamaCpp.stopServer()) },
    uninstall: () => { run(() => ctx.remote.llamaCpp.removeInstall()) },
  }
}
