/** Explicit CLI exemptions use the profile lock and never become pnpm arguments. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { expect, it, onTestFinished, vi } from 'vitest'
import { getJanRuntimeVersion, initProfile, readProfileVersionExemptions } from '@janhq/jan-app-boot'
import { withFileLock } from '@janhq/jan-atomic-write'
import { PROFILE_TEMPLATES } from '@janhq/jan-official-bundles'
import * as operations from '@janhq/jan-plugin-manager/operations'
import { runPluginCommand, runProfilePnpm } from '@janhq/jan-plugin-manager/operations'
import { runPlugin } from '../src/plugin.ts'

vi.mock('../src/profile-boot.ts', () => ({ INSTALL_ANCHOR: '/installation/package.json' }))
vi.mock('@janhq/jan-plugin-manager/operations', async importOriginal => ({
  ...await importOriginal<typeof import('@janhq/jan-plugin-manager/operations')>(),
  runPluginCommand: vi.fn(),
  runProfilePnpm: vi.fn(),
}))

const packageRun = vi.fn<typeof runPluginCommand>()

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'cli-version-exemptions-'))
  vi.stubEnv('JAN_HOME', home)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((_text, encoding, callback) => {
    if (typeof encoding === 'function') encoding()
    else callback?.()
    return true
  })
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.mocked(runPluginCommand).mockImplementation((context, args, options, runLocked) => {
    const run = () => packageRun(context, args, options)
    return runLocked === undefined ? run() : runLocked(run)
  })
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(runPluginCommand).mockReset()
    packageRun.mockReset()
    vi.mocked(runProfilePnpm).mockReset()
    rmSync(home, { recursive: true, force: true })
  })
  return { home, dir: join(home, 'profiles', 'test'), stdout, stderr }
}

/** Record a dependency the way a successful pnpm run leaves it: an exact spec and installed contents. */
function declarePlugin(dir: string, name: string, version: string, spec = version): void {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, [name]: spec } }))
  mkdirSync(join(dir, 'node_modules', name), { recursive: true })
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
}

/** The one document a `--json` run wrote to stdout. */
function report(stdout: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const documents = stdout.mock.calls.map(call => call[0] as string)
  expect(documents).toHaveLength(1)
  return JSON.parse(documents[0]!) as Record<string, unknown>
}

it('requires explicit acknowledgement, grants only the exact pair, lists and revokes it without pnpm', async () => {
  const { dir, stdout, stderr } = fixture()
  const runtime = getJanRuntimeVersion()
  expect(await runPlugin('test', ['allow-version', '@example/plugin@1.2.3', '--jan-version', runtime, '--accept-risk'])).toBe(0)
  expect(stderr.mock.calls.map(call => call[0]).join('')).toMatchInlineSnapshot(`
    "jan: warning: allowing incompatible plugin versions can break the application or corrupt data. Approval applies only to the exact package and Jan versions.
    "
  `)
  expect(stderr.mock.invocationCallOrder[0]).toBeLessThan(stdout.mock.invocationCallOrder[0]!)
  expect(readProfileVersionExemptions(dir)).toEqual({ '@example/plugin@1.2.3': [runtime] })
  expect(JSON.parse(readFileSync(join(dir, 'compatibility.json'), 'utf8'))).toEqual({ '@example/plugin@1.2.3': [runtime] })
  expect(await runPlugin('test', ['version-exemptions'])).toBe(0)
  expect(stdout).toHaveBeenLastCalledWith(JSON.stringify({ '@example/plugin@1.2.3': [runtime] }, undefined, 2) + '\n')
  expect(await runPlugin('test', ['revoke-version', '@example/plugin@1.2.3', `--jan-version=${runtime}`])).toBe(0)
  expect(readProfileVersionExemptions(dir)).toEqual({})
  expect(runPluginCommand).not.toHaveBeenCalled()
})

