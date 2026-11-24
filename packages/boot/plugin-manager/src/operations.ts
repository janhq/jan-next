/** Shared profile package operations used by jan plugin and the running manager. */
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import type { EntryOptions } from '@janhq/cordis-plugin-loader'
import { withFileLock, writeFileAtomic } from '@janhq/jan-atomic-write'
import {
  assertBundlePlatform, UnsupportedBundlePlatformError, bundlePatchPaths, initProfile, readProfileManifest,
  resolveBundleDir, resolveProfileDir, loadOverlayPatches, composeEntries, readProfileVersionExemptions,
  evaluatePluginCompatibility, pluginCompatibilityWarning, type ProfileManifest,
} from '@janhq/jan-app-boot'
import { PROFILE_TEMPLATES, DEFAULT_PROFILE_BUNDLES } from '@janhq/jan-official-bundles'
import { scrubbedParentEnv } from '@janhq/jan-subprocess'
import { approveBuilds, blockedBuildNames, readPendingBuilds, recordPendingBuilds } from './build-approval.ts'
import { parseInstallSpec } from './install-spec.ts'
import { awaitTreeGone, leadsOwnGroup, treeAlive, type RunTree } from './run-tree.ts'
import { incompatiblePlugin } from './failure.ts'
import type { IncompatiblePlugin, PackageResult, Registry } from './types.ts'
export { setProfileVersionExemption, readProfileVersionExemptions } from '@janhq/jan-app-boot'
/** The exact `allowBuilds` keys a pnpm run reported as blocked, for a caller that offers approval. */
export { blockedBuildNames, readPendingBuilds } from './build-approval.ts'

/** Profile and invocation locations supplied by the launcher. */
export interface PackageOperationContext {
  profile: string
  /** Explicit directory for an application-owned profile; named CLI profiles resolve under home. */
  dir?: string
  installAnchor: string
  cwd: string
  home?: string
}

/** Output and cancellation policy for one pnpm operation. */
export interface PackageOperationOptions {
  /** The pnpm executable name or path; resolved through `PATH` like the `jan plugin` command. Defaults to `pnpm`. */
  command?: string
  /** Prefix arguments for an application-owned executable. */
  args?: readonly string[]
  /** Application runtime environment, applied only to this package operation. */
  env?: Readonly<Record<string, string>>
  /** CLI inherits authentication and terminal descriptors; service scrubs secrets and captures output. */
  execution: 'cli' | 'service'
  signal?: AbortSignal
  outputBytes: number
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void
  activateNewBundles?: boolean
  lockWaitMs?: number
  /**
   * Terminate the run once its captured output has been silent for this long, in
   * milliseconds. A run stopped this way reports `timedOut`; without a bound, a
   * child that stops progressing without exiting holds its caller forever. A run
   * with inherited descriptors captures nothing and is never bound.
   */
  idleTimeoutMs?: number
  /** Bound on the pre-install registry lookup, in milliseconds; without one a fixed bound applies. */
  lookupTimeoutMs?: number
  /**
   * Capture CLI output and hand it to `onOutput` instead of inheriting the caller's descriptors.
   * A caller that reserves stdout for one JSON answer sets this. Installs and updates are always
   * captured while checking for skipped builds. `output` holds the captured tail.
   */
  captureOutput?: boolean
  /**
   * Explicitly allow the dependency build scripts this very run reports as blocked, then retry once.
   * Only the reported keys are approved: a key an earlier attempt left undecided stays pending, and the
   * caller holds the profile lock, so the approval and the retry see the same profile. The attempt that
   * records the report needs captured output, so a CLI caller echoes it through `onOutput`.
   */
  approveReportedBuilds?: boolean
  /** Called with the exact keys just approved, so a caller can report what running scripts it allowed. */
  onBuildsApproved?: (names: readonly string[]) => void
}

/** One profile file as a restore would put it back. */
interface SavedFile {
  path: string
  text: string | undefined
}

/** The profile state one operation found, before any attempt changed it. */
interface OperationStart {
  /** Direct dependency specs recorded in the profile manifest. */
  dependencies: Readonly<Record<string, string>>
  /** Production dependencies eligible for automatic bundle selection. */
  productionDependencies: ProfileManifest['dependencies']
  /** Each direct dependency's installed manifest, keyed by name. */
  installedBefore: ReadonlyMap<string, string | undefined>
  /** `package.json` and `pnpm-lock.yaml` as they were, for restoring on a rejection. */
  savedFiles: readonly SavedFile[]
}

/** Pending keys and the original state shared by all attempts in one package operation. */
interface OperationAttempts {
  /**
   * `allowBuilds` keys that were already awaiting a decision before the operation started. pnpm reports
   * every pending key in the tree, so a key outside this list means this attempt's own package never built
   * and must not be activated.
   */
  earlierPendingBuilds: ReadonlySet<string>
  /**
   * The profile as the whole operation found it. A sibling attempt has already saved its dependency and
   * installed it, so this snapshot is what keeps a retried attempt's validation, restoration and
   * activation judging the operation rather than only its own run.
   */
  start?: OperationStart
}

/** Resolve relative package specs against the caller's directory.
 * @param argument One pnpm argument.
 * @param cwd Invocation directory, never the profile directory.
 * @returns Anchored argument.
 */
export function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  return `${match.groups.prefix ?? ''}${resolve(cwd, match.groups.path)}`
}

