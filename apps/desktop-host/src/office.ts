/** Desktop paths for the optional Office plugin rows in the `@janhq/jan-desktop-app` bundle. */

import { realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/** Bundled payload locations the Desktop carrier knows before the profile loads. */
export interface OfficePaths {
  /** Bundled payload directory. Its sibling `office-skills` holds the skill assets. */
  readonly source: string
  /** Harness-home directory where workspace dependencies are installed. */
  readonly root: string
  /** Prepared or ASAR-contained application dependency directory. */
  readonly runtimeDir: string
}

/**
 * Name the bundled Office payload for the bundle rows, which read these variables in their config.
 * The rows stay ordinary plugins: Plugins can switch them off or override any path.
 * @param paths - Bundled payload source, installation root, and runtime directory.
 * @returns Environment variables for `workspace-dependencies` and `skill-office`.
 */
export function officeEnvironment(paths: OfficePaths): Record<string, string> {
  const archive = runtimeArchivePath(paths.runtimeDir) === undefined ? undefined : dirname(realpathSync(paths.runtimeDir))
  const manifest = fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  const packageRoot = dirname(archive === undefined ? manifest : join(`${archive}.unpacked`, relative(archive, manifest)))
  return {
    JAN_BUNDLED_PRIMARY_RUNTIME: paths.source,
    JAN_BUNDLED_PRIMARY_RUNTIME_ROOT: paths.root,
    JAN_BUNDLED_OFFICE_SKILLS: join(dirname(paths.source), 'office-skills'),
    JAN_BUNDLED_OFFICE_NODE: join(paths.source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    JAN_BUNDLED_OFFICE_CLI: join(packageRoot, 'lib', 'cli.js'),
  }
}