it.each([
  ['allow-version', 'plugin@1.2.3', '--jan-version', 'CURRENT'],
  ['allow-version', 'plugin@1.2.3', '--accept-risk'],
  ['allow-version', 'plugin@^1.2.3', '--jan-version', 'CURRENT', '--accept-risk'],
  ['allow-version', 'plugin@1.2.3', '--jan-version', '999.0.0', '--accept-risk'],
  ['allow-version', 'plugin@1.2.3', '--jan-version', 'CURRENT', '--accept-risk=false'],
  ['allow-version', 'plugin@1.2.3', '--jan-version', 'CURRENT', '--accept-risk', '--accept-risk'],
  ['revoke-version', 'plugin@1.2.3'],
  ['version-exemptions', 'extra'],
])('rejects malformed or unacknowledged exemption command %j', async (...arguments_) => {
  const { dir, stderr } = fixture()
  const args = arguments_.map(value => value === 'CURRENT' ? getJanRuntimeVersion() : value)
  expect(await runPlugin('test', args)).toBe(1)
  expect(stderr).toHaveBeenCalled()
  expect(existsSync(join(dir, 'compatibility.json'))).toBe(false)
  expect(runPluginCommand).not.toHaveBeenCalled()
})

it('uses shipped profile defaults when listing a missing profile', async () => {
  fixture()
  expect(await runPlugin('web', ['version-exemptions'])).toBe(0)
  expect(runPluginCommand).not.toHaveBeenCalled()
})

