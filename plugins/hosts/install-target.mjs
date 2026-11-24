/**
 * Which Jan build a remote computer needs, read from one shell probe over SSH. The probe prints
 * labelled lines so a login banner or a chatty shell profile around them cannot be mistaken for
 * an answer; only the lines between the markers count.
 */

export const PROBE_BEGIN = 'JAN_HOSTS_PROBE_BEGIN'
export const PROBE_END = 'JAN_HOSTS_PROBE_END'

/**
 * A POSIX `sh` script that reports the machine without needing anything beyond `uname`. `ldd`
 * and the loader report the C library; `HOME` is where the install goes.
 * @param {string} versionFile - path, relative to `$HOME`, of the installed build's identity file.
 * @returns {string} the remote command.
 */
export function probeScript(versionFile) {
  return [
    `echo ${PROBE_BEGIN}`,
    'echo "os=$(uname -s 2>/dev/null)"',
    'echo "arch=$(uname -m 2>/dev/null)"',
    'echo "home=$HOME"',
    // musl's ldd prints its banner on stderr and exits 1; glibc prints "ldd (GNU libc) 2.39".
    'echo "libc=$( { LC_ALL=C ldd --version 2>&1 || true; } | head -n 1)"',
    'for t in tar gzip sha256sum shasum; do command -v "$t" >/dev/null 2>&1 && echo "tool=$t"; done',
    `if [ -f "$HOME/${versionFile}" ]; then echo "installed=$(cat "$HOME/${versionFile}")"; fi`,
    `echo ${PROBE_END}`,
  ].join('; ')
}

/**
 * Read the probe's answer.
 * @param {string} output - everything the remote printed.
 * @returns {{ os: string, arch: string, home: string, libc: string, tools: Set<string>, installed?: string }} the fields.
 * @throws {Error} when the markers are missing, which means the command never ran as `sh`.
 */
export function parseProbe(output) {
  const text = String(output)
  const start = text.indexOf(PROBE_BEGIN)
  const end = text.indexOf(PROBE_END, start + PROBE_BEGIN.length)
  if (start === -1 || end === -1) {
    throw new Error('That computer did not answer the setup check. Its login shell may not be a POSIX shell (sh, bash, zsh).')
  }
  const fields = { os: '', arch: '', home: '', libc: '', tools: new Set() }
  for (const line of text.slice(start + PROBE_BEGIN.length, end).split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (key === 'tool') fields.tools.add(value)
    else if (key === 'installed') { if (value !== '') fields.installed = value }
    else if (key in fields) fields[key] = value
  }
  return fields
}

/**
 * Map a probe to a build target such as `linux-x64`. Only targets this release can build are
 * returned; everything else gets a sentence that names what the computer is.
 * @param {{ os: string, arch: string, libc: string }} probe - parsed probe.
 * @param {readonly string[]} supported - targets this Jan can prepare, e.g. `['linux-x64', 'linux-arm64']`.
 * @returns {{ target: string } | { error: string }} the target, or why there is none.
 */
export function selectTarget(probe, supported) {
  const os = probe.os.toLowerCase()
  const arch = probe.arch.toLowerCase()
  const platform = os === 'linux' ? 'linux' : os === 'darwin' ? 'darwin' : undefined
  const cpu = arch === 'x86_64' || arch === 'amd64' ? 'x64' : arch === 'aarch64' || arch === 'arm64' ? 'arm64' : undefined
  const described = `${probe.os || 'an unknown system'} on ${probe.arch || 'an unknown processor'}`
  if (platform === undefined || cpu === undefined) {
    return { error: `Jan can set itself up on Linux and macOS computers with x64 or arm64 processors. That computer is ${described}.` }
  }
  if (platform === 'linux' && /musl/i.test(probe.libc)) {
    return { error: 'That computer uses musl (for example Alpine Linux). Jan can set itself up only on glibc Linux, such as Debian, Ubuntu, Fedora or Raspberry Pi OS.' }
  }
  const target = `${platform}-${cpu}`
  if (!supported.includes(target)) {
    return { error: `This Jan cannot prepare a build for ${described} yet. Supported: ${supported.join(', ')}.` }
  }
  return { target }
}

/**
 * The tools the remote install needs, and the first one missing.
 * @param {Set<string>} tools - tools the probe found.
 * @returns {string | undefined} a sentence naming the missing tool, or undefined when all are there.
 */
export function missingTool(tools) {
  if (!tools.has('tar')) return 'That computer has no tar command, which Jan needs to unpack itself there.'
  if (!tools.has('gzip')) return 'That computer has no gzip command, which Jan needs to unpack itself there.'
  if (!tools.has('sha256sum') && !tools.has('shasum')) {
    return 'That computer has neither sha256sum nor shasum, which Jan needs to check its copy there.'
  }
  return undefined
}
