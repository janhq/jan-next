/** Profile package management, explicit exact-version approvals, and machine-readable command reports. */
import {
  blockedBuildNames, readPendingBuilds, runPluginCommand, runProfilePnpm, setProfileVersionExemption, type PackageOperationOptions,
} from '@janhq/jan-plugin-manager/operations'
import { INSTALL_ANCHOR } from './profile-boot.ts'
import {
  initProfile, readProfileCompatibility, readProfileManifest, resolveProfileDir, type ProfileContext, type ProfileManifest,
} from '@janhq/jan-app-boot'
import type { IncompatiblePlugin, PackageResult } from '@janhq/jan-plugin-manager/types'
import { PROFILE_TEMPLATES, DEFAULT_PROFILE_BUNDLES } from '@janhq/jan-official-bundles'
import { withFileLock } from '@janhq/jan-atomic-write'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Commands whose outcome a `--json` report describes. */
const REPORT_COMMANDS: Record<PluginCommandReport['command'], true> = { add: true, remove: true, list: true }

/** Whether a subcommand is one a `--json` report describes. */
function reportsCommand(command: string | undefined): command is PluginCommandReport['command'] {
  return command !== undefined && Object.hasOwn(REPORT_COMMANDS, command)
}

/** One package a command installed or removed, with the version observed on disk when there is one. */
export interface PluginCommandPackage {
  name: string
  version?: string
}

/**
 * The single JSON document `--json` writes to stdout. Diagnostics, including pnpm's own output, stay on
 * stderr, so a caller can read stdout as one document whatever the exit status.
 */
export interface PluginCommandReport {
  command: 'add' | 'remove' | 'list'
  /** Whether the command ended successfully; the same fact as a zero `exitCode`. */
  ok: boolean
  exitCode: number
  /** Direct dependencies this command installed or removed, or every declared dependency for `list`. */
  packages: PluginCommandPackage[]
  /** The bundle this command activated, when it activated one. */
  bundle?: string
  /** The profile's bundle selection after the command. */
  bundles: string[]
  /** Exact `allowBuilds` keys `--yes-builds` approved before the retry. */
  approvedBuilds?: string[]
  /** Exact `allowBuilds` keys a failed run reported as blocked; re-run with `--yes-builds` to allow them. */
  pendingBuilds?: string[]
  /** Packages a compatibility check refused, when one did. */
  incompatible?: IncompatiblePlugin[]
  /** The full diagnostic log of the package-manager run. */
  logPath?: string
  /** Why the command did not run or what refused it; a human-readable sentence. */
  error?: string
}

/** The arguments one plugin invocation carries, split into pnpm's and Jan's own. */
interface PluginInvocation {
  /** Arguments pnpm receives, with Jan-owned flags removed. */
  args: string[]
  /** Write one JSON report to stdout instead of human diagnostics. */
  json: boolean
  /** Approve the build scripts this run reports as blocked, then retry once. */
  yesBuilds: boolean
  /** The subcommand the arguments name, when they name one. */
  command: string | undefined
  /** Package specs the subcommand names, in order, without flags. */
  targets: string[]
}

/** A profile's plugin state around one command, for the report's before/after comparison. */
interface ProfileSnapshot {
  dependencies: Readonly<Record<string, string>>
  bundles: readonly string[]
  /** Installed version per declared direct dependency. */
  versions: Readonly<Record<string, string | undefined>>
}

function requireDesktopProfile(dir: string): void {
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error('Open Jan Desktop once to initialize its profile, then fully quit it before running jan plugin --profile desktop.')
  }
}

/** Split Jan-owned flags from the arguments pnpm receives.
 * The flags belong to the commands Jan reports on; for any other command they stay pnpm's own
 * arguments, so `jan plugin why --json` still reaches pnpm unchanged.
 * @param args Arguments after `jan plugin --profile <name>`.
 * @returns The forwarded arguments and the flags Jan consumes.
 */
function parsePluginArguments(args: readonly string[]): PluginInvocation {
  const index = args.findIndex(argument => !argument.startsWith('-'))
  const command = index < 0 ? undefined : args[index]
  if (!reportsCommand(command)) return { args: [...args], json: false, yesBuilds: false, command, targets: [] }
  let json = false
  let yesBuilds = false
  const forwarded: string[] = []
  for (const argument of args) {
    if (argument === '--json') json = true
    else if (argument === '--yes-builds') yesBuilds = true
    else forwarded.push(argument)
  }
  const targets = forwarded.slice(forwarded.indexOf(command) + 1).filter(argument => !argument.startsWith('-'))
  return { args: forwarded, json, yesBuilds, command, targets }
}

