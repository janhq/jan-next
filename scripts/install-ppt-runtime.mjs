import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const home = process.argv[2]
if (!home) throw new Error('Usage: node scripts/install-ppt-runtime.mjs <DSH_HOME>')
const root = resolve(home)
const profile = join(root, 'profiles', 'web')
const manifestPath = join(profile, 'package.json')
const original = await readFile(manifestPath, 'utf8')
const manifest = JSON.parse(original)
const bundles = manifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error('The web profile has no bundle list.')
const source = fileURLToPath(new URL('../dsh/ppt-runtime/', import.meta.url))
const target = join(root, 'vendor', 'open-waifu-ppt')
await mkdir(target, { recursive: true })
const packages = ['dsh-ppt', 'dsh-ppt-composer']
const dependencies = {}
for (const name of packages) {
  const filename = `${name}-0.1.1-rc.2.tgz`
  await copyFile(join(source, filename), join(target, filename))
  dependencies[name] = `file:${join(target, filename).replaceAll('\\', '/')}`
}
manifest.dependencies = { ...manifest.dependencies, ...dependencies }
manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides, 'dsh-ppt': dependencies['dsh-ppt'] } }
manifest.dsh.profile.bundles = [...bundles.filter(name => !packages.includes(name)), 'dsh-ppt-composer']
await copyFile(manifestPath, `${manifestPath}.before-ppt-${Date.now()}`)
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
try {
  const corepack = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [corepack, 'pnpm@10.33.0', 'install', '--no-frozen-lockfile'], {
      cwd: profile, stdio: 'inherit', env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0', COREPACK_DEFAULT_TO_LATEST: '0' },
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`PPT package installation exited with ${code}`)))
  })
} catch (error) {
  await writeFile(manifestPath, original)
  throw error
}
console.log(`Installed the matching PPT runtime and composer in ${profile}. Restart the desktop app.`)
