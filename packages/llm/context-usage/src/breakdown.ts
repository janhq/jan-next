/**
 * Pure attribution of one request's content to `/context` categories and entries.
 * Every figure starts as the token meter's fixed-density estimate; route repricing
 * (images) and the provider anchor are applied afterwards, so the categories always
 * sum to the occupancy the composer meter shows.
 * @module @janhq/jan-context-usage/breakdown
 */
import type { ContentBlock, Message, ToolSchema } from '@janhq/jan-llm'
import { ROLE_OVERHEAD, estimateContent } from '@janhq/jan-token-meter/estimate'
import { CONTEXT_CATEGORIES, type ContextCategoryId, type ContextUsageCategory } from './types.ts'

const CHARS_PER_TOKEN = 4
const INSTRUCTIONS_FROM = /^Instructions from: (.+)$/gm
const SKILL_TOOLS = new Set(['skill', 'skill_search'])
const SECTION_SEPARATOR = '\n\n'

/** One surviving surface node with its meter prices. */
export interface PricedMessage {
  readonly message: Message
  /** Route-priced tokens of the node (images at the route's visual price). */
  readonly tokens: number
  /** Fixed-heuristic tokens of the same node. */
  readonly heuristicTokens: number
}

/** Everything one breakdown attributes. */
export interface BreakdownInput {
  readonly messages: readonly PricedMessage[]
  /** Tool schemas the request declares. */
  readonly tools: readonly ToolSchema[]
  /** MCP server per public tool name; other tools are Jan's own. */
  readonly mcpServers: ReadonlyMap<string, string>
  /** Rendered system-prompt sections, used to name parts of the logged prompt. */
  readonly sections: readonly { readonly name: string; readonly text: string }[]
  /** System prompt the next request would send when none is logged yet. */
  readonly pendingSystemPrompt?: string
}

type Tally = Map<ContextCategoryId, Map<string, number>>

function add(tally: Tally, category: ContextCategoryId, label: string, tokens: number): void {
  if (tokens <= 0) return
  let entries = tally.get(category)
  if (entries === undefined) tally.set(category, entries = new Map<string, number>())
  entries.set(label, (entries.get(label) ?? 0) + tokens)
}

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Name the parts of a system prompt by the sections it was assembled from;
 * text no current section accounts for is reported as `other`.
 */
function systemParts(text: string, sections: BreakdownInput['sections']): [string, number][] {
  const parts: [string, number][] = []
  let accounted = 0
  for (const section of sections) {
    if (section.text === '' || !text.includes(section.text)) continue
    parts.push([section.name, section.text.length])
    accounted += section.text.length
  }
  // Sections are joined with a blank line; only text no section accounts for is `other`.
  const unaccounted = text.length - accounted - SECTION_SEPARATOR.length * Math.max(0, parts.length - 1)
  if (unaccounted > 0) parts.push(['other', unaccounted])
  return parts
}

/** Split agent-instruction text into one part per file it quotes. */
function instructionParts(text: string): [string, number][] {
  const starts = [...text.matchAll(INSTRUCTIONS_FROM)]
  if (starts.length === 0) return [['instructions', text.length]]
  const parts: [string, number][] = []
  if ((starts[0]?.index ?? 0) > 0) parts.push(['notice', starts[0]?.index ?? 0])
  starts.forEach((match, index) => {
    const end = starts[index + 1]?.index ?? text.length
    parts.push([match[1] ?? 'instructions', end - match.index])
  })
  return parts
}

function blockLabel(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return 'text'
    case 'image': return 'images'
    default: return block.type
  }
}

function joinedText(message: Message): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

/** Distribute a node's tokens over weighted parts, giving route repricing to images. */
function spread(
  tally: Tally, priced: PricedMessage, parts: readonly (readonly [ContextCategoryId, string, number, boolean])[],
): void {
  const weight = parts.reduce((sum, [, , tokens]) => sum + tokens, 0)
  if (weight === 0) return
  const images = parts.filter(([, , , image]) => image).length
  const extra = images > 0 ? Math.max(0, priced.tokens - priced.heuristicTokens) : 0
  const scale = (priced.tokens - extra) / weight
  for (const [category, label, tokens, image] of parts) {
    add(tally, category, label, tokens * scale + (image ? extra / images : 0))
  }
}

function skillLabel(argumentsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed && typeof parsed.name === 'string') {
      return `skill: ${parsed.name}`
    }
  } catch { /* Partial or invalid arguments name no skill. */ }
  return 'skill'
}

/**
 * Attribute every model-visible part of one request.
 * @param input - priced surface messages, tool schemas and naming hints.
 * @returns unscaled heuristic tokens per category and entry label.
 */
