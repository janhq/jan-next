import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'

/** Release target, or Linux x64, which has only unpackaged development launches. */
export type DesktopDevelopmentTarget = DesktopAutoUpdateTarget | 'linux-x64'

/** Platform and architecture of a release payload. */
export interface DesktopReleasePlatform {
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
}

/** Platform and architecture of a release or development payload. */
export interface DesktopDevelopmentPlatform {
  readonly platform: DesktopReleasePlatform['platform'] | 'linux'
  readonly arch: DesktopReleasePlatform['arch']
}

/** Mutable target directories plus shared download and package caches. */
export interface DesktopTargetBuildPaths {
  readonly root: string
  readonly artifacts: string
  readonly unsignedArtifacts: string
  readonly unnotarizedArtifacts: string
  readonly runtime: string
  readonly packageSet: string
  readonly dsh: string
  readonly dshPnpm: string
  readonly electron: string
  readonly packedDsh: string
  readonly packedVendor: string
  readonly packedLandlock: string
  readonly downloads: string
  readonly pnpmStore: string
}

/**
 * Resolve the fixed release target selected by a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Supported Desktop release target name.
 */
export function resolveDesktopBuildTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopAutoUpdateTarget

/**
 * Resolve the target an unpackaged development launch prepares, which includes Linux.
 * @param env - Launch environment.
 * @param hostPlatform - Host platform used when no target override exists.
 * @param hostArch - Host architecture used when no target override exists.
 * @returns Supported Desktop development target name.
 */
export function resolveDesktopDevelopmentTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopDevelopmentTarget

/**
 * Return the mutable preparation and artifact directories owned by one target.
 * @param target - Supported Desktop release or development target name.
 * @param environment - Packaging environment with an optional absolute cache directory.
 * @returns Target paths plus shared download and package caches.
 */
export function desktopTargetBuildPaths(target: DesktopDevelopmentTarget, environment?: NodeJS.ProcessEnv): DesktopTargetBuildPaths

/**
 * Return the platform and architecture of the payload one release target prepares.
 * Windows is prepared as x64 only, so this differs from the build host on an arm64 Windows machine.
 * @param target - Supported Desktop release target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopAutoUpdateTarget): DesktopReleasePlatform
/**
 * Return the platform and architecture of the payload one development target prepares.
 * @param target - Supported Desktop development target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopDevelopmentTarget): DesktopDevelopmentPlatform

/**
 * Resolve the paths owned by the release target selected in a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Selected target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTargetBuildPaths

/**
 * Resolve the primary-runtime directory an unpackaged development launch uses.
 * @param env - Launch environment.
 * @param hostPlatform - Host platform used when no target override exists.
 * @param hostArch - Host architecture used when no target override exists.
 * @returns Primary-runtime directory prepared for the selected development target.
 */
export function developmentRuntimeDirectory(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): string

/**
 * Select the output directory and filename suffix for one packaging mode.
 * @param paths Target artifact directories.
 * @param mode Validated packaging mode.
 * @returns Matching artifact destination and filename marker.
 */
export function desktopArtifactOutput(
  paths: Pick<DesktopTargetBuildPaths, 'artifacts' | 'unsignedArtifacts' | 'unnotarizedArtifacts'>,
  mode: { unsigned: boolean, skipNotarization: boolean },
): { directory: string, suffix: string }
