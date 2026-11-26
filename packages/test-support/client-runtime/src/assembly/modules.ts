/**
 * In-process module arrival: import every roster row's `/client` module (or
 * the plan's replacement) and register each as a pre-arrived factory on a
 * production `ClientModuleSystem`, so neither the Loader's `internal.import`
 * nor a stage-one `prefetch` ever fetches a bundle.
 * @module @janhq/jan-client-test-runtime/src/assembly/modules
 */
import * as modulesClient from '@janhq/jan-client-modules/client'
import { createClientModuleSystem } from '@janhq/jan-client-modules/client'
import type { ClientBundleRegistration, ClientModuleLoader, ClientModuleLoaderTarget, WebBootGraph } from '@janhq/jan-client-modules/client'
import { getStaticModules } from '@janhq/jan-client-web'
import type { AssemblyPlan, ClientPluginModule } from './roster.ts'

/** The bootstrap row: always this process's static namespace, never a dynamic import or a `provide` replacement. */
export const MODULES_PACKAGE = '@janhq/jan-client-modules'

/**
 * Resolve each roster row to its plugin module: `plan.provide[name]` when
 * present, otherwise a `/client` import resolved by the repository's tsconfig
 * path aliases under Vitest. The bootstrap row is the
 * statically imported `@janhq/jan-client-modules/client` namespace.
 * @param plan - validated plan.
 * @returns package name → module, in roster order.
 * @throws {Error} when an import fails (the package name prefixes the original message) or the bootstrap row is provided.
 */
export async function loadPluginModules(plan: AssemblyPlan): Promise<ReadonlyMap<string, ClientPluginModule>> {
  const modules = new Map<string, ClientPluginModule>()
  for (const { name } of plan.roster.rows) {
    const provided = plan.provide?.[name]
    if (name === MODULES_PACKAGE) {
      if (provided !== undefined) {
        throw new Error(`client-test-runtime: ${MODULES_PACKAGE} is the bootstrap module and cannot be provided`)
      }
      modules.set(name, modulesClient)
      continue
    }
    modules.set(name, provided ?? await importClient(name))
  }
  return modules
}

/**
 * Factories of rows whose `/client` entry is a plain loader script (a
 * `window.__ModuleLoader__.load(...)` call, as shipped by script plugins)
 * rather than an ES module. Keyed by package name: a module evaluates once
 * per test file, so later boots reuse the first registration.
 */
const scriptFactories = new Map<string, ClientBundleRegistration['factory']>()
/** Namespaces of loader scripts, which export nothing and stand in for their registered factory. */
const scriptNamespaces = new WeakMap<object, ClientBundleRegistration['factory']>()

async function importClient(name: string): Promise<ClientPluginModule> {
  const host = globalThis as { __ModuleLoader__?: unknown }
  const previous = Object.getOwnPropertyDescriptor(host, '__ModuleLoader__')
  // A loader script registers through the page-global loader while it evaluates; capture that registration.
  host.__ModuleLoader__ = {
    load: (registration: ClientBundleRegistration) => {
      if (registration.id === name && registration.chunk === undefined) scriptFactories.set(name, registration.factory)
    },
  }
  let namespace: object
  try {
    namespace = await import(/* @vite-ignore */ `${name}/client`) as object
  } catch (error) {
    throw new Error(`client-test-runtime: cannot import ${name}/client: ${String(error)}`, { cause: error })
  } finally {
    if (previous === undefined) Reflect.deleteProperty(host, '__ModuleLoader__')
    else Object.defineProperty(host, '__ModuleLoader__', previous)
  }
  const factory = scriptFactories.get(name)
  if (factory !== undefined) scriptNamespaces.set(namespace, factory)
  return namespace as ClientPluginModule
}

/**
 * Build the production module system over queued factories returning the
 * loaded namespaces. The bootstrap row uses `bootstrapModule`. A loader-script
 * row queues its own registered factory, which resolves `require` through the
 * module table and the production platform seed, as it does in the browser.
 * Missing factories reject through `loadBundle` without fetching.
 * @param graph - raw boot graph from `graphFromRoster`; `createClientModuleSystem` parses it.
 * @param modules - loaded plugin modules keyed by package name.
 * @returns module system to install as `loader.internal`; its `manifest` is the parsed graph.
 */
export function createInProcessModules(
  graph: WebBootGraph,
  modules: ReadonlyMap<string, ClientPluginModule>,
): ClientModuleLoader {
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue: [],
    /* v8 ignore next -- construction replaces this sink before draining the prefilled queue. */
    load: () => { throw new Error('client-test-runtime: module facade is not initialized') },
    create: options => createClientModuleSystem(target, { id: MODULES_PACKAGE, exports: modulesClient }, options),
  }
  for (const [id, namespace] of modules) {
    if (id === MODULES_PACKAGE) continue
    const factory = scriptNamespaces.get(namespace)
    target.pendingQueue.push({ id, factory: factory ?? (() => namespace as unknown as Record<string, unknown>) })
  }
  return target.create({
    boot: graph,
    staticModules: getStaticModules(),
    loadBundle: url => Promise.reject(new Error(`client-test-runtime: in-process modules never load bundles (${url})`)),
  })
}
