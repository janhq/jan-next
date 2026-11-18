/**
 * Tavily search and fetch through the REST `/search` and `/extract` endpoints, authenticated with a
 * bearer API key. Tavily has no keyless mode: both providers report not ready while the key is
 * unset, and an operation without one fails naming the credential reference.
 * @module @janhq/jan-web-search/tavily
 */

import { WebError } from '@janhq/jan-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult,
  WebSearchSource,
} from '@janhq/jan-web'
import z from '@janhq/schemastery'
import { TAVILY_PROVIDER_ID } from './config.ts'
import type { TavilySpec } from './config.ts'
import type { KeyLookup } from './credentials.ts'
import { assertHttpUrl, boundPage, requestCount, snippetOf } from './shape.ts'
import { assertOk, parseJson, postJson } from './transport.ts'

const PROVIDER = 'Tavily'

/** The fields read from a `/search` reply. */
export interface TavilySearchReply {
  results: { url?: string; title?: string; content?: string; published_date?: string | null }[]
}

const TavilySearchReply: z<TavilySearchReply> = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    published_date: z.union([z.string(), z.const(null)]),
  })).default([]),
})

/** The fields read from an `/extract` reply. */
export interface TavilyExtractReply {
  results: { url?: string; raw_content?: string | null }[]
  failed_results: { url?: string; error?: string }[]
}

const TavilyExtractReply: z<TavilyExtractReply> = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.union([z.string(), z.const(null)]) })).default([]),
  failed_results: z.array(z.object({ url: z.string(), error: z.string() })).default([]),
})

/**
 * Map a `/search` reply to sources. `content` is Tavily's excerpt of the page and becomes the
 * snippet and summary. A result without a parseable URL is dropped.
 * @param reply - the validated reply.
 * @returns one source per result, in Tavily's order.
 */
