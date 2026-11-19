import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectJanPackageLicenses } from './verify-jan-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'jan-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@janhq/jan-root',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

describe('Jan package license gate', () => {
  it('checks root, unhyphenated CLI, and jan-prefixed package names while ignoring other families', () => {
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: '@janhq/jan', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@janhq/jan-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@janhq/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectJanPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @janhq/jan-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('requires a listed exception to declare exactly its listed license', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/web/ported/package.json', { name: '@janhq/jan-ported', license: 'Apache-2.0' })
    writeManifest(root, 'packages/web/other/package.json', { name: '@janhq/jan-other', license: 'MIT' })
    expect(inspectJanPackageLicenses(root, { '@janhq/jan-ported': 'Apache-2.0' }).failures).toEqual([])
    expect(inspectJanPackageLicenses(root, { '@janhq/jan-ported': 'Apache-2.0', '@janhq/jan-other': 'Apache-2.0' }).failures).toEqual([
      'packages/web/other/package.json: @janhq/jan-other must declare "license": "Apache-2.0"; found "MIT".',
    ])
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@janhq/jan-agent' })

    expect(inspectJanPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @janhq/jan-agent must declare "license": "MIT"; found undefined.',
    ])
  })
})
