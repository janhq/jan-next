/**
 * Build the archive Settings → Hosts copies to another computer over SSH: the pinned Node, the
 * `@janhq/jan-host-runtime` closure deployed for one Linux target, and that target's flock addon.
 * The other computer needs nothing installed and no internet; see apps/jan-host-runtime/README.md.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, globSync } from 'node:fs'
import { cp, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { x as extractTar } from 'tar'
import { pnpmInvocation } from './executable-packaging.ts'
import { downloadPrimaryRuntimeAsset } from './primary-runtime/prepare.ts'
import lock from './primary-runtime/lock.json' with { type: 'json' }
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')
const closureDirectory = 'apps/jan-host-runtime'
const closureName = '@janhq/jan-host-runtime'
/** Targets Hosts can install; each needs a machine of that target to compile the flock addon. */
export const HOST_RUNTIME_TARGETS = ['linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64'] as const
export type HostRuntimeTarget = typeof HOST_RUNTIME_TARGETS[number]

/** Per target: the primary-runtime lock entry with its pinned Node, and pnpm's os/cpu/libc filters. */
const TARGETS: Record<HostRuntimeTarget, { lock: keyof typeof lock.targets; os: string; cpu: string; libc?: string; addon: string }> = {
  'linux-x64': { lock: 'linux-x64', os: 'linux', cpu: 'x64', libc: 'glibc', addon: 'bin/glibc/system.node' },
  'linux-arm64': { lock: 'linux-arm64', os: 'linux', cpu: 'arm64', libc: 'glibc', addon: 'bin/glibc/system.node' },
  'darwin-arm64': { lock: 'mac-arm64', os: 'darwin', cpu: 'arm64', addon: 'bin/system.node' },
  'darwin-x64': { lock: 'mac-x64', os: 'darwin', cpu: 'x64', addon: 'bin/system.node' },
}
/** Archive layout version Hosts reads from `build.json`. */
export const HOST_RUNTIME_FORMAT = 1
// Type declarations and source maps are never loaded at run time; they are a third of the closure.
const PRUNED = ['**/*.map', '**/*.d.ts', '**/*.d.mts', '**/*.d.cts', '**/*.tsbuildinfo']

async function run(command: string, args: string[]): Promise<void> {
  console.log(`host-runtime build: ${[command, ...args].join(' ')}`)
  const { promise, resolve: done, reject: fail } = Promise.withResolvers<void>()
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
  child.once('error', fail)
  child.once('close', (code, signal) => {
    if (code === 0 && signal === null) done()
    else fail(new Error(`host-runtime build: ${command} failed (${code ?? signal})`))
  })
  await promise
}

async function pnpm(...args: string[]): Promise<void> {
  const [command, argv] = pnpmInvocation(args)
  await run(command, argv)
}

/**
 * SHA-256 of one file.
 * @param path - file to hash.
 * @returns lowercase hex digest.
 */
export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Archive file name for one build.
 * @param version - `@janhq/jan-host-runtime` version.
 * @param target - build target.
 * @returns the `.tar.gz` file name.
 */
export function archiveName(version: string, target: HostRuntimeTarget): string {
  return `jan-host-runtime-${version}-${target}.tar.gz`
}

/**
 * Copy the target's flock addon into the deployed closure. pnpm installs the platform package's
 * manifest but not its `bin/`, which `native/system` builds on a machine of that target.
 * @param staging - deployed `jan/` directory.
 * @param target - build target.
 * @param source - the target's `native/system/packages/<target>` directory, or a copy of it.
 */
async function stageFlock(staging: string, target: HostRuntimeTarget, source: string): Promise<void> {
  const relative = TARGETS[target].addon
  const addon = join(source, relative)
  if (!existsSync(addon)) {
    throw new Error(`host-runtime build: ${addon} is missing; run \`pnpm --dir native/system run build:native\` on a ${target} machine, or pass --natives`)
  }
  const destination = join(staging, 'node_modules', '@janhq', `node-addon-system-${target}`, relative)
  await mkdir(dirname(destination), { recursive: true })
  await cp(addon, destination)
}

/** Drop every node-pty prebuild except the target's; the closure deploys all six. */
async function pruneNodePty(staging: string, target: HostRuntimeTarget): Promise<void> {
  const prebuilds = join(staging, 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuilds)) return
  for (const entry of globSync('*', { cwd: prebuilds })) {
    if (entry !== target) await rm(join(prebuilds, entry), { recursive: true, force: true })
  }
  if (!existsSync(join(prebuilds, target, 'pty.node'))) throw new Error(`host-runtime build: node-pty has no ${target} prebuild`)
}

// ELF, Mach-O 64-bit (as read big-endian from a little-endian file) and universal Mach-O.
const PROGRAM_MAGIC = new Set([0x7f454c46, 0xcffaedfe, 0xcafebabe])

