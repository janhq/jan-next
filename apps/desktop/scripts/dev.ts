/**
 * Build and launch the unpackaged Electron shell against the current workspace.
 * `--watch` also runs the rebuild watchers (`pnpm run dev:web --skip-build --no-serve --host`), mounts
 * jan-hmr over the repository's package outputs and plugins plus `@janhq/jan-dev-reload` through a
 * development patch, and starts Electron again whenever it exits asking for a restart.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, globSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { prepareDevelopmentWindowsApp } from './development-windows.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')
/** Electron exits with this code when `janDesktop.restartApplication()` asks `--watch` to start it again. */
const RESTART_EXIT_CODE = 75
/** Printed by dev-web once its watchers finished their initial builds. */
const WATCHERS_READY = 'dev-web: watching'
/** Grace period before escalating a watcher stop; `dev-web` waits up to six seconds per step for its own stages. */
const WATCHER_STOP_GRACE_MS = 15_000

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

/**
 * Settle with a child's exit code, or the signal that ended it.
 * @param child - a spawned process.
 * @returns the exit code or signal name.
 */
function exited(child: ChildProcess): Promise<number | NodeJS.Signals> {
  const result = Promise.withResolvers<number | NodeJS.Signals>()
  child.once('error', result.reject)
  child.once('exit', (code, signal) => { result.resolve(code ?? signal ?? 1) })
  return result.promise
}

async function run(
  command: string, args: readonly string[], cwd: string, environment = process.env, accepted: readonly number[] = [0],
): Promise<number> {
  const result = await exited(spawn(command, args, { cwd, env: environment, stdio: 'inherit' }))
  if (typeof result === 'number' && accepted.includes(result)) return result
  throw new Error(`desktop development: ${args.join(' ')} exited with ${String(result)}`)
}

function packageManagerEntry(): string {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  return packageManager
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  await run(process.execPath, [packageManagerEntry(), 'run', script], cwd)
}

/**
 * Write the development patch `--watch` passes to the desktop Host: jan-hmr watches every package's
 * `lib` and every plain-JS plugin, and the dev-reload plugin holds those reloads while chats run.
 * @returns the patch path.
 */
function writeReloadPatch(): string {
  const roots = [
    ...globSync('packages/*/*/lib', { cwd: REPOSITORY_ROOT }).sort(),
    ...readdirSync(join(REPOSITORY_ROOT, 'plugins'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
      .map(entry => join('plugins', entry.name)).sort(),
  ].map(path => path.split(sep).join('/'))
  const restartWatch = [
    join(APP_ROOT, 'lib', 'main.js'),
    join(APP_ROOT, 'lib', 'preload-app.cjs'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]
  // JSON is YAML, so the overlay loader reads it without a YAML writer here.
  const patch = [
    {
      id: 'hmr',
      disabled: false,
      config: {
        base: REPOSITORY_ROOT,
        root: roots,
        ignored: ['**/node_modules', '**/.*', 'cache', 'data', '**/lib/types/**', '**/tests/**', '**/*.tsbuildinfo'],
        debounce: 500,
      },
    },
    { insert: [{ id: 'dev-reload', name: '@janhq/jan-dev-reload', config: { restartWatch } }] },
  ]
  const path = join(DEVELOPMENT_ROOT, 'dev-reload.patch.yml')
  writeFileSync(path, `${JSON.stringify(patch, null, 2)}\n`)
  return path
}

/**
 * Start `dev:web` in Host mode and wait until its initial builds finish, so their rewrites of every
 * `lib` bundle land before the Host starts watching them.
 * @returns a stop function that interrupts the watchers and waits for them.
 */
async function startRebuildWatchers(): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, [packageManagerEntry(), 'run', 'dev:web', '--skip-build', '--no-serve', '--host'], {
    cwd: REPOSITORY_ROOT, stdio: ['inherit', 'pipe', 'inherit'],
  })
  const ready = Promise.withResolvers<void>()
  let tail = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk)
    // Test before trimming: the marker opens a multi-kilobyte package listing that arrives as one chunk.
    const seen = tail + chunk.toString('utf8')
    if (seen.includes(WATCHERS_READY)) ready.resolve()
    tail = seen.slice(-WATCHERS_READY.length)
  })
  let stopping = false
  const exit = exited(child)
  void exit.then((result) => {
    ready.reject(new Error(`desktop development: rebuild watchers exited with ${String(result)} before their first build finished`))
    // Electron keeps running; edits simply stop rebuilding.
    if (!stopping) console.error(`desktop development: rebuild watchers stopped (code ${String(result)})`)
  }, (error: unknown) => { ready.reject(error) })
  await ready.promise
  return async () => {
    stopping = true
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      if (child.exitCode !== null || child.signalCode !== null) break
      child.kill(signal)
      await Promise.race([exit, sleep(WATCHER_STOP_GRACE_MS)])
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exit
  }
}

async function launchElectron(accepted: readonly number[] = [0]): Promise<number> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('JAN_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('JAN_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('JAN_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.JAN_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.JAN_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    JAN_HOME: home,
    JAN_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.JAN_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
    JAN_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    JAN_DESKTOP_OPEN_DEVTOOLS: process.env.JAN_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
    JAN_LLAMA_WORKER: process.env.JAN_LLAMA_WORKER
      ?? join(REPOSITORY_ROOT, 'native', 'llama-worker', 'dist', process.platform === 'win32' ? 'jan-llama-worker.exe' : 'jan-llama-worker'),
    // `scripts/build-host-runtime.ts` writes here; Hosts reports none shipped when it is empty.
    JAN_HOST_RUNTIME_DIR: process.env.JAN_HOST_RUNTIME_DIR ?? join(REPOSITORY_ROOT, 'dist-host-runtime'),
  }
  console.log(`desktop development: JAN_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({
      electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.JAN_DESKTOP_OPEN_DEVTOOLS!,
    })
    return run(executable, [], APP_ROOT, environment, accepted)
  }
  // Windows names the app in the firewall prompt, taskbar and Task Manager from the executable's own resources.
  const executable = process.platform === 'win32' ? await prepareDevelopmentWindowsApp(electron, DEVELOPMENT_ROOT) : electron
  return run(executable, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment, accepted)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    'skip-build': { type: 'boolean', default: false },
    watch: { type: 'boolean', default: false },
  } })
  if (!values['skip-build']) {
    await runPackageScript('build:artifacts', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const target = resolveDesktopBuildTarget()
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(createRequire(import.meta.url)('electron') as string, ['-p', 'process.versions.node'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target,
  })
  await preparePrimaryRuntime(target)
  if (!values.watch) {
    await launchElectron()
    return
  }
  process.env.JAN_DESKTOP_DEV_PATCH = writeReloadPatch()
  process.env.JAN_DESKTOP_RESTART_EXIT_CODE = String(RESTART_EXIT_CODE)
  const stopWatchers = await startRebuildWatchers()
  try {
    while (await launchElectron([0, RESTART_EXIT_CODE]) === RESTART_EXIT_CODE) console.log('desktop development: restarting Electron')
  } finally {
    await stopWatchers()
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