export function normalizeTavilySearch(reply: TavilySearchReply): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const result of reply.results) {
    if (result.url === undefined || !URL.canParse(result.url)) continue
    const excerpt = result.content?.trim() ?? ''
    const title = result.title?.trim()
    const publishedAt = result.published_date?.trim()
    sources.push({
      url: result.url,
      ...title === undefined || title.length === 0 ? {} : { title },
      ...excerpt.length === 0 ? {} : { snippet: snippetOf(excerpt), summary: excerpt },
      ...publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Map an `/extract` reply for one URL to a fetch result.
 * @param reply - the validated reply.
 * @param requestedUrl - the URL the caller asked for.
 * @param maxCharacters - the page-text bound.
 * @returns the raw page content as a `text` body, reported with status 200.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when no content was returned, with Tavily's reason when it gave one.
 */
export function normalizeTavilyExtract(reply: TavilyExtractReply, requestedUrl: string, maxCharacters: number): WebFetchResult {
  const [first] = reply.results
  const content = first?.raw_content ?? ''
  if (content.trim().length === 0) {
    const reason = reply.failed_results.find(failure => (failure.error ?? '').length > 0)?.error
    throw new WebError(`${PROVIDER} returned no content for ${requestedUrl}${reason === undefined ? '' : `: ${reason}`}`, 'WEB_PROVIDER_ERROR')
  }
  return boundPage(first?.url !== undefined && URL.canParse(first.url) ? first.url : requestedUrl, content, maxCharacters)
}

const DESCRIPTION_SEARCH: NonNullable<WebSearchProvider['description']> = {
  en: 'Web search through Tavily. Needs a Tavily API key; queries are sent to Tavily.',
  zh: '通过 Tavily 搜索网页。需要 Tavily API 密钥；查询会发送到 Tavily。',
  ja: 'Tavily による Web 検索です。Tavily API キーが必要です。クエリは Tavily に送信されます。',
  es: 'Búsqueda web a través de Tavily. Requiere una clave de API de Tavily; las consultas se envían a Tavily.',
  fr: 'Recherche web via Tavily. Nécessite une clé d’API Tavily ; les requêtes sont envoyées à Tavily.',
  de: 'Websuche über Tavily. Benötigt einen Tavily-API-Schlüssel; Anfragen gehen an Tavily.',
  ru: 'Веб-поиск через Tavily. Нужен ключ API Tavily; запросы отправляются в Tavily.',
  pt: 'Pesquisa na web através da Tavily. Requer uma chave de API da Tavily; as consultas são enviadas à Tavily.',
}

const DESCRIPTION_FETCH: NonNullable<WebFetchProvider['description']> = {
  en: 'Reads pages through Tavily, which returns the extracted page text. Needs a Tavily API key; the URL is sent to Tavily.',
  zh: '通过 Tavily 读取页面，返回提取的正文。需要 Tavily API 密钥；URL 会发送到 Tavily。',
  ja: 'Tavily を通じてページを読み取り、抽出した本文を返します。Tavily API キーが必要です。URL は Tavily に送信されます。',
  es: 'Lee páginas a través de Tavily, que devuelve el texto extraído. Requiere una clave de API de Tavily; la URL se envía a Tavily.',
  fr: 'Lit les pages via Tavily, qui renvoie le texte extrait. Nécessite une clé d’API Tavily ; l’URL est envoyée à Tavily.',
  de: 'Liest Seiten über Tavily, das den extrahierten Seitentext liefert. Benötigt einen Tavily-API-Schlüssel; die URL geht an Tavily.',
  ru: 'Читает страницы через Tavily, который возвращает извлечённый текст. Нужен ключ API Tavily; URL отправляется в Tavily.',
  pt: 'Lê páginas através da Tavily, que devolve o texto extraído. Requer uma chave de API da Tavily; a URL é enviada à Tavily.',
}

/**
 * The key for one operation.
 * @param spec - resolved Tavily settings.
 * @param lookupKey - per-operation credential lookup.
 * @returns the key.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` naming the credential reference while it is unset.
 */
async function requireKey(spec: TavilySpec, lookupKey: KeyLookup): Promise<string> {
  const key = await lookupKey(spec.apiKeyEnv)
  if (key === undefined) throw new WebError(`${PROVIDER} requires an API key; set ${spec.apiKeyEnv} or select another provider`, 'WEB_PROVIDER_ERROR')
  return key
}

/** Tavily search provider; ready only while its API key is set. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_SEARCH

  /**
   * @param spec - resolved Tavily settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: TavilySpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async ready(): Promise<boolean> {
    return await this.lookupKey(this.spec.apiKeyEnv) !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const key = await requireKey(this.spec, this.lookupKey)
    const reply = await postJson({
      provider: PROVIDER, url: this.spec.searchUrl, headers: { authorization: `Bearer ${key}` }, timeoutMs: this.spec.timeoutMs,
      body: { query: request.query, max_results: requestCount(request.maxResults, this.spec.numResults) },
    }, signal)
    assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
    return { sources: normalizeTavilySearch(parseJson(PROVIDER, reply.body, TavilySearchReply)), truncated: false }
  }
}

/** Tavily fetch provider; ready only while its API key is set. */
export class TavilyFetchProvider implements WebFetchProvider {
  readonly id = TAVILY_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_FETCH

  /**
   * @param spec - resolved Tavily settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: TavilySpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async ready(): Promise<boolean> {
    return await this.lookupKey(this.spec.apiKeyEnv) !== undefined
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    assertHttpUrl(request.url)
    const key = await requireKey(this.spec, this.lookupKey)
    const reply = await postJson({
      provider: PROVIDER, url: this.spec.extractUrl, headers: { authorization: `Bearer ${key}` }, timeoutMs: this.spec.timeoutMs,
      body: { urls: [request.url] },
    }, signal)
    assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
    return normalizeTavilyExtract(parseJson(PROVIDER, reply.body, TavilyExtractReply), request.url, this.spec.maxCharacters)
  }
}