/**
 * List every native program in the product. A build on Windows loses the executable bit, so the
 * remote install restores it from this list instead of trusting the archive's modes.
 * @param product - archive root.
 * @returns product-relative POSIX paths, sorted.
 */
async function programFiles(product: string): Promise<string[]> {
  const found: string[] = []
  for (const path of globSync('**/*', { cwd: product, withFileTypes: false }).sort()) {
    const absolute = join(product, path)
    const info = await stat(absolute)
    if (!info.isFile() || info.size < 4) continue
    const handle = await open(absolute, 'r')
    try {
      const { buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0)
      // Shared objects load with mmap and need no executable bit; programs are what fail to start.
      if (PROGRAM_MAGIC.has(buffer.readUInt32BE(0)) && !/\.(node|dylib|so(\.\d+)*)$/.test(path)) found.push(path.split('\\').join('/'))
    } finally {
      await handle.close()
    }
  }
  return found
}

async function stageNode(product: string, target: HostRuntimeTarget, cache: string): Promise<void> {
  const artifact = lock.targets[TARGETS[target].lock]
  const filename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
  const archive = await downloadPrimaryRuntimeAsset(`https://nodejs.org/dist/v${lock.nodeVersion}/${filename}`, artifact.nodeSha256, cache)
  const destination = join(product, 'node')
  await mkdir(destination, { recursive: true })
  // Only the executable and its licence are needed; npm, corepack and headers stay behind.
  await extractTar({ file: archive, cwd: destination, strip: 1, filter: path => /\/(bin\/node|LICENSE)$/.test(path) })
  if (!existsSync(join(destination, 'bin', 'node'))) throw new Error(`host-runtime build: ${filename} has no bin/node`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      output: { type: 'string' },
      natives: { type: 'string' },
      cache: { type: 'string' },
    },
  })
  const target = values.target as HostRuntimeTarget | undefined
  if (target === undefined || !HOST_RUNTIME_TARGETS.includes(target)) {
    throw new Error(`host-runtime build: --target must be one of ${HOST_RUNTIME_TARGETS.join(', ')}`)
  }
  const closure = await verifyRuntimeClosure(root, `${closureDirectory}/package.json`)
  if (closure.failures.length > 0) throw new Error(`host-runtime build: open closure:\n${closure.failures.join('\n')}`)
  const { version } = JSON.parse(await readFile(join(root, closureDirectory, 'package.json'), 'utf8')) as { version: string }
  const output = resolve(root, values.output ?? 'dist-host-runtime')
  const natives = resolve(root, values.natives ?? join('native', 'system', 'packages', target))
  const cache = resolve(root, values.cache ?? join('.jan-build', 'host-runtime-downloads'))
  await mkdir(join(root, '.jan-build'), { recursive: true })
  const temporary = await mkdtemp(join(root, '.jan-build', 'host-runtime-'))
  try {
    const product = join(temporary, 'product')
    const staging = join(product, 'jan')
    const { os, cpu, libc } = TARGETS[target]
    await pnpm('--filter', closureName, 'deploy', '--prod', '--os', os, '--cpu', cpu, ...(libc === undefined ? [] : ['--libc', libc]), '--ignore-scripts',
      '--config.allow-unused-patches=true', '--config.node-linker=hoisted', '--config.link-workspace-packages=true',
      '--config.hoist-workspace-packages=false', `--config.pnpmfile=${join(root, 'scripts', 'python-runtime-deploy.pnpmfile.mjs')}`, staging)
    for (const path of globSync(PRUNED, { cwd: staging })) await rm(join(staging, path), { force: true })
    await pruneNodePty(staging, target)
    await stageFlock(staging, target, natives)
    await stageNode(product, target, cache)
    const executables = await programFiles(product)
    if (!executables.includes('node/bin/node')) throw new Error('host-runtime build: node/bin/node is not a native program')
    await writeFile(join(product, 'executables.txt'), `${executables.join('\n')}\n`)
    await writeFile(join(product, 'build.json'), `${JSON.stringify({ format: HOST_RUNTIME_FORMAT, version, target, node: lock.nodeVersion }, undefined, 2)}\n`)
    await mkdir(output, { recursive: true })
    const archive = join(output, archiveName(version, target))
    await rm(archive, { force: true })
    // System tar: node-tar's writer stalled on this tree of 17,000 files (2026-11-21). Owner and
    // group are reset so the remote unpacks the files as the SSH user.
    await run('tar', ['--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', product, 'build.json', 'executables.txt', 'node', 'jan'])
    const digest = await fileSha256(archive)
    await writeFile(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`)
    console.log(`host-runtime archive: ${archive} (${((await stat(archive)).size / 1e6).toFixed(1)} MB, sha256 ${digest})`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
