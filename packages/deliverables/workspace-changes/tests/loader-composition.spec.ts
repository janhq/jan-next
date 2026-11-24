/**
 * REAL-composition proof: the shipped YAML rows (session store, local
 * subprocess runtime, workspace-changes) boot through the vendored Loader and
 * a logged turn ends with its recorded changes.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import SessionStore, { SessionId } from '@janhq/jan-session'
import LocalSubprocessRuntime from '@janhq/jan-subprocess-local'
import LocalFileSystem from '@janhq/jan-fs-local'
import * as WorkspaceChangesPlugin from '@janhq/jan-workspace-changes'
import { changes, endTurn, git, startTurn, toolCall } from './support.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('loads the shipped rows and records a turn’s changes', async () => {
    root = await mkdtemp(join(tmpdir(), 'jan-workspace-changes-loader-'))
    const cwd = join(root, 'ws')
    await writeFile(join(root, 'cordis.yml'), [
      "- name: '@janhq/jan-session'",
      "- name: '@janhq/jan-subprocess-local'",
      "- name: '@janhq/jan-fs-local'",
      "- name: '@janhq/jan-workspace-changes'",
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@janhq/jan-session', SessionStore],
      ['@janhq/jan-subprocess-local', LocalSubprocessRuntime],
      ['@janhq/jan-fs-local', LocalFileSystem],
      ['@janhq/jan-workspace-changes', WorkspaceChangesPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
    await context.loader.await()
    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    await writeFile(join(root, 'placeholder'), '')
    await rm(cwd, { recursive: true, force: true })
    git(root, 'init', '-q', cwd)
    await writeFile(join(cwd, 'tracked.txt'), 'one\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'init')
    const session = context.sessions.create(SessionId('composed'), { meta: { cwd } })
    startTurn(session, 1)
    await context.waterfall('tools/pre-execute', { agent: { session }, signal: new AbortController().signal } as never, () => Promise.resolve(undefined as never))
    await writeFile(join(cwd, 'tracked.txt'), 'one\ntwo\n')
    toolCall(session, 1, 'bash', { command: 'x' })
    endTurn(session, 1)
    await context.waterfall('tools/pre-execute', { agent: { session }, signal: new AbortController().signal } as never, () => Promise.resolve(undefined as never))
    const [recorded, ...rest] = changes(context, session)
    expect(rest).toEqual([])
    expect(recorded).toEqual({
      turn: 1, cwd, total: 1, added: 1, deleted: 0,
      files: [{ path: 'tracked.txt', display: 'tracked.txt', added: 1, deleted: 0 }],
      snapshot: { before: expect.stringMatching(/^[0-9a-f]+$/) as string, after: expect.stringMatching(/^[0-9a-f]+$/) as string },
    })
  })
})
