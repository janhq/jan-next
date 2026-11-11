/**
 * Search and fetch through Exa's hosted MCP endpoint, which serves `web_search_exa` and
 * `web_fetch_exa` without an API key. Each operation is one stateless JSON-RPC `tools/call` POST;
 * the reply is either a JSON body or a single-message SSE stream.
 * @module @deepseek-ai/dsh-web-search-exa/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id both providers register under, one per capability kind. */
export const EXA_PROVIDER_ID = 'exa'

/** Exa's hosted, keyless MCP endpoint. */
export const EXA_DEFAULT_URL = 'https://mcp.exa.ai/mcp'

/** Upper bound Exa's hosted search accepts for `numResults`. */
export const EXA_MAX_RESULTS = 20

/** Longest display snippet taken from a result's highlights. */
const SNIPPET_CHARS = 300

/** Options for one operation, read once at its entry. */
export interface ExaOptions {
  /** MCP endpoint receiving the JSON-RPC POST. */
  readonly url: string
  /** Results requested when the caller sets no bound. */
  readonly numResults: number
  /** Characters of page text one fetch requests. */
  readonly maxCharacters: number
  /** Milliseconds one operation may take before it fails as a timeout. */
  readonly timeoutMs: number
}

/** The `result` member of a `tools/call` reply. */
interface ToolCallResult {
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly isError?: boolean
  readonly _meta?: Readonly<Record<string, unknown>>
}

/** One JSON-RPC reply frame. */
interface RpcReply {
  readonly result?: ToolCallResult
  readonly error?: { readonly code?: number; readonly message?: string }
}

/**
 * Pull the JSON-RPC reply out of a response body, which is either the JSON object itself or an
 * SSE stream whose `data:` frames carry it.
 * @param body - the response text.
 * @returns the first frame carrying `result` or `error`.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when no frame carries either.
 */
export function parseRpcReply(body: string): RpcReply {
  const candidates = body.trimStart().startsWith('{')
    ? [body]
    : body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
  for (const candidate of candidates) {
    let parsed: unknown
    try { parsed = JSON.parse(candidate) }
    catch (_notJson) { continue /* A keep-alive or non-JSON frame carries no reply. */ }
    if (typeof parsed === 'object' && parsed !== null && ('result' in parsed || 'error' in parsed)) return parsed as RpcReply
  }
  throw new WebError('Exa returned no JSON-RPC reply', 'WEB_PROVIDER_ERROR')
}

/**
 * Split `web_search_exa` text into sources. Results are separated by `---` lines; each starts
 * with `Title:`, `URL:`, `Published:` and `Author:` lines followed by `Highlights:` and free text.
 * A block without a URL is dropped.
 * @param text - the tool's text content.
 * @returns one source per result, in Exa's order.
 */
