/**
 * You.com search and fetch. Each operation resolves the configured API key: without one, search
 * calls the hosted MCP tool `you-search` and fetch calls the keyless `/v1/extract` endpoint; with
 * one, both call the REST `/v1/search` and `/v1/contents` endpoints. Both search transports return
 * the same JSON, so one normalizer reads both.
 * @module @janhq/jan-web-search/you
 */

import { createRequire } from 'node:module'
import { WebError } from '@janhq/jan-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult,
  WebSearchSource,
} from '@janhq/jan-web'
import z from '@janhq/schemastery'
import { YOU_PROVIDER_ID } from './config.ts'
import type { YouSpec } from './config.ts'
import type { KeyLookup } from './credentials.ts'
import { assertHttpUrl, boundPage, excerptSource, requestCount } from './shape.ts'
import { assertOk, callMcpTool, clipChars, parseJson, postJson } from './transport.ts'
import type { HttpReply } from './transport.ts'

const PROVIDER = 'You.com'

/**
 * The `x-client-info` attribution You.com integrations send:
 * `plugin; client=<name>/<version>; ua=<runtime>/<version>`.
 */
export const YOU_CLIENT_INFO = `plugin; client=jan-web-search/${ownVersion()}; ua=node/${process.versions.node}`

function ownVersion(): string {
  const manifest: unknown = createRequire(import.meta.url)('../package.json')
  /* v8 ignore next 3 -- the package's own manifest always carries a version. */
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('web-search: package.json has no version')
  }
  return manifest.version
}

/** The fields read from a search reply of either transport. */
export interface YouSearchReply {
  results: {
    web: { url?: string; title?: string; description?: string; snippets: string[]; page_age?: string | null }[]
  }
}

/** The fields read from one page of a keyed `/v1/contents` reply. */
export interface YouPage {
  url?: string
  markdown?: string | null
}

/** The fields read from a keyless `/v1/extract` reply. */
export interface YouExtractReply {
  url?: string
  contents: { full_page: { markdown?: string | null } }
}

interface YouErrorReply {
  error?: string
  message?: string
}

const YouSearchReply: z<YouSearchReply> = z.object({
  results: z.object({
    web: z.array(z.object({
      url: z.string(),
      title: z.string(),
      description: z.string(),
      snippets: z.array(z.string()).default([]),
      page_age: z.union([z.string(), z.const(null)]),
    })).default([]),
  }),
})

const YouContentsReply: z<YouPage[]> = z.array(z.object({
  url: z.string(),
  markdown: z.union([z.string(), z.const(null)]),
}))

const YouExtractReply: z<YouExtractReply> = z.object({
  url: z.string(),
  contents: z.object({ full_page: z.object({ markdown: z.union([z.string(), z.const(null)]) }) }),
})

const YouErrorReply: z<YouErrorReply> = z.object({ error: z.string(), message: z.string() })

/**
 * Map a search reply to sources. Only the `web` section maps to search sources; a reply without
 * one (news-only, or empty) yields none. `description` is the snippet and summary; keyword
 * `snippets` stand in when a result has no description. A result without a parseable URL is dropped.
 * @param reply - the validated reply.
 * @returns one source per web result, in You.com's order.
 */
export function normalizeSearch(reply: YouSearchReply): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const hit of reply.results.web) {
    if (hit.url === undefined || !URL.canParse(hit.url)) continue
    const description = hit.description?.trim() ?? ''
    const excerpt = description.length > 0 ? description : hit.snippets.map(snippet => snippet.trim()).filter(Boolean).join(' ')
    sources.push(excerptSource(hit.url, hit.title, excerpt, hit.page_age))
  }
  return sources
}

/**
 * Pick the page URL a reply reported, falling back to the requested URL.
 * @param reported - the URL in the reply, when present.
 * @param requested - the URL the caller asked for.
 * @returns a parseable URL.
 */
function pageUrl(reported: string | undefined, requested: string): string {
  return reported !== undefined && URL.canParse(reported) ? reported : requested
}

/**
 * Map a keyed `/v1/contents` reply for one URL to a fetch result. A null or empty `markdown` is
 * how You.com reports a failed extraction.
 * @param reply - the validated reply.
 * @param requestedUrl - the URL the caller asked for.
 * @param maxCharacters - the page-text bound.
 * @returns the markdown as a `text` body, reported with status 200.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when no markdown was returned.
 */
