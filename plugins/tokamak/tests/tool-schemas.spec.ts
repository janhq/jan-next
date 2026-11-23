import { describe, expect, it } from 'vitest'
import { apply } from '../index.mjs'

/** Collect the tools the plugin registers, with a Context that answers only what registration reads. */
function registeredTools(): { name: string, parameters: Record<string, unknown> }[] {
  const tools: { name: string, parameters: Record<string, unknown> }[] = []
  const ctx = {
    effect(body: () => Generator<unknown>) { for (const _ of body()); },
    tools: { register(tool: { name: string, parameters: Record<string, unknown> }) { tools.push(tool); return () => { } } },
    inject() { },
    credentials: { resolve: async () => undefined },
    logger: { warn() { }, info() { } },
  }
  apply(ctx as never, { speechProvider: false })
  return tools
}

describe('Tokamak tool schemas', () => {
  it('give every tool an object-rooted JSON Schema that model providers accept', () => {
    const tools = registeredTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(['classify', 'edit_image', 'generate_image', 'text_to_speech', 'transcribe_audio'])
    for (const tool of tools) {
      // Anthropic's Messages API refuses a tool whose input_schema has no `type: "object"` root.
      expect(tool.parameters.type, tool.name).toBe('object')
      expect(Array.isArray(tool.parameters.required), tool.name).toBe(true)
      for (const [name, schema] of Object.entries(tool.parameters.properties as Record<string, Record<string, unknown>>)) {
        expect(Object.hasOwn(schema, 'required'), `${tool.name}.${name}`).toBe(false)
        expect(Object.hasOwn(schema, 'type') || Object.hasOwn(schema, 'oneOf'), `${tool.name}.${name}`).toBe(true)
      }
    }
    const transcribe = tools.find(tool => tool.name === 'transcribe_audio')
    expect(transcribe?.parameters.required).toEqual(['path'])
  })
})
