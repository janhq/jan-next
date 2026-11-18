import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'

/** Packaging and development target; Linux x64 packages only unsigned and has no update feed. */
export type DesktopBuildTarget = DesktopAutoUpdateTarget | 'linux-x64'

/** Platform and architecture of an auto-updated release payload. */
export interface DesktopReleasePlatform {
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
}

/** Platform and architecture of any packaged or development payload. */
export interface DesktopBuildPlatform {
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
  readonly jan: string
  readonly janPnpm: string
  readonly electron: string
  readonly packedJan: string
  readonly packedVendor: string
  readonly packedLandlock: string
  readonly downloads: string
  readonly pnpmStore: string
}

/**
 * Resolve the target a packaging run or unpackaged development launch prepares.
 * @param env - Packaging or launch environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Supported Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopBuildTarget

/**
 * Return the mutable preparation and artifact directories owned by one target.
 * @param target - Supported Desktop target name.
 * @param environment - Packaging environment with an optional absolute cache directory.
 * @returns Target paths plus shared download and package caches.
 */
export function desktopTargetBuildPaths(target: DesktopBuildTarget, environment?: NodeJS.ProcessEnv): DesktopTargetBuildPaths

/**
 * Return the platform and architecture of the payload one release target prepares.
 * Windows is prepared as x64 only, so this differs from the build host on an arm64 Windows machine.
 * @param target - Supported Desktop release target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopAutoUpdateTarget): DesktopReleasePlatform
/**
 * Return the platform and architecture of the payload any packaging or development target prepares.
 * @param target - Supported Desktop target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopBuildTarget): DesktopBuildPlatform

/**
 * Locate the executable inside an extracted Electron distribution.
 * @param electronDirectory - Extracted Electron archive root.
 * @param platform - Platform the distribution was built for.
 * @returns Electron executable path.
 */
export function desktopElectronExecutable(electronDirectory: string, platform: NodeJS.Platform): string

/**
 * Resolve the paths owned by the target selected in a packaging environment.
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