export function normalizeContents(reply: YouPage[], requestedUrl: string, maxCharacters: number): WebFetchResult {
  const [first] = reply
  const markdown = first?.markdown ?? ''
  if (markdown.trim().length === 0) throw new WebError(`${PROVIDER} returned no content for ${requestedUrl}`, 'WEB_PROVIDER_ERROR')
  return boundPage(pageUrl(first?.url, requestedUrl), markdown, maxCharacters)
}

/**
 * Map a keyless `/v1/extract` reply to a fetch result. A missing or empty `markdown` is also how a
 * skipped PDF comes back.
 * @param reply - the validated reply.
 * @param requestedUrl - the URL the caller asked for.
 * @param maxCharacters - the page-text bound.
 * @returns the markdown as a `text` body, reported with status 200.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when no markdown was returned.
 */
export function normalizeExtract(reply: YouExtractReply, requestedUrl: string, maxCharacters: number): WebFetchResult {
  const markdown = reply.contents.full_page.markdown ?? ''
  if (markdown.trim().length === 0) throw new WebError(`${PROVIDER} returned no content for ${requestedUrl}`, 'WEB_PROVIDER_ERROR')
  return boundPage(pageUrl(reply.url, requestedUrl), markdown, maxCharacters)
}

/**
 * Fail a refused keyless extraction with the server's reason and the next step.
 * @param reply - the completed exchange.
 * @param credential - the credential reference that would lift the free tier's limits.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` unless the status is 2xx.
 */
export function assertExtractOk(reply: HttpReply, credential: string): void {
  if (reply.status === 402 || reply.status === 422) {
    let detail: YouErrorReply = {}
    try { detail = parseJson(PROVIDER, reply.body, YouErrorReply) }
    catch (_unreadable) { /* The status alone still names the refusal. */ }
    const message = clipChars(detail.message?.trim() ?? '', 400)
    if (reply.status === 422 && detail.error === 'pdf_not_supported') {
      throw new WebError(`${PROVIDER} cannot extract PDFs without an API key; set ${credential} or select another fetch provider`, 'WEB_PROVIDER_ERROR')
    }
    if (reply.status === 402) {
      const reason = message.length > 0 ? message : 'the free extraction allowance is used up'
      throw new WebError(`${PROVIDER} refused the keyless extraction: ${reason}; set ${credential} or select another fetch provider`, 'WEB_PROVIDER_ERROR')
    }
  }
  assertOk(PROVIDER, reply)
}

const DESCRIPTION_SEARCH: NonNullable<WebSearchProvider['description']> = {
  en: 'Web search through You.com. Works without a key on the free tier; set a You.com API key for higher limits. Queries are sent to You.com.',
  zh: '通过 You.com 搜索网页。无需密钥即可使用免费额度；设置 You.com API 密钥可提高限额。查询会发送到 You.com。',
  ja: 'You.com による Web 検索です。キーなしでも無料枠で使えます。You.com API キーを設定すると上限が上がります。クエリは You.com に送信されます。',
  es: 'Búsqueda web a través de You.com. Funciona sin clave en el nivel gratuito; configura una clave de API de You.com para límites más altos. Las consultas se envían a You.com.',
  fr: 'Recherche web via You.com. Fonctionne sans clé avec l’offre gratuite ; définissez une clé d’API You.com pour des limites plus élevées. Les requêtes sont envoyées à You.com.',
  de: 'Websuche über You.com. Funktioniert ohne Schlüssel im kostenlosen Kontingent; ein You.com-API-Schlüssel hebt die Grenzen an. Anfragen gehen an You.com.',
  ru: 'Веб-поиск через You.com. Работает без ключа на бесплатном тарифе; ключ API You.com повышает лимиты. Запросы отправляются в You.com.',
  pt: 'Pesquisa na web através da You.com. Funciona sem chave no plano gratuito; configure uma chave de API da You.com para limites maiores. As consultas são enviadas à You.com.',
}

