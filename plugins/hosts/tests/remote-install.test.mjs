import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installFailure, installScript, runtimeIdentity, shellQuote, shippedRuntimes, sshArgs, sshFailure, startCommand, VERSION_FILE,
} from '../remote-install.mjs'

const POSIX = process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v tar gzip'], { encoding: 'utf8' }).status === 0
const SKIP_POSIX = POSIX ? false : 'needs a POSIX sh with tar and gzip'

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jan-hosts-install-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

test('shipped archives are found by target and need their checksum file', async (t) => {
  const directory = await temporary(t)
  assert.equal(shippedRuntimes(undefined).size, 0)
  assert.equal(shippedRuntimes(join(directory, 'absent')).size, 0)
  const digest = 'a'.repeat(64)
  await writeFile(join(directory, 'jan-host-runtime-0.3.0-linux-x64.tar.gz'), 'x')
  await writeFile(join(directory, 'jan-host-runtime-0.3.0-linux-x64.tar.gz.sha256'), `${digest}  jan-host-runtime-0.3.0-linux-x64.tar.gz\n`)
  await writeFile(join(directory, 'README.txt'), 'not an archive')
  await writeFile(join(directory, 'jan-host-runtime-0.3.0-darwin-arm64.tar.gz'), 'x')
  await writeFile(join(directory, 'jan-host-runtime-0.3.0-darwin-arm64.tar.gz.sha256'), `${'b'.repeat(64)}  x\n`)
  const found = shippedRuntimes(directory)
  assert.deepEqual([...found.keys()].sort(), ['darwin-arm64', 'linux-x64'])
  assert.equal(found.get('linux-x64').version, '0.3.0')
  assert.equal(runtimeIdentity(found.get('linux-x64')), `0.3.0+${'a'.repeat(12)}`)
  await writeFile(join(directory, 'jan-host-runtime-0.3.0-linux-arm64.tar.gz'), 'x')
  assert.throws(() => shippedRuntimes(directory), /linux-arm64\.tar\.gz\.sha256 is missing/)
})

test('ssh arguments keep the destination last and never let it read as an option', () => {
  const args = sshArgs('pi@pi.local:2222')
  assert.equal(args.at(-1), 'pi@pi.local')
  assert.deepEqual(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2), ['-p', '2222'])
  assert.ok(args.includes('BatchMode=yes'))
  assert.equal(sshArgs('@office').at(-1), 'office')
  assert.equal(sshArgs('office').includes('-p'), false)
})

test('ssh failures name the cause a person can fix', () => {
  assert.match(sshFailure('pi@pi.local: Permission denied (publickey).'), /refused the SSH login.*key/)
  assert.match(sshFailure('ssh: Could not resolve hostname pi.local: Name or service not known'), /cannot find that host name/)
  assert.match(sshFailure('ssh: connect to host 10.0.0.9 port 22: Connection timed out'), /did not answer/)
  assert.match(sshFailure('ssh: connect to host 10.0.0.9 port 22: Connection refused'), /refused the connection/)
  assert.match(sshFailure('Host key verification failed.'), /identity changed/)
  assert.equal(sshFailure('kex_exchange_identification: read: Connection reset by peer'), 'The SSH login failed: kex_exchange_identification: read: Connection reset by peer')
})

test('install failures from the remote script are read back as sentences', () => {
  assert.equal(installFailure({ code: 0, stdout: 'JAN_HOSTS_INSTALL_OK\n', stderr: '' }), undefined)
  assert.match(installFailure({ code: 3, stdout: '', stderr: 'JAN_HOSTS_INSTALL_CORRUPT 00ff' }), /arrived damaged/)
  assert.match(installFailure({ code: 2, stdout: '', stderr: 'tar: jan/x: Cannot write: No space left on device' }), /out of disk space/)
  assert.match(installFailure({ code: 255, stdout: '', stderr: 'Permission denied (publickey).' }), /refused the SSH login/)
  // A link cut mid-copy names the fix, not ssh's wording.
  assert.equal(installFailure({ code: 255, stdout: '', stderr: 'Connection to 127.0.0.1 closed by remote host.' }),
    'The connection dropped while Jan was being copied. Connect again to resend it.')
  assert.equal(installFailure({ code: 1, stdout: '', stderr: 'mv: cannot move x.' }), 'Jan could not be installed there: mv: cannot move x.')
  // A remote end killed mid-copy can leave ssh silent; the short copy still names the fix.
  assert.match(installFailure({ code: 143, stdout: '', stderr: '' }, false), /connection dropped/)
  assert.match(installFailure({ code: 2, stdout: '', stderr: 'tar: Cannot write: No space left on device' }, false), /out of disk space/)
  // A zero exit without the marker is a shell that ran something else.
  assert.match(installFailure({ code: 0, stdout: '', stderr: '' }), /could not be installed there\./)
})

