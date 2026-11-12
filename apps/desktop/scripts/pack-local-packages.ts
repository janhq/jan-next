/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
} from '../../../scripts/client-build-environment.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

/**
 * tokamak-harness: fork packages the shipped bundles mount. They are `private` so npm publication
 * skips them, and the release family therefore does not pack them; a local Desktop build needs them.
 * One absent from the checkout is skipped: the package-set step fails if a bundle still requires it.
 */
const FORK_PACKAGES = [
  'packages/credentials/tokamak-account',
  'packages/llm/llama-cpp',
  'packages/api/llama-cpp-controller',
  'packages/client/ui-settings-local-model',
  'packages/web/web-search-exa',
] as const

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const environment = resolveClientBuildEnvironment(repositoryClientBuildEnvironment(root), 'local')
  readClientBuildRecord(root, environment)
  const destination = resolve(root, values.out)
  const packed = await packFamilyMembers(root, releaseFamily('dsh'), destination, concurrency)
  const present = FORK_PACKAGES.filter(directory => existsSync(join(root, directory, 'package.json')))
  for (const directory of present) {
    const invocation = pnpmInvocation(['--dir', directory, 'pack', '--pack-destination', destination])
    execFileSync(invocation.command, invocation.args, { cwd: root, stdio: 'inherit' })
  }
  console.log(`desktop local pack: ${String(packed.length + present.length)} tarball(s) in ${destination}`)
}

await main()
