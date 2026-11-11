/**
 * Remote calls shared by the card, the model manager and the first-run option. Lifecycle failures
 * surface through the Host state; lookups and imports answer the caller directly.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HuggingFaceRepoInfo } from '@deepseek-ai/dsh-api-llama-cpp-controller'
import type {} from '@deepseek-ai/dsh-api-llama-cpp-controller/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LocalModelMirror } from './state.ts'

/** Outcome of a call whose failure the calling view shows itself. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }

/** Operations a view may trigger. */
export interface LocalModelActions {
  install: () => void
  cancel: () => void
  start: () => void
  stop: () => void
  uninstall: () => void
  /** Download a curated model by catalog id. */
  downloadModel: (id: string) => void
  /** Stop a download, or dismiss a failed one. */
  cancelDownload: (id: string) => void
  /** Run an installed model. */
  selectModel: (id: string) => void
  /** Remove an installed model. */
  deleteModel: (id: string) => void
  /** List a Hugging Face repository's downloadable files. */
  lookupRepo: (repo: string, signal?: AbortSignal) => Promise<Outcome<HuggingFaceRepoInfo>>
  /** Download one file of a Hugging Face repository. */
  downloadRepoFile: (repo: string, file: string) => Promise<Outcome<string>>
  /** Add a GGUF file from the Host's disk. */
  importModel: (path: string) => Promise<Outcome<string>>
}

/** Registration-side dependencies of every view. */
export interface LocalModelInjected {
  hooks: { localModel: SnapshotStore<LocalModelMirror> }
  actions: LocalModelActions
}

/**
 * Bind the Remote calls once.
 * @param ctx - context owning the mounted `llamaCpp` Remote.
 * @returns the actions.
 */
export function createActions(ctx: Context): LocalModelActions {
  const run = (call: () => Promise<{ ok: boolean; error?: unknown }>): void => {
    void call().then((result) => {
      if (!result.ok) ctx.logger.warn(result.error)
    }, (error: unknown) => { ctx.logger.warn(error) })
  }
  type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
  const answer = async <T>(call: () => Promise<Result<T>>): Promise<Outcome<T>> => {
    try {
      const result = await call()
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return {
    install: () => { run(() => ctx.remote.llamaCpp.beginInstall()) },
    cancel: () => { run(() => ctx.remote.llamaCpp.cancelInstall()) },
    start: () => { run(() => ctx.remote.llamaCpp.startServer()) },
    stop: () => { run(() => ctx.remote.llamaCpp.stopServer()) },
    uninstall: () => { run(() => ctx.remote.llamaCpp.removeInstall()) },
    downloadModel: (id) => { run(() => ctx.remote.llamaCpp.downloadModel(id)) },
    cancelDownload: (id) => { run(() => ctx.remote.llamaCpp.cancelDownload(id)) },
    selectModel: (id) => { run(() => ctx.remote.llamaCpp.selectModel(id)) },
    deleteModel: (id) => { run(() => ctx.remote.llamaCpp.deleteModel(id)) },
    lookupRepo: (repo, signal) => answer(() => ctx.remote.llamaCpp.lookupRepo(repo, signal)),
    downloadRepoFile: (repo, file) => answer(() => ctx.remote.llamaCpp.downloadRepoFile(repo, file)),
    importModel: path => answer(() => ctx.remote.llamaCpp.importModel(path)),
  }
}
