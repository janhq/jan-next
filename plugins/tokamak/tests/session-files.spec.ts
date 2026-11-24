import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@janhq/cordis'
import { LocalFileSystem } from '@janhq/jan-fs-local'
import type { Agent } from '@janhq/jan-agent'
import type { ToolExecution } from '@janhq/jan-tools'
import { expect, it } from 'vitest'
import { readInside, writeOutputs } from '../session-files.mjs'

async function workspace(run: (ctx: Context, cwd: string, outside: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'jan-tokamak-files-'))
  const ctx = new Context()
  const cwd = join(dir, 'workspace')
  const outside = join(dir, 'workspace-other')
  try {
    await Promise.all([mkdir(cwd), mkdir(outside)])
    await ctx.plugin(LocalFileSystem, { cwd })
    await run(ctx, cwd, outside)
  } finally {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

const signal = new AbortController().signal

it('reads workspace media but rejects outside paths, including through a linked directory', async () => {
  await workspace(async (ctx, cwd, outside) => {
    const at = { cwd, root: await ctx.fs.resolve(cwd), agent: {} as Agent }
    await Promise.all([writeFile(join(cwd, 'clip.wav'), 'inside'), writeFile(join(outside, 'clip.wav'), 'outside')])
    expect(Buffer.from(await readInside(ctx, at, 'clip.wav', 100, signal)).toString()).toBe('inside')
    await expect(readInside(ctx, at, join(outside, 'clip.wav'), 100, signal)).rejects.toMatchObject({ code: 'TOKAMAK_PATH_OUTSIDE' })
    await expect(readInside(ctx, at, '../workspace-other/clip.wav', 100, signal)).rejects.toMatchObject({ code: 'TOKAMAK_PATH_OUTSIDE' })
    await symlink(outside, join(cwd, 'linked'), 'junction')
    await expect(readInside(ctx, at, 'linked/clip.wav', 100, signal)).rejects.toMatchObject({ code: 'TOKAMAK_PATH_OUTSIDE' })
  })
})

it('does not clobber default media paths or split a numbered image batch on collision', async () => {
  await workspace(async (ctx, cwd) => {
    const root = await ctx.fs.resolve(cwd)
    const at = { cwd, root, agent: {} as Agent }
    const exec = { signal } as ToolExecution
    await mkdir(join(cwd, 'images'))
    await writeFile(join(cwd, 'images/cat-2.webp'), 'existing')
    const batches = [['first image', 'first extra'], ['second image', 'second extra']]
    const replies = await Promise.all(batches.map(batch =>
      writeOutputs(ctx, at, undefined, 'images/cat.png', '.webp', batch.map(text => Buffer.from(text)), exec)))
    expect(replies.map(([first]) => first).sort()).toEqual(['cat-v2.webp', 'cat-v3.webp'].map(name => join(ctx.fs.processPath(root), 'images', name)).sort())
    expect(await Promise.all(replies.map(files => Promise.all(files.map(file => readFile(file, 'utf8')))))).toEqual(batches)
    await expect(readFile(join(cwd, 'images/cat.webp'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(cwd, 'images/cat-2.webp'), 'utf8')).toBe('existing')
  })
})

it('honors create-only intents when the model supplies a media path', async () => {
  await workspace(async (ctx, cwd) => {
    const at = { cwd, root: await ctx.fs.resolve(cwd), agent: {} as Agent }
    const exec = { signal } as ToolExecution
    ctx.on('fs/write-intent', async () => ({ kind: 'createIfAbsent' }))
    const original = ['original', 'replacement'].map(text => Buffer.from(text))
    const [path] = await writeOutputs(ctx, at, 'requested.wav', 'audio/default.wav', '.wav', [original[0]!], exec)
    await expect(writeOutputs(ctx, at, 'requested.wav', 'audio/default.wav', '.wav', [original[1]!], exec))
      .rejects.toMatchObject({ code: 'TOKAMAK_PATH_EXISTS' })
    expect(await readFile(path!, 'utf8')).toBe('original')
  })
})