/** A single argv item with no prefix a registry, git host, or path form claims. */
const BARE_SPEC = /^[^@:\\/]+$/

/** Resolve a named install spec that names something already on disk in the caller's directory.
 * A bare `plugin.tgz` or `plugin` is a package name to pnpm, so a file or directory the caller
 * can see wins over a registry lookup, the same way `./plugin.tgz` already does.
 * @param argument One positional argument after an install command.
 * @param cwd Invocation directory, never the profile directory.
 * @returns The anchored spec, or the argument unchanged when it is not a path the caller can see.
 */
export function anchorInstallSpec(argument: string, cwd: string): string {
  const anchored = anchorPathSpec(argument, cwd)
  if (anchored !== argument || !BARE_SPEC.test(argument) || argument.startsWith('-')) return anchored
  const path = resolve(cwd, argument)
  return existsSync(path) ? path : argument
}

/** Read bundle metadata without loading its JavaScript.
 * @param name Installed dependency or installation-owned package name.
 * @param dir Profile directory.
 * @param anchor Installation manifest.
 * @returns Resolved metadata, or undefined for packages without bundle metadata.
 */
export function bundleManifest(name: string, dir: string, anchor: string): ProfileManifest | undefined {
  const packageDir = resolveBundleDir('jan', name, anchor, dir)
  const manifest = readProfileManifest('jan', packageDir)
  return manifest.jan?.bundle?.patch === undefined ? undefined : manifest
}

/** Atomically save a profile manifest while retaining unrelated fields.
 * @param dir Profile directory.
 * @param manifest Updated document.
 */
