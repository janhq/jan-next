import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@janhq/cordis'
import Loader from '@janhq/cordis-plugin-loader'
import Include from '@janhq/cordis-plugin-include'
import SessionProjectionRegistry from '@janhq/jan-session-projection'
import TokenMeter from '@janhq/jan-token-meter'
import ToolResultPruner from '@janhq/jan-compaction-tool-result-pruner'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('compaction-tool-result-pruner real Loader composition', () => {
  it('loads and resolves the flat YAML plugin shape', async () => {
    root = await mkdtemp(join(tmpdir(), 'jan-compact-tool-result-prune-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@janhq/jan-session-projection'",
      "- name: '@janhq/jan-token-meter'",
      "- name: '@janhq/jan-compaction-tool-result-pruner'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@janhq/jan-session-projection') return SessionProjectionRegistry
        if (specifier === '@janhq/jan-token-meter') return TokenMeter
        if (specifier === '@janhq/jan-compaction-tool-result-pruner') return ToolResultPruner
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('toolResultPruner')).toBeInstanceOf(ToolResultPruner)
    expect(context.toolResultPruner.config).toEqual({
      thresholdChars: 100,
      headChars: 20,
      tailChars: 10,
    })
  })

  it('rejects stale config after plugin schema normalization', async () => {
    context = new Context()
    // Satisfy the declared injections first: config normalization runs in the
    // service constructor, which a pending fiber never reaches.
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(ToolResultPruner, {
      maxChars: 100,
    } as never)).rejects.toThrow(/unknown key "maxChars"/)
  })
})