it.each([0, 1])('forwards ordinary pnpm output and exit status %s', async (exitCode) => {
  const { stdout, stderr } = fixture()
  packageRun.mockImplementation(async (_context, _args, options) => {
    options.onOutput?.('pnpm output', 'stdout')
    return { exitCode, output: '', truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('test', ['list'])).toBe(exitCode)
  expect(stdout).toHaveBeenCalledWith('pnpm output')
  if (exitCode === 0) expect(stderr).not.toHaveBeenCalled()
  else expect(stderr).toHaveBeenCalledWith('jan: plugin command failed; diagnostics: /profile/log\n')
})

it('names the exact grant command for each package a compatibility check refused', async () => {
  const { stderr } = fixture()
  packageRun.mockResolvedValue({
    exitCode: 1, output: '', truncated: false, logPath: '/profile/log',
    incompatible: [{ name: '@example/plugin', version: '1.2.3', runtimeVersion: '0.1.0', requirements: { '@janhq/jan': '^9.0.0' } }],
  })
  expect(await runPlugin('test', ['add', '@example/plugin'])).toBe(1)
  expect(stderr.mock.calls.map(call => call[0])).toEqual([
    'jan: to accept the risk, run: jan plugin --profile test allow-version @example/plugin@1.2.3 --jan-version 0.1.0 --accept-risk\n',
    'jan: plugin command failed; diagnostics: /profile/log\n',
  ])
})

it('forwards all other commands unchanged and retains package diagnostics', async () => {
  const { stderr } = fixture()
  packageRun.mockResolvedValue({ exitCode: 127, output: '', truncated: false, logPath: '/profile/log' })
  const args = ['add', 'github:example/plugin']
  expect(await runPlugin('test', args)).toBe(127)
  expect(runPluginCommand).toHaveBeenCalledWith(expect.objectContaining({ profile: 'test' }), args, expect.objectContaining({ execution: 'cli' }), expect.any(Function))
  expect(stderr.mock.calls.map(call => call[0]).join('')).toContain('pnpm was not found')
})

it('uses the installation package runtime without changing CLI authentication or output policy', async () => {
  fixture()
  packageRun.mockResolvedValue({ exitCode: 0, output: '', truncated: false, logPath: '/profile/log' })
  const packageManager = {
    command: '/installation/electron',
    args: ['--expose-internals', '/installation/pnpm.mjs'],
    env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/installation/bin' },
  }
  expect(await runPlugin('test', ['list'], packageManager)).toBe(0)
  expect(runPluginCommand).toHaveBeenCalledWith(
    expect.objectContaining({ profile: 'test' }), ['list'],
    expect.objectContaining({ ...packageManager, execution: 'cli' }), expect.any(Function),
  )
})

it.each([
  ['list'], ['add', 'example-plugin'],
  ['version-exemptions'],
  ['allow-version', 'example-plugin@1.2.3', '--jan-version', 'CURRENT', '--accept-risk'],
  ['revoke-version', 'example-plugin@1.2.3', '--jan-version', 'CURRENT'],
])('requires Desktop initialization before %j without creating a profile', async (...arguments_) => {
  const { home, stderr } = fixture()
  const args = arguments_.map(value => value === 'CURRENT' ? getJanRuntimeVersion() : value)
  expect(await runPlugin('desktop', args)).toBe(1)
  expect(stderr.mock.calls.map(call => call[0]).join('')).toMatchInlineSnapshot(`
    "jan: Error: Open Jan Desktop once to initialize its profile, then fully quit it before running jan plugin --profile desktop.
    "
  `)
  expect(existsSync(join(home, 'profiles', 'desktop'))).toBe(false)
  expect(runPluginCommand).not.toHaveBeenCalled()
  expect(runProfilePnpm).not.toHaveBeenCalled()
})

it('runs Desktop package operations under the shared writer lock with bundled pnpm', async () => {
  const { home } = fixture()
  const dir = join(home, 'profiles', 'desktop')
  initProfile(dir, PROFILE_TEMPLATES.web!.bundles)
  const manifest = readFileSync(join(dir, 'package.json'), 'utf8')
  const packageManager = { command: '/installation/electron', args: ['/installation/pnpm.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } }
  vi.mocked(runProfilePnpm).mockImplementation(async (context, args, options) => {
    expect(context).toEqual({ profile: 'desktop', dir, installAnchor: '/installation/package.json', cwd: process.cwd() })
    expect(args).toEqual(['list'])
    expect(options).toMatchObject({ ...packageManager, execution: 'cli' })
    expect(existsSync(join(dir, 'package.json.lock'))).toBe(true)
    return { exitCode: 0, output: '', truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('desktop', ['list'], packageManager)).toBe(0)
  expect(runProfilePnpm).toHaveBeenCalledOnce()
  expect(runPluginCommand).not.toHaveBeenCalled()
  expect(existsSync(join(dir, 'package.json.lock'))).toBe(false)
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest)
  expect(existsSync(join(home, 'profiles', 'test'))).toBe(false)
})

it('applies version approvals to the existing Desktop profile without replacing its bundle selection', async () => {
  const { home } = fixture()
  const dir = join(home, 'profiles', 'desktop')
  initProfile(dir, PROFILE_TEMPLATES.web!.bundles)
  const manifest = readFileSync(join(dir, 'package.json'), 'utf8')
  const runtime = getJanRuntimeVersion()
  expect(await runPlugin('desktop', ['allow-version', 'example-plugin@1.2.3', '--jan-version', runtime, '--accept-risk'])).toBe(0)
  expect(readProfileVersionExemptions(dir)).toEqual({ 'example-plugin@1.2.3': [runtime] })
  expect(await runPlugin('desktop', ['version-exemptions'])).toBe(0)
  expect(await runPlugin('desktop', ['revoke-version', 'example-plugin@1.2.3', '--jan-version', runtime])).toBe(0)
  expect(readProfileVersionExemptions(dir)).toEqual({})
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest)
  expect(existsSync(join(dir, 'package.json.lock'))).toBe(false)
  expect(runPluginCommand).not.toHaveBeenCalled()
  expect(runProfilePnpm).not.toHaveBeenCalled()
})

it('reports one JSON document for add, including the installed version and activated bundle', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  packageRun.mockImplementation(async () => {
    declarePlugin(dir, 'example-plugin', '1.2.3')
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, jan: { profile: { bundles: ['example-plugin'] } } }))
    return { exitCode: 0, output: 'pnpm progress\n', truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('test', ['add', 'example-plugin', '--json'])).toBe(0)
  expect(report(stdout)).toEqual({
    command: 'add',
    ok: true,
    exitCode: 0,
    packages: [{ name: 'example-plugin', version: '1.2.3' }],
    bundles: ['example-plugin'],
    bundle: 'example-plugin',
    logPath: '/profile/log',
  })
  expect(stdout).toHaveBeenCalledTimes(1)
})

it('reports a repeated add by the name the spec asked for', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'example-plugin', '1.2.3')
  packageRun.mockResolvedValue({ exitCode: 0, output: '', truncated: false, logPath: '/profile/log' })
  expect(await runPlugin('test', ['add', 'example-plugin@1.2.3', '--json'])).toBe(0)
  expect(report(stdout)).toMatchObject({ packages: [{ name: 'example-plugin', version: '1.2.3' }] })
})

