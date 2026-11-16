import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fs, joinPath } from '../native/runtime.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { registerApi } from '../native/api.mjs'
import { Assistants, validateAssistantId } from './store'

export const name = 'ow-assistant'
export const inject = ['owNative', 'webServer', 'connection', 'agentPresets', 'configEditor', 'sessionProjections', 'agents', 'sessionPersistence']

interface CustomPreset {
  id: string
  name: string
  description: string
  instructions: string
  legacy?: Record<string, unknown>
}
interface Config {
  presets?: CustomPreset[]
  importedAssistants?: boolean
  /** Set once per-conversation applied instructions were scanned. */
  appliedInstructions?: boolean
  assignments?: Record<string, string>
}

/** A DSH preset id for one Jan assistant; hashed only when Jan's id is unusable. */
function legacyPresetId(id: string): string {
  const safe = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,121}$/.test(id) ? id : createHash('sha256').update(id).digest('hex')
  return `jan-${safe}`
}

/**
 * Stable JSON for hashing stored records: object keys sorted at every depth, so
 * the same record hashes the same regardless of the order Jan wrote its keys.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** One Jan conversation's applied assistant instructions and record. */
interface JanAssignment {
  sessionId: string
  assistantId: string
  instructions: string
  /** The whole thread-level assistant clone, kept as the preset's legacy record. */
  clone: Record<string, unknown>
}

/** The stored Jan avatar when it is short text (an emoji), not a path or URL. */
function legacyAvatar(legacy: Record<string, unknown> | undefined): string | undefined {
  const value = legacy?.avatar
  return typeof value === 'string' && value !== '' && [...value].length <= 8 && !/[/\\:]/.test(value) ? value : undefined
}

/**
 * Read the assistant each Jan thread actually ran. Jan records it in
 * `threads/<id>/thread.json` `assistants[0]`; its instructions are what that
 * conversation was answered with, which may differ from the assistant's
 * current text. The importer names the DSH session `jan-<thread id>`.
 */
async function readAppliedInstructions(log: { warn: (...args: unknown[]) => void }): Promise<JanAssignment[]> {
  const root = 'file://threads'
  if (!await fs.existsSync(root)) return []
  const rows: JanAssignment[] = []
  for (const entry of await fs.readdirSync(root)) {
    const folder = entry.replaceAll('\\', '/').split('/').pop() ?? ''
    const path = await joinPath([root, folder, 'thread.json'])
    if (!await fs.existsSync(path)) continue
    try {
      const thread = JSON.parse(await fs.readFileSync(path)) as { id?: unknown; assistants?: unknown }
      const applied = Array.isArray(thread.assistants) ? thread.assistants[0] as { id?: unknown; instructions?: unknown } | undefined : undefined
      if (typeof applied?.id !== 'string' || typeof applied.instructions !== 'string' || applied.instructions.trim() === '') continue
      rows.push({
        sessionId: `jan-${typeof thread.id === 'string' ? thread.id : folder}`,
        assistantId: applied.id,
        instructions: applied.instructions,
        clone: applied as Record<string, unknown>,
      })
    } catch (error) {
      log.warn(`Skipping Jan thread ${folder}: ${String(error)}`)
    }
  }
  return rows
}

