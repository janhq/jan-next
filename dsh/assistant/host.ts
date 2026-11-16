import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fs } from '../native/runtime.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
  assignments?: Record<string, string>
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
  for (const input of presets) {
    const preset = validate(input)
    const base = registry.definitionFor('standard')
    const plugins = base.plugins.filter((row: { id?: string }) => row.id !== 'persona')
    plugins.unshift({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: preset.instructions, interpolate: false } })
    mounted.push(await registry.register({ id: preset.id, name: preset.name, description: preset.description, plugins }))
  }
  const importedSelection = await ctx.sessionProjections.register({
    key: 'owAssistantImportedSelection', stateSchema: z.boolean(), stateVersion: 1,
    init: () => false,
    apply: (state, event) => state || (event.type === 'agent-preset/selected' && event.data.agentPreset.startsWith('jan-applied-')),
  })
  const restoreAssignment = async (agent: Agent) => {
    const presetId = config.assignments?.[agent.id]
    if (!presetId || importedSelection.stateOf(agent.session)) return
    // Creation listeners finish before any queued prompt can run. The native
    // selection event is also the durable migration marker after later switches.
    await registry.recompose(agent.ctx, presetId)
    agent.session.append('agent-preset/selected', { agentPreset: presetId })
  }
  ctx.on('agent/created', async ({ agent }) => { await restoreAssignment(agent) })
  for (const agent of ctx.agents.list()) {
    if (config.assignments?.[agent.id] && !importedSelection.stateOf(agent.session)) {
      await agent.runMaintenance(async () => { await restoreAssignment(agent) })
    }
  }
  const write = (change: (current: CustomPreset[]) => CustomPreset[]) => editor.edit(entry, (current: Record<string, unknown>) => ({
    ...current, presets: change((current.presets as CustomPreset[] | undefined) ?? []), importedAssistants: true,
  }))
  const service = {
    async list() { return presets },
    async save({ assistant }: { assistant?: unknown }) {
      const preset = validate(assistant)
      if (Object.values(config.assignments ?? {}).includes(preset.id)) throw new Error('This preset preserves the instructions applied to an imported conversation. Create a new preset to customize them.')
      await write(current => current.some(item => item.id === preset.id) ? current.map(item => item.id === preset.id ? preset : item) : [...current, preset])
      return preset
    },
    async remove({ id, confirmed }: { id?: unknown; confirmed?: unknown }) {
      validateAssistantId(id)
      if (confirmed !== true) throw new Error('Confirm deletion before removing a preset.')
      if (Object.values(config.assignments ?? {}).includes(id)) throw new Error('This imported preset preserves saved conversation instructions and cannot be deleted.')
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
  if (!config.importedAssistants) {
    // Reconciliation restarts this entry. Run after activation has returned.
    const timer = setTimeout(() => {
      void (async () => {
        // Read without prepare(): importing must never seed or rewrite Jan data.
        const store = new Assistants()
        const legacy = (await store.getAssistants()).map(item => validate({ ...item, legacy: item, id: item.id.length <= 123 ? `jan-${item.id}` : `jan-${createHash('sha256').update(item.id).digest('hex')}` }))
        const assignmentFile = 'file://assistants/.session_assignments.json'
        const saved = await fs.existsSync(assignmentFile) ? JSON.parse(await fs.readFileSync(assignmentFile)) : {}
        const assignments: Record<string, string> = {}
        for (const [sessionId, value] of Object.entries(saved)) {
          const assignment = value as { assistantId?: string; instructions?: string }
          if (typeof assignment.instructions !== 'string' || typeof assignment.assistantId !== 'string') continue
          const id = `jan-applied-${createHash('sha256').update(assignment.assistantId + '\\0' + assignment.instructions).digest('hex')}`
          const source = legacy.find(item => item.id === `jan-${assignment.assistantId}`)
          if (!legacy.some(item => item.id === id)) legacy.push(validate({ id, name: `${source?.name ?? assignment.assistantId} (saved conversation)`, description: 'Imported applied instructions from a Jan conversation.', instructions: assignment.instructions }))
          assignments[sessionId] = id
        }
        await editor.edit(entry, (current: Record<string, unknown>) => ({ ...current, importedAssistants: true, assignments, presets: [...((current.presets as CustomPreset[]) ?? []), ...legacy.filter(item => !((current.presets as CustomPreset[]) ?? []).some(saved => saved.id === item.id))] }))
      })().catch(error => ctx.logger.error(`Assistant import failed: ${String(error)}`))
    }, 0)
    ctx.effect(() => () => clearTimeout(timer), 'ow-assistant: import scheduling')
  }
}
