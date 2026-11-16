import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Assistant } from '@janhq/core'
import { fs } from '../native/runtime.mjs'
import { registerApi } from '../native/api.mjs'
import { Assistants, validateAssistantId } from './store'

export const name = 'ow-assistant'
export const inject = ['owNative', 'webServer', 'connection', 'agents']

interface Assignment {
  assistantId: string
  instructions: string
}

export async function apply(ctx: Context) {
  const store = new Assistants()
  const assignmentFile = 'file://assistants/.session_assignments.json'
  const assignments: Record<string, Assignment> = Object.create(null)
  const registrations = new Map<Agent, { assignment: Assignment; dispose: () => void }>()
  let preparation: Promise<void> | undefined
  let writes = Promise.resolve()

  const prepare = () => (preparation ??= (async () => {
    await store.prepare()
    if (await fs.existsSync(assignmentFile)) {
      const saved: unknown = JSON.parse(await fs.readFileSync(assignmentFile))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        throw new Error('Saved assistant session assignments are invalid.')
      }
      for (const [sessionId, value] of Object.entries(saved)) {
        if (!value || typeof value !== 'object') continue
        const assignment = value as Assignment
        if (typeof assignment.assistantId !== 'string' || typeof assignment.instructions !== 'string') continue
        validateAssistantId(assignment.assistantId)
        assignments[sessionId] = assignment
      }
    }
    for (const agent of ctx.agents.list()) {
      const assignment = assignments[agent.id]
      if (assignment) install(agent, assignment)
    }
  })().catch((error) => {
    preparation = undefined
    throw error
  }))

  const install = (agent: Agent, assignment: Assignment) => {
    const current = registrations.get(agent)
    if (current) {
      current.assignment = assignment
      return
    }
    const entry = { assignment, dispose: () => { } }
    entry.dispose = agent.ctx.systemPrompt.section({
      name: 'open-waifu.assistant',
      order: agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      interpolate: false,
      text: () => entry.assignment.instructions.replaceAll('{{current_date}}', new Date().toISOString().slice(0, 10)),
    })
    registrations.set(agent, entry)
  }

  ctx.on('agent/created', async ({ agent }) => {
    await prepare()
    const assignment = assignments[agent.id]
    if (assignment) install(agent, assignment)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    registrations.delete(agent)
  })
  ctx.effect(() => () => {
    for (const entry of registrations.values()) entry.dispose()
    registrations.clear()
  }, 'ow-assistant: session instructions')

  const text = (value: unknown, label: string, max: number) => {
    if (typeof value !== 'string' || value.length > max) {
      throw new Error(`${label} must be text no longer than ${max} characters.`)
    }
    return value
  }
  const find = async (id: unknown) => {
    validateAssistantId(id)
    await prepare()
    const assistant = (await store.getAssistants()).find((item) => item.id === id)
    if (!assistant) throw new Error('Assistant no longer exists. Refresh the list and try again.')
    return assistant
  }
  const service = {
    async list(_params: Record<string, unknown>) {
      await prepare()
      return store.getAssistants()
    },
    async save({ assistant: input }: { assistant?: unknown }) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an assistant object.')
      const value = input as Record<string, unknown>
      validateAssistantId(value.id)
      const assistantName = text(value.name, 'Name', 200).trim()
      if (!assistantName) throw new Error('Enter a name for this assistant.')
      const description = text(value.description ?? '', 'Description', 4000)
      const instructions = text(value.instructions ?? '', 'Instructions', 262144)
      await prepare()
      const existing = (await store.getAssistants()).find((item) => item.id === value.id)
      const assistant = {
        ...existing,
        id: value.id,
        object: 'assistant',
        created_at: existing?.created_at ?? Date.now() / 1000,
        model: existing?.model ?? '*',
        name: assistantName,
        description,
        instructions,
      } as Assistant
      await store.createAssistant(assistant)
      return assistant
    },
    async remove({ id, confirmed }: { id?: unknown; confirmed?: unknown }) {
      if (confirmed !== true) throw new Error('Confirm deletion before removing an assistant.')
      const assistant = await find(id)
      await store.deleteAssistant(assistant)
      return { id: assistant.id }
    },
    /** Durable assignment for one session; null when none is stored. */
    async getAssignment({ sessionId }: { sessionId?: unknown }): Promise<{ id: string; name: string | null } | null> {
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('Select a running DSH session.')
      await prepare()
      const assignment = assignments[sessionId]
      if (!assignment) return null
      const assistant = (await store.getAssistants()).find((item) => item.id === assignment.assistantId)
      return { id: assignment.assistantId, name: assistant?.name ?? null }
    },
    async apply({ id, sessionId }: { id?: unknown; sessionId?: unknown }) {
      const assistant = await find(id)
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('Select a running DSH session.')
      const agent = ctx.agents.get(sessionId as Parameters<typeof ctx.agents.get>[0])
      if (!agent) throw new Error('This session is not loaded. Open the conversation, then try again.')
      if (agent.session.header.origin === 'subagent') throw new Error('Choose a conversation rather than a subagent session.')
      if (agent.status !== 'idle') throw new Error('Wait for the session to finish its current turn before applying an assistant.')
      const assignment = { assistantId: assistant.id, instructions: assistant.instructions ?? '' }
      // Serialize read-modify-write so a failed persistence never changes the live prompt.
      const operation = writes.then(() => agent.runMaintenance(async (signal) => {
        signal.throwIfAborted()
        if (ctx.agents.get(agent.id) !== agent) throw new Error('The selected session was closed. Open it and try again.')
        const saved = { ...assignments, [sessionId]: assignment }
        await fs.writeFileSync(assignmentFile, JSON.stringify(saved, null, 2))
        assignments[sessionId] = assignment
        install(agent, assignment)
        return { assistantId: assistant.id, sessionId }
      }))
      writes = operation.then(() => { }, () => { })
      return operation
    },
  }
  await prepare()
  ctx.provide('owAssistant', service)
  ctx.effect(() => registerApi(ctx, 'assistant', service), 'ow-assistant: API')
}
