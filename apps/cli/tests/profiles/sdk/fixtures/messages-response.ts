/** Frame one text or tool response from the local Messages endpoint. */
export function messagesResponse(content: Record<string, unknown>, stopReason: 'end_turn' | 'max_tokens' | 'tool_use'): string {
  // Tool input streams as JSON deltas, as the Messages API sends it.
  const { input, ...block } = content
  const isTool = content.type === 'tool_use'
  return [
    { type: 'message_start', message: { id: 'sdk-smoke-response', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: isTool ? { ...block, input: {} } : content },
    ...isTool ? [{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input ?? {}) } }] : [],
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

/** One `tool_result` block of a captured Messages request. */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  is_error?: boolean
  content?: string | { type: string; text?: string }[]
}

/**
 * Find a tool result in captured request messages.
 * @param messages - `messages` of one captured Messages request body.
 * @param id - tool call id the result answers.
 * @returns the result block, or undefined when the request carries none.
 */
export function findToolResult(messages: unknown, id: string): ToolResultBlock | undefined {
  return toolResults(messages).find(block => block.tool_use_id === id)
}

/**
 * Find the last tool result in captured request messages.
 * @param messages - `messages` of one captured Messages request body.
 * @returns the last result block, or undefined when the request carries none.
 */
export function lastToolResult(messages: unknown): ToolResultBlock | undefined {
  return toolResults(messages).at(-1)
}

function toolResults(messages: unknown): ToolResultBlock[] {
  if (!Array.isArray(messages)) return []
  return (messages as { content?: unknown }[]).flatMap(message => Array.isArray(message.content)
    ? (message.content as { type?: unknown }[]).filter((block): block is ToolResultBlock => block.type === 'tool_result')
    : [])
}

/**
 * Read a tool result's text whether the adapter sent a string or text blocks.
 * @param result - tool result block, or undefined.
 * @returns the concatenated text, or undefined without text content.
 */
export function toolResultText(result: ToolResultBlock | undefined): string | undefined {
  const content = result?.content
  if (typeof content === 'string') return content
  const texts = content?.filter(block => block.type === 'text').map(block => block.text ?? '')
  return texts === undefined || texts.length === 0 ? undefined : texts.join('')
}
