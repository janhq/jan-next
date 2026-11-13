import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { useModelProvider } from '@/hooks/useModelProvider'
import { resolveEndpoint, type ModelSelection } from './dsh-chat-transport'
import { isLoopbackUrl, loopbackFetch } from './loopback-fetch'
import { BACKGROUND_THREAD_ID, CHAT_SLOT_ID } from '@/constants/models'

const MAX_TITLE_WORDS = 10
const MAX_PROMPT_LENGTH = 1500

function buildSummarizePrompt(transcript: string): string {
  const truncated =
    transcript.length > MAX_PROMPT_LENGTH
      ? transcript.slice(0, MAX_PROMPT_LENGTH) + '...'
      : transcript
  return `Summarize the following conversation into a concise title of at most ${MAX_TITLE_WORDS} words. Capture the overall topic, not just the latest turn. Output the title only, no quotes, no explanation.\n\nConversation:\n${truncated}`
}

/**
 * Clean a model-generated title: strip reasoning tags, special characters,
 * quotes, and enforce a word limit. Returns null if the result is unusable.
 */
export function cleanTitle(raw: string): string | null {
  let text = raw.trim()

  // Strip complete reasoning blocks like <think>...</think> (any tag name)
  text = text.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '').trim()

  // If a reasoning opener remains without a close, the output is all reasoning — unusable
  if (/<(think|thinking|reasoning|analysis)[^>]*>/i.test(text)) return null

  // If only a closing tag is present, take what's after the last one
  const lastClose = text.match(/<\/(?:think|thinking|reasoning|analysis)>\s*([\s\S]*)$/i)
  if (lastClose) {
    text = lastClose[1].trim()
  }

  // Remove leftover XML-like tags
  text = text.replace(/<[^>]+>/g, '').trim()

  // Collapse whitespace and newlines into single spaces
  text = text.replace(/\s+/g, ' ').trim()

  // Remove surrounding quotes
  text = text.replace(/^["']+|["']+$/g, '').trim()

  // Keep only letters, numbers, and spaces (unicode-aware)
  text = text.replace(/[^\p{L}\p{N}\s]/gu, '').trim()

  // Enforce word limit
  const words = text.split(/\s+/).slice(0, MAX_TITLE_WORDS)
  text = words.join(' ')

  if (!text || text.length < 2) return null

  return text
}

/**
 * Generate a summarized thread title from the user's first message.
 * Uses the given model (the thread's own, which a turn finishing in the
 * background no longer shares with the open thread), else the currently
 * selected one, via a non-streaming generateText call.
 * Returns null on failure or if the signal is aborted.
 */
export async function generateThreadTitle(
  transcript: string,
  abortSignal: AbortSignal,
  modelSelection?: ModelSelection
): Promise<string | null> {
  try {
    const selection = modelSelection ?? useModelProvider.getState()
    if (!selection.selectedModel || !selection.selectedProvider) return null
    const endpoint = await resolveEndpoint(selection, BACKGROUND_THREAD_ID)
    const body: Record<string, unknown> = {
      model: endpoint.model,
      messages: [{ role: 'user', content: buildSummarizePrompt(transcript) }],
      max_tokens: 128,
      stream: false,
    }
    // Slot 0 like every other surface, but under its own thread identity: the
    // engine parks the chat's KV prefix before this call takes the slot and
    // restores it on the next chat turn.
    if (selection.selectedProvider === 'llamacpp') {
      body.chat_template_kwargs = { enable_thinking: false }
      body.id_slot = CHAT_SLOT_ID
      body.thread_id = BACKGROUND_THREAD_ID
    }
    const send = isLoopbackUrl(endpoint.baseUrl) ? loopbackFetch : httpFetch
    const res = await send(`${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return cleanTitle(json.choices?.[0]?.message?.content ?? '')
  } catch (error) {
    // Expected when the user sends a new message mid-summary.
    if ((error as Error).name === 'AbortError') return null
    console.error('[ThreadTitle] Failed to generate title:', error)
    return null
  }
}
