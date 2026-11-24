/**
 * Development-only reload policy for Jan developing itself. Host module changes wait while a chat
 * runs and apply on their own once every chat is idle; "Reload now" applies them at once and
 * continues the chats it interrupted; a restart records the running chats and continues them on the
 * next start. The `dev:desktop --watch` overlay mounts it; no shipped profile does.
 */
import { randomUUID } from 'node:crypto'
import { unwatchFile, watchFile } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolveJanHome } from '@janhq/jan-home-paths'
import { registerApi } from '@janhq/jan-plugin-api'
import z from '@janhq/schemastery'

/** Cordis identity of the development reload plugin. */
export const name = 'jan-dev-reload'

export const inject = ['hmr', 'agents', 'sessionController', 'webServer', 'connection']

/** Text queued to a chat whose step a reload or restart stopped. */
export const CONTINUE_TEXT = 'Jan reloaded changed code while you were working, which stopped your last step. '
  + 'Check what finished, then continue the task.'

/** A restart record older than this is discarded unread, so an old crash never resumes chats. */
export const CONTINUE_MAX_AGE_MS = 15 * 60_000

/** Gate reason while chats run. */
export const RUNNING_CHATS = 'running-chats'

export const Config = z.object({
  restartWatch: z.array(String).default([]).description('Files whose change needs a Jan restart, such as the desktop main bundle.'),
  continueText: z.string().default(CONTINUE_TEXT).description('Message queued to chats a reload or restart interrupted.'),
})

/**
 * Chats to continue: running top-level Sessions, and the parent of a running subagent.
 * @param {Iterable<{ status: string, session: { id: string, header: { origin?: string, parentSession?: string } } }>} agents - live agents.
 * @returns {string[]} distinct Session ids.
 */
export function runningChats(agents) {
  const ids = new Set()
  for (const agent of agents) {
    if (agent.status !== 'running') continue
    const { id, header } = agent.session
    const chat = header.origin === 'subagent' ? header.parentSession : id
    if (chat !== undefined) ids.add(chat)
  }
  return [...ids]
}

/**
 * Wire the gate, idle waiter and restart record for one Host.
 * @param {import('@janhq/cordis').Context} ctx - a context with `hmr`, `agents` and `sessionController`.
 * @param {{ restartWatch?: string[], continueText?: string, home?: string }} config - plugin configuration; `home` overrides the Jan home.
 * @returns {{
 *   state(): { held: { count: number, reason: string } | null, restart: { reason: string } | null, running: number },
 *   reloadNow(): Promise<{ applied: boolean, continued: number }>,
 *   prepareRestart(): Promise<{ continued: number }>,
 *   resume(): Promise<number>,
 * }} the operations the client calls, and `resume` for startup.
 */
export function createDevReload(ctx, config = {}) {
  const continueText = config.continueText ?? CONTINUE_TEXT
  const recordFile = join(config.home ?? resolveJanHome(), 'dev-reload', 'continue.json')
  const stop = new AbortController()
  ctx.effect(() => () => { stop.abort() })
  const busy = () => ctx.agents.list().filter(agent => agent.status === 'running')
  /** @type {{ reason: string } | null} */
  let restart = null

  ctx.effect(() => ctx.hmr.setGate({ hold: () => busy().length > 0 ? RUNNING_CHATS : undefined }))

  // One waiter at a time applies held changes as soon as nothing runs.
  let waiting = false
  const applyWhenIdle = async () => {
    if (waiting) return
    waiting = true
    try {
      while (!stop.signal.aborted && ctx.hmr.held !== undefined) {
        const running = busy()
        if (running.length === 0) {
          await ctx.hmr.applyHeld()
          continue
        }
        await Promise.race([
          Promise.allSettled(running.map(agent => agent.whenIdle())),
          sleep(1000, undefined, { signal: stop.signal }).catch(() => {}),
        ])
      }
    } catch (error) {
      if (!stop.signal.aborted) ctx.logger.warn('could not apply held code changes: %s', error)
    } finally {
      waiting = false
    }
  }
  ctx.on('hmr/held', () => { void applyWhenIdle() })
  ctx.on('hmr/restart-required', (reason) => { restart = { reason } })

  for (const file of config.restartWatch ?? []) {
    const listener = (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs) restart = { reason: 'app-build' }
    }
    watchFile(file, { interval: 1000 }, listener)
    ctx.effect(() => () => { unwatchFile(file, listener) })
  }

  /**
   * Queue the continue message to each chat; a failure is logged and skipped.
   * @param {readonly string[]} sessionIds - chats to continue.
   * @returns {Promise<number>} chats that accepted it.
   */
  const continueChats = async (sessionIds) => {
    let accepted = 0
    for (const sessionId of sessionIds) {
      try {
        await ctx.sessionController.prompt({
          requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: continueText }],
        }, AbortSignal.timeout(30_000))
        accepted++
      } catch (error) {
        ctx.logger.warn('could not continue chat %s: %s', sessionId, error)
      }
    }
    return accepted
  }

  return {
    state() {
      const held = ctx.hmr.held
      return {
        held: held === undefined ? null : { count: held.modules.length, reason: held.reason },
        restart,
        running: runningChats(ctx.agents.list()).length,
      }
    },
    async reloadNow() {
      const sessionIds = runningChats(ctx.agents.list())
      const applied = await ctx.hmr.applyHeld()
      return { applied, continued: await continueChats(sessionIds) }
    },
    async prepareRestart() {
      const sessionIds = runningChats(ctx.agents.list())
      await mkdir(join(recordFile, '..'), { recursive: true, mode: 0o700 })
      const temporary = `${recordFile}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify({ sessionIds, writtenAt: Date.now() }), { mode: 0o600 })
      await rename(temporary, recordFile)
      return { continued: sessionIds.length }
    },
    /** Continue the chats a restart recorded, then remove the record. */
    async resume() {
      let record
      try {
        record = JSON.parse(await readFile(recordFile, 'utf8'))
      } catch (error) {
        if (error?.code !== 'ENOENT') ctx.logger.warn('could not read the restart record: %s', error)
      } finally {
        await rm(recordFile, { force: true })
      }
      const fresh = record !== undefined && Number.isFinite(record.writtenAt) && Date.now() - record.writtenAt <= CONTINUE_MAX_AGE_MS
      const sessionIds = fresh && Array.isArray(record.sessionIds) ? record.sessionIds.filter(id => typeof id === 'string') : []
      return sessionIds.length === 0 ? 0 : continueChats(sessionIds)
    },
  }
}

export function apply(ctx, config) {
  const devReload = createDevReload(ctx, config)
  const { resume, ...methods } = devReload
  ctx.effect(() => registerApi(ctx, 'dev-reload', methods))
  const ready = ctx.get('appReady')
  const start = () => { void resume().catch((error) => { ctx.logger.warn(error) }) }
  if (ready === undefined) start()
  else ctx.effect(() => ready.onReady(start))
}
