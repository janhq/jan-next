import { join } from 'node:path'
import { resolveJanHome } from '@janhq/jan-home-paths'
import { registerApi } from '@janhq/jan-plugin-api'
import { ProxyProcess } from './process.mjs'
import { modelRoute } from './route.mjs'
import { SubscriptionProxy } from './subscriptions.mjs'

/** Cordis identity for Jan's subscription sign-in plugin. */
export const name = 'jan-cli-proxy'

/** Host model runtime and authenticated same-origin plugin API. */
export const inject = ['llm', 'webServer', 'connection']

/** Mount the route and restore saved accounts without delaying Host startup. */
export function apply(ctx) {
  const proxy = new SubscriptionProxy(new ProxyProcess(join(resolveJanHome(), 'cli-proxy')), modelRoute(ctx), {
    // Upstream OAuth errors may carry codes or callback URLs. Do not log their causes.
    onError: operation => ctx.logger.warn(`CLIProxyAPI: ${operation} failed`),
  })
  ctx.effect(() => registerApi(ctx, 'cli-proxy', {
    state: () => proxy.state(),
    signIn: ({ provider }) => proxy.signIn(provider),
    cancel: () => proxy.cancel(),
    signOut: ({ id }) => proxy.signOut(id),
    retry: () => { void proxy.retry() },
  }, { maxBodyBytes: 4096 }))
  ctx.effect(() => {
    void proxy.restore()
    return () => proxy.dispose()
  }, 'CLIProxyAPI subscriptions')
}
