/**
 * Enforce the MIT license declaration for repository-owned Jan npm packages, except the listed
 * packages that keep the license of the source they port.
 * @module scripts/verify-jan-package-licenses
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const JAN_PACKAGE_NAME = /^@janhq\/jan(?:-|$)/

/** The exact license each listed package declares instead of MIT, with its LICENSE file. */
export const LICENSE_EXCEPTIONS: Readonly<Record<string, string>> = {
  // Ports the Jan app's Apache-2.0 tauri-plugin-websearch; packages/web/web-search/LICENSE.
  '@janhq/jan-web-search': 'Apache-2.0',
}

/** Result of checking every Jan package reachable through the root workspace list. */
export interface JanPackageLicenseReport {
  /** Number of Jan package manifests checked. */
  packageCount: number
  /** Repository-relative diagnostics for declarations other than the expected license. */
  failures: string[]
}

function readManifest(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-jan-package-licenses: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function workspaceManifestPaths(root: string): string[] {
  const rootManifest = readManifest(root, 'package.json')
  const workspaces = rootManifest.workspaces
  if (!isStringArray(workspaces)) {
    throw new Error('verify-jan-package-licenses: package.json workspaces must be a string array.')
  }

  const files = new Set(['package.json'])
  for (const pattern of workspaces) {
    for (const file of globSync(`${pattern}/package.json`, { cwd: root })) {
      files.add(file)
    }
  }
  return [...files].sort()
}

function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check every Jan npm package declared by the repository workspace.
 * @param root - absolute repository root containing the workspace package.json.
 * @param exceptions - package names mapped to the license they declare instead of MIT.
 * @returns the checked package count and every declaration other than the expected license.
 */
export function inspectJanPackageLicenses(
  root: string,
  exceptions: Readonly<Record<string, string>> = LICENSE_EXCEPTIONS,
): JanPackageLicenseReport {
  let packageCount = 0
  const failures: string[] = []

  for (const file of workspaceManifestPaths(root)) {
    const manifest = readManifest(root, file)
    const name = manifest.name
    if (typeof name !== 'string' || !JAN_PACKAGE_NAME.test(name)) continue

    packageCount++
    const expected = exceptions[name] ?? 'MIT'
    if (manifest.license !== expected) {
      const normalizedFile = file.split(sep).join('/')
      failures.push(
        `${normalizedFile}: ${name} must declare "license": "${expected}"; found ${printable(manifest.license)}.`,
      )
    }
  }

  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectJanPackageLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-jan-package-licenses: unexpected Jan package license declarations found:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-jan-package-licenses: ${String(report.packageCount)} Jan package(s) checked; all declare MIT or their listed exception.\n`,
    )
  }
}
