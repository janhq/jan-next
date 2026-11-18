import { describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { NamespaceOwnership, packageOf, trackOwnership } from '../src/client/ownership.ts'

describe('packageOf', () => {
  it('reads the package name from a Loader module specifier', () => {
    expect(packageOf('dsh-cad')).toBe('dsh-cad')
    expect(packageOf('dsh-cad/client')).toBe('dsh-cad')
    expect(packageOf('@scope/pkg')).toBe('@scope/pkg')
    expect(packageOf('@scope/pkg/client/sub')).toBe('@scope/pkg')
  })

  it('names no package for builtins, relative paths, and absolute paths', () => {
    expect(packageOf('cordis:timer')).toBeUndefined()
    expect(packageOf('./local')).toBeUndefined()
    expect(packageOf('../up')).toBeUndefined()
    expect(packageOf('/abs/path')).toBeUndefined()
  })
})

describe('NamespaceOwnership', () => {
  it('attributes namespaces that appear between begin and end, and lists only live ones', () => {
    const live = new Set(['old'])
    const ownership = new NamespaceOwnership(() => new Set(live))
    ownership.begin(1)
    live.add('a')
    live.add('b')
    ownership.end(1, 'pkg')
    expect(ownership.ownedBy('pkg')).toEqual(['a', 'b'])
    expect(ownership.ownedBy('other')).toEqual([])
    live.delete('a')
    expect(ownership.ownedBy('pkg')).toEqual(['b'])
  })

  it('accumulates across fibers of one package and ignores an end without a begin', () => {
    const live = new Set<string>()
    const ownership = new NamespaceOwnership(() => new Set(live))
    ownership.end(9, 'pkg')
    ownership.begin(1)
    live.add('a')
    ownership.end(1, 'pkg')
    ownership.begin(2)
    live.add('b')
    ownership.end(2, 'pkg')
    ownership.begin(3)
    ownership.end(3, 'pkg')
    expect(ownership.ownedBy('pkg')).toEqual(['a', 'b'])
  })

  it('forgets an abandoned fiber', () => {
    const live = new Set<string>()
    const ownership = new NamespaceOwnership(() => new Set(live))
    ownership.begin(1)
    live.add('a')
    ownership.abandon(1)
    ownership.end(1, 'pkg')
    expect(ownership.ownedBy('pkg')).toEqual([])
  })
})

/** A root fiber of a Loader entry, as the status event carries it. */
function rootFiber(uid: number, name: string, state: number) {
  const entry = { options: { name } }
  return { uid, entry, state, parent: { fiber: { entry: undefined } } }
}

describe('trackOwnership', () => {
  it('follows root fibers of package entries from start to activation', () => {
    const ctx = new Context()
    const live = new Set<string>()
    const ownership = new NamespaceOwnership(() => new Set(live))
    const active = vi.fn()
    trackOwnership(ctx, ownership, active)
    ctx.emit('internal/status', rootFiber(1, '@scope/pkg/client', 1) as never, 0 as never)
    live.add('ns')
    ctx.emit('internal/status', rootFiber(1, '@scope/pkg/client', 2) as never, 1 as never)
    expect(ownership.ownedBy('@scope/pkg')).toEqual(['ns'])
    expect(active).toHaveBeenCalledExactlyOnceWith('@scope/pkg')
  })

  it('ignores builtins, child fibers, fibers without an entry, and drops failed starts', () => {
    const ctx = new Context()
    const live = new Set<string>()
    const ownership = new NamespaceOwnership(() => new Set(live))
    const active = vi.fn()
    trackOwnership(ctx, ownership, active)
    ctx.emit('internal/status', rootFiber(1, 'cordis:timer', 2) as never, 1 as never)
    const child = rootFiber(2, 'pkg', 2)
    child.parent = { fiber: { entry: child.entry } } as never
    ctx.emit('internal/status', child as never, 1 as never)
    ctx.emit('internal/status', { uid: 3, entry: undefined, state: 2, parent: { fiber: {} } } as never, 1 as never)
    ctx.emit('internal/status', { ...rootFiber(4, 'pkg', 1), uid: null } as never, 0 as never)
    expect(active).not.toHaveBeenCalled()
    ctx.emit('internal/status', rootFiber(5, 'failing', 1) as never, 0 as never)
    live.add('ns')
    ctx.emit('internal/status', rootFiber(5, 'failing', 3) as never, 1 as never)
    ctx.emit('internal/status', rootFiber(5, 'failing', 4) as never, 3 as never)
    ctx.emit('internal/status', rootFiber(5, 'failing', 5) as never, 4 as never)
    ctx.emit('internal/status', rootFiber(5, 'failing', 0) as never, 5 as never)
    expect(ownership.ownedBy('failing')).toEqual([])
    expect(active).not.toHaveBeenCalled()
  })
})