it('reports the installed version changed by replacing a tarball at the same path', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'example-plugin', '1.2.3', 'file:./plugin.tgz')
  packageRun.mockImplementation(async () => {
    declarePlugin(dir, 'example-plugin', '2.0.0', 'file:./plugin.tgz')
    return { exitCode: 0, output: '', truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('test', ['add', './plugin.tgz', '--json'])).toBe(0)
  expect(report(stdout)).toMatchObject({ packages: [{ name: 'example-plugin', version: '2.0.0' }] })
})

it('does not report an unchanged plugin when an add of another version fails', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'example-plugin', '1.2.3')
  packageRun.mockResolvedValue({ exitCode: 1, output: '', truncated: false, logPath: '/profile/log' })
  expect(await runPlugin('test', ['add', 'example-plugin@2.0.0', '--json'])).toBe(1)
  expect(report(stdout)).toMatchObject({ ok: false, packages: [] })
})

it('reports a failed add with the pending build scripts it introduced and the key it approved', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  earlier@1.0.0: set this to true or false\n')
  packageRun.mockImplementation(async (_context, _args, options) => {
    // pnpm reports every pending key in the tree; only the one this run added is its own answer.
    options.onBuildsApproved?.(['example-plugin'])
    return {
      exitCode: 1, truncated: false, logPath: '/profile/log',
      output: '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: earlier@1.0.0, example-plugin\n',
    }
  })
  expect(await runPlugin('test', ['add', 'example-plugin', '--yes-builds', '--json'])).toBe(1)
  expect(report(stdout)).toMatchObject({ ok: false, exitCode: 1, approvedBuilds: ['example-plugin'], pendingBuilds: ['example-plugin'] })
})

it('lists declared dependencies with their installed versions as JSON', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'example-plugin', '1.2.3')
  declarePlugin(dir, 'not-installed', '2.0.0')
  rmSync(join(dir, 'node_modules', 'not-installed'), { recursive: true })
  packageRun.mockResolvedValue({ exitCode: 0, output: '', truncated: false, logPath: '/profile/log' })
  expect(await runPlugin('test', ['list', '--json'])).toBe(0)
  expect(report(stdout)).toMatchObject({
    command: 'list', ok: true, packages: [{ name: 'example-plugin', version: '1.2.3' }, { name: 'not-installed' }],
  })
})

it('lists only packages selected by pnpm in JSON mode', async () => {
  const { dir, stdout, stderr } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'one-plugin', '1.2.3')
  declarePlugin(dir, 'another-plugin', '2.0.0')
  packageRun.mockImplementation(async (_context, args, options) => {
    const output = args.includes('--json')
      ? JSON.stringify([{ dependencies: { 'one-plugin': { version: '1.2.3' } } }]) : 'one-plugin 1.2.3\n'
    options.onOutput?.(output, 'stdout')
    options.onOutput?.('pnpm diagnostic\n', 'stderr')
    return { exitCode: 0, output, truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('test', ['list', 'one-*', '--json'])).toBe(0)
  expect(report(stdout)).toMatchObject({ packages: [{ name: 'one-plugin', version: '1.2.3' }] })
  expect(stderr).toHaveBeenCalledWith('pnpm diagnostic\n')
})

it('writes one JSON failure when pnpm operation logging cannot start', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  mkdirSync(join(dir, '.plugin-manager'))
  writeFileSync(join(dir, '.plugin-manager', 'logs'), 'not a directory')
  const actual = await vi.importActual<typeof operations>('@janhq/jan-plugin-manager/operations')
  vi.mocked(runPluginCommand).mockImplementation(actual.runPluginCommand)
  expect(await runPlugin('test', ['list', '--json'])).toBe(1)
  expect(report(stdout)).toMatchObject({ command: 'list', ok: false, exitCode: 1, packages: [], error: expect.stringContaining('logs') })
})

