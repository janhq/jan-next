/**
 * Splits a failed reply's error text into what a person should read first.
 * Providers answer with `503: {"error":{"message":"..."}}` or similar; the
 * message is the useful part, the status is a badge, and the rest is detail.
 */
export type ProviderError = {
  /** HTTP status when the text leads with one. */
  status?: number
  /** One readable line. */
  summary: string
  /** The original text, when the summary dropped something from it. */
  raw?: string
}

const pickMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  return pickMessage(v.message) ?? pickMessage(v.error) ?? pickMessage(v.detail)
}

export function parseProviderError(text: string): ProviderError {
  const trimmed = text.trim()
  const match = /^(?:HTTP\s*)?(\d{3})\s*[:-]\s*([\s\S]*)$/i.exec(trimmed)
  const status = match ? Number(match[1]) : undefined
  const rest = match ? match[2].trim() : trimmed
  let message: string | undefined
  const jsonStart = rest.indexOf('{')
  if (jsonStart !== -1) {
    try {
      message = pickMessage(JSON.parse(rest.slice(jsonStart)))
    } catch {
      // Not JSON after all; the text itself is the message.
    }
  }
  const summary = (message ?? rest).replace(/\s+/g, ' ').trim() || trimmed
  return { status, summary, raw: summary === trimmed ? undefined : trimmed }
}
