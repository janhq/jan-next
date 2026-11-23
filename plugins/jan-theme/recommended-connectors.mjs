// Connectors Customize recommends before the user searches anything. Local setup
// commands are pinned to the version Jan was tried with; hosted connectors have
// their own provisioning flow.

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const SETUP_TIMEOUT_MS = 10 * 60_000
const OUTPUT_LIMIT = 4 * 1024 * 1024

export const RECOMMENDED_CONNECTORS = [
  {
    id: 'openmotion',
    serverName: 'openmotion',
    setup: 'local-install',
    title: 'OpenMotion',
    description: 'Turn a reference video into editable motion graphics with your brand kit, then export MP4s for YouTube, Shorts, Reels and TikTok. Adds the OpenMotion Studio tools and its video-making skills.',
    publisher: 'nexu-io',
    homepage: 'https://github.com/nexu-io/openmotion',
    license: 'Apache-2.0',
    package: '@openmotion/app',
    version: '0.2.1',
    requirement: 'Node.js 22.18 or later with npm',
  },
  {
    id: 'composio',
    serverName: 'composio',
    setup: 'project-key',
    title: 'Composio',
    publisher: 'Composio',
    homepage: 'https://composio.dev',
  },
]

/**
 * Run a command and collect stdout; reject with the tail of stderr on failure.
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [options]
 */
export function runCommand(command, args, { timeoutMs = SETUP_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', chunk => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(signal ? `Setup stopped (${signal}).` : stderr.trim().split('\n').slice(-3).join('\n') || `Setup exited with code ${code}.`))
    })
  })
}

/**
 * Install one recommended connector into `baseDir/<id>` and return what to save.
 * @param {string} id - a RECOMMENDED_CONNECTORS id.
 * @param {{ baseDir: string, run?: typeof runCommand }} deps
 * @returns {Promise<{ server: object, skillsDirectory: string }>}
 */
export async function installRecommended(id, { baseDir, run = runCommand }) {
  const item = RECOMMENDED_CONNECTORS.find(row => row.id === id && row.setup === 'local-install')
  if (!item) throw new Error('Choose a recommended connector.')
  const root = join(baseDir, item.id)
  const skillsDirectory = join(root, 'skills')
  let output
  try {
    output = await run('npx', ['--yes', '--package', `${item.package}@${item.version}`, '--', 'openmotion', 'setup',
      '--host', 'jan', '--utm-source', 'jan', '--home', join(root, 'app'), '--skills-dir', skillsDirectory])
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${item.title} needs ${item.requirement}. Install Node.js, then try again.`)
    throw new Error(`${item.title} setup failed: ${error.message}`)
  }
  let result
  try { result = JSON.parse(output.slice(output.indexOf('{'))) } catch { throw new Error(`${item.title} setup finished without a readable result.`) }
  const transport = result?.agentRegistration?.transport
  if (transport?.type !== 'stdio' || typeof transport.command !== 'string' || !Array.isArray(transport.args)) {
    throw new Error(`${item.title} setup did not return a local MCP command.`)
  }
  return {
    server: { name: item.serverName, enabled: true, transport: 'stdio', command: transport.command, args: transport.args.map(String) },
    skillsDirectory: typeof result.agentRegistration.skillsDirectory === 'string' ? result.agentRegistration.skillsDirectory : skillsDirectory,
  }
}