/** Every direct-dependency field pnpm can install a plugin through. */
function declaredDependencies(manifest: ProfileManifest): Record<string, string> {
  const extra = manifest as ProfileManifest & {
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  return { ...extra.devDependencies, ...manifest.dependencies, ...extra.optionalDependencies }
}

/** The version a declared dependency has on disk, or undefined when it is not installed in the profile. */
function installedVersion(dir: string, name: string): string | undefined {
  try { return readProfileManifest('jan', join(dir, 'node_modules', name)).version }
  catch (error) { void error; return undefined }
}

/** Read a profile's declared dependencies, bundle selection and installed versions; a missing profile reads as empty. */
function snapshotProfile(dir: string): ProfileSnapshot {
  if (!existsSync(join(dir, 'package.json'))) return { dependencies: {}, bundles: [], versions: {} }
  const manifest = readProfileManifest('jan', dir)
  const dependencies = declaredDependencies(manifest)
  const versions: Record<string, string | undefined> = {}
  for (const name of Object.keys(dependencies)) versions[name] = installedVersion(dir, name)
  return { dependencies, bundles: manifest.jan?.profile?.bundles ?? [], versions }
}

/** Direct dependencies whose saved spec or installed version changed, with the version read after the command. */
function changedPackages(before: ProfileSnapshot, after: ProfileSnapshot): PluginCommandPackage[] {
  const names = new Set([...Object.keys(before.dependencies), ...Object.keys(after.dependencies)])
  return [...names].flatMap((name) => {
    if (before.dependencies[name] === after.dependencies[name]) return []
    const version = after.versions[name] ?? before.versions[name]
    return [version === undefined ? { name } : { name, version }]
  })
}

/** Declared dependencies a registry or git spec names by its own name prefix, for a repeated `add` that saved nothing new. */
function namedTargets(targets: readonly string[], dependencies: Readonly<Record<string, string>>): string[] {
  return [...new Set(targets.flatMap(spec =>
    Object.keys(dependencies).filter(name => spec === name || spec.startsWith(`${name}@`))))]
}

/** Parse only Jan-owned commands; all other arguments remain pnpm's responsibility. */
async function versionCommand(profile: string, args: readonly string[]): Promise<number | undefined> {
  const [command, ...rest] = args
  if (command !== 'allow-version' && command !== 'revoke-version' && command !== 'version-exemptions') return undefined
  try {
    let packageVersion: string | undefined
    let runtimeVersion: string | undefined
    let acceptRisk = false
    const argumentsIterator = rest.values()
    for (const argument of argumentsIterator) {
      if (argument === '--accept-risk' && command === 'allow-version' && !acceptRisk) acceptRisk = true
      else if (argument === '--jan-version' && runtimeVersion === undefined) runtimeVersion = argumentsIterator.next().value
      else if (argument.startsWith('--jan-version=') && runtimeVersion === undefined) runtimeVersion = argument.slice('--jan-version='.length)
      else if (!argument.startsWith('-') && packageVersion === undefined) packageVersion = argument
      else throw new Error(`unexpected argument ${JSON.stringify(argument)}`)
    }
    if (command === 'version-exemptions' && rest.length > 0) throw new Error('usage: jan plugin version-exemptions')
    let request: { packageVersion: string; runtimeVersion: string } | undefined
    if (command !== 'version-exemptions') {
      if (packageVersion === undefined || runtimeVersion === undefined) {
        throw new Error(`usage: jan plugin ${command} <package@version> --jan-version <exact>${command === 'allow-version' ? ' --accept-risk' : ''}`)
      }
      request = { packageVersion, runtimeVersion }
    }
    if (command === 'allow-version') {
      process.stderr.write('jan: warning: allowing incompatible plugin versions can break the application or corrupt data. Approval applies only to the exact package and Jan versions.\n')
    }
    const dir = resolveProfileDir(profile)
    if (profile !== 'desktop') await mkdir(dir, { recursive: true })
    await withFileLock(join(dir, 'package.json'), async () => {
      if (profile === 'desktop') requireDesktopProfile(dir)
      else if (!existsSync(join(dir, 'package.json'))) initProfile(dir, PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
      if (request === undefined) {
        const { exemptions, warnings } = readProfileCompatibility(dir)
        for (const warning of warnings) process.stderr.write(`jan: warning: ${warning}\n`)
        process.stdout.write(JSON.stringify(exemptions, undefined, 2) + '\n')
      } else {
        await setProfileVersionExemption(dir, request.packageVersion, request.runtimeVersion, command === 'allow-version', acceptRisk)
        process.stdout.write(`jan: ${command === 'allow-version' ? 'allowed' : 'revoked'} ${request.packageVersion} for Jan ${request.runtimeVersion}\n`)
      }
    }, { waitMs: 120000 })
    return 0
  } catch (error) {
    process.stderr.write(`jan: ${String(error)}\n`)
    return 1
  }
}

/** Run package management for a profile.
 * @param profile Profile name; Desktop's reserved profile must already be initialized by the application.
 * @param args Jan exemption command or pnpm arguments relative to the invoking directory.
 * @param packageManager Installation-owned executable and environment for pnpm operations.
 * @returns Zero on success; nonzero on invalid approval or package-manager failure.
 * With `--json`, one report document is the whole of stdout; pnpm output and warnings stay on stderr.
 * With `--yes-builds`, an `add` that pnpm blocked on build scripts approves exactly the keys it
 * reported and repeats once, leaving any earlier undecided key pending.
 */
export async function runPlugin(profile: string, args: readonly string[], packageManager?: ProfileContext['packageManager']): Promise<number> {
  const invocation = parsePluginArguments(args)
  const { json, yesBuilds, command } = invocation
  const reports = reportsCommand(command)
  const report = (fields: Omit<PluginCommandReport, 'command'>): void => {
    if (!reports) return
    process.stdout.write(JSON.stringify({ command, ...fields }) + '\n')
  }
  /** Refuse before anything runs, as the report or as a stderr line. */
  const refuse = (message: string): number => {
    if (json && reports) report({ ok: false, exitCode: 1, packages: [], bundles: [], error: message })
    else process.stderr.write(`jan: ${message}\n`)
    return 1
  }
  if (yesBuilds && command !== 'add') return refuse('--yes-builds applies to add')
  if (profile === 'desktop') {
    try { requireDesktopProfile(resolveProfileDir(profile)) } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (json) report({ ok: false, exitCode: 1, packages: [], bundles: [], error: message })
      else process.stderr.write(`jan: ${String(error)}\n`)
      return 1
    }
  }
  const versionResult = await versionCommand(profile, invocation.args)
  if (versionResult !== undefined) return versionResult
  const dir = resolveProfileDir(profile)
  if (existsSync(join(dir, 'package.json'))) {
    for (const warning of readProfileCompatibility(dir).warnings) process.stderr.write(`jan: warning: ${warning}\n`)
  }
  // The state the report compares against: what the command changed, what it activated, and the
  // version a removal takes away. A non-desktop profile may not exist yet, which reads as empty.
  const before = snapshotProfile(dir)
  // Keys that were already pending belong to earlier work: the report names only what this run introduced,
  // which is also exactly the set `--yes-builds` would approve.
  const earlierBuilds: readonly string[] = await readPendingBuilds(dir).catch(() => [])
  let approvedBuilds: string[] = []
  const context = { profile, dir, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }
  const options: PackageOperationOptions = {
    ...packageManager,
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    lookupTimeoutMs: 120000,
    // A report owns stdout, so pnpm's own output is captured and replayed on stderr; approval likewise
    // needs the run's report to name the keys it blocked.
    ...json || yesBuilds ? { captureOutput: true } : {},
    ...yesBuilds ? { approveReportedBuilds: true } : {},
    onOutput: (text, stream) => { (json ? process.stderr : process[stream]).write(text) },
    ...yesBuilds ? { onBuildsApproved: (names: readonly string[]) => { approvedBuilds = [...names] } } : {},
  }
  // The report describes the profile the run left behind, so a Desktop run takes its snapshot and writes
  // the document before the shared lock is released: no other writer can land between the two.
  const describe = (result: PackageResult): void => {
    if (!json || !reports) return
    const after = snapshotProfile(dir)
    const declared = Object.keys(after.dependencies)
    const packages: PluginCommandPackage[] = command === 'list'
      ? declared.map(name => after.versions[name] === undefined ? { name } : { name, version: after.versions[name] })
      : changedPackages(before, after)
    // A second `add` of the same version saves no new spec, so the spec's own name is what the report
    // answers with; a path or tarball target's name is only known once pnpm recorded it.
    if (command === 'add' && packages.length === 0) {
      for (const name of namedTargets(invocation.targets, after.dependencies)) {
        packages.push(after.versions[name] === undefined ? { name } : { name, version: after.versions[name] })
      }
    }
    const activated = after.bundles.filter(name => !before.bundles.includes(name))
    const pendingBuilds = result.exitCode === 0
      ? [] : blockedBuildNames(result.output).filter(name => !earlierBuilds.includes(name))
    report({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      packages,
      bundles: [...after.bundles],
      ...activated[0] === undefined ? {} : { bundle: activated[0] },
      ...approvedBuilds.length === 0 ? {} : { approvedBuilds },
      ...pendingBuilds.length === 0 ? {} : { pendingBuilds },
      ...result.incompatible === undefined ? {} : { incompatible: result.incompatible },
      logPath: result.logPath,
    })
  }
  const result = profile === 'desktop'
    ? await withFileLock(join(dir, 'package.json'), async () => {
      requireDesktopProfile(dir)
      const run = await runProfilePnpm(context, invocation.args, options)
      describe(run)
      return run
    }, { waitMs: 120000 })
    : await runPluginCommand(context, invocation.args, options)
  if (profile !== 'desktop') describe(result)
  if (!json) {
    if (result.exitCode === 127) process.stderr.write('jan: pnpm was not found; install pnpm and make it available on PATH.\n')
    for (const { name, version, runtimeVersion } of result.incompatible ?? []) {
      process.stderr.write(`jan: to accept the risk, run: jan plugin --profile ${profile} allow-version ${name}@${version} --jan-version ${runtimeVersion} --accept-risk\n`)
    }
    if (result.exitCode !== 0) process.stderr.write(`jan: plugin command failed; diagnostics: ${result.logPath}\n`)
    if (result.exitCode !== 0 && invocation.args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(`jan: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — re-run with --yes-builds to allow exactly the scripts pnpm printed, or add that key under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}\n`)
    }
  }
  return result.exitCode
}