it.each(['test', 'desktop'])('compares the %s profile before and after under its writer lock', async (profile) => {
  const { home, stdout } = fixture()
  const dir = join(home, 'profiles', profile)
  initProfile(dir, [])
  const actual = await vi.importActual<typeof operations>('@janhq/jan-plugin-manager/operations')
  vi.mocked(runPluginCommand).mockImplementation(actual.runPluginCommand)
  const script = join(home, 'fake-pnpm.cjs')
  writeFileSync(script, `
    const fs = require('node:fs');
    if (process.argv[2] === 'view') { console.log('{}'); return; }
    const manifest = JSON.parse(fs.readFileSync('package.json'));
    manifest.dependencies = { ...manifest.dependencies, added: '1.0.0' };
    fs.writeFileSync('package.json', JSON.stringify(manifest));
    fs.mkdirSync('node_modules/added', { recursive: true });
    fs.writeFileSync('node_modules/added/package.json', '{"name":"added","version":"1.0.0"}');
  `)
  vi.mocked(runProfilePnpm).mockImplementation(actual.runProfilePnpm)
  const manager = { command: process.execPath, args: [script] }
  const ready = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const prior = withFileLock(join(dir, 'package.json'), async () => {
    ready.resolve(undefined)
    await release.promise
    declarePlugin(dir, 'earlier', '1.0.0')
  })
  await ready.promise
  const add = runPlugin(profile, ['add', 'added', '--json'], manager)
  release.resolve(undefined)
  await prior
  expect(await add).toBe(0)
  expect(report(stdout)).toMatchObject({ packages: [{ name: 'added', version: '1.0.0' }] })
})

it('waits for the JSON stdout write to complete before returning the exit code', async () => {
  const { stdout } = fixture()
  const written = Promise.withResolvers<undefined>()
  let finish: (() => void) | undefined
  stdout.mockImplementation((_text, encoding, callback) => {
    finish = typeof encoding === 'function' ? encoding : callback
    written.resolve(undefined)
    return false
  })
  packageRun.mockResolvedValue({ exitCode: 0, output: '', truncated: false, logPath: '/profile/log' })
  let exited = false
  const run = runPlugin('test', ['list', '--json']).then((code) => { exited = true; return code })
  await written.promise
  await setImmediate()
  try { expect(exited).toBe(false) } finally { finish?.() }
  expect(await run).toBe(0)
})

it('removes a dependency and reports the version it took away', async () => {
  const { dir, stdout } = fixture()
  initProfile(dir, [])
  declarePlugin(dir, 'example-plugin', '1.2.3')
  packageRun.mockImplementation(async () => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { jan?: unknown }
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {}, jan: manifest.jan }))
    return { exitCode: 0, output: '', truncated: false, logPath: '/profile/log' }
  })
  expect(await runPlugin('test', ['remove', 'example-plugin', '--json'])).toBe(0)
  expect(report(stdout)).toMatchObject({ command: 'remove', ok: true, packages: [{ name: 'example-plugin', version: '1.2.3' }] })
})

it('reports why a desktop run could not start, as JSON', async () => {
  const { stdout } = fixture()
  expect(await runPlugin('desktop', ['list', '--json'])).toBe(1)
  expect(report(stdout)).toMatchObject({ command: 'list', ok: false, exitCode: 1 })
  expect(String(report(stdout).error)).toContain('Open Jan Desktop once')
  expect(runPluginCommand).not.toHaveBeenCalled()
})

it('refuses --yes-builds on anything but add', async () => {
  const { stdout, stderr } = fixture()
  expect(await runPlugin('test', ['list', '--yes-builds'])).toBe(1)
  expect(stderr).toHaveBeenCalledWith('jan: --yes-builds applies to add\n')
  expect(stdout).not.toHaveBeenCalled()
  expect(runPluginCommand).not.toHaveBeenCalled()
})

it('forwards --json to a command Jan does not report on', async () => {
  fixture()
  packageRun.mockResolvedValue({ exitCode: 0, output: '', truncated: false, logPath: '/profile/log' })
  expect(await runPlugin('test', ['why', 'example-plugin', '--json'])).toBe(0)
  expect(runPluginCommand).toHaveBeenCalledWith(expect.anything(), ['why', 'example-plugin', '--json'],
    expect.not.objectContaining({ captureOutput: true }), expect.any(Function))
})
