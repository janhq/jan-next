/** Authenticated, cancellation-aware browser access to the managed local llama.cpp model. */
import { Context } from '@janhq/cordis'
import { resolveJanHome } from '@janhq/jan-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@janhq/jan-typert-protocol'
import type {} from '@janhq/jan-llama-cpp'
import type { HuggingFaceRepoInfo, LlamaCppState, StoredDownload } from '@janhq/jan-llama-cpp/types'
import { repositoryCaches, speechCaches, type RepositoryCacheOwner } from './stored-caches.ts'

export type {
  CatalogModelInfo, HuggingFaceFileInfo, HuggingFaceRepoInfo, ImportModelOptions, LlamaCppDevice, LlamaCppDownload, LlamaCppHardware,
  LlamaCppHostPlatform, LlamaCppModelInfo, LlamaCppPhase, LlamaCppProgress, LlamaCppState, LocalModelEntry, LocalModelSource,
  LocalModelStatus, ModelFit, StoredDownload,
} from '@janhq/jan-llama-cpp/types'

declare module '@janhq/jan-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The local model operation failed. */
    'llama-cpp/failed': { readonly reason: string }
  }
}

declare module '@janhq/cordis' {
  interface Context {
    /** Local model Remote controller. */
    llamaCppController: LlamaCppController
  }
}

function failed(error: unknown): RemoteError {
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError('llama-cpp/failed', reason, { reason })
}

