import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { apply } from '../index.mjs'

async function withImporter(callback) {
  const root = await mkdtemp(join(tmpdir(), 'jan-import-'))
  const source = join(root, 'jan-data')
  const outside = join(root, 'outside.png')
  const threadId = 'sample'
  const sessionId = `jan-${threadId}`
  await mkdir(join(source, 'threads', threadId), { recursive: true })
  await writeFile(outside, 'outside image')
  const thread = { id: threadId, title: 'Images', created_at: 1000 }
  await writeFile(join(source, 'threads', threadId, 'thread.json'), JSON.stringify(thread))
  const saved = []
  const handles = []
  const sessions = new Map()
  const persistence = {
    stat: async id => sessions.get(id),
    create: async header => {
      const handle = {
        append: async events => { sessions.set(header.id, { header, events }) },
        flush: async () => {},
        close: async () => {},
      }
      handles.push(handle)
      return handle
    },
  }
  const workspace = { path: source, attachSession: async () => {} }
  const api = { register: ({ handler }) => { api.handler = handler; return () => {} } }
  const ctx = {
    fiber: {},
    effect: callback => callback(),
    webServer: api,
    connection: { requestRejection: () => undefined },
    sessions: { get: () => undefined, prepare: (id, { seed, meta }) => ({ header: { id, ...meta }, inheritedEventCount: 0 }) },
    sessionPersistence: persistence,
    workspaceRegistry: { initializeDefault: async () => workspace },
    attachments: { saveImage: async image => { saved.push(image); return { id: `image-${saved.length}` } } },
    get: () => undefined,
  }
  apply(ctx)
  const importImages = async urls => {
    const messages = urls.map((url, index) => ({ id: `u${index}`, role: 'user', created_at: 1000 + index, content: [{ type: 'image_url', image_url: { url } }] }))
    await writeFile(join(source, 'threads', threadId, 'messages.jsonl'), messages.map(message => JSON.stringify(message)).join('\n'))
    return new Promise((resolve, reject) => {
      const req = { method: 'POST', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ method: 'import', params: { folder: source, ids: [threadId] } })) } }
      const res = { writeHead(status) { this.status = status }, end(body) { try { resolve({ status: this.status, body: JSON.parse(body) }) } catch (error) { reject(error) } } }
      api.handler(req, res).catch(reject)
    })
  }
  try { await callback({ source, outside, sessionId, saved, sessions, persistence, handles, importImages }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('imported images are confined to the real legacy data folder', async () => withImporter(async ({ source, outside, saved, importImages }) => {
  const inside = join(source, 'inside.png')
  await writeFile(inside, 'inside image')
  await symlink(outside, join(source, 'escape.png'))
  const { body } = await importImages([inside, outside, `file://${outside}`, '../outside.png', join(source, 'escape.png')])
  assert.equal(body.result.results[0].status, 'imported')
  assert.deepEqual(saved.map(image => image.data.toString()), ['inside image'])
}))