const DESCRIPTION_FETCH: NonNullable<WebFetchProvider['description']> = {
  en: 'Reads pages through You.com, which returns page text as Markdown. Works without a key on the free tier, except PDFs; the URL is sent to You.com.',
  zh: '通过 You.com 读取页面，以 Markdown 返回正文。无需密钥即可使用免费额度（PDF 除外）；URL 会发送到 You.com。',
  ja: 'You.com を通じてページを読み取り、本文を Markdown で返します。PDF を除き、キーなしでも無料枠で使えます。URL は You.com に送信されます。',
  es: 'Lee páginas a través de You.com, que devuelve el texto en Markdown. Funciona sin clave en el nivel gratuito, salvo los PDF; la URL se envía a You.com.',
  fr: 'Lit les pages via You.com, qui renvoie le texte en Markdown. Fonctionne sans clé avec l’offre gratuite, sauf pour les PDF ; l’URL est envoyée à You.com.',
  de: 'Liest Seiten über You.com, das den Seitentext als Markdown liefert. Funktioniert ohne Schlüssel im kostenlosen Kontingent, außer bei PDFs; die URL geht an You.com.',
  ru: 'Читает страницы через You.com, который возвращает текст в Markdown. Работает без ключа на бесплатном тарифе, кроме PDF; URL отправляется в You.com.',
  pt: 'Lê páginas através da You.com, que devolve o texto em Markdown. Funciona sem chave no plano gratuito, exceto PDFs; a URL é enviada à You.com.',
}

/**
 * Attribution headers sent on every You.com request.
 * @param spec - resolved You.com settings.
 * @returns the `user-agent` and `x-client-info` headers.
 */
function attribution(spec: YouSpec): Record<string, string> {
  return { 'user-agent': spec.userAgent, 'x-client-info': YOU_CLIENT_INFO }
}

/** You.com search provider; keyless until an API key resolves. */
export class YouSearchProvider implements WebSearchProvider {
  readonly id = YOU_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_SEARCH

  /**
   * @param spec - resolved You.com settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: YouSpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const args = { query: request.query, count: requestCount(request.maxResults, this.spec.numResults) }
    const key = await this.lookupKey(this.spec.apiKeyEnv)
    let body: string
    if (key === undefined) {
      body = await callMcpTool({
        provider: PROVIDER, url: this.spec.mcpUrl, tool: 'you-search', arguments: args,
        headers: attribution(this.spec), timeoutMs: this.spec.timeoutMs,
      }, signal)
    } else {
      const reply = await postJson({
        provider: PROVIDER, url: this.spec.searchUrl, body: args,
        headers: { ...attribution(this.spec), 'x-api-key': key }, timeoutMs: this.spec.timeoutMs,
      }, signal)
      assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
      body = reply.body
    }
    return { sources: normalizeSearch(parseJson(PROVIDER, body, YouSearchReply)), truncated: false }
  }
}

/** You.com fetch provider; keyless until an API key resolves. */
export class YouFetchProvider implements WebFetchProvider {
  readonly id = YOU_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_FETCH

  /**
   * @param spec - resolved You.com settings.
   * @param lookupKey - per-operation credential lookup.
   */
  constructor(private readonly spec: YouSpec, private readonly lookupKey: KeyLookup) {}

  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    assertHttpUrl(request.url)
    const key = await this.lookupKey(this.spec.apiKeyEnv)
    if (key === undefined) {
      const reply = await postJson({
        provider: PROVIDER, url: this.spec.extractUrl, body: { url: request.url },
        headers: attribution(this.spec), timeoutMs: this.spec.timeoutMs,
      }, signal)
      assertExtractOk(reply, this.spec.apiKeyEnv)
      return normalizeExtract(parseJson(PROVIDER, reply.body, YouExtractReply), request.url, this.spec.maxCharacters)
    }
    const reply = await postJson({
      provider: PROVIDER, url: this.spec.contentsUrl, body: { urls: [request.url], formats: ['markdown'] },
      headers: { ...attribution(this.spec), 'x-api-key': key }, timeoutMs: this.spec.timeoutMs,
    }, signal)
    assertOk(PROVIDER, reply, this.spec.apiKeyEnv)
    return normalizeContents(parseJson(PROVIDER, reply.body, YouContentsReply), request.url, this.spec.maxCharacters)
  }
}
