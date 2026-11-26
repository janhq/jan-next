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
  /** Direct dependencies whose saved spec or installed version changed, or the declared dependencies selected by `list`. */
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
    if (before.dependencies[name] === after.dependencies[name] && before.versions[name] === after.versions[name]) return []
    const version = after.versions[name] ?? before.versions[name]
    return [version === undefined ? { name } : { name, version }]
  })
}

/** Declared dependencies a registry or git spec names by its own name prefix, for a repeated `add` that saved nothing new. */
function namedTargets(targets: readonly string[], dependencies: Readonly<Record<string, string>>): string[] {
  return [...new Set(targets.flatMap(spec =>
    Object.keys(dependencies).filter(name => spec === name || spec.startsWith(`${name}@`))))]
}

/** Use pnpm's own list JSON for its package selectors, version ranges and list flags. */
function selectedListPackages(output: string): Set<string> {
  const projects: unknown = JSON.parse(output)
  if (!Array.isArray(projects)) throw new Error('pnpm list did not return a JSON project list')
  const names = new Set<string>()
  for (const project of projects) {
    if (typeof project !== 'object' || project === null) throw new Error('pnpm list returned an invalid JSON project')
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const packages: unknown = Reflect.get(project, field)
      if (typeof packages === 'object' && packages !== null) {
        for (const name of Object.keys(packages)) names.add(name)
      }
    }
  }
  return names
}

/** The CLI exits on return, so a report must finish writing even when stdout is a full pipe. */
function writeReport(report: PluginCommandReport): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  process.stdout.write(JSON.stringify(report) + '\n', (error) => { if (error) reject(error); else resolve() })
  return promise
}

/** Build the report from both snapshots of one locked operation. */
function describe(
  command: PluginCommandReport['command'], invocation: PluginInvocation, result: PackageResult,
  before: ProfileSnapshot, after: ProfileSnapshot, earlierBuilds: readonly string[], approvedBuilds: string[],
  listOutput: string | undefined,
): PluginCommandReport {
  const ok = result.exitCode === 0
  const packages = command === 'list' ? [] : changedPackages(before, after)
  let names: readonly string[] = []
  if (command === 'list' && ok) {
    const selected = listOutput === undefined ? undefined : selectedListPackages(listOutput)
    names = Object.keys(after.dependencies).filter(name => selected === undefined || selected.has(name))
  } else if (command === 'add' && ok && packages.length === 0) {
    names = namedTargets(invocation.targets, after.dependencies)
  }
  for (const name of names) {
    const version = after.versions[name]
    packages.push(version === undefined ? { name } : { name, version })
  }
  const bundle = after.bundles.find(name => !before.bundles.includes(name))
  const pendingBuilds = ok ? [] : blockedBuildNames(result.output).filter(name => !earlierBuilds.includes(name))
  return {
    command, ok, exitCode: result.exitCode, packages,
    bundles: [...after.bundles],
    ...bundle === undefined ? {} : { bundle },
    ...approvedBuilds.length === 0 ? {} : { approvedBuilds },
    ...pendingBuilds.length === 0 ? {} : { pendingBuilds },
    ...result.incompatible === undefined ? {} : { incompatible: result.incompatible },
    logPath: result.logPath,
  }
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
 * @returns Zero on success; nonzero on invalid approval or package-manager failure. Without `--json`, unexpected operation errors reject.
 * An operation that throws before its state can be reported returns an error document with empty state arrays.
 * With `--json`, one report document is the whole of stdout; pnpm output and warnings stay on stderr.
 * With `--yes-builds`, an `add` that pnpm blocked on build scripts approves exactly the keys it
 * reported and repeats once, leaving any earlier undecided key pending.
 */
export async function runPlugin(profile: string, args: readonly string[], packageManager?: ProfileContext['packageManager']): Promise<number> {
  const invocation = parsePluginArguments(args)
  const { json, yesBuilds, command } = invocation
  const reportCommand = json && reportsCommand(command) ? command : undefined
  const refuse = async (error: string, diagnostic = error): Promise<number> => {
    if (reportCommand !== undefined) await writeReport({ command: reportCommand, ok: false, exitCode: 1, packages: [], bundles: [], error })
    else process.stderr.write(`jan: ${diagnostic}\n`)
    return 1
  }
  if (yesBuilds && command !== 'add') return refuse('--yes-builds applies to add')
  let dir: string
  try { dir = resolveProfileDir(profile) } catch (error) {
    if (reportCommand === undefined) throw error
    return refuse(error instanceof Error ? error.message : String(error))
  }
  if (profile === 'desktop') {
    try { requireDesktopProfile(dir) } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error), String(error))
    }
  }
  const versionResult = await versionCommand(profile, invocation.args)
  if (versionResult !== undefined) return versionResult
  // Let pnpm evaluate selectors and flags rather than maintaining a second argument parser for list.
  const pnpmList = reportCommand === 'list' && invocation.args.length > 1
  const pnpmArgs = pnpmList ? [...invocation.args, '--json'] : invocation.args
  const listOutput: string[] = []
  let approvedBuilds: string[] = []
  const context = { profile, dir, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }
  const options: PackageOperationOptions = {
    ...packageManager,
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    lookupTimeoutMs: 120000,
    ...json ? { captureOutput: true } : {},
    ...yesBuilds ? { approveReportedBuilds: true, onBuildsApproved: (names: readonly string[]) => { approvedBuilds = [...names] } } : {},
    onOutput: (text, stream) => {
      if (pnpmList && stream === 'stdout') listOutput.push(text)
      else (json ? process.stderr : process[stream]).write(text)
    },
  }
  let document: PluginCommandReport | undefined
  const runLocked = async (run: () => Promise<PackageResult>): Promise<PackageResult> => {
    for (const warning of readProfileCompatibility(dir).warnings) process.stderr.write(`jan: warning: ${warning}\n`)
    if (reportCommand === undefined) return run()
    const before = snapshotProfile(dir)
    const earlierBuilds = reportCommand === 'add' ? await readPendingBuilds(dir).catch(() => []) : []
    const result = await run()
    document = describe(reportCommand, invocation, result, before, snapshotProfile(dir), earlierBuilds, approvedBuilds,
      pnpmList ? listOutput.join('') : undefined)
    return result
  }
  let result: PackageResult
  try {
    result = profile === 'desktop'
      ? await withFileLock(join(dir, 'package.json'), async () => {
        requireDesktopProfile(dir)
        return runLocked(() => runProfilePnpm(context, pnpmArgs, options))
      }, { waitMs: 120000 })
      : await runPluginCommand(context, pnpmArgs, options, runLocked)
  } catch (error) {
    if (reportCommand === undefined) throw error
    return refuse(error instanceof Error ? error.message : String(error))
  }
  if (document !== undefined) await writeReport(document)
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