/** Install, start, stop and remove the local models and the worker serving them; progress arrives through {@link follow}. */
export default class LlamaCppController extends TypertRemoteService {
  static inject = ['llamaCpp', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'llamaCppController', { namespace: 'llamaCpp' })
  }

  /**
   * Read the current state.
   * @returns phase, model facts and progress; never paths or keys.
   */
  @Remote
  readState(): LlamaCppState { return this.ctx.llamaCpp.snapshot() }

  /**
   * Follow the state.
   * @param signal - Client observation lifetime.
   * @returns the current state, then one snapshot per change.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<LlamaCppState> {
    for await (const state of this.ctx.llamaCpp.follow(signal)) yield state
  }

  /** First run: download and verify the first-run model, then start the worker; with a model installed, start it. */
  @Remote
  beginInstall(): void {
    try { this.ctx.llamaCpp.install() } catch (error) { throw failed(error) }
  }

  /**
   * Stop every download in progress; each resumes when it is started again.
   * @returns after the downloads settle.
   */
  @Remote
  async cancelInstall(): Promise<void> { await this.ctx.llamaCpp.cancel() }

  /**
   * Download a curated model; the first model installed also starts.
   * @param id - catalog id from the state's `catalog`.
   */
  @Remote
  downloadModel(id: string): void {
    try { this.ctx.llamaCpp.downloadCatalog(id) } catch (error) { throw failed(error) }
  }

  /**
   * List the downloadable GGUF files of a Hugging Face repository.
   * @param repo - `owner/name` or a huggingface.co link.
   * @param signal - Client cancellation.
   * @returns the repository and its files.
   */
  @Remote
  async lookupRepo(repo: string, signal: AbortSignal): Promise<HuggingFaceRepoInfo> {
    try { return await this.ctx.llamaCpp.lookupHuggingFace(repo, signal) } catch (error) { throw failed(error) }
  }

  /**
   * Download one file of a Hugging Face repository.
   * @param repo - `owner/name` or a huggingface.co link.
   * @param file - file name from {@link lookupRepo}.
   * @param signal - Client cancellation of the lookup that precedes the download.
   * @returns the model id it installs as.
   */
  @Remote
  async downloadRepoFile(repo: string, file: string, signal: AbortSignal): Promise<string> {
    try { return await this.ctx.llamaCpp.downloadHuggingFace(repo, file, signal) } catch (error) { throw failed(error) }
  }

  /**
   * Start a failed or paused download again, from its partial file.
   * @param id - model id of the failed or paused download.
   */
  @Remote
  retryDownload(id: string): void {
    try { this.ctx.llamaCpp.retry(id) } catch (error) { throw failed(error) }
  }

  /**
   * Pause a running or queued download, keeping its partial file for {@link retryDownload}.
   * @param id - model id of the download.
   */
  @Remote
  pauseDownload(id: string): void {
    try { this.ctx.llamaCpp.pause(id) } catch (error) { throw failed(error) }
  }

  /**
   * Stop one download and discard its files, or dismiss it when it failed.
   * @param id - model id of the download.
   * @returns after it settles.
   */
  @Remote
  async cancelDownload(id: string): Promise<void> { await this.ctx.llamaCpp.cancel(id) }

  /** Jan's on-disk downloads and caches, with paths relative to the Jan data folder. */
  @Remote
  async listStoredDownloads(): Promise<StoredDownload[]> {
    try {
      const home = resolveJanHome(this.ctx.get('profileContext')?.home)
      const [models, caches] = await Promise.all([this.ctx.llamaCpp.listStoredDownloads(home), this.storedCaches(home)])
      return [...models, ...caches.map(cache => cache.item)].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    } catch (error) { throw failed(error) }
  }

  /** Remove one currently listed download. @param path - exact Jan-home-relative path from the list. */
  @Remote
  async deleteStoredDownload(path: string): Promise<void> {
    try {
      const home = resolveJanHome(this.ctx.get('profileContext')?.home)
      const cache = (await this.storedCaches(home)).find(entry => entry.item.path === path)
      if (cache === undefined) await this.ctx.llamaCpp.deleteStoredDownload(home, path)
      else await cache.delete()
    } catch (error) { throw failed(error) }
  }

  private async storedCaches(home: string) {
    const market: RepositoryCacheOwner | undefined = this.ctx.get('pluginMarket')
    const speech = this.ctx.get('senseVoiceWorker', false)
    const [voice, repositories] = await Promise.all([
      speechCaches(home, speech === undefined ? undefined : 'Disable the Voice Input plugin before deleting its speech files.'),
      market === undefined ? [] : repositoryCaches(home, market),
    ])
    return [...voice, ...repositories]
  }

  /**
   * Add a GGUF file from this computer, left where it is.
   * @param path - absolute path on the Host.
   * @param projector - absolute Host path of the model's vision projector (mmproj) file; omitted for a text-only model.
   * @returns the model id.
   */
  @Remote
  async importModel(path: string, projector?: string): Promise<string> {
    try {
      return await this.ctx.llamaCpp.importModel(path, projector === undefined ? undefined : { projector })
    } catch (error) { throw failed(error) }
  }

  /**
   * Make an installed model the default, which the route's alias id serves, and load it; a stopped
   * worker starts. A start failure arrives through {@link follow}.
   * @param id - installed model id.
   * @returns after the worker serves it or has failed to start.
   */
  @Remote
  async setDefaultModel(id: string): Promise<void> {
    try { await this.ctx.llamaCpp.setDefault(id) } catch (error) { throw failed(error) }
  }

  /**
   * Current served context, GGUF-trained maximum when known, and auto-fit for one installed model.
   * @param id - installed model id; `local` names the default.
   * @returns served context tokens, the trained maximum when the GGUF declares one, and whether auto-fit is on.
   */
  @Remote
  getModelContext(id: string): { current: number; maximum?: number; fit: boolean } {
    try { return this.ctx.llamaCpp.getModelContext(id) } catch (error) { throw failed(error) }
  }

  /**
   * Persist a per-model context length and wait for the worker's new preset to load.
   * @param id - installed model id; `local` names the default.
   * @param contextSize - positive token count, at most the model's trained maximum.
   */
  @Remote
  async setModelContext(id: string, contextSize: number): Promise<void> {
    try { await this.ctx.llamaCpp.setModelContext(id, contextSize) } catch (error) { throw failed(error) }
  }

  /**
   * Persist and apply automatic GPU/memory fit for one installed model.
   * @param id - installed model id; `local` names the default.
   * @param fit - whether llama.cpp fits the context and offload to free memory.
   */
  @Remote
  async setModelFit(id: string, fit: boolean): Promise<void> {
    try { await this.ctx.llamaCpp.setModelFit(id, fit) } catch (error) { throw failed(error) }
  }

  /**
   * Grow the context to the next step, reload the model, or answer null at its maximum.
   * @param id - installed model id; `local` names the default.
   * @returns the new context length, or null when the model cannot grow further.
   */
  @Remote
  async increaseModelContext(id: string): Promise<number | null> {
    try { return await this.ctx.llamaCpp.increaseModelContext(id) } catch (error) { throw failed(error) }
  }

  /**
   * Load an installed model now instead of on its first request, starting a stopped worker.
   * @param id - installed model id.
   * @returns after it is loaded.
   */
  @Remote
  async loadModel(id: string): Promise<void> {
    try { await this.ctx.llamaCpp.loadModel(id) } catch (error) { throw failed(error) }
  }

  /**
   * Free a loaded model's memory; it loads again on its next request.
   * @param id - installed model id.
   * @returns after it is unloaded.
   */
  @Remote
  async unloadModel(id: string): Promise<void> {
    try { await this.ctx.llamaCpp.unloadModel(id) } catch (error) { throw failed(error) }
  }

  /**
   * Remove an installed model, unloading it first; an imported file is only forgotten.
   * @param id - installed model id.
   * @returns after it is removed.
   */
  @Remote
  async deleteModel(id: string): Promise<void> {
    try { await this.ctx.llamaCpp.removeModel(id) } catch (error) { throw failed(error) }
  }

  /**
   * Start the worker with the default model.
   * @returns after it is running or has failed.
   */
  @Remote
  async startServer(): Promise<void> { await this.ctx.llamaCpp.start() }

  /**
   * Stop the worker.
   * @returns after it has exited.
   */
  @Remote
  async stopServer(): Promise<void> {
    try { await this.ctx.llamaCpp.stop() } catch (error) { throw failed(error) }
  }

  /**
   * Stop the worker, delete every downloaded model and remove the route credentials.
   * @returns after the files are gone.
   */
  @Remote
  async removeInstall(): Promise<void> {
    try { await this.ctx.llamaCpp.uninstall() } catch (error) { throw failed(error) }
  }
}
