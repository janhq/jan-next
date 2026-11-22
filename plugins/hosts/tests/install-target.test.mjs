import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { PROBE_BEGIN, PROBE_END, missingTool, parseProbe, probeScript, selectTarget } from '../install-target.mjs'

const LINUX = ['linux-x64', 'linux-arm64']

function answer(lines) {
  return [PROBE_BEGIN, ...lines, PROBE_END].join('\n')
}

test('a login banner and shell noise around the probe do not change the answer', () => {
  const output = [
    'Welcome to Ubuntu 24.04 LTS', 'os=FreeBSD (from the motd, not the probe)',
    answer(['os=Linux', 'arch=aarch64', 'home=/home/pi', 'libc=ldd (Debian GLIBC 2.36-9+deb12u7) 2.36', 'tool=tar', 'tool=gzip', 'tool=sha256sum']),
    'arch=x86_64 printed by .bash_logout',
  ].join('\n')
  const probe = parseProbe(output)
  assert.equal(probe.os, 'Linux')
  assert.equal(probe.arch, 'aarch64')
  assert.equal(probe.home, '/home/pi')
  assert.deepEqual([...probe.tools].sort(), ['gzip', 'sha256sum', 'tar'])
  assert.equal(probe.installed, undefined)
  assert.deepEqual(selectTarget(probe, LINUX), { target: 'linux-arm64' })
})

test('an installed build is reported only when its identity file has content', () => {
  assert.equal(parseProbe(answer(['os=Linux', 'installed=0.2.2-rc.1+abc'])).installed, '0.2.2-rc.1+abc')
  assert.equal(parseProbe(answer(['os=Linux', 'installed='])).installed, undefined)
})

test('a shell that never ran the probe is reported instead of guessed', () => {
  assert.throws(() => parseProbe('fish: Unknown command: echo'), /did not answer the setup check/)
  assert.throws(() => parseProbe(`${PROBE_BEGIN}\nos=Linux`), /did not answer/)
})

test('every supported processor name maps to its build target', () => {
  const base = { os: 'Linux', libc: 'ldd (GNU libc) 2.39' }
  assert.deepEqual(selectTarget({ ...base, arch: 'x86_64' }, LINUX), { target: 'linux-x64' })
  assert.deepEqual(selectTarget({ ...base, arch: 'amd64' }, LINUX), { target: 'linux-x64' })
  assert.deepEqual(selectTarget({ ...base, arch: 'aarch64' }, LINUX), { target: 'linux-arm64' })
  assert.deepEqual(selectTarget({ ...base, arch: 'arm64' }, LINUX), { target: 'linux-arm64' })
})

test('computers Jan cannot set up are named in the reason', () => {
  const armv7 = selectTarget({ os: 'Linux', arch: 'armv7l', libc: 'ldd (GNU libc) 2.31' }, LINUX)
  assert.match(armv7.error, /Linux on armv7l/)
  const alpine = selectTarget({ os: 'Linux', arch: 'x86_64', libc: 'musl libc (x86_64)' }, LINUX)
  assert.match(alpine.error, /musl/)
  // A Mac's probe has no ldd at all; that is not mistaken for musl.
  const mac = { os: 'Darwin', arch: 'arm64', libc: 'zsh:1: command not found: ldd' }
  assert.match(selectTarget(mac, LINUX).error, /cannot prepare a build for Darwin on arm64/)
  assert.deepEqual(selectTarget(mac, [...LINUX, 'darwin-arm64']), { target: 'darwin-arm64' })
  const windows = selectTarget({ os: 'MINGW64_NT-10.0', arch: 'x86_64', libc: '' }, LINUX)
  assert.match(windows.error, /MINGW64_NT-10.0 on x86_64/)
})

test('a missing unpack or checksum tool is named before anything is copied', () => {
  assert.match(missingTool(new Set(['gzip', 'sha256sum'])), /no tar/)
  assert.match(missingTool(new Set(['tar', 'sha256sum'])), /no gzip/)
  assert.match(missingTool(new Set(['tar', 'gzip'])), /neither sha256sum nor shasum/)
  assert.equal(missingTool(new Set(['tar', 'gzip', 'shasum'])), undefined)
})

test('the probe script runs under a real POSIX sh and parses back', { skip: process.platform === 'win32' && 'needs a POSIX sh' }, () => {
  const output = execFileSync('sh', ['-c', probeScript('.jan/host/VERSION')], { encoding: 'utf8' })
  const probe = parseProbe(output)
  assert.notEqual(probe.os, '')
  assert.notEqual(probe.home, '')
})