export function attribute(input: BreakdownInput): Tally {
  const tally: Tally = new Map()
  const toolNames = new Map<string, string>()
  const skillCalls = new Map<string, string>()
  const lastSystem = input.messages.findLastIndex(({ message }) => message.role === 'system' && joinedText(message) !== '')
  if (lastSystem === -1 && input.pendingSystemPrompt !== undefined && input.pendingSystemPrompt !== '') {
    for (const [label, length] of systemParts(input.pendingSystemPrompt, input.sections)) add(tally, 'systemPrompt', label, length / CHARS_PER_TOKEN)
    add(tally, 'systemPrompt', 'other', ROLE_OVERHEAD)
  }
  input.messages.forEach((priced, index) => {
    const { message } = priced
    const parts: [ContextCategoryId, string, number, boolean][] = []
    const overhead = (category: ContextCategoryId, label: string): void => { parts.push([category, label, ROLE_OVERHEAD, false]) }
    if (message.role === 'system') {
      const text = joinedText(message)
      const named = index === lastSystem ? systemParts(text, input.sections) : [['earlier prompt', text.length] as [string, number]]
      for (const [name, length] of named) parts.push(['systemPrompt', name, length / CHARS_PER_TOKEN, false])
    } else if (message.role === 'assistant') {
      for (const block of message.content) {
        const tokens = estimateContent([block])
        if (block.type === 'reasoning') parts.push(['assistantThinking', 'reasoning', tokens, false])
        else if (block.type === 'tool-call') {
          toolNames.set(block.id, block.name)
          if (SKILL_TOOLS.has(block.name)) skillCalls.set(block.id, skillLabel(block.arguments))
          parts.push(['toolCalls', block.name, tokens, false])
        } else parts.push(['assistantMessages', blockLabel(block), tokens, block.type === 'image'])
      }
      overhead('assistantMessages', 'text')
    } else if (message.role === 'tool') {
      const { callId } = message.source
      const name = toolNames.get(callId) ?? 'unknown'
      const skill = skillCalls.get(callId)
      const [category, label]: [ContextCategoryId, string] = skill === undefined ? ['toolOutput', name] : ['skills', skill]
      for (const block of message.content) parts.push([category, label, estimateContent([block]), block.type === 'image'])
      overhead(category, label)
    } else {
      const { source } = message
      // Producers declare their source kinds in their own packages; this reader keeps them as plain strings.
      const kind: string = source.kind
      const named = (key: string): string | undefined => {
        const value: unknown = Reflect.get(source, key)
        return typeof value === 'string' ? value : undefined
      }
      switch (kind) {
        case 'agent-instructions':
          for (const [path, length] of instructionParts(joinedText(message))) parts.push(['instructionFiles', path, length / CHARS_PER_TOKEN, false])
          break
        case 'skill-catalog':
          parts.push(['skills', 'catalog', estimateContent(message.content), false])
          break
        case 'skill-invocation':
          parts.push(['skills', `skill: ${named('name') ?? 'unknown'}`, estimateContent(message.content), false])
          break
        case 'compact-checkpoint':
          parts.push(['compactionSummary', 'summary', estimateContent(message.content), false])
          break
        case 'user':
          for (const block of message.content) parts.push(['userMessages', blockLabel(block), estimateContent([block]), block.type === 'image'])
          break
        default: {
          const sections: unknown = named('form') === 'snapshot' ? Reflect.get(source, 'sections') : undefined
          if (Array.isArray(sections) && sections.length > 0) {
            for (const section of sections as readonly { name: string; text: string }[]) {
              parts.push(['injectedContext', section.name, section.text.length / CHARS_PER_TOKEN, false])
            }
          } else {
            for (const block of message.content) parts.push(['injectedContext', kind, estimateContent([block]), block.type === 'image'])
          }
        }
      }
      const [category, label] = parts[0] ?? ['injectedContext', kind]
      overhead(category, label)
    }
    spread(tally, priced, parts)
  })
  for (const tool of input.tools) {
    const server = input.mcpServers.get(tool.name)
    add(tally, server === undefined ? 'janTools' : 'mcpTools', server ?? tool.name, textTokens(JSON.stringify(tool)))
  }
  return tally
}

/**
 * Scale heuristic shares to the occupancy figure, keeping integer category totals that sum to it exactly.
 * @param tally - unscaled tokens from {@link attribute}.
 * @param usedTokens - occupancy to split; undefined keeps the heuristic total.
 * @returns non-empty categories in display order, and the total they sum to.
 */
export function scale(tally: Tally, usedTokens: number | undefined): { categories: ContextUsageCategory[]; usedTokens: number } {
  const raw = CONTEXT_CATEGORIES.flatMap((id) => {
    const entries = tally.get(id)
    const total = entries === undefined ? 0 : [...entries.values()].reduce((sum, tokens) => sum + tokens, 0)
    return total > 0 && entries !== undefined ? [{ id, total, entries }] : []
  })
  const estimated = raw.reduce((sum, { total }) => sum + total, 0)
  const used = usedTokens ?? Math.round(estimated)
  const factor = estimated === 0 ? 0 : used / estimated
  const exact = raw.map(({ total }) => total * factor)
  const rounded = exact.map(Math.floor)
  let remainder = used - rounded.reduce((sum, tokens) => sum + tokens, 0)
  for (const index of exact.map((_, i) => i).sort((a, b) => (exact[b] ?? 0) % 1 - (exact[a] ?? 0) % 1)) {
    if (remainder <= 0) break
    rounded[index] = (rounded[index] ?? 0) + 1
    remainder--
  }
  return {
    usedTokens: estimated === 0 ? 0 : used,
    categories: raw.map(({ id, entries }, index) => ({
      id,
      tokens: rounded[index] ?? 0,
      entries: [...entries]
        .map(([label, tokens]) => ({ label, tokens: Math.round(tokens * factor) }))
        .filter(entry => entry.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label)),
    })).filter(category => category.tokens > 0),
  }
}
