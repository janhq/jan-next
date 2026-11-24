/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `jan-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

afterEach(() => { vi.restoreAllMocks() })

describe('entry identity', () => {
  it('distinguishes paths and holds each identity across repeated stats', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/one.txt', 'one')
    vfs.seed('/jan/two.txt', 'two')
    const first = identity(vfs, '/jan/one.txt')
    expect(identity(vfs, '/jan/two.txt')).not.toBe(first)
    expect(identity(vfs, '/jan/one.txt')).toBe(first)
  })

  it('forgets the identities under a directory removed as a subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/skills/git/SKILL.md', '# git\n')
    const before = identity(vfs, '/jan/skills/git/SKILL.md')
    vfs.rmSync('/jan/skills', { recursive: true })
    vfs.seed('/jan/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/jan/skills/git/SKILL.md')).not.toBe(before)
  })

  it('moves the source identity when a file replaces another path', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/from.txt', 'moved')
    vfs.seed('/jan/to.txt', 'replaced')
    const [source, destination] = [identity(vfs, '/jan/from.txt'), identity(vfs, '/jan/to.txt')]
    vfs.renameSync('/jan/from.txt', '/jan/to.txt')
    const renamed = identity(vfs, '/jan/to.txt')
    expect(vfs.readFileSync('/jan/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

describe('modification time', () => {
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/jan/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    const stats = vfs.statSync('/jan/restored') as VfsStats
    const directory = vfs.statSync('/jan/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/jan/log.jsonl', 'first\n')
    const seeded = modified(vfs, '/jan/log.jsonl')
    vfs.writeFileSync('/jan/log.jsonl', 'second\n')
    const written = modified(vfs, '/jan/log.jsonl')
    vfs.appendFileSync('/jan/log.jsonl', 'third\n')
    const appended = modified(vfs, '/jan/log.jsonl')
    vfs.truncateSync('/jan/log.jsonl', 6)
    const truncated = modified(vfs, '/jan/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  it('takes the clock once the clock has passed the entry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/jan/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/jan/log.jsonl', 'second\n')
    expect(modified(vfs, '/jan/log.jsonl')).toBe(1_700_000_005_000)
  })

  it('extends truncation with zero bytes', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/jan/file', 5)
    expect([...vfs.readFileSync('/jan/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    const handle = vfs.open('/jan/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/jan/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/jan/workspace')
    const empty = modified(vfs, '/jan/workspace')
    vfs.writeFileSync('/jan/workspace/file.txt', 'one')
    const created = modified(vfs, '/jan/workspace')
    vfs.writeFileSync('/jan/workspace/file.txt', 'two')
    const rewritten = modified(vfs, '/jan/workspace')
    vfs.rmSync('/jan/workspace/file.txt')
    const removed = modified(vfs, '/jan/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

describe('mutation publication', () => {
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    const vfs = new MemoryVfs()
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/jan/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/jan/seeded.txt', 'changed')
    vfs.mkdirSync('/jan/created')
    vfs.chmodSync('/jan/created', 0o700)
    vfs.renameSync('/jan/seeded.txt', '/jan/renamed.txt')
    vfs.rmSync('/jan/created', { recursive: true })
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/jan/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/jan/created' },
      { kind: 'chmod', path: '/jan/created', mode: 0o700 },
      { kind: 'remove', path: '/jan/seeded.txt' },
      { kind: 'write', path: '/jan/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/jan/created' },
    ])
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  it('contains a faulty observer and lets disposal stop later notifications', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/jan')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    const seen: string[] = []
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/jan/one', '1')
    first()
    second()
    vfs.writeFileSync('/jan/two', '2')
    expect(seen).toEqual(['/jan/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    const recorded: VfsMutation[] = []
    let flushes = 0
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/jan')
    const observed: VfsMutation[] = []
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/jan/log', 'a')
    vfs.appendFileSync('/jan/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/jan/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/jan/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  it('publishes descriptor writes at the file identity current path', () => {
    const mutations: VfsMutation[] = []
    const vfs = new MemoryVfs()
    vfs.seed('/jan/source', 'old')
    const descriptor = vfs.openFileSync('/jan/source', 'r+')
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/jan/source', '/jan/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/jan/destination'])
    expect(vfs.readFileSync('/jan/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/jan/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  it('reports the path identity through a BigInt file handle stat', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/session.lock', '')
    const handle = vfs.open('/jan/session.lock', 'w')
    const held = await handle.stat({ bigint: true }) as VfsBigIntStats
    const current = vfs.statSync('/jan/session.lock', { bigint: true }) as VfsBigIntStats

    expect([held.dev, held.ino]).toEqual([current.dev, current.ino])
    await handle.chmod(0o600)
    expect((vfs.statSync('/jan/session.lock') as VfsStats).mode & 0o777).toBe(0o600)
    await handle.close()
  })

  it('decomposes a directory rename into replayable destination state', () => {
    const recorded: VfsMutation[] = []
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/jan/staging/nested', { mode: 0o700 })
    vfs.seed('/jan/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/jan/staging', '/jan/published')

    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/jan/staging'],
      ['mkdir', '/jan/published'],
      ['mkdir', '/jan/published/nested'],
      ['write', '/jan/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

describe('directory rename', () => {
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/source/nested/file', 'source')
    vfs.seed('/jan/file', 'destination')
    vfs.seed('/jan/non-empty/child', 'destination')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    expect(() => { vfs.renameSync('/jan/source', '/jan/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => { vfs.renameSync('/jan/source', '/jan/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    expect(() => { vfs.renameSync('/jan/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/jan/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/jan/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/jan/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  it('replaces an empty directory with the source subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/jan/source/nested', { mode: 0o700 })
    vfs.seed('/jan/source/nested/file', 'source')
    vfs.seedDirectory('/jan/destination', { mode: 0o711 })

    vfs.renameSync('/jan/source', '/jan/destination')

    expect(vfs.existsSync('/jan/source')).toBe(false)
    expect(vfs.readFileSync('/jan/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/jan/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/jan/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

describe('hard links', () => {
  it('shares identity, bytes, and mode until one name is removed', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/session.jsonl', 'committed\n')
    vfs.linkSync('/jan/session.jsonl', '/jan/session-latest.jsonl')
    vfs.linkSync('/jan/session-latest.jsonl', '/jan/session-archive.jsonl')
    expect(identity(vfs, '/jan/session-latest.jsonl')).toBe(identity(vfs, '/jan/session.jsonl'))
    expect(linkCount(vfs, '/jan/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/jan/session-latest.jsonl', 'utf8')).toBe('committed\n')
    const changedPaths: string[] = []
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/jan/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/jan/session.jsonl',
      '/jan/session-latest.jsonl',
      '/jan/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/jan/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/jan/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/jan/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/jan/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/jan/session-latest.jsonl')
    expect(linkCount(vfs, '/jan/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/jan/session-archive.jsonl')
    expect(linkCount(vfs, '/jan/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/jan/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  it('treats rename between names of the same node as a no-op', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/source', 'value')
    vfs.linkSync('/jan/source', '/jan/alias')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/jan/source', '/jan/alias')

    expect(vfs.readFileSync('/jan/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/jan/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/jan/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  it('retargets linked names through file replacement and directory moves', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/replacement', 'replacement')
    vfs.seed('/jan/target', 'old')
    vfs.linkSync('/jan/target', '/jan/target-alias')
    const replaced = vfs.openFileSync('/jan/target', 'r+')
    vfs.renameSync('/jan/replacement', '/jan/target')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/jan/target-alias'])
    expect(vfs.readFileSync('/jan/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/jan/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/jan/target-alias')).toBe(1n)

    vfs.seed('/jan/tree/file', 'tree')
    vfs.linkSync('/jan/tree/file', '/jan/outside')
    const moved = vfs.openFileSync('/jan/tree/file', 'r+')
    vfs.renameSync('/jan/tree', '/jan/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/jan/outside', '/jan/moved/file'])
    expect(linkCount(vfs, '/jan/moved/file')).toBe(2n)

    vfs.rmSync('/jan/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/jan/outside'])
    expect(vfs.readFileSync('/jan/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/jan/outside')).toBe(1n)
  })

  it('rejects renaming a file over an existing directory', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/jan/file', 'value')
    vfs.seedDirectory('/jan/directory')
    expect(() => { vfs.renameSync('/jan/file', '/jan/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/jan/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/jan/directory').isDirectory()).toBe(true)
  })
})