export async function saveManifest(dir: string, manifest: ProfileManifest): Promise<void> {
  await writeFileAtomic(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', { mode: 0o600 })
}

/** Reconcile bundle selection, returning platform denials without saving any selection changes. */
async function reconcile(
  before: ProfileManifest['dependencies'], after: ProfileManifest, dir: string, anchor: string, options: PackageOperationOptions,
): Promise<string[]> {
  const dependencies = new Set(Object.keys(after.dependencies ?? {}))
  const beforeDeps = new Set(Object.keys(before ?? {}))
  const previous = after.jan?.profile?.bundles ?? []
  const unsupported: string[] = []
  const bundles = previous.filter((name) => {
    if (!beforeDeps.has(name) && !dependencies.has(name)) return true
    return dependencies.has(name) && bundleManifest(name, dir, anchor) !== undefined
  })
  for (const name of dependencies) {
    if (beforeDeps.has(name)) continue
    const metadata = bundleManifest(name, dir, anchor)
    if (metadata?.jan?.bundle === undefined) {
      options.onOutput?.(`jan: warning: ${name} declares no jan.bundle — installed as a plain dependency, not a profile layer\n`, 'stderr')
      continue
    }
    try { assertBundlePlatform(metadata.jan.bundle.platforms, process.platform) } catch (error) {
      if (!(error instanceof UnsupportedBundlePlatformError)) throw error
      unsupported.push(`${name}: ${error.message}`)
      continue
    }
    for (const file of bundlePatchPaths(resolveBundleDir('jan', name, anchor, dir), metadata.jan.bundle)) loadOverlayPatches('jan', file)
    if (!bundles.includes(name)) {
      bundles.push(name)
    }
  }
  if (unsupported.length > 0) return unsupported
  if (JSON.stringify(previous) === JSON.stringify(bundles)) return []
  after.jan = { ...after.jan, profile: { ...after.jan?.profile, bundles } }
  await saveManifest(dir, after)
  return []
}

/**
 * How long the pipes keep draining after their process exited, as a fixed part of
 * finishing a run rather than a deployment knob: a descendant that inherited them
 * holds them open, and the tail a failure classification reads is written by then.
 */
const DRAIN_AFTER_EXIT_MS = 2_000

/** Whether every collector finished within `ms`.
 * @param collectors The pipe readers racing the bound.
 * @param ms The longest wait, in milliseconds.
 * @returns True when all collectors settled in time.
 */
async function drainWithin(collectors: readonly Promise<void>[], ms: number): Promise<boolean> {
  if (collectors.length === 0) return true
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      Promise.allSettled(collectors).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => { resolve(false) }, ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Install commands that take the packages to install as positionals. */
const INSTALL_COMMANDS = new Set(['add', 'install', 'i'])

/** Commands whose package changes can bring in new dependency build scripts. */
const BUILD_COMMANDS = new Set([...INSTALL_COMMANDS, 'update', 'up', 'upgrade'])

/** Bound on a pre-install registry lookup when the caller names none. */
const LOOKUP_TIMEOUT_MS = 20_000

/** Package specs an install command names explicitly, in order. */
function namedSpecs(args: readonly string[]): string[] {
  const index = args.findIndex(argument => !argument.startsWith('-'))
  const command = index < 0 ? undefined : args[index]
  if (command === undefined || !INSTALL_COMMANDS.has(command)) return []
  return args.slice(index + 1).filter(argument => !argument.startsWith('-'))
}

/** The arguments pnpm receives, with an install command's positionals anchored to the caller's directory.
 * A positional an install command names may be a local file or directory the caller sees, even without
 * a `./` prefix; every other argument keeps the path form `anchorPathSpec` already gave it.
 * @param args Pnpm arguments, before anchoring.
 * @param cwd Invocation directory, never the profile directory.
 * @returns Anchored arguments.
 */
function anchoredArguments(args: readonly string[], cwd: string): string[] {
  const index = args.findIndex(argument => !argument.startsWith('-'))
  const install = index >= 0 && INSTALL_COMMANDS.has(args[index] as string)
  return args.map((argument, position) => install && position > index
    ? anchorInstallSpec(argument, cwd) : anchorPathSpec(argument, cwd))
}

/** The manifest a named spec would install, read without installing it.
 * A path spec is read from disk. A registry spec asks pnpm's own configuration for the version the
 * range selects and its jan requirements (`engines` and peerDependencies). A git or tarball spec needs the fetch itself, so the
 * check after installation is what judges it.
 * @param dir Profile directory the lookup runs in.
 * @param spec Anchored install spec.
 * @param options Pnpm executable, prefix arguments, the caller's bound and signal.
 * @param environment Environment of the caller's pnpm invocations.
 * @param flags Flags of the run itself, so the lookup asks the registry that run will use.
 * @returns The package manifest, or undefined when reading it would need the installation itself.
 */
async function namedSpecManifest(
  dir: string, spec: string, options: PackageOperationOptions, environment: Readonly<Record<string, string | undefined>>,
  flags: readonly string[],
): Promise<object | undefined> {
  const parsed = parseInstallSpec(spec)
  if (parsed.kind === 'path') {
    const filename = join(parsed.path, 'package.json')
    return existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) as object : undefined
  }
  if (parsed.kind !== 'registry') return undefined
  const viewed = await execa(options.command ?? 'pnpm', [
    ...options.args ?? [], 'view', parsed.spec, 'name', 'version', 'engines', 'peerDependencies', '--json',
    ...flags, '--config.fetch-retries=0',
  ], {
    cwd: dir, env: environment, extendEnv: false, reject: false, stdin: 'ignore',
    ...options.signal === undefined ? {} : { cancelSignal: options.signal },
    timeout: options.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS,
  })
  if (viewed.exitCode !== 0) return undefined
  const value: unknown = JSON.parse(viewed.stdout)
  return (Array.isArray(value) ? value.at(-1) : value) as object
}

/** Missing installed packages are repairable; their absence is part of the before/after comparison. */
function optionalFile(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Where an operation records the pnpm run it started, for a successor when the operation's own process ends first. */
function runRecordPath(dir: string): string {
  return join(dir, '.plugin-manager', 'run.json')
}

/** Record a started run; a successor that takes over the profile lock from an exited process waits for it. */
async function recordRun(dir: string, tree: RunTree): Promise<void> {
  if (tree.pid === undefined) return
  await writeFileAtomic(runRecordPath(dir), `${JSON.stringify(tree)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Why this operation must not run: a record left by an operation whose process
 * ended mid-run names a run that is still writing the profile. The profile
 * lock is taken over once its holder exits, but its pnpm tree can outlive it.
 * A recorded run that stopped, within a bounded wait, has its record removed.
 * @param dir Profile directory.
 * @returns The diagnostic, or undefined when no recorded run is active.
 */
async function activeRecordedRun(dir: string): Promise<string | undefined> {
  const path = runRecordPath(dir)
  const text = optionalFile(path)
  if (text === undefined) return undefined
  let tree: RunTree | undefined
  try {
    const value: unknown = JSON.parse(text)
    const { pid, grouped } = (typeof value === 'object' && value !== null ? value : {}) as { pid?: unknown; grouped?: unknown }
    if (Number.isSafeInteger(pid) && (pid as number) > 0 && typeof grouped === 'boolean') tree = { pid: pid as number, grouped }
  } catch (error) {
    // Records are replaced atomically, so an unparsable one was written by something else and is reported below.
    void error
  }
  if (tree === undefined) {
    return `jan: ${path} does not name a package run; delete it once no earlier package operation is still running in this profile\n`
  }
  await awaitTreeGone(tree)
  if (treeAlive(tree)) {
    return `jan: process ${String(tree.pid)}, started by an earlier package operation whose own process ended, is still running in this profile; `
      + `wait for it or stop it, then retry. If process ${String(tree.pid)} is not that package run, delete ${path}.\n`
  }
  await rm(path, { force: true })
  return undefined
}

/** pnpm can install plugins through any direct-dependency field. */
function directDependencies(manifest: ProfileManifest): Record<string, string> {
  const extra = manifest as ProfileManifest & { devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
  return { ...extra.devDependencies, ...manifest.dependencies, ...extra.optionalDependencies }
}

/** Inspect only plugin rows contributed by the changed bundle, not its dependency closure. */
function bundleComponentManifests(manifest: ProfileManifest, dir: string, anchor: string): ProfileManifest[] {
  const bundle = manifest.jan?.bundle
  if (bundle === undefined) return []
  const patches = bundlePatchPaths(dir, bundle).flatMap(file => loadOverlayPatches('jan', file))
  const names = new Set<string>()
  const visit = (rows: EntryOptions[]) => {
    for (const row of rows) {
      if (row.group && Array.isArray(row.config)) visit(row.config as EntryOptions[])
      if (typeof row.name !== 'string' || row.name.startsWith('.') || row.name.startsWith('/') || row.name.includes(':')) continue
      const parts = row.name.split('/')
      names.add(parts.slice(0, row.name.startsWith('@') ? 2 : 1).join('/'))
    }
  }
  visit(composeEntries([patches.filter(patch => patch.insert !== undefined)]))
  return [...names].flatMap((name) => {
    let packageDir: string
    try { packageDir = resolveBundleDir('jan', name, anchor, dir) } catch (error) {
      // Resolution errors for uninstalled or dynamic rows remain subject to the startup loader's checks.
      void error
      return []
    }
    return [readProfileManifest('jan', packageDir)]
  })
}

/** Execute pnpm inside a profile whose caller already holds the profile write lock.
 * Newly installed or updated direct dependencies are checked even when activation is disabled;
 * an untouched dependency never blocks an unrelated operation and stays denied at startup.
 * Compatibility denial restores the profile manifest and lockfile, but leaves downloaded modules on disk.
 * @param context Launcher-owned profile and resolution locations.
 * @param args Pnpm arguments, before relative path anchoring.
 * @param options Output, activation and cancellation policy.
 * @returns Exit status, whether the silence bound stopped the run, and the diagnostic path.
 * A compatibility denial returns exit code 1. CLI uses inherited descriptors unless captured for build checks or reporting.
 * Unsupported Host activation returns exit code 1 with named diagnostics; installed dependencies remain,
 * and no bundle selection changes are saved. Other reconciliation or filesystem errors reject.
 * Newly blocked builds leave modules on disk for pnpm approval but restore the manifest and lockfile before an explicit retry.
 * The diagnostic file is closed on return or rejection, including preparation and spawn failures.
 * With `approveReportedBuilds`, the keys this run reports as blocked are approved and the run repeats once.
 */
export async function runProfilePnpm(
  context: PackageOperationContext, args: readonly string[], options: PackageOperationOptions,
): Promise<PackageResult> {
  const command = args.find(argument => !argument.startsWith('-'))
  const checkBuilds = command !== undefined && BUILD_COMMANDS.has(command)
  const dir = context.dir ?? resolveProfileDir(context.profile, context.home)
  // Keys already awaiting a decision belong to earlier work. Without a readable policy, a reported
  // key still blocks activation but is never automatically approved.
  const earlier = checkBuilds || options.approveReportedBuilds === true
    ? await readPendingBuilds(dir).catch(() => undefined) : []
  const attempt: OperationAttempts = { earlierPendingBuilds: new Set(earlier) }
  const runOptions = checkBuilds || options.approveReportedBuilds === true ? { ...options, captureOutput: true } : options
  const refused = await runPnpmOnce(context, args, runOptions, attempt, checkBuilds)
  if (options.approveReportedBuilds !== true || earlier === undefined) return refused
  const buildOutput = refused.truncated ? await readFile(refused.logPath, 'utf8') : refused.output
  const reported = blockedBuildNames(buildOutput).filter(name => !attempt.earlierPendingBuilds.has(name))
  if (reported.length === 0) return refused
  let approved: string[]
  try {
    // Record only what this run reported, then approve just the keys it introduced.
    const pending = await recordPendingBuilds(dir, buildOutput)
    approved = pending.filter(name => reported.includes(name))
    if (approved.length === 0) return refused
    await approveBuilds(dir, approved)
  } catch (error) {
    // The first run is already the answer, and the profile settings could not take the approval.
    void error
    return refused
  }
  options.onBuildsApproved?.(approved)
  return await runPnpmOnce(context, args, runOptions, attempt, checkBuilds)
}

/** Read the profile files that an unsuccessful package operation can restore. */
function savedProfileFiles(dir: string): SavedFile[] {
  return ['package.json', 'pnpm-lock.yaml'].map((name) => {
    const path = join(dir, name)
    return { path, text: optionalFile(path) }
  })
}

/** Read the dependency version pnpm stores under a lockfile dependency alias. */
function dependencyReference(alias: string, value: string): string | undefined {
  if (value.startsWith('link:')) return undefined
  const at = value.indexOf('@')
  const colon = value.indexOf(':')
  const suffix = value.indexOf('(')
  return at >= 0 && (colon < 0 || at < colon) && (suffix < 0 || at < suffix) ? value : `${alias}@${value}`
}

/** Report skipped builds reachable from production packages newly eligible for bundle activation. */
function skippedBuildsFor(dir: string, added: readonly string[], lockfile: string | undefined): string[] {
  if (added.length === 0 || lockfile === undefined) return []
  const metadata = optionalFile(join(dir, 'node_modules', '.modules.yaml'))
  if (metadata === undefined) return []
  const ignoredBuilds = parseDocument(metadata).get('ignoredBuilds')
  if (!isSeq(ignoredBuilds)) return []
  const ignored = new Set(ignoredBuilds.items.flatMap(item => isScalar(item) && typeof item.value === 'string' ? [item.value] : []))
  if (ignored.size === 0) return []
  const lock = parseDocument(lockfile)
  const snapshots = lock.get('snapshots')
  const remaining: string[] = []
  for (const name of added) {
    const ref = lock.getIn(['importers', '.', 'dependencies', name, 'version'])
    if (typeof ref !== 'string') continue
    const key = dependencyReference(name, ref)
    if (key !== undefined) remaining.push(key)
  }
  const seen = new Set<string>()
  const skipped: string[] = []
  for (const key of remaining) {
    if (seen.has(key)) continue
    seen.add(key)
    if (ignored.has(key)) skipped.push(key)
    const snapshot = isMap(snapshots) ? snapshots.get(key) : undefined
    if (!isMap(snapshot)) continue
    for (const field of ['dependencies', 'optionalDependencies']) {
      const refs = snapshot.get(field)
      if (!isMap(refs)) continue
      for (const { key: alias, value } of refs.items) {
        if (!isScalar(alias) || typeof alias.value !== 'string' || !isScalar(value) || typeof value.value !== 'string') continue
        const ref = dependencyReference(alias.value, value.value)
        if (ref !== undefined) remaining.push(ref)
      }
    }
  }
  return skipped
}

/** Read the profile state before an operation changed anything.
 * @param dir Profile directory.
 * @param manifest The profile manifest this operation found.
 * @returns The dependencies, their installed manifests, and the files a rejection restores.
 */
function operationStart(dir: string, manifest: ProfileManifest): OperationStart {
  const dependencies = directDependencies(manifest)
  return {
    dependencies,
    productionDependencies: manifest.dependencies,
    installedBefore: new Map(Object.keys(dependencies)
      .map(name => [name, optionalFile(join(dir, 'node_modules', name, 'package.json'))])),
    savedFiles: savedProfileFiles(dir),
  }
}

/** One pnpm run, under the caller's profile lock.
 * @param attempt The operation's pending keys and initial state, shared across any retry.
 */
async function runPnpmOnce(
  context: PackageOperationContext, args: readonly string[], options: PackageOperationOptions,
  attempt: OperationAttempts,
  checkBuilds: boolean,
): Promise<PackageResult> {
  const dir = context.dir ?? resolveProfileDir(context.profile, context.home)
  // Before any profile file is read: a recorded run that is still active may be rewriting them.
  const active = await activeRecordedRun(dir)
  const logRoot = join(dir, '.plugin-manager', 'logs')
  await mkdir(logRoot, { recursive: true, mode: 0o700 })
  const logDir = await mkdtemp(join(logRoot, 'operation-'))
  const logPath = join(logDir, 'pnpm.log')
  await using log = await open(logPath, 'wx', 0o600)
  if (active !== undefined) {
    await log.write(active)
    await log.close()
    options.onOutput?.(active, 'stderr')
    const bytes = Buffer.from(active)
    return { exitCode: 1, output: bytes.subarray(Math.max(0, bytes.length - options.outputBytes)).toString('utf8'), truncated: bytes.length > options.outputBytes, logPath }
  }
  const before = readProfileManifest('jan', dir)
  // A retried attempt inherits the state the whole operation found: its sibling already saved and installed
  // the dependency, so judging only this run would call an attempted install an untouched dependency.
  const start = attempt.start ??= operationStart(dir, before)
  const savedFiles = start.savedFiles
  const beforeDependencies = start.dependencies
  const installedBefore = start.installedBefore
  let output = Buffer.alloc(0)
  let truncated = false
  const append = (bytes: Buffer): void => {
    output = Buffer.concat([output, bytes])
    if (output.length > options.outputBytes) {
      truncated = true
      output = output.subarray(output.length - options.outputBytes)
    }
  }
  const environment = { ...(options.execution === 'cli' ? process.env : scrubbedParentEnv()), ...options.env }
  const restore = async (): Promise<void> => {
    for (const file of savedFiles) {
      if (file.text === undefined) await rm(file.path, { force: true })
      else await writeFileAtomic(file.path, file.text, { mode: 0o600 })
    }
  }
  /** Packages a compatibility check refused; callers render them for their own surface. */
  const incompatible: IncompatiblePlugin[] = []
  const rejected = async (warnings: readonly string[], restoration: string): Promise<PackageResult> => {
    const diagnostic = `\njan: installation rejected: ${warnings.join('\n')}\njan: ${restoration}.\n`
    await log.write(diagnostic)
    options.onOutput?.(diagnostic, 'stderr')
    append(Buffer.from(diagnostic))
    await log.close()
    return { exitCode: 1, output: output.toString('utf8'), truncated, logPath, incompatible }
  }
  // An install command names the packages it adds, so their manifests are read and checked before
  // pnpm runs: an incompatible version is never installed, and the one already in use keeps working.
  const preflight: string[] = []
  const exemptions = readProfileVersionExemptions(dir)
  // The run's own registry flags, so the lookup asks the registry the installation will use.
  const registryFlags = args.filter(argument => argument.startsWith('--registry='))
  for (const raw of namedSpecs(args)) {
    // A spec whose manifest cannot be read or validated is left to the run itself and to the check
    // after installation, which reports what it could not validate.
    try {
      const manifest = await namedSpecManifest(dir, anchorInstallSpec(raw, context.cwd), options, environment, registryFlags)
      if (manifest === undefined) continue
      const issue = evaluatePluginCompatibility(manifest, exemptions)
      if (issue !== undefined && !issue.exempted) {
        preflight.push(pluginCompatibilityWarning(issue))
        incompatible.push(incompatiblePlugin(issue))
      }
    } catch (error) { void error; continue }
  }
  if (preflight.length > 0) return await rejected(preflight, 'nothing was installed')
  const cancellation = new AbortController()
  // A service run captures output, so execa terminates the tree it leads when the
  // run is killed: a lifecycle script outlives the pnpm process that started it.
  // The CLI keeps the caller's process group, so an interrupt still reaches it.
  const grouped = leadsOwnGroup(options.execution)
  const child = execa(options.command ?? 'pnpm', [...options.args ?? [], ...anchoredArguments(args, context.cwd)], {
    cwd: dir, env: environment, extendEnv: false, reject: false,
    stdout: options.execution === 'cli' && options.captureOutput !== true ? 'inherit' : 'pipe',
    stderr: options.execution === 'cli' && options.captureOutput !== true ? 'inherit' : 'pipe',
    killDescendants: options.execution === 'service',
    buffer: false, stdin: options.execution === 'cli' ? 'inherit' : 'ignore', cancelSignal: options.signal === undefined
      ? cancellation.signal : AbortSignal.any([cancellation.signal, options.signal]),
  })
  // Listened for before the record is written, so an exit during that write is not missed.
  const exited = once(child.nodeChildProcess, 'exit').catch(() => undefined)
  let writes = Promise.resolve()
  /** `settled` records that the process outcome is known; `stalled` that the silence bound stopped the run. */
  const control = { settled: false, stalled: false }
  /** Set once this call cuts the reading short itself, so the close it causes is not read as a run failure. */
  let cut = false
  /** The first failure a reading hit before that cut, which the run still reports. */
  let failure: Error | undefined
  let idleTimer: NodeJS.Timeout | undefined
  /** The silence bound: a captured run that stops printing without exiting is terminated, never awaited. */
  const armIdle = (): void => {
    if (control.settled || options.idleTimeoutMs === undefined) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      control.stalled = true
      // execa's kill reaches the whole tree of a service run, and escalates on its own.
      child.kill()
    }, options.idleTimeoutMs)
  }
  const collect = async (stream: AsyncIterable<Buffer | string>, kind: 'stdout' | 'stderr') => {
    try {
      for await (const chunk of stream) {
        armIdle()
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        writes = writes.then(async () => { await log.write(bytes) })
        await writes
        options.onOutput?.(bytes.toString('utf8'), kind)
        append(bytes)
      }
    } catch (error) {
      // A reading this call cut short is not a failure the run hit, and the run has
      // already exited, so there is nothing left for the cancellation to stop.
      if (!cut) {
        failure ??= error instanceof Error ? error : new Error(String(error))
        cancellation.abort()
      }
      throw error
    }
  }
  const collectors = [
    ...child.stdout === null ? [] : [collect(child.stdout, 'stdout')],
    ...child.stderr === null ? [] : [collect(child.stderr, 'stderr')],
  ]
  // The drain decides whether a failure surfaces, so each reading is claimed now:
  // an unclaimed rejection would be reported as unhandled while the pipes drain.
  for (const collector of collectors) void collector.catch(() => { /* reported through `failure` and the settled readings */ })
  // Inherited descriptors hand pnpm the terminal, so there is no captured output
  // for a silence bound to observe: it would fire on a healthy run.
  if (collectors.length > 0) armIdle()
  let exitCode: number
  try {
    await recordRun(dir, { pid: child.pid, grouped })
    // execa resolves its promise only once the piped stdio has ended, so the
    // process's own exit — the run's completion — is read from the raw child. A
    // spawn failure settles without one.
    const settled = Promise.allSettled([child])
    await Promise.race([exited, settled])
    control.settled = true
    clearTimeout(idleTimer)
    // A stalled run stops its whole tree first, so the caller's rollback and lock
    // release happen only after the scripts it started stopped writing.
    if (control.stalled) await awaitTreeGone({ pid: child.pid, grouped })
    // A descendant that inherited the pipes can hold them open past the process;
    // the tail drains under a bound instead of being awaited forever.
    const drained = await drainWithin(collectors, DRAIN_AFTER_EXIT_MS)
    if (drained) {
      for (const stream of await Promise.allSettled(collectors)) if (stream.status === 'rejected') throw stream.reason
    } else {
      // Cutting the tail short is this call's own end, not a failure the run hit;
      // a failure from before the cut still surfaces, and the cut leaves a notice
      // in the log because a classification may read an incomplete tail.
      cut = true
      child.stdout?.destroy()
      child.stderr?.destroy()
      const notice = 'jan: pnpm output was cut short after its process exited\n'
      await log.write(notice)
      // A failure from before the cut is the run's own and replaces the notice a
      // caller would otherwise read; a rejection the cut itself causes is its end.
      if (failure !== undefined) throw failure
      options.onOutput?.(notice, 'stderr')
      append(Buffer.from(notice))
    }
    const [completion] = await settled
    if (completion.status === 'rejected') throw completion.reason
    const result = completion.value
    exitCode = result.exitCode ?? (result.code === 'ENOENT' ? 127 : 1)
    const activation = options.activateNewBundles !== false
    const written = checkBuilds && activation && !control.stalled ? savedProfileFiles(dir) : undefined
    if (control.stalled) {
      const notice = `jan: pnpm printed nothing for ${String(options.idleTimeoutMs)}ms and was terminated\n`
      await log.write(notice)
      options.onOutput?.(notice, 'stderr')
      append(Buffer.from(notice))
    }
    if (result.failed && output.length === 0) {
      const diagnostic = result.shortMessage ?? 'pnpm failed'
      await log.write(diagnostic)
      // The run printed nothing, so this diagnostic is the whole of its captured output; stream it as such.
      options.onOutput?.(diagnostic, 'stderr')
      truncated = Buffer.byteLength(diagnostic) > options.outputBytes
      output = Buffer.from(diagnostic).subarray(0, options.outputBytes)
    }
    if (!control.stalled && (checkBuilds || options.approveReportedBuilds === true)) {
      const buildOutput = truncated ? await readFile(logPath, 'utf8') : output.toString('utf8')
      const stillPending = new Set(blockedBuildNames(buildOutput).filter(name => !attempt.earlierPendingBuilds.has(name)))
      const installed = written === undefined ? [] : Object.keys(readProfileManifest('jan', dir).dependencies ?? {})
        .filter(name => !Object.hasOwn(start.productionDependencies ?? {}, name))
      // A repeated add can reinstall a bundle the preceding blocked operation rolled back. An older
      // pending key from its new dependency tree still blocks it; pending keys elsewhere do not.
      for (const key of skippedBuildsFor(dir, installed, written?.[1]?.text)) stillPending.add(key)
      if (stillPending.size > 0 && (exitCode === 0 || activation)) {
        exitCode = 1
        let diagnostic = `\njan: build scripts of ${[...stillPending].join(', ')} are still undecided; bundle selection is unchanged.\n`
        if (written !== undefined) {
          const retry = installed.length === 0 ? 'retry the package command' : `add ${installed.join(', ')} again`
          // The shared lock excludes Jan writers. Do not overwrite a change from a writer outside Jan.
          if (written.every(file => optionalFile(file.path) === file.text)) {
            await restore()
            diagnostic += `jan: restored package.json and pnpm-lock.yaml; downloaded modules remain. Approve the build scripts, then ${retry}.\n`
          } else {
            diagnostic += 'jan: package.json or pnpm-lock.yaml changed after pnpm ran and was not restored. Check the profile before retrying.\n'
          }
        }
        await log.write(diagnostic)
        options.onOutput?.(diagnostic, 'stderr')
        append(Buffer.from(diagnostic))
      }
    }
    // A terminated run's exit status says nothing about what it wrote, so it never reconciles the selection.
    if (exitCode === 0 && !control.stalled) {
      const after = readProfileManifest('jan', dir)
      const warnings: string[] = []
      for (const [name, spec] of Object.entries(directDependencies(after))) {
        const packageDir = join(dir, 'node_modules', name)
        const installed = optionalFile(join(packageDir, 'package.json'))
        if (installed === undefined) continue
        // A dependency this run did not touch never blocks an unrelated operation; profile startup denies it.
        const untouched = beforeDependencies[name] === spec && installedBefore.get(name) === installed
        const found: string[] = []
        const issues: IncompatiblePlugin[] = []
        try {
          const manifest = readProfileManifest('jan', packageDir)
          for (const candidate of [manifest, ...bundleComponentManifests(manifest, packageDir, context.installAnchor)]) {
            const issue = evaluatePluginCompatibility(candidate, readProfileVersionExemptions(dir))
            if (issue !== undefined && !issue.exempted) {
              found.push(pluginCompatibilityWarning(issue))
              issues.push(incompatiblePlugin(issue))
            }
          }
        } catch (error) {
          found.push(`Cannot validate installed package ${name}: ${String(error)}`)
        }
        if (found.length === 0) continue
        if (!untouched) {
          warnings.push(...found)
          incompatible.push(...issues)
        }
        else {
          const notice = `\njan: warning: ${found.join('\n')}\njan: it stays installed but profile startup denies it until you grant an exemption for those exact versions.\n`
          await log.write(notice)
          options.onOutput?.(notice, 'stderr')
        }
      }
      if (warnings.length > 0) {
        // A bundle component's requirements need installed contents, so this rejection lands after pnpm
        // replaced the tree: restore the files, then reinstall the restored lockfile so the version
        // that worked before this run keeps loading. A profile that had no lockfile is reinstalled
        // from its restored manifest without creating one, which removes what this run added.
        await restore()
        const hadLockfile = savedFiles.some(file => file.path.endsWith('pnpm-lock.yaml') && file.text !== undefined)
        const repair = ['install', hadLockfile ? '--frozen-lockfile' : '--config.lockfile=false']
        const repairing = execa(options.command ?? 'pnpm', [...options.args ?? [], ...repair], {
          cwd: dir, env: environment, extendEnv: false, reject: false, stdin: 'ignore',
          ...options.idleTimeoutMs === undefined ? {} : { timeout: options.idleTimeoutMs },
        })
        await recordRun(dir, { pid: repairing.pid, grouped: false })
        const repaired = await repairing
        exitCode = 1
        const restoration = repaired.exitCode === 0
          ? 'restored package.json, pnpm-lock.yaml, and node_modules'
          : "restored package.json and pnpm-lock.yaml, but node_modules could not be reinstalled; run 'jan plugin install'"
        const diagnostic = `\njan: installation rejected: ${warnings.join('\n')}\njan: ${restoration}.\n`
        await log.write(diagnostic)
        options.onOutput?.(diagnostic, 'stderr')
        append(Buffer.from(diagnostic))
      } else if (options.activateNewBundles !== false) {
        const unsupported = await reconcile(start.productionDependencies, after, dir, context.installAnchor, options)
        if (unsupported.length > 0) {
          exitCode = 1
          const diagnostic = `\njan: bundle activation rejected: ${unsupported.join('\n')}\njan: installed dependencies remain; bundle selection is unchanged. Use a supported Host or remove the unwanted dependencies with 'jan plugin remove <package>'.\n`
          await log.write(diagnostic)
          options.onOutput?.(diagnostic, 'stderr')
          append(Buffer.from(diagnostic))
        }
      }
    }
  } finally {
    control.settled = true
    clearTimeout(idleTimer)
    // This process saw the run end, so no successor has to wait for it.
    await rm(runRecordPath(dir), { force: true })
    await log.close()
  }
  return {
    exitCode, output: output.toString('utf8'), truncated, logPath,
    ...control.stalled ? { timedOut: true } : {}, ...incompatible.length > 0 ? { incompatible } : {},
  }
}

/** Initialize and run the jan plugin command with the same write lock as the service.
 * @param context Launcher-owned locations.
 * @param args Pnpm arguments.
 * @param options Output and cancellation policy.
 * @param runLocked Optional wrapper for command-specific reads under the profile lock; it must await the run.
 * @returns Completed package-manager result.
 */
export async function runPluginCommand(
  context: PackageOperationContext, args: readonly string[], options: PackageOperationOptions,
  runLocked: (run: () => Promise<PackageResult>) => Promise<PackageResult> = run => run(),
): Promise<PackageResult> {
  const dir = context.dir ?? resolveProfileDir(context.profile, context.home)
  await mkdir(dir, { recursive: true })
  return withFileLock(join(dir, 'package.json'), async () => {
    if (!existsSync(join(dir, 'package.json'))) {
      const template = PROFILE_TEMPLATES[context.profile]
      initProfile(dir, template?.bundles ?? DEFAULT_PROFILE_BUNDLES)
      options.onOutput?.(`jan: initialized profile ${context.profile} at ${dir}\n`, 'stderr')
    }
    return runLocked(() => runProfilePnpm(context, args, options))
  }, options.lockWaitMs === undefined ? undefined : { waitMs: options.lockWaitMs })
}

/** What one registry lookup answered. */
export interface PackageViewResult {
  /** pnpm's exit code, null when it ended without one or never started. */
  exitCode: number | null
  stdout: string
  stderr: string
  /** The lookup ran past its bound and was killed. */
  timedOut: boolean
  /** The failure of starting pnpm at all, when that is what happened. */
  cause?: unknown
}

/** Bounds of one registry lookup. */
export interface PackageViewOptions {
  /** The pnpm executable name or path. Defaults to `pnpm`. */
  command?: string
  /** Prefix arguments for an application-owned executable. */
  args?: readonly string[]
  /** Application runtime environment, applied only to this package operation. */
  env?: Readonly<Record<string, string>>
  /** Ends the lookup early; the caller's signal, when it has one. */
  signal?: AbortSignal
  /** Bound on the lookup, in milliseconds. */
  timeoutMs: number
  /** The registry asked; null asks the one pnpm's own configuration names. */
  registry?: Registry
  /** The manifest fields printed, as `pnpm view` names them; registry-only fields such as `versions`, `time`, and `dist-tags` included. */
  fields: readonly string[]
}

/**
 * Read the registry pnpm's own configuration names in the profile: its `.npmrc` chain and workspace settings,
 * as `pnpm config get registry` resolves them.
 * @param dir Profile directory.
 * @param options The pnpm executable and the time bound.
 * @returns The registry URL as pnpm printed it, or null when pnpm did not answer with one.
 */
export async function readProfileRegistry(
  dir: string, options: { command?: string; args?: readonly string[]; env?: Readonly<Record<string, string>>; timeoutMs: number },
): Promise<string | null> {
  const result = await execa(options.command ?? 'pnpm', [...options.args ?? [], 'config', 'get', 'registry'], {
    cwd: dir, env: { ...scrubbedParentEnv(), ...options.env }, extendEnv: false, reject: false, stdin: 'ignore', timeout: options.timeoutMs,
  })
  // The registry is the last line: pnpm may print a notice before it.
  const answer = result.exitCode === 0 ? result.stdout.trim().replace(/^[\s\S]*\n/, '').trim() : ''
  return /^https?:\/\/\S+$/.test(answer) ? answer : null
}

/**
 * The argument that sends one pnpm command to a registry.
 * @param registry - the registry, or null for the one pnpm's own configuration names.
 * @returns `--registry=<url>` for a URL; nothing for null.
 */
export function registryArguments(registry: Registry): string[] {
  return registry === null ? [] : [`--registry=${registry}`]
}

/**
 * Ask the registry what a spec names through `pnpm view`, run in the profile
 * directory so the registry, proxy, and authentication settings of an install
 * apply. The lookup makes one request without pnpm's own retries: a registry
 * that does not answer is reported within `timeoutMs`, and the registries
 * configured after it are the retry.
 * @param dir Profile directory.
 * @param spec One registry spec: a package name with an optional range.
 * @param options The fields printed, the registry, cancellation, and the time bound.
 * @returns pnpm's exit, output, and how the lookup ended.
 */
export async function viewProfilePackage(dir: string, spec: string, options: PackageViewOptions): Promise<PackageViewResult> {
  const result = await execa(options.command ?? 'pnpm', [
    ...options.args ?? [], 'view', spec, ...options.fields, '--json',
    ...registryArguments(options.registry ?? null), '--config.fetch-retries=0',
  ], {
    cwd: dir, env: { ...scrubbedParentEnv(), ...options.env }, extendEnv: false, reject: false, stdin: 'ignore',
    timeout: options.timeoutMs, ...options.signal === undefined ? {} : { cancelSignal: options.signal },
  })
  const cause = result.exitCode === undefined && !result.timedOut && !result.isCanceled
    ? Object.assign(new Error(result.shortMessage), { code: result.code })
    : undefined
  return {
    exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut,
    ...cause === undefined ? {} : { cause },
  }
}
