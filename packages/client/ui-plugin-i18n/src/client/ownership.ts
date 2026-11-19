/** Attribution of registered dictionary namespaces to the plugin package whose client fiber registered them. */
import type { Context as ClientContext, Fiber, FiberState } from '@janhq/cordis'
// Type-only: the `Fiber.entry` merge naming the Loader entry a root fiber runs.
import type {} from '@janhq/cordis-plugin-loader'

/** Numeric mirror of Cordis's const enum `FiberState`, which bundles cannot import as a runtime object. */
const LOADING = 1 as FiberState.LOADING
const ACTIVE = 2 as FiberState.ACTIVE
const FAILED = 3 as FiberState.FAILED
const DISPOSED = 4 as FiberState.DISPOSED
const UNLOADING = 5 as FiberState.UNLOADING

/**
 * Read the npm package name from a Loader module specifier.
 * @param moduleName - specifier such as `@scope/pkg/client` or `pkg`.
 * @returns the package name, or undefined for a relative, absolute, or `cordis:` builtin specifier.
 */
export function packageOf(moduleName: string): string | undefined {
  if (/^(?:\.|\/|[a-z]+:)/i.test(moduleName)) return undefined
  const parts = moduleName.split('/')
  return moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Tracks which namespaces appear while one package's fiber loads. A namespace registered between the fiber's
 * start and its activation belongs to that package; fibers that load concurrently can lend each other namespaces,
 * which only widens what a translation request covers, since requests include only namespaces lacking the locale.
 */
export class NamespaceOwnership {
  private readonly before = new Map<number, ReadonlySet<string>>()
  private readonly owned = new Map<string, Set<string>>()

  /** @param namespaces - reads the namespaces registered right now. */
  constructor(private readonly namespaces: () => ReadonlySet<string>) {}

  /**
   * Remember the namespaces that exist as a fiber starts.
   * @param uid - the fiber's uid.
   */
  begin(uid: number): void {
    this.before.set(uid, this.namespaces())
  }

  /**
   * Attribute the namespaces added since `begin` to the package.
   * @param uid - the fiber's uid.
   * @param pkg - the package the fiber loaded.
   */
  end(uid: number, pkg: string): void {
    const before = this.before.get(uid)
    this.before.delete(uid)
    if (before === undefined) return
    const added = [...this.namespaces()].filter(ns => !before.has(ns))
    if (added.length === 0) return
    const owned = this.owned.get(pkg) ?? new Set<string>()
    for (const ns of added) owned.add(ns)
    this.owned.set(pkg, owned)
  }

  /**
   * Read the namespaces attributed to a package that are still registered.
   * @param pkg - package name.
   * @returns the attributed namespaces.
   */
  ownedBy(pkg: string): readonly string[] {
    const live = this.namespaces()
    return [...this.owned.get(pkg) ?? []].filter(ns => live.has(ns))
  }

  /**
   * Drop what was remembered for a fiber that ended without activating.
   * @param uid - the fiber's uid.
   */
  abandon(uid: number): void {
    this.before.delete(uid)
  }
}

/**
 * Follow the root fibers of Loader entries and report each package that becomes active.
 * @param ctx - the plugin context; the listener leaves with its fiber.
 * @param ownership - receives start and end of each package fiber.
 * @param onActive - called after a package's namespaces are attributed.
 */
export function trackOwnership(ctx: ClientContext, ownership: NamespaceOwnership, onActive: (pkg: string) => void): void {
  ctx.on('internal/status', (fiber: Fiber) => {
    const uid = fiber.uid
    const name = fiber.entry?.options.name
    // Only the root fiber of a Loader entry names a package; its children share the entry.
    if (uid === null || name === undefined || fiber.parent.fiber.entry === fiber.entry) return
    const pkg = packageOf(name)
    if (pkg === undefined) return
    switch (fiber.state) {
      case LOADING:
        ownership.begin(uid)
        break
      case ACTIVE:
        ownership.end(uid, pkg)
        onActive(pkg)
        break
      case FAILED:
      case DISPOSED:
      case UNLOADING:
        ownership.abandon(uid)
        break
      default:
        break
    }
  })
}
