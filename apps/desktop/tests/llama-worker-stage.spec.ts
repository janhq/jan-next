/** The staged-worker gate rejects a missing worker and one built for another platform or architecture. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertStagedLlamaWorker, executableTarget, LLAMA_WORKER_STAGE } from '../scripts/llama-worker-stage.mjs'
import { signWindowsCode } from '../scripts/windows-runtime-signature.mjs'

const builderRequire = createRequire(createRequire(import.meta.url).resolve('app-builder-lib'))
const { walkAsync } = builderRequire(join(dirname(builderRequire.resolve('@electron/osx-sign')), 'util.js')) as {
  walkAsync: (path: string) => Promise<string[]>
}

const roots: string[] = []

function stage(name: string, bytes: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'llama-worker-stage-'))
  roots.push(root)
  writeFileSync(join(root, name), bytes)
  return root
}

function elf(machine: number): Buffer {
  const bytes = Buffer.alloc(64)
  bytes.writeUInt32BE(0x7f454c46, 0)
  bytes[5] = 1
  bytes.writeUInt16LE(machine, 18)
  return bytes
}

function machO(cpuType: number): Buffer {
  const bytes = Buffer.alloc(64)
  bytes.writeUInt32LE(0xfeedfacf, 0)
  bytes.writeUInt32LE(cpuType, 4)
  return bytes
}

function universal(...cpuTypes: number[]): Buffer {
  const bytes = Buffer.alloc(64 + 20 * cpuTypes.length)
  bytes.writeUInt32BE(0xcafebabe, 0)
  bytes.writeUInt32BE(cpuTypes.length, 4)
  cpuTypes.forEach((cpuType, index) => bytes.writeUInt32BE(cpuType, 8 + 20 * index))
  return bytes
}

function pe(machine: number): Buffer {
  const bytes = Buffer.alloc(256)
  bytes.writeUInt16LE(0x5a4d, 0)
  bytes.writeUInt32LE(128, 0x3c)
  bytes.writeUInt32LE(0x4550, 128)
  bytes.writeUInt16LE(machine, 132)
  return bytes
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('reads the platform and architectures of each executable format', () => {
  const read = (bytes: Buffer) => executableTarget(join(stage('worker', bytes), 'worker'))
  expect(read(elf(0x3e))).toEqual({ platform: 'linux', archs: ['x64'] })
  expect(read(elf(0xb7))).toEqual({ platform: 'linux', archs: ['arm64'] })
  expect(read(machO(0x0100000c))).toEqual({ platform: 'darwin', archs: ['arm64'] })
  expect(read(universal(0x01000007, 0x0100000c))).toEqual({ platform: 'darwin', archs: ['x64', 'arm64'] })
  expect(read(pe(0x8664))).toEqual({ platform: 'win32', archs: ['x64'] })
  expect(read(pe(0x14c))).toEqual({ platform: 'win32', archs: [] })
  expect(read(Buffer.from('#!/bin/sh\n'))).toBeUndefined()
})

it('accepts a worker built for the packaged platform and architecture', () => {
  expect(() => { assertStagedLlamaWorker('darwin', 'x64', stage('jan-llama-worker', machO(0x01000007))) }).not.toThrow()
  expect(() => { assertStagedLlamaWorker('darwin', 'arm64', stage('jan-llama-worker', universal(0x01000007, 0x0100000c))) }).not.toThrow()
  expect(() => { assertStagedLlamaWorker('win32', 'x64', stage('jan-llama-worker.exe', pe(0x8664))) }).not.toThrow()
  expect(() => { assertStagedLlamaWorker('linux', 'arm64', stage('jan-llama-worker', elf(0xb7))) }).not.toThrow()
})

it('rejects a missing worker or one built for another target', () => {
  expect(() => { assertStagedLlamaWorker('win32', 'x64', stage('jan-llama-worker', pe(0x8664))) })
    .toThrow(/jan-llama-worker\.exe is missing.*JAN_DESKTOP_OMIT_LLAMA_WORKER=1/u)
  expect(() => { assertStagedLlamaWorker('darwin', 'x64', stage('jan-llama-worker', machO(0x0100000c))) })
    .toThrow(/targets darwin arm64, not darwin x64/u)
  expect(() => { assertStagedLlamaWorker('darwin', 'x64', stage('jan-llama-worker', elf(0x3e))) })
    .toThrow(/targets linux x64, not darwin x64/u)
  expect(() => { assertStagedLlamaWorker('linux', 'x64', stage('jan-llama-worker', Buffer.from('#!/bin/sh\n'))) })
    .toThrow(/targets no known executable format, not linux x64/u)
})

function tree(files: Record<string, Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'llama-worker-package-'))
  roots.push(root)
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), bytes)
  }
  return root
}

it('signs the packaged macOS worker and its libraries with the application', async () => {
  const worker = ['jan-llama-worker', 'libggml.0.dylib', 'libggml-metal.so', 'libggml-cpu-apple_m1.so']
    .map(name => `Contents/Resources/llama-worker/${name}`)
  const contents = join(tree(Object.fromEntries(worker.map(name => [name, machO(0x0100000c)]))), 'Contents')
  expect((await walkAsync(contents)).sort()).toEqual(worker.map(name => join(dirname(contents), name)).sort())
})

it('signs the packaged Windows worker and its DLLs with the application', async () => {
  const worker = ['jan-llama-worker.exe', 'ggml.dll', 'ggml-base.dll', 'ggml-vulkan.dll'].map(name => join('resources', 'llama-worker', name))
  const root = tree(Object.fromEntries(['Jan Alpha.exe', ...worker].map(name => [name, pe(0x8664)])))
  const signed = new Set<string>()
  await signWindowsCode(root, {
    thumbprint: 'AA',
    record: () => {},
    sign: async ({ path }) => { signed.add(path) },
    inspect: async path => signed.has(path)
      ? { status: 'Valid', timestamped: true, thumbprint: 'AA' }
      : { status: 'NotSigned', timestamped: false, thumbprint: null },
  })
  expect([...signed].sort()).toEqual(['Jan Alpha.exe', ...worker].map(name => join(root, name)).sort())
})

it('stages from the worker crate dist directory', () => {
  expect(LLAMA_WORKER_STAGE.replaceAll('\\', '/')).toMatch(/\/native\/llama-worker\/dist$/u)
})