export function parseSearchText(text: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const block of text.split(/\n---\n/)) {
    const field = (label: string): string | undefined => {
      const value = new RegExp(`^${label}:[ \\t]*(.*)$`, 'm').exec(block)?.[1]?.trim()
      return value === undefined || value.length === 0 || value === 'N/A' ? undefined : value
    }
    const url = field('URL')
    if (url === undefined || !URL.canParse(url)) continue
    const marker = /^Highlights:[ \t]*$/m.exec(block)
    const highlights = marker === null ? '' : block.slice(marker.index + marker[0].length).trim()
    const title = field('Title')
    const publishedAt = field('Published')
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...highlights.length === 0 ? {} : {
        snippet: highlights.length > SNIPPET_CHARS ? `${highlights.slice(0, SNIPPET_CHARS).trimEnd()}…` : highlights,
        summary: highlights,
      },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Remove the `# Title` / `URL:` header `web_fetch_exa` puts before the page text.
 * @param text - the tool's text content for one page.
 * @returns the page text.
 */
export function stripFetchHeader(text: string): string {
  return text.replace(/^# [^\n]*\n/, '').replace(/^URL: [^\n]*\n/, '').replace(/^\n+/, '')
}

/**
 * Call one Exa tool and return its text content.
 * @param options - the operation's options.
 * @param tool - Exa tool name.
 * @param args - the tool's arguments.
 * @param signal - caller cancellation.
 * @returns the concatenated text content of the reply.
 * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_TIMEOUT` past `timeoutMs`,
 * `WEB_PROVIDER_ERROR` for transport, HTTP, JSON-RPC, tool and rate-limit failures.
 */
export async function callExaTool(
  options: ExaOptions, tool: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted === true) throw aborted(signal)
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let body: string
  try {
    const response = await fetch(options.url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
      signal: combined,
    })
    body = await response.text()
    if (!response.ok) throw new WebError(`Exa request failed (HTTP ${String(response.status)})`, 'WEB_PROVIDER_ERROR')
  } catch (error: unknown) {
    if (signal !== undefined && isAborted(signal)) throw aborted(signal)
    if (timeout.aborted) throw new WebError(`Exa did not answer within ${String(options.timeoutMs)} ms`, 'WEB_PROVIDER_TIMEOUT', { cause: error })
    if (error instanceof WebError) throw error
    throw new WebError(`Exa request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  const reply = parseRpcReply(body)
  if (reply.error !== undefined) throw new WebError(`Exa error: ${reply.error.message ?? 'unknown'}`, 'WEB_PROVIDER_ERROR')
  const result = reply.result ?? {}
  // Exa answers a throttled call with HTTP 200 and this flag; without the check it reads as no results.
  if (result._meta?.['ai.exa/rateLimited'] === true) {
    throw new WebError('Exa rate-limited this request; wait a minute and try again', 'WEB_PROVIDER_ERROR')
  }
  const text = (result.content ?? []).map(part => (part.type === 'text' ? part.text ?? '' : '')).join('\n')
  if (result.isError === true) throw new WebError(`Exa error: ${text.length > 0 ? text : 'unknown'}`, 'WEB_PROVIDER_ERROR')
  return text
}

/** Read `signal.aborted` after an await, where control-flow narrowing from the entry check no longer holds. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function aborted(signal: AbortSignal): WebError {
  return new WebError('Exa request aborted', 'WEB_ABORTED', { cause: signal.reason })
}

const DESCRIPTION_SEARCH: NonNullable<WebSearchProvider['description']> = {
  en: 'Free web search through Exa. No account or key needed; queries are sent to Exa and are rate-limited.',
  zh: '通过 Exa 免费搜索网页，无需账号或密钥；查询会发送到 Exa，并有频率限制。',
  ja: 'Exa による無料の Web 検索です。アカウントやキーは不要です。クエリは Exa に送信され、回数制限があります。',
  es: 'Búsqueda web gratuita a través de Exa. No requiere cuenta ni clave; las consultas se envían a Exa y tienen límite de frecuencia.',
  fr: 'Recherche web gratuite via Exa. Aucun compte ni clé requis ; les requêtes sont envoyées à Exa et leur fréquence est limitée.',
  de: 'Kostenlose Websuche über Exa. Kein Konto und kein Schlüssel nötig; Anfragen gehen an Exa und sind ratenbegrenzt.',
  ru: 'Бесплатный веб-поиск через Exa. Учётная запись и ключ не нужны; запросы отправляются в Exa и ограничены по частоте.',
  pt: 'Pesquisa na web gratuita através da Exa. Não requer conta nem chave; as consultas são enviadas à Exa e têm limite de frequência.',
}

const DESCRIPTION_FETCH: NonNullable<WebFetchProvider['description']> = {
  en: 'Reads pages through Exa, which returns clean page text. No key needed; the URL is sent to Exa.',
  zh: '通过 Exa 读取页面，返回整理后的正文。无需密钥；URL 会发送到 Exa。',
  ja: 'Exa を通じてページを読み取り、整形された本文を返します。キーは不要です。URL は Exa に送信されます。',
  es: 'Lee páginas a través de Exa, que devuelve el texto limpio. No requiere clave; la URL se envía a Exa.',
  fr: 'Lit les pages via Exa, qui renvoie le texte nettoyé. Aucune clé requise ; l’URL est envoyée à Exa.',
  de: 'Liest Seiten über Exa, das bereinigten Seitentext liefert. Kein Schlüssel nötig; die URL geht an Exa.',
  ru: 'Читает страницы через Exa, который возвращает очищенный текст. Ключ не нужен; URL отправляется в Exa.',
  pt: 'Lê páginas através da Exa, que devolve o texto limpo. Não requer chave; a URL é enviada à Exa.',
}

/** Keyless Exa search provider; always ready. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID
  readonly title = 'Exa'
  readonly description = DESCRIPTION_SEARCH

  /** @param resolveOptions - options for the next operation, read once at its entry. */
  constructor(private readonly resolveOptions: () => ExaOptions) {}

  available(): boolean {
    return URL.canParse(this.resolveOptions().url)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const numResults = Math.max(1, Math.min(request.maxResults ?? options.numResults, EXA_MAX_RESULTS))
    const text = await callExaTool(options, 'web_search_exa', { query: request.query, objective: request.query, numResults }, signal)
    return { sources: parseSearchText(text), truncated: false }
  }
}

/** Keyless Exa fetch provider; always ready. */
export class ExaFetchProvider implements WebFetchProvider {
  readonly id = EXA_PROVIDER_ID
  readonly title = 'Exa'
  readonly description = DESCRIPTION_FETCH

  /** @param resolveOptions - options for the next operation, read once at its entry. */
  constructor(private readonly resolveOptions: () => ExaOptions) {}

  available(): boolean {
    return URL.canParse(this.resolveOptions().url)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (!/^https?:\/\//i.test(request.url) || !URL.canParse(request.url)) {
      throw new WebError(`Not an http(s) URL: ${request.url}`, 'WEB_INVALID_URL')
    }
    const options = this.resolveOptions()
    const text = await callExaTool(options, 'web_fetch_exa', { urls: [request.url], maxCharacters: options.maxCharacters }, signal)
    const content = stripFetchHeader(text)
    // Exa reports no HTTP status for the page it read; a returned page is reported as 200.
    return { url: request.url, statusCode: 200, body: { kind: 'text', content }, truncated: content.length >= options.maxCharacters }
  }
}
