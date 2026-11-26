import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { officeEnvironment } from '../src/office.ts'

it('names the bundled Office payload for the optional bundle rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-'))
  try {
    const source = join(root, 'runtime', 'primary-runtime')
    const env = officeEnvironment({ source, root: join(root, 'installed'), runtimeDir: join(root, 'jan') })
    const kit = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json')))
    expect(env).toEqual({
      JAN_BUNDLED_PRIMARY_RUNTIME: source,
      JAN_BUNDLED_PRIMARY_RUNTIME_ROOT: join(root, 'installed'),
      JAN_BUNDLED_OFFICE_SKILLS: join(root, 'runtime', 'office-skills'),
      JAN_BUNDLED_OFFICE_NODE: join(source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
      JAN_BUNDLED_OFFICE_CLI: join(kit, 'lib', 'cli.js'),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