test('the start command quotes the proxy and keeps loopback direct', () => {
  const command = startCommand({ port: 41000, proxy: "http://jan:p'w@127.0.0.1:42000" })
  assert.match(command, /--profile edge --no-open --port 41000$/)
  assert.match(command, /HTTPS_PROXY='http:\/\/jan:p'\\''w@127\.0\.0\.1:42000'/)
  assert.match(command, /NO_PROXY=127\.0\.0\.1,localhost,::1/)
  assert.match(command, /JAN_HOME="\$HOME"\/\.jan\/hosts-runtime\/home/)
  assert.doesNotMatch(startCommand({ port: 41000 }), /PROXY/)
})

test('the start command names the remote after the saved connection', () => {
  assert.match(startCommand({ port: 41000, name: " Thịnh's homelab " }), /JAN_HOST_NAME='Thịnh'\\''s homelab'/)
  assert.doesNotMatch(startCommand({ port: 41000, name: '  ' }), /JAN_HOST_NAME/)
})

async function archiveFixture(directory) {
  const product = join(directory, 'product')
  await mkdir(join(product, 'node', 'bin'), { recursive: true })
  await writeFile(join(product, 'node', 'bin', 'node'), '#!/bin/sh\necho fake node\n')
  await chmod(join(product, 'node', 'bin', 'node'), 0o644)
  await writeFile(join(product, 'executables.txt'), 'node/bin/node\n')
  await writeFile(join(product, 'build.json'), '{}\n')
  const archive = join(directory, 'jan-host-runtime-0.3.0-linux-x64.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', product, 'build.json', 'executables.txt', 'node'])
  const bytes = await readFile(archive)
  return { archive, bytes, digest: sha256(bytes) }
}

function runInstall(home, script, input) {
  return spawnSync('sh', ['-c', script], { input, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 5000 })
}

test('the install script publishes a checked archive and restores its programs', { skip: SKIP_POSIX }, async (t) => {
  const directory = await temporary(t)
  const home = join(directory, 'home')
  await mkdir(home)
  const { bytes, digest } = await archiveFixture(directory)
  const result = runInstall(home, installScript({ identity: '0.3.0+abc', sha256: digest }), bytes)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(installFailure({ code: result.status, stdout: result.stdout, stderr: result.stderr }), undefined)
  assert.equal(await readFile(join(home, VERSION_FILE), 'utf8'), '0.3.0+abc')
  assert.equal((await stat(join(home, '.jan/hosts-runtime/current/node/bin/node'))).mode & 0o111, 0o111)
  assert.equal(execFileSync(join(home, '.jan/hosts-runtime/current/node/bin/node'), { encoding: 'utf8' }), 'fake node\n')
})

test('a damaged copy leaves the installed build and its identity in place', { skip: SKIP_POSIX }, async (t) => {
  const directory = await temporary(t)
  const home = join(directory, 'home')
  await mkdir(home)
  const { bytes, digest } = await archiveFixture(directory)
  assert.equal(runInstall(home, installScript({ identity: 'first', sha256: digest }), bytes).status, 0)
  const damaged = Buffer.from(bytes)
  damaged[damaged.length - 10] ^= 0xff
  const result = runInstall(home, installScript({ identity: 'second', sha256: digest }), damaged)
  assert.equal(result.status, 3)
  assert.match(installFailure({ code: result.status, stdout: result.stdout, stderr: result.stderr }), /arrived damaged/)
  assert.equal(await readFile(join(home, VERSION_FILE), 'utf8'), 'first')
  assert.equal(execFileSync('sh', ['-c', 'ls -A "$HOME/.jan/hosts-runtime"'], { env: { ...process.env, HOME: home }, encoding: 'utf8' }).split('\n').filter(Boolean).sort().join(','), '.install.lock,VERSION,current')
})

test('a retry recovers an abandoned install lock without waiting out its timeout', { skip: SKIP_POSIX }, async (t) => {
  const directory = await temporary(t)
  const home = join(directory, 'home')
  const legacyLock = join(home, '.jan/hosts-runtime/.lock')
  await mkdir(legacyLock, { recursive: true })
  const old = new Date(Date.now() - 60 * 60_000)
  await utimes(legacyLock, old, old)
  await writeFile(join(home, '.jan/hosts-runtime/.install.lock'), '')
  const { bytes, digest } = await archiveFixture(directory)
  const result = runInstall(home, installScript({ identity: 'recovered', sha256: digest }), bytes)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(join(home, VERSION_FILE), 'utf8'), 'recovered')
})

test('a copy cut off before it ends is refused like a damaged one', { skip: SKIP_POSIX }, async (t) => {
  const directory = await temporary(t)
  const home = join(directory, 'home')
  await mkdir(home)
  const { bytes, digest } = await archiveFixture(directory)
  const result = runInstall(home, installScript({ identity: 'cut', sha256: digest }), bytes.subarray(0, bytes.length >> 1))
  assert.equal(result.status, 3)
  await assert.rejects(readFile(join(home, VERSION_FILE), 'utf8'), { code: 'ENOENT' })
})

test('shell quoting survives every quote character', { skip: SKIP_POSIX }, () => {
  const value = `it's "quoted" $(id) \`x\``
  assert.equal(execFileSync('sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' }), value)
})
