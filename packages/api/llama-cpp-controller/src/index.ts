/** Authenticated, cancellation-aware browser access to the managed local llama.cpp model. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-llama-cpp'
import type { LlamaCppState } from '@deepseek-ai/dsh-llama-cpp/types'

export type { LlamaCppState, LlamaCppPhase, LlamaCppProgress, LlamaCppModelInfo } from '@deepseek-ai/dsh-llama-cpp/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The local model operation failed. */
    'llama-cpp/failed': { readonly reason: string }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local model Remote controller. */
    llamaCppController: LlamaCppController
  }
}

function failed(error: unknown): RemoteError {
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError('llama-cpp/failed', reason, { reason })
}

/** Install, start, stop and remove the local model; progress arrives through {@link follow}. */
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

  /** Download what is missing, verify it, then start the server. */
  @Remote
  beginInstall(): void {
    try { this.ctx.llamaCpp.install() } catch (error) { throw failed(error) }
  }

  /**
   * Stop a download in progress; it resumes on the next install.
   * @returns after the install task settles.
   */
  @Remote
  async cancelInstall(): Promise<void> { await this.ctx.llamaCpp.cancel() }

  /**
   * Start the installed server.
   * @returns after it is running or has failed.
   */
  @Remote
  async startServer(): Promise<void> { await this.ctx.llamaCpp.start() }

  /**
   * Stop the server.
   * @returns after it has exited.
   */
  @Remote
  async stopServer(): Promise<void> {
    try { await this.ctx.llamaCpp.stop() } catch (error) { throw failed(error) }
  }

  /**
   * Delete the engine and model and remove the route key.
   * @returns after the files are gone.
   */
  @Remote
  async removeInstall(): Promise<void> {
    try { await this.ctx.llamaCpp.uninstall() } catch (error) { throw failed(error) }
  }
}
