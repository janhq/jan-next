import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@janhq/cordis'
import SessionStore from '@janhq/jan-session'
import Storage from '@janhq/jan-storage'
import { DomainFacility } from '@janhq/jan-storage-domain'
import { remoteErrorOf } from '@janhq/jan-typert-protocol'
import WorkspaceRegistry from '@janhq/jan-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { WorkspaceCommands } from '../src/commands.ts'
import { WorkspaceFeed } from '../src/feed.ts'
import type { WorkspaceUpdateRequest } from '../src/types.ts'

async function openRegistry(pool: MemoryMediaPool) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  return { ctx, commands: new WorkspaceCommands(ctx), feed: new WorkspaceFeed(ctx) }
}

function directories() {
  const root = mkdtempSync(join(tmpdir(), 'jan-project-identity-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  return (name: string) => {
    const path = join(root, name)
    mkdirSync(path)
    return path
  }
}

it('publishes and reopens an edited project in the existing v2 registry', async () => {
  const pool = new MemoryMediaPool()
  const directory = directories()
  const { ctx, commands, feed } = await openRegistry(pool)
  const { workspace: legacy } = await commands.create({ path: directory('original') })
  expect(legacy).not.toHaveProperty('color')
  expect(legacy).not.toHaveProperty('avatar')
  const { workspaceId } = legacy
  const frames = feed.follow(new AbortController().signal)[Symbol.asyncIterator]()
  await frames.next()
  const icon = { kind: 'icon', name: 'star' } as const
  const { workspace: edited } = await commands.update({ workspaceId, title: '  Named project ', color: 'blue', avatar: icon })
  expect(edited).toMatchObject({ workspaceId, title: 'Named project', color: 'blue', avatar: icon })
  expect((await frames.next()).value).toMatchObject({ type: 'upsert', workspace: edited })
  const emoji = { kind: 'emoji', value: '👩🏽‍💻' } as const
  await commands.update({ workspaceId, avatar: emoji })
  await frames.return?.()
  await ctx.fiber.dispose()

  const reopened = await openRegistry(pool)
  expect(pool.versions.get('workspace')).toBe(2)
  const restored = reopened.feed.follow(new AbortController().signal)[Symbol.asyncIterator]()
  expect((await restored.next()).value).toMatchObject({
    type: 'baseline', value: { items: [{ workspaceId, title: 'Named project', color: 'blue', avatar: emoji }] },
  })
  const { workspace: reset } = await reopened.commands.update({ workspaceId, color: null, avatar: null })
  expect(reset).not.toHaveProperty('color')
  expect(reset).not.toHaveProperty('avatar')
  await restored.return?.()
})

it('rejects invalid appearance and conflicting titles without partially writing', async () => {
  const { commands } = await openRegistry(new MemoryMediaPool())
  const directory = directories()
  const { workspace: original } = await commands.create({ path: directory('original') })
  await commands.create({ path: directory('taken') })
  const { workspaceId } = original
  const invalid = [
    { color: '#123456' },
    { avatar: { kind: 'icon', name: 'unknown' } },
    { avatar: { kind: 'emoji', value: 'x' } },
    { avatar: { kind: 'emoji', value: '🧪🧪' } },
    { avatar: { kind: 'emoji', value: '🏻' } },
    { avatar: { kind: 'emoji', value: '' } },
    { title: ' ' },
  ]
  for (const patch of invalid) {
    const error = await commands.update({ workspaceId, title: 'Not saved', ...patch } as WorkspaceUpdateRequest)
      .catch((reason: unknown) => reason)
    expect(remoteErrorOf(error)).toMatchObject({ code: 'gateway/bad-request' })
  }
  const error = await commands.update({ workspaceId, title: 'taken', color: 'blue' }).catch((reason: unknown) => reason)
  expect(remoteErrorOf(error)).toMatchObject({ code: 'workspace/name-conflict' })
  await expect(commands.create({ path: original.path })).resolves.toMatchObject({ workspace: original })
})