// Legacy assistant folders are import-only. All subsequent edits belong to
// the DSH profile, so copying DSH_HOME also carries the user's personas.
export async function apply(ctx: Context, config: Config = {}) {
  const editor = ctx.get('configEditor')
  const entry = ctx.fiber.entry
  if (!editor || !entry) throw new Error('Agent presets require an editable DSH profile.')
  const registry = ctx.get('agentPresets')
  const mounted: Array<() => Promise<void>> = []
  const presets = config.presets ?? []
  const validate = (input: unknown): CustomPreset => {
    if (!input || typeof input !== 'object') throw new Error('Enter an agent preset.')
    const value = input as Record<string, unknown>
    validateAssistantId(value.id)
    const field = (key: string, max: number) => {
      const text = value[key] ?? ''
      if (typeof text !== 'string' || text.length > max) throw new Error(`${key} must be text no longer than ${max} characters.`)
      return text
    }
    const name = field('name', 200).trim()
    if (!name) throw new Error('Enter a name for this preset.')
    return { id: value.id, name, description: field('description', 4000), instructions: field('instructions', 262144), ...(value.legacy && typeof value.legacy === 'object' ? { legacy: value.legacy as Record<string, unknown> } : {}) }
  }
  ctx.effect(() => async () => { for (const dispose of mounted) await dispose() }, 'ow-assistant: custom agent presets')
  // Custom presets derive from Standard mode; a deployment that removed it
  // still gets its current default instead of a dead plugin.
  let base: PresetDefinition | undefined
  for (const id of ['standard', registry.defaultId]) {
    try { base = registry.definitionFor(id); break }
    catch (error) { ctx.logger.warn(`Custom presets: no "${id}" composition: ${String(error)}`) }
  }
  for (const input of presets) {
    if (base === undefined) break
    try {
      const preset = validate(input)
      const plugins = base.plugins.filter((row: { id?: string }) => row.id !== 'persona')
      plugins.unshift({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: preset.instructions, interpolate: false } })
      mounted.push(await registry.register({ id: preset.id, name: preset.name, description: preset.description, plugins }))
    } catch (error) {
      // One unusable stored preset must not take the editor or the others down.
      ctx.logger.error(`Agent preset "${input.id}" was not registered: ${String(error)}`)
    }
  }
  const importedSelection = await ctx.sessionProjections.register({
    key: 'owAssistantImportedSelection', stateSchema: z.boolean(), stateVersion: 1,
    init: () => false,
    apply: (state, event) => state || (event.type === 'agent-preset/selected' && event.data.agentPreset.startsWith('jan-applied-')),
  })
  const restoreAssignment = async (agent: Agent) => {
    const presetId = config.assignments?.[agent.id]
    if (!presetId || importedSelection.stateOf(agent.session)) return
    // A skipped or unregistered preset must not fail the Session's creation.
    if (!(await registry.list()).some(row => row.id === presetId)) {
      ctx.logger.warn(`Imported preset "${presetId}" is unavailable for "${agent.id}"; keeping the default composition.`)
      return
    }
    // Creation listeners finish before any queued prompt can run. The native
    // selection event is also the durable migration marker after later switches.
    await registry.recompose(agent.ctx, presetId)
    agent.session.append('agent-preset/selected', { agentPreset: presetId })
  }
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await restoreAssignment(agent)
    } catch (error) {
      ctx.logger.warn(`Imported preset not restored for "${agent.id}": ${String(error)}`)
    }
  })
  for (const agent of ctx.agents.list()) {
    if (!config.assignments?.[agent.id] || importedSelection.stateOf(agent.session)) continue
    try {
      await agent.runMaintenance(async () => { await restoreAssignment(agent) })
    } catch (error) {
      // An Agent already driving a turn keeps its composition; `agent/created`
      // cannot fire for it again, and a later restart retries this pass.
      ctx.logger.warn(`Imported preset not restored for "${agent.id}": ${String(error)}`)
    }
  }
  const write = (change: (current: CustomPreset[]) => CustomPreset[]) => editor.edit(entry, (current: Record<string, unknown>) => ({
    ...current, presets: change((current.presets as CustomPreset[] | undefined) ?? []),
  }))
  const locked = (id: string) => Object.values(config.assignments ?? {}).includes(id)
  const row = (item: CustomPreset) => {
    const avatar = legacyAvatar(item.legacy)
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      instructions: item.instructions,
      // A conversation snapshot is history, not a template: its text is what an
      // imported conversation was answered with, so the editor shows it read-only.
      locked: locked(item.id),
      ...(avatar === undefined ? {} : { avatar }),
    }
  }
  const service = {
    async list() { return presets.map(row) },
    async save({ assistant }: { assistant?: unknown }) {
      const preset = validate(assistant)
      if (locked(preset.id)) throw new Error('This preset preserves the instructions applied to an imported conversation. Create a new preset to customize them.')
      const existing = presets.find(item => item.id === preset.id)
      // The edited row carries no legacy metadata (the browser never needs the
      // full Jan record), so keep it beside the edited text.
      const next: CustomPreset = {
        ...preset,
        ...(preset.legacy === undefined && existing?.legacy !== undefined ? { legacy: existing.legacy } : {}),
      }
      if (existing === undefined && (await registry.list()).some(item => item.id === next.id)) {
        throw new Error('That preset id is already in use. Create the preset again to get a new id.')
      }
      await write(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next])
      return row(next)
    },
    async remove({ id, confirmed }: { id?: unknown; confirmed?: unknown }) {
      validateAssistantId(id)
      if (confirmed !== true) throw new Error('Confirm deletion before removing a preset.')
      if (locked(id)) throw new Error('This imported preset preserves saved conversation instructions and cannot be deleted.')
      if (registry.defaultId === id) throw new Error('This preset is the new-task default. Set another default preset in Agent presets before deleting it.')
      for (const agent of ctx.agents.list()) {
        if (registry.presetForSession(agent.session) === id) throw new Error('This preset is used by a conversation. Switch that conversation to another preset before deleting it.')
      }
      for (const stored of await ctx.sessionPersistence.list()) {
        const handle = await ctx.sessionPersistence.open(stored.header.id, 'read')
        try {
          let selected = handle.header.agentPreset
          for (const event of (await handle.read()).events) if (event.type === 'agent-preset/selected') selected = event.data.agentPreset
          if (selected === id) throw new Error('This preset is used by a saved conversation. Switch that conversation to another preset before deleting it.')
        } finally { await handle.close() }
      }
      await write(current => current.filter(item => item.id !== id))
      return { id }
    },
  }
  ctx.effect(() => registerApi(ctx, 'assistant', service), 'ow-assistant: preset editor API')
  if (!config.importedAssistants || !config.appliedInstructions) {
    // Reconciliation restarts this entry. Run after activation has returned.
    const timer = setTimeout(() => {
      void (async () => {
        // Read without prepare(): importing must never seed or rewrite Jan data.
        const store = new Assistants()
        const known = [...presets]
        const added: CustomPreset[] = []
        let assistantsDone = config.importedAssistants === true
        if (!config.importedAssistants) {
          try {
            for (const item of await store.getAssistants()) {
              try {
                // The whole Jan record rides along untouched; the editor only ever
                // rewrites name, description and instructions on the DSH copy.
                const preset = validate({ ...item, legacy: item, id: legacyPresetId(item.id) })
                if (!known.some(row => row.id === preset.id)) added.push(preset)
              } catch (error) {
                ctx.logger.warn(`Skipping Jan assistant ${item.id}: ${String(error)}`)
              }
            }
            assistantsDone = true
          } catch (error) {
            // A refused read keeps the flag off, so the next boot retries it.
            ctx.logger.error(`Assistant import failed: ${String(error)}`)
          }
        }
        // Applied instructions are a separate, older-data repair: an install
        // that ran the assistant import before this field existed still gets
        // its per-conversation snapshots once.
        const assignments: Record<string, string> = { ...(config.assignments ?? {}) }
        let appliedDone = config.appliedInstructions === true
        if (!config.appliedInstructions) {
          try {
            for (const applied of await readAppliedInstructions(ctx.logger)) {
              // The clone record is part of a snapshot's identity: two Jan
              // conversations can share instructions but differ in model or
              // tools, and each must keep the record it actually ran.
              const id = `jan-applied-${createHash('sha256').update([applied.assistantId, applied.instructions, canonicalJson(applied.clone)].join('\0')).digest('hex')}`
              try {
                if (!known.some(item => item.id === id) && !added.some(item => item.id === id)) {
                  const source = [...known, ...added].find(item => item.id === legacyPresetId(applied.assistantId))
                  // The clone's own name distinguishes records that share text.
                  const cloneName = typeof applied.clone.name === 'string' && applied.clone.name.trim() !== ''
                    ? applied.clone.name.trim() : undefined
                  added.push(validate({
                    id,
                    name: `${cloneName ?? source?.name ?? applied.assistantId} (saved conversation)`,
                    description: 'Imported applied instructions from a Jan conversation.',
                    instructions: applied.instructions,
                    // History keeps the whole applied clone, not only its text.
                    legacy: applied.clone,
                  }))
                }
                assignments[applied.sessionId] = id
              } catch (error) {
                ctx.logger.warn(`Skipping applied instructions for ${applied.sessionId}: ${String(error)}`)
              }
            }
            appliedDone = true
          } catch (error) {
            ctx.logger.error(`Applied instructions import failed: ${String(error)}`)
          }
        }
        if (added.length === 0 && assistantsDone === config.importedAssistants && appliedDone === config.appliedInstructions) return
        await editor.edit(entry, (current: Record<string, unknown>) => ({
          ...current,
          ...(assistantsDone ? { importedAssistants: true } : {}),
          ...(appliedDone ? { appliedInstructions: true } : {}),
          assignments,
          presets: [...((current.presets as CustomPreset[]) ?? []), ...added.filter(item => !((current.presets as CustomPreset[]) ?? []).some(saved => saved.id === item.id))],
        }))
      })().catch(error => ctx.logger.error(`Assistant import failed: ${String(error)}`))
    }, 0)
    ctx.effect(() => () => clearTimeout(timer), 'ow-assistant: import scheduling')
  }
}
