/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { assertNever } from '../../../packages/util/values/src/index.ts'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths, type DesktopBuildTarget } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

interface PackagedApplication { application: string; resources: string; executable: string }

function packagedApplication(target: DesktopBuildTarget, artifacts: string): PackagedApplication {
  switch (target) {
    case 'win-x64': {
      const application = join(artifacts, 'win-unpacked')
      return { application, resources: join(application, 'resources'), executable: join(application, 'Jan Next.exe') }
    }
    case 'linux-x64': {
      const application = join(artifacts, 'linux-unpacked')
      return { application, resources: join(application, 'resources'), executable: join(application, 'jan-alpha') }
    }
    case 'mac-arm64':
    case 'mac-x64': {
      const application = join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'Jan Next.app', 'Contents')
      return { application, resources: join(application, 'Resources'), executable: join(application, 'MacOS', 'Jan Next') }
    }
    default: return assertNever(target)
  }
}

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
const { application, resources, executable } = packagedApplication(target, artifacts)
const descriptor = await verifyDesktopRuntime(paths.jan, readDesktopRuntime(paths.jan).release.version,
  resolveDesktopPackageTarget(target))
if (target === 'win-x64' && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'jan'), executable, join(resources, 'runtime'), descriptor)
