/**
 * Exa search and fetch. Each operation resolves the configured API key: without one it calls
 * Exa's hosted MCP tools `web_search_exa` and `web_fetch_exa`, which need no account; with one it
 * calls the REST `/search` and `/contents` endpoints, which return structured JSON under the
 * account's rate limits.
 * @module @janhq/jan-web-search/exa
 */

import { WebError } from '@janhq/jan-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult,
  WebSearchSource,
} from '@janhq/jan-web'
import z from '@janhq/schemastery'
import { EXA_PROVIDER_ID } from './config.ts'
import type { ExaSpec } from './config.ts'
import type { KeyLookup } from './credentials.ts'
import { assertHttpUrl, boundPage, requestCount, snippetOf } from './shape.ts'
import { assertOk, callMcpTool, parseJson, postJson } from './transport.ts'

const PROVIDER = 'Exa'

/**
 * Split hosted `web_search_exa` text into sources. Results are separated by `---` lines; each
 * starts with `Title:`, `URL:`, `Published:` and `Author:` lines followed by `Highlights:` and
 * free text. A block without a parseable URL is dropped.
 * @param text - the tool's text content.
 * @returns one source per result, in Exa's order.
 */
export function parseHostedSearchText(text: string): WebSearchSource[] {
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
      ...highlights.length === 0 ? {} : { snippet: snippetOf(highlights), summary: highlights },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Remove the `# Title` / `URL:` header hosted `web_fetch_exa` puts before the page text.
 * @param text - the tool's text content for one page.
 * @returns the page text.
 */
export function stripHostedFetchHeader(text: string): string {
  return text.replace(/^# [^\n]*\n/, '').replace(/^URL: [^\n]*\n/, '').replace(/^\n+/, '')
}

/** The fields read from a REST `/search` or `/contents` reply. */
export interface ExaRestReply {
  results: { url?: string; title?: string | null; text?: string; highlights: string[]; publishedDate?: string | null }[]
  statuses: { id?: string; status?: string; error?: { tag?: string; httpStatusCode?: number | null } | null }[]
}

const nullableString = z.union([z.string(), z.const(null)])

const ExaRestReply: z<ExaRestReply> = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: nullableString,
    text: z.string(),
    highlights: z.array(z.string()).default([]),
    publishedDate: nullableString,
  })).default([]),
  statuses: z.array(z.object({
    id: z.string(),
    status: z.string(),
    error: z.union([z.object({ tag: z.string(), httpStatusCode: z.union([z.number(), z.const(null)]) }), z.const(null)]),
  })).default([]),
})

/**
 * Map a REST `/search` reply to sources. The first highlight is the snippet, falling back to the
 * start of the page text; the page text is the summary. A result without a parseable URL is dropped.
 * @param reply - the validated reply.
 * @returns one source per result, in Exa's order.
 */
