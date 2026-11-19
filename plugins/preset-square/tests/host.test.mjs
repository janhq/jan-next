import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apply } from '../host.mjs'

const id = 'example'
const directory = () => join(process.env.JAN_HOME, '.agent-presets', id)
const persona = `- id: persona
  name: '@janhq/jan-persona'
  config:
    text: Be concise.
    interpolate: false
`

beforeEach(async () => {
  vi.stubEnv('JAN_HOME', await mkdtemp(join(tmpdir(), 'jan-preset-square-')))
})

afterEach(async () => {
  await rm(process.env.JAN_HOME, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function startHost(warn = vi.fn()) {
  let route
  const register = vi.fn(async () => async () => {})
  apply({
    agentPresets: { register, list: async () => [] },
    effect: run => run(),
    logger: { warn },
    webServer: { register: spec => { route = spec } },
    connection: { requestRejection: () => undefined },
  })
  return {
    register,
    async install() {
      const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ method: 'install', params: { slug: id } }))]), {
        method: 'POST', headers: { 'content-type': 'application/json' },
      })
      let status, body
      await route.handler(request, {
        writeHead: value => { status = value },
        end: value => { body = JSON.parse(value) },
      })
      return { status, body }
    },
  }
}

function servePackage(composition, extraEntries) {
  serveArchive(makePackage(composition, extraEntries))
}

function makePackage(composition, extraEntries) {
  const bytes = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'dsh-preset', version: 1, id })),
    'preset/agent.cordis.yml': strToU8(composition),
    ...extraEntries,
  })
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function serveArchive(bytes) {
  const downloadUrl = 'https://dshdesktop.com/preset/example.zip'
  const detail = {
    presetId: id, title: 'Example preset', description: 'An example.',
    artifact: { downloadUrl, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  }
  vi.stubGlobal('fetch', async url => url === downloadUrl ? new Response(bytes) : Response.json(detail))
}

it('installs and registers a data-only persona with its instructions and config', async () => {
  servePackage(persona)
  const { install, register } = startHost()
  expect(await install()).toEqual({ status: 200, body: { result: { id } } })
  expect(register).toHaveBeenCalledExactlyOnceWith({
    id, name: 'Example preset', description: 'An example.',
    plugins: [{ id: 'persona', name: '@janhq/jan-persona', config: { prefix: 'Be concise.', interpolate: false } }],
  })
  expect(await readFile(join(directory(), 'agent.cordis.yml'), 'utf8')).toBe(persona)
})

it('rejects an oversized expanded archive before inflating any entry', async () => {
  const zeros = new Uint8Array(17 * 1024 * 1024)
  const bytes = makePackage(persona, { 'preset/one.bin': zeros, 'preset/two.bin': zeros })
  expect(bytes.length).toBeLessThan(1024 * 1024)
  // Corrupt the first entry's DEFLATE stream so decoding it would fail before the size rejection.
  const manifestDataOffset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28)
  bytes[manifestDataOffset] = 0x07 // Reserved DEFLATE block type.
  serveArchive(bytes)
  const { install, register } = startHost()
  expect(await install()).toEqual({ status: 400, body: { error: 'The unpacked package exceeds 32 MB.' } })
  expect(register).not.toHaveBeenCalled()
})

it('rejects an archive containing 513 entries, including its manifest', async () => {
  const empty = new Uint8Array()
  const extraEntries = Object.fromEntries(Array.from({ length: 511 }, (_, i) => [`preset/file-${i}`, empty]))
  servePackage(persona, extraEntries)
  const { install, register } = startHost()
  expect(await install()).toEqual({ status: 400, body: { error: 'The package has more than 512 files.' } })
  expect(register).not.toHaveBeenCalled()
})

it('rejects an entry whose expanded size does not match its ZIP metadata', async () => {
  const bytes = makePackage(persona, { 'preset/data.bin': new Uint8Array(64) })
  const directoryOffset = bytes.readUInt32LE(bytes.length - 6)
  // The last central directory entry is data.bin. Give it an incorrect size.
  const entryOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), bytes.length - 22)
  expect(entryOffset).toBeGreaterThan(directoryOffset)
  bytes.writeUInt32LE(63, entryOffset + 24)
  serveArchive(bytes)
  const { install, register } = startHost()
  expect(await install()).toEqual({ status: 400, body: { error: 'The package is not a valid ZIP archive.' } })
  expect(register).not.toHaveBeenCalled()
})

it.each([
  ['a relative module', `${persona}- name: './plugin.mjs'\n`],
  ['an arbitrary installed plugin', `${persona}- name: 'cordis:include'\n`],
  ['an inline expression', `${persona}  disabled: !!js 'true'\n`],
  ['a serialized expression', `${persona}  disabled: { __jsExpr: 'true' }\n`],
])('rejects a package containing %s before writing or registering anything', async (_kind, composition) => {
  servePackage(composition)
  const { install, register } = startHost()
  const response = await install()
  expect(register).not.toHaveBeenCalled()
  expect(response.status).toBe(400)
  expect(response.body.error).toMatch(/Preset Square.*executable/i)
  await expect(readFile(join(directory(), 'agent.cordis.yml'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not register an executable preset left on disk by an older install', async () => {
  await mkdir(directory(), { recursive: true })
  await writeFile(join(directory(), 'square.json'), JSON.stringify({ name: 'Old preset' }))
  await writeFile(join(directory(), 'agent.cordis.yml'), `${persona}- name: './plugin.mjs'\n`)
  const warn = vi.fn()
  const { register } = startHost(warn)
  await expect.poll(() => warn.mock.calls.length + register.mock.calls.length).toBe(1)
  expect(register).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Preset Square.*executable/i))
})
