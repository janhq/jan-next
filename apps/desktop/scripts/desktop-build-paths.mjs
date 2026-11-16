/** Resolve target-owned Desktop outputs and shared package caches. */

import { isAbsolute, join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const TARGET_PLATFORMS = /** @type {const} */ ({
  'mac-arm64': { platform: 'darwin', arch: 'arm64' },
  'mac-x64': { platform: 'darwin', arch: 'x64' },
  'win-x64': { platform: 'win32', arch: 'x64' },
  'linux-x64': { platform: 'linux', arch: 'x64' },
})
const RELEASE_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

function selectedTarget(env, hostPlatform, hostArch) {
  const platform = env.DSH_DESKTOP_TARGET_PLATFORM ?? env.npm_config_platform ?? hostPlatform
  const arch = env.DSH_DESKTOP_TARGET_ARCH ?? env.npm_config_arch
    ?? (platform === 'win32' || platform === 'win' ? 'x64' : hostArch)
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' || platform === 'win' ? 'win' : platform
  return `${os}-${arch}`
}

/**
 * Resolve the fixed release target selected by a packaging environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no target override exists.
 * @param {string} hostArch - Build-host architecture used when no target override exists.
 * @returns {'mac-arm64' | 'mac-x64' | 'win-x64'} Supported Desktop release target name.
 */
export function resolveDesktopBuildTarget(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const target = selectedTarget(env, hostPlatform, hostArch)
  if (!RELEASE_TARGETS.has(target)) {
    throw new Error(`desktop build paths: unsupported release target ${target}; release targets are ${[...RELEASE_TARGETS].join(', ')}`)
  }
  return /** @type {'mac-arm64' | 'mac-x64' | 'win-x64'} */ (target)
}

/**
 * Resolve the target an unpackaged development launch prepares, which includes Linux.
 * @param {NodeJS.ProcessEnv} env - Launch environment.
 * @param {NodeJS.Platform} hostPlatform - Host platform used when no target override exists.
 * @param {string} hostArch - Host architecture used when no target override exists.
 * @returns {keyof typeof TARGET_PLATFORMS} Supported Desktop development target name.
 */
export function resolveDesktopDevelopmentTarget(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const target = selectedTarget(env, hostPlatform, hostArch)
  assertSupportedTarget(target)
  return target
}

function assertSupportedTarget(target) {
  if (!Object.hasOwn(TARGET_PLATFORMS, target)) {
    throw new Error(`desktop build paths: unsupported target ${String(target)}`)
  }
}

/**
 * Return the mutable preparation and artifact directories owned by one target.
 * @param {keyof typeof TARGET_PLATFORMS} target - Supported Desktop release or development target name.
 * @param {NodeJS.ProcessEnv} environment - Packaging environment with an optional absolute cache directory.
 * @returns {{ root: string, artifacts: string, unsignedArtifacts: string, unnotarizedArtifacts: string, runtime: string, packageSet: string, dsh: string, dshPnpm: string, electron: string, packedDsh: string, packedVendor: string, packedLandlock: string, downloads: string, pnpmStore: string }} Target paths plus shared download and package caches.
 */
export function desktopTargetBuildPaths(target, environment = process.env) {
  assertSupportedTarget(target)
  const cacheRoot = environment.DSH_DESKTOP_PACKAGE_CACHE_DIR ?? BUILD_ROOT
  if (!cacheRoot.trim() || !isAbsolute(cacheRoot) || cacheRoot.includes('\0')) {
    throw new Error('desktop package: DSH_DESKTOP_PACKAGE_CACHE_DIR must be a nonempty absolute directory')
  }
  const root = join(BUILD_ROOT, 'targets', target)
  const packed = join(root, 'packed')
  return {
    root,
    artifacts: join(root, 'artifacts'),
    unsignedArtifacts: join(root, 'unsigned-artifacts'),
    unnotarizedArtifacts: join(root, 'unnotarized-artifacts'),
    runtime: join(root, 'runtime'),
    packageSet: join(root, 'package-set'),
    dsh: join(root, 'dsh'),
    dshPnpm: join(root, 'dsh-pnpm'),
    electron: join(root, 'electron'),
    packedDsh: join(packed, 'dsh'),
    packedVendor: join(packed, 'vendor'),
    packedLandlock: join(packed, 'landlock'),
    downloads: join(cacheRoot, 'downloads'),
    pnpmStore: join(cacheRoot, 'pnpm-store'),
  }
}

/**
 * Return the platform and architecture of the payload one target prepares.
 * Windows is prepared as x64 only, so this differs from the build host on an arm64 Windows machine.
 * @param {keyof typeof TARGET_PLATFORMS} target - Supported Desktop release or development target name.
 * @returns {{ platform: 'darwin' | 'win32' | 'linux', arch: 'arm64' | 'x64' }} Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target) {
  assertSupportedTarget(target)
  return TARGET_PLATFORMS[target]
}

/**
 * Resolve the paths owned by the release target selected in a packaging environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no target override exists.
 * @param {string} hostArch - Build-host architecture used when no target override exists.
 * @returns {ReturnType<typeof desktopTargetBuildPaths>} Selected target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  return desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch), env)
}

/**
 * Resolve the primary-runtime directory an unpackaged development launch uses.
 * Windows is fixed to x64, so the shell cannot derive this directory from the architecture
 * of the process that launched it.
 * @param {NodeJS.ProcessEnv} env - Launch environment.
 * @param {NodeJS.Platform} hostPlatform - Host platform used when no target override exists.
 * @param {string} hostArch - Host architecture used when no target override exists.
 * @returns {string} Primary-runtime directory prepared for the selected development target.
 */
export function developmentRuntimeDirectory(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const target = resolveDesktopDevelopmentTarget(env, hostPlatform, hostArch)
  return join(desktopTargetBuildPaths(target, env).runtime, 'primary-runtime')
}

/**
 * Select the output directory and filename suffix for one packaging mode.
 * @param {{ artifacts: string, unsignedArtifacts: string, unnotarizedArtifacts: string }} paths Target artifact directories.
 * @param {{ unsigned: boolean, skipNotarization: boolean }} mode Validated packaging mode.
 * @returns {{ directory: string, suffix: string }} Matching artifact destination and filename marker.
 */
export function desktopArtifactOutput(paths, mode) {
  if (mode.unsigned) return { directory: paths.unsignedArtifacts, suffix: '-unsigned' }
  if (mode.skipNotarization) return { directory: paths.unnotarizedArtifacts, suffix: '-unnotarized' }
  return { directory: paths.artifacts, suffix: '' }
}
