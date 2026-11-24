import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DESKTOP_HOST_PACKAGE, DESKTOP_HOST_RUNTIME_FILES } from '../src/core-package-set.ts'
import { DESKTOP_RUNTIME_FILE, readDesktopRuntime, runtimePath, verifyDesktopRuntime, writeDesktopRuntime, writeDesktopRuntimeAsync } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-runtime-'))
  roots.push(root)
  runtimeFixture(join(root, 'jan'))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('seals final file bytes identically with concurrent and synchronous inventory', async () => {
  const jan = join(fixture(), 'jan')
  const original = readDesktopRuntime(jan)
  const names = original.sharedPackages.map(entry => entry.name)
  writeFileSync(join(jan, 'extra.bin'), Buffer.from([0, 1, 255]))
  writeFileSync(join(jan, 'package.json'), '{"type":"module","private":true}\n')
  const expected = writeDesktopRuntime(jan, original.release, names)
  const expectedBytes = readFileSync(join(jan, DESKTOP_RUNTIME_FILE))
  expect(await writeDesktopRuntimeAsync(jan, original.release, names)).toEqual(expected)
  expect(readFileSync(join(jan, DESKTOP_RUNTIME_FILE))).toEqual(expectedBytes)
  expect(await verifyDesktopRuntime(jan, original.release.version)).toEqual(expected)
})

it.each(['manifest', 'link'])('leaves the descriptor unchanged when concurrent sealing rejects a %s', async (failure) => {
  const jan = join(fixture(), 'jan')
  const original = readDesktopRuntime(jan)
  const before = readFileSync(join(jan, DESKTOP_RUNTIME_FILE))
  if (failure === 'manifest') writeFileSync(join(jan, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json'), '{}')
  else symlinkSync(join(jan, 'node_modules'), join(jan, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(writeDesktopRuntimeAsync(jan, original.release, original.sharedPackages.map(entry => entry.name))).rejects.toThrow()
  expect(readFileSync(join(jan, DESKTOP_RUNTIME_FILE))).toEqual(before)
})

it('verifies a runtime after relocation without depending on build paths', async () => {
  const root = fixture()
  const before = await verifyDesktopRuntime(join(root, 'jan'), '1.0.0')
  cpSync(join(root, 'jan'), join(root, 'moved'), { recursive: true })
  expect(await verifyDesktopRuntime(join(root, 'moved'), '1.0.0')).toEqual(before)
})
it.each(['changed', 'same-size', 'extra', 'missing'])('checks %s runtime bytes only during build verification', async (operation) => {
  const jan = join(fixture(), 'jan')
  const before = readDesktopRuntime(jan)
  if (operation === 'changed') writeFileSync(join(jan, 'package.json'), '{}')
  if (operation === 'same-size') writeFileSync(join(jan, 'package.json'), '{"type":"Module"}\n')
  if (operation === 'extra') writeFileSync(join(jan, 'extra'), '')
  if (operation === 'missing') rmSync(join(jan, 'package.json'))
  expect(readDesktopRuntime(jan)).toEqual(before)
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/integrity/u)
})
it('rejects filesystem links and incompatible targets', async () => {
  const jan = join(fixture(), 'jan')
  await expect(verifyDesktopRuntime(jan, '1.0.0', { platform: process.platform, arch: 'wrong' })).rejects.toThrow(/incompatible/u)
  symlinkSync(join(jan, 'node_modules'), join(jan, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(readDesktopRuntime(jan).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/unsupported filesystem/u)
})
it('reads file inventory records unchanged during startup', () => {
  const jan = join(fixture(), 'jan')
  const path = join(jan, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: unknown[] }
  descriptor.files.unshift({ path: '../outside', bytes: -1.5, sha256: 'unchecked', executable: 'unchecked' })
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(jan).files).toEqual(descriptor.files)
})
it.each(['missing', 'directory'])('checks a %s Host entry only during build verification', async (operation) => {
  const jan = join(fixture(), 'jan')
  const path = join(jan, 'node_modules', DESKTOP_HOST_PACKAGE, DESKTOP_HOST_RUNTIME_FILES[0])
  rmSync(path)
  if (operation === 'directory') mkdirSync(path)
  expect(readDesktopRuntime(jan).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/integrity/u)
})
it('checks the bundled version only during build verification', async () => {
  const jan = join(fixture(), 'jan')
  expect(readDesktopRuntime(jan).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(jan, '2.0.0')).rejects.toThrow(/bundled 1\.0\.0 is not the expected 2\.0\.0/u)
})
it.each([
  { schemaVersion: 2 },
  { platform: 'other' },
  { arch: 'other' },
  { release: { schemaVersion: 2 } },
  { release: { hostProtocolVersion: 999 } },
  { release: { nodeVersion: 'invalid' } },
  { release: { pnpmVersion: 'invalid' } },
])('checks release compatibility only during build verification: %j', async (patch) => {
  const jan = join(fixture(), 'jan')
  const path = join(jan, DESKTOP_RUNTIME_FILE)
  const original = readDesktopRuntime(jan)
  const descriptor = { ...original, ...patch, release: { ...original.release, ...patch.release } }
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(jan)).toEqual(descriptor)
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/invalid|incompatible/u)
})
it.each(['missing', 'invalid-json', 'mismatched'])('checks %s shared manifests only during build verification', async (operation) => {
  const jan = join(fixture(), 'jan')
  const before = readDesktopRuntime(jan)
  const path = join(jan, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json')
  if (operation === 'missing') rmSync(path)
  else writeFileSync(path, operation === 'invalid-json' ? '{' : '{}')
  expect(readDesktopRuntime(jan)).toEqual(before)
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow()
})
it('rejects a descriptor that maps a shared package outside node_modules', async () => {
  const jan = join(fixture(), 'jan')
  const path = join(jan, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { sharedPackages: { path: string }[] }
  descriptor.sharedPackages[0]!.path = '../outside'
  writeFileSync(path, JSON.stringify(descriptor))
  await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/shared package record/u)
})
it('verifies recorded executable permissions only on Unix', async () => {
  const jan = join(fixture(), 'jan')
  const path = join(jan, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: { executable: boolean }[] }
  descriptor.files[0]!.executable = !descriptor.files[0]!.executable
  writeFileSync(path, JSON.stringify(descriptor))
  if (process.platform === 'win32') await expect(verifyDesktopRuntime(jan, '1.0.0')).resolves.toMatchObject(descriptor)
  else await expect(verifyDesktopRuntime(jan, '1.0.0')).rejects.toThrow(/integrity/u)
})
it.each(['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', './a'])('rejects nonportable path %s', (path) => {
  expect(() => runtimePath('/runtime', path)).toThrow(/invalid relative path/u)
})
