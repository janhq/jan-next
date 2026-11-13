import type { UIMessage } from '@ai-sdk/react'

/**
 * Approximate token count using a character-based heuristic. DSH owns the
 * real context window and compaction; this only sizes what the UI shows.
 */
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function messageToText(message: UIMessage): string {
  const parts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') parts.push(part.text)
    else if (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
      parts.push(JSON.stringify(part))
  }
  return parts.join('\n')
}

/** Tokens a whole conversation already occupies in the context window. */
export function estimateConversationTokens(
  messages: readonly UIMessage[] | undefined
): number {
  return (messages ?? []).reduce(
    // A small overhead per message for role/formatting tokens.
    (sum, message) => sum + estimateTokens(messageToText(message)) + 4,
    0
  )
}