export function normalizeRestSearch(reply: ExaRestReply): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const result of reply.results) {
    if (result.url === undefined || !URL.canParse(result.url)) continue
    const text = result.text?.trim() ?? ''
    const excerpt = result.highlights.find(highlight => highlight.trim().length > 0)?.trim() ?? text
    const title = result.title?.trim()
    const publishedAt = result.publishedDate?.trim()
    sources.push({
      url: result.url,
      ...title === undefined || title.length === 0 ? {} : { title },
      ...excerpt.length === 0 ? {} : { snippet: snippetOf(excerpt) },
      ...text.length === 0 ? {} : { summary: text },
      ...publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Map a REST `/contents` reply for one URL to a fetch result.
 * @param reply - the validated reply.
 * @param requestedUrl - the URL the caller asked for.
 * @param maxCharacters - the page-text bound.
 * @returns the page text as a `text` body, reported with status 200.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when Exa returned no text, naming its status tag.
 */
export function normalizeRestContents(reply: ExaRestReply, requestedUrl: string, maxCharacters: number): WebFetchResult {
  const [first] = reply.results
  const text = first?.text ?? ''
  if (first === undefined || text.trim().length === 0) {
    const failure = reply.statuses.find(status => status.status === 'error')?.error
    const reason = failure?.tag === undefined ? '' : ` (${failure.tag}${failure.httpStatusCode == null ? '' : `, HTTP ${String(failure.httpStatusCode)}`})`
    throw new WebError(`${PROVIDER} returned no content for ${requestedUrl}${reason}`, 'WEB_PROVIDER_ERROR')
  }
  return boundPage(first.url !== undefined && URL.canParse(first.url) ? first.url : requestedUrl, text, maxCharacters)
}

const DESCRIPTION_SEARCH: NonNullable<WebSearchProvider['description']> = {
  en: 'Web search through Exa. Works without a key at a limited rate; set an Exa API key for higher limits. Queries are sent to Exa.',
  zh: '通过 Exa 搜索网页。无需密钥即可使用，但有频率限制；设置 Exa API 密钥可提高限额。查询会发送到 Exa。',
  ja: 'Exa による Web 検索です。キーなしでも回数制限付きで使えます。Exa API キーを設定すると上限が上がります。クエリは Exa に送信されます。',
  es: 'Búsqueda web a través de Exa. Funciona sin clave con límite de frecuencia; configura una clave de API de Exa para límites más altos. Las consultas se envían a Exa.',
  fr: 'Recherche web via Exa. Fonctionne sans clé avec une fréquence limitée ; définissez une clé d’API Exa pour des limites plus élevées. Les requêtes sont envoyées à Exa.',
  de: 'Websuche über Exa. Funktioniert ohne Schlüssel mit Ratenbegrenzung; ein Exa-API-Schlüssel hebt die Grenzen an. Anfragen gehen an Exa.',
  ru: 'Веб-поиск через Exa. Работает без ключа с ограничением частоты; ключ API Exa повышает лимиты. Запросы отправляются в Exa.',
  pt: 'Pesquisa na web através da Exa. Funciona sem chave com limite de frequência; configure uma chave de API da Exa para limites maiores. As consultas são enviadas à Exa.',
}

const DESCRIPTION_FETCH: NonNullable<WebFetchProvider['description']> = {
  en: 'Reads pages through Exa, which returns clean page text. Works without a key at a limited rate; the URL is sent to Exa.',
  zh: '通过 Exa 读取页面，返回整理后的正文。无需密钥即可使用，但有频率限制；URL 会发送到 Exa。',
  ja: 'Exa を通じてページを読み取り、整形された本文を返します。キーなしでも回数制限付きで使えます。URL は Exa に送信されます。',
  es: 'Lee páginas a través de Exa, que devuelve el texto limpio. Funciona sin clave con límite de frecuencia; la URL se envía a Exa.',
  fr: 'Lit les pages via Exa, qui renvoie le texte nettoyé. Fonctionne sans clé avec une fréquence limitée ; l’URL est envoyée à Exa.',
  de: 'Liest Seiten über Exa, das bereinigten Seitentext liefert. Funktioniert ohne Schlüssel mit Ratenbegrenzung; die URL geht an Exa.',
  ru: 'Читает страницы через Exa, который возвращает очищенный текст. Работает без ключа с ограничением частоты; URL отправляется в Exa.',
  pt: 'Lê páginas através da Exa, que devolve o texto limpo. Funciona sem chave com limite de frequência; a URL é enviada à Exa.',
}

/** Exa search provider; keyless until an API key resolves. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_SEARCH

  /**
   * @param spec - resolved Exa settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: ExaSpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const numResults = requestCount(request.maxResults, this.spec.numResults)
    const key = await this.lookupKey(this.spec.apiKeyEnv)
    if (key === undefined) {
      const text = await callMcpTool({
        provider: PROVIDER, url: this.spec.mcpUrl, tool: 'web_search_exa', timeoutMs: this.spec.timeoutMs,
        arguments: { query: request.query, objective: request.query, numResults },
      }, signal)
      return { sources: parseHostedSearchText(text), truncated: false }
    }
    const reply = await postJson({
      provider: PROVIDER, url: this.spec.searchUrl, headers: { 'x-api-key': key }, timeoutMs: this.spec.timeoutMs,
      body: {
        query: request.query,
        type: 'auto',
        numResults,
        contents: {
          text: { maxCharacters: this.spec.searchTextCharacters },
          highlights: { numSentences: 3, highlightsPerUrl: 1 },
        },
      },
    }, signal)
    assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
    return { sources: normalizeRestSearch(parseJson(PROVIDER, reply.body, ExaRestReply)), truncated: false }
  }
}

/** Exa fetch provider; keyless until an API key resolves. */
export class ExaFetchProvider implements WebFetchProvider {
  readonly id = EXA_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_FETCH

  /**
   * @param spec - resolved Exa settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: ExaSpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    assertHttpUrl(request.url)
    const { maxCharacters } = this.spec
    const key = await this.lookupKey(this.spec.apiKeyEnv)
    if (key === undefined) {
      const text = await callMcpTool({
        provider: PROVIDER, url: this.spec.mcpUrl, tool: 'web_fetch_exa', timeoutMs: this.spec.timeoutMs,
        arguments: { urls: [request.url], maxCharacters },
      }, signal)
      const page = boundPage(request.url, stripHostedFetchHeader(text), maxCharacters)
      // Exa cuts the text at `maxCharacters` itself; a reply that reaches the limit counts as cut.
      return { ...page, truncated: page.truncated || text.length >= maxCharacters }
    }
    const reply = await postJson({
      provider: PROVIDER, url: this.spec.contentsUrl, headers: { 'x-api-key': key }, timeoutMs: this.spec.timeoutMs,
      body: { urls: [request.url], text: { maxCharacters } },
    }, signal)
    assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
    const page = normalizeRestContents(parseJson(PROVIDER, reply.body, ExaRestReply), request.url, maxCharacters)
    return { ...page, truncated: page.truncated || (page.body.content.length >= maxCharacters) }
  }
}
