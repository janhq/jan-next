/**
 * Tokamak search and fetch through the REST `/web_search` and `/web_fetch` endpoints, authenticated
 * with the API key of the signed-in Tokamak account. The account releases the key only for URLs on
 * the deployment that issued it, so both providers are available only while the account is signed
 * in to the deployment `tokamak.apiUrl` names. A rejected key is reported back to the account, which
 * signs out.
 * @module @janhq/jan-web-search/tokamak
 */

import type { TokamakAccount } from '@janhq/jan-tokamak-account'
import { WebError } from '@janhq/jan-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult,
  WebSearchSource,
} from '@janhq/jan-web'
import z from '@janhq/schemastery'
import { TOKAMAK_PROVIDER_ID } from './config.ts'
import type { TokamakSpec } from './config.ts'
import { assertHttpUrl, boundPage, requestCount, snippetOf } from './shape.ts'
import { clipChars, parseJson, postJson } from './transport.ts'
import type { HttpReply } from './transport.ts'

const PROVIDER = 'Tokamak'

/** Longest Tokamak error message quoted in a {@link WebError}. */
const ERROR_EXCERPT_CHARS = 400

/** The account operations the Tokamak backend uses. */
export type TokamakSignIn = Pick<TokamakAccount, 'watch' | 'resolveToken' | 'rejectToken'>

/** The fields read from a `/web_search` reply. */
export interface TokamakSearchReply {
  results: { url?: string; title?: string | null; snippet?: string | null; content?: string | null; published_at?: string | null }[]
}

const nullableString = z.union([z.string(), z.const(null)])

const TokamakSearchReply: z<TokamakSearchReply> = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: nullableString,
    snippet: nullableString,
    content: nullableString,
    published_at: nullableString,
  })).default([]),
})

/** The fields read from a `/web_fetch` reply. */
export interface TokamakFetchReply {
  url?: string | null
  content: string
  truncated: boolean
}

const TokamakFetchReply: z<TokamakFetchReply> = z.object({
  url: nullableString,
  content: z.string().required(),
  truncated: z.boolean().default(false),
})

/** The fields read from an error reply: `{ error: string }` or `{ error: { code, message } }`. */
interface TokamakErrorReply {
  error?: string | { code?: string; message?: string }
  code?: string
  message?: string
}

const TokamakErrorReply: z<TokamakErrorReply> = z.object({
  error: z.union([z.string(), z.object({ code: z.string(), message: z.string() })]),
  code: z.string(),
  message: z.string(),
})

/**
 * Map a `/web_search` reply to sources. `content`, when the deployment returns it, is the summary;
 * otherwise the snippet is both snippet and summary. A result without a parseable URL is dropped.
 * @param reply - the validated reply.
 * @returns one source per result, in Tokamak's order.
 */
export function normalizeTokamakSearch(reply: TokamakSearchReply): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const result of reply.results) {
    if (result.url === undefined || !URL.canParse(result.url)) continue
    const snippet = result.snippet?.trim() ?? ''
    const summary = result.content?.trim() || snippet
    const title = result.title?.trim()
    const publishedAt = result.published_at?.trim()
    sources.push({
      url: result.url,
      ...title === undefined || title.length === 0 ? {} : { title },
      ...snippet.length === 0 && summary.length === 0 ? {} : { snippet: snippetOf(snippet || summary) },
      ...summary.length === 0 ? {} : { summary },
      ...publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Map a `/web_fetch` reply to a fetch result.
 * @param reply - the validated reply.
 * @param requestedUrl - the URL the caller asked for.
 * @param maxCharacters - the page-text bound.
 * @returns the page text as a `text` body, reported with status 200, flagged truncated when
 *   Tokamak or the bound cut it.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when Tokamak returned no text.
 */
export function normalizeTokamakFetch(reply: TokamakFetchReply, requestedUrl: string, maxCharacters: number): WebFetchResult {
  if (reply.content.trim().length === 0) throw new WebError(`${PROVIDER} returned no content for ${requestedUrl}`, 'WEB_PROVIDER_ERROR')
  const url = reply.url !== undefined && reply.url !== null && URL.canParse(reply.url) ? reply.url : requestedUrl
  const page = boundPage(url, reply.content, maxCharacters)
  return { ...page, truncated: page.truncated || reply.truncated }
}

/**
 * The error code and message of a non-2xx reply.
 * @param body - the reply text.
 * @returns the code and message, each empty when the reply carries none.
 */
function errorDetail(body: string): { code: string; message: string } {
  let reply: TokamakErrorReply
  try { reply = parseJson(PROVIDER, body, TokamakErrorReply) }
  catch (_unreadable) { return { code: '', message: clipChars(body.trim(), ERROR_EXCERPT_CHARS) } /* A gateway page is not JSON. */ }
  const nested = typeof reply.error === 'object' ? reply.error : undefined
  const code = nested?.code ?? reply.code ?? ''
  const message = nested?.message ?? (typeof reply.error === 'string' ? reply.error : undefined) ?? reply.message ?? ''
  return { code, message: clipChars(message.trim(), ERROR_EXCERPT_CHARS) }
}

/**
 * The failure for a non-2xx reply other than 401, naming the next step.
 * @param operation - `web search` or `web fetch`, for the message.
 * @param reply - the completed exchange.
 * @returns `WEB_BLOCKED_URL` for a URL the deployment refuses to fetch, else `WEB_PROVIDER_ERROR`.
 */
function replyError(operation: string, reply: HttpReply): WebError {
  const { code, message } = errorDetail(reply.body)
  const status = `HTTP ${String(reply.status)}${code.length === 0 ? '' : ` ${code}`}`
  const detail = message.length === 0 ? '' : `: ${message}`
  if (code === 'url_not_allowed') {
    return new WebError(`${PROVIDER} refused to fetch this URL (${status}); only public http(s) URLs can be fetched${detail}`, 'WEB_BLOCKED_URL')
  }
  const next = ((): string => {
    switch (reply.status) {
      case 402: return '; the Tokamak organization cannot pay for this call, so add credit or select another provider'
      case 429: return '; wait a minute and try again'
      case 502: return '; the upstream provider failed, so try again or select another provider'
      case 503: return '; this deployment offers no provider for it, so select another provider'
      default: return ''
    }
  })()
  return new WebError(`${PROVIDER} ${operation} failed (${status})${detail}${next}`, 'WEB_PROVIDER_ERROR')
}

const DESCRIPTION_SEARCH: NonNullable<WebSearchProvider['description']> = {
  en: 'Web search through Tokamak, billed to the signed-in Tokamak account. Available only while signed in; queries are sent to Tokamak and its search provider.',
  zh: '通过 Tokamak 搜索网页，费用计入已登录的 Tokamak 账户。仅在登录后可用；查询会发送到 Tokamak 及其搜索服务商。',
  ja: 'Tokamak による Web 検索です。料金はサインイン中の Tokamak アカウントに請求されます。サインイン中のみ使えます。クエリは Tokamak とその検索プロバイダーに送信されます。',
  es: 'Búsqueda web a través de Tokamak, facturada a la cuenta de Tokamak con la sesión iniciada. Solo disponible con la sesión iniciada; las consultas se envían a Tokamak y a su proveedor de búsqueda.',
  fr: 'Recherche web via Tokamak, facturée au compte Tokamak connecté. Disponible uniquement une fois connecté ; les requêtes sont envoyées à Tokamak et à son fournisseur de recherche.',
  de: 'Websuche über Tokamak, abgerechnet über das angemeldete Tokamak-Konto. Nur bei Anmeldung verfügbar; Anfragen gehen an Tokamak und dessen Suchanbieter.',
  ru: 'Веб-поиск через Tokamak с оплатой с аккаунта Tokamak, в который выполнен вход. Доступен только после входа; запросы отправляются в Tokamak и его поисковому провайдеру.',
  pt: 'Pesquisa na web através da Tokamak, cobrada à conta Tokamak com sessão iniciada. Disponível apenas com sessão iniciada; as consultas são enviadas à Tokamak e ao seu fornecedor de pesquisa.',
}

const DESCRIPTION_FETCH: NonNullable<WebFetchProvider['description']> = {
  en: 'Reads pages through Tokamak, billed to the signed-in Tokamak account. Available only while signed in; the URL is sent to Tokamak and its fetch provider.',
  zh: '通过 Tokamak 读取页面，费用计入已登录的 Tokamak 账户。仅在登录后可用；URL 会发送到 Tokamak 及其抓取服务商。',
  ja: 'Tokamak を通じてページを読み取ります。料金はサインイン中の Tokamak アカウントに請求されます。サインイン中のみ使えます。URL は Tokamak とその取得プロバイダーに送信されます。',
  es: 'Lee páginas a través de Tokamak, facturado a la cuenta de Tokamak con la sesión iniciada. Solo disponible con la sesión iniciada; la URL se envía a Tokamak y a su proveedor de lectura.',
  fr: 'Lit les pages via Tokamak, facturé au compte Tokamak connecté. Disponible uniquement une fois connecté ; l’URL est envoyée à Tokamak et à son fournisseur de lecture.',
  de: 'Liest Seiten über Tokamak, abgerechnet über das angemeldete Tokamak-Konto. Nur bei Anmeldung verfügbar; die URL geht an Tokamak und dessen Abrufanbieter.',
  ru: 'Читает страницы через Tokamak с оплатой с аккаунта Tokamak, в который выполнен вход. Доступно только после входа; URL отправляется в Tokamak и его провайдеру загрузки.',
  pt: 'Lê páginas através da Tokamak, cobrado à conta Tokamak com sessão iniciada. Disponível apenas com sessão iniciada; a URL é enviada à Tokamak e ao seu fornecedor de leitura.',
}

/**
 * The signed-in state both Tokamak providers share. `available()` must answer synchronously, so
 * {@link TokamakSession.follow} keeps a cached answer current from the account's state stream.
 */
export class TokamakSession {
  private signedIn = false

  /**
   * @param account - the signed-in account.
   * @param spec - resolved Tokamak settings; `searchUrl` is the URL the account must release a key for.
   */
  constructor(private readonly account: TokamakSignIn, private readonly spec: TokamakSpec) {}

  /** Whether the account last held a key for this deployment; false until the first state arrives. */
  available(): boolean {
    return this.signedIn
  }

  /**
   * Refresh the cached answer on each account state until `signal` aborts. A failure to read the
   * account leaves the providers unavailable.
   * @param signal - the owning effect's lifetime.
   * @returns once the state stream ends.
   * @throws whatever the account's state stream throws; the cached answer is false by then.
   */
  async follow(signal: AbortSignal): Promise<void> {
    try {
      for await (const view of this.account.watch(signal)) {
        this.signedIn = view.status === 'credential-stored' && await this.ready(this.spec.searchUrl)
      }
    } finally {
      this.signedIn = false
    }
  }

  /**
   * Whether the account releases a key for `url`. Makes no network calls.
   * @param url - the endpoint about to be called.
   * @returns true while a key for that deployment is stored.
   */
  async ready(url: string): Promise<boolean> {
    return await this.account.resolveToken(url) !== undefined
  }

  /**
   * Send one authenticated request and validate its reply.
   * @param operation - `web search` or `web fetch`, for messages.
   * @param url - the endpoint.
   * @param body - the JSON request body; Tokamak rejects unknown fields.
   * @param signal - caller cancellation.
   * @returns the 2xx reply.
   * @throws {@link WebError} `WEB_PROVIDER_ERROR` while signed out, and after a rejected key, which
   *   the account then removes; otherwise as {@link replyError} and {@link postJson} describe.
   */
  async post(operation: string, url: string, body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<HttpReply> {
    const token = await this.account.resolveToken(url)
    if (token === undefined) {
      throw new WebError(`${PROVIDER} ${operation} needs a signed-in Tokamak account; sign in or select another provider`, 'WEB_PROVIDER_ERROR')
    }
    const reply = await postJson({
      provider: PROVIDER, url, headers: { authorization: `Bearer ${token}` }, timeoutMs: this.spec.timeoutMs, body,
    }, signal)
    if (reply.status >= 200 && reply.status < 300) return reply
    if (reply.status === 401) {
      await this.account.rejectToken(token)
      throw new WebError(`${PROVIDER} rejected the signed-in account's API key (HTTP 401); sign in to Tokamak again`, 'WEB_PROVIDER_ERROR')
    }
    throw replyError(operation, reply)
  }
}

/** Tokamak search provider; available only while the account is signed in to this deployment. */
export class TokamakSearchProvider implements WebSearchProvider {
  readonly id = TOKAMAK_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_SEARCH

  /**
   * @param spec - resolved Tokamak settings.
   * @param session - the shared signed-in state.
   */
  constructor(private readonly spec: TokamakSpec, private readonly session: TokamakSession) {}

  available(): boolean {
    return this.session.available()
  }

  async ready(): Promise<boolean> {
    return await this.session.ready(this.spec.searchUrl)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const maxResults = Math.min(requestCount(request.maxResults, this.spec.numResults), this.spec.maxResults)
    const reply = await this.session.post('web search', this.spec.searchUrl, { query: request.query, max_results: maxResults }, signal)
    return { sources: normalizeTokamakSearch(parseJson(PROVIDER, reply.body, TokamakSearchReply)), truncated: false }
  }
}

/** Tokamak fetch provider; available only while the account is signed in to this deployment. */
export class TokamakFetchProvider implements WebFetchProvider {
  readonly id = TOKAMAK_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION_FETCH

  /**
   * @param spec - resolved Tokamak settings.
   * @param session - the shared signed-in state.
   */
  constructor(private readonly spec: TokamakSpec, private readonly session: TokamakSession) {}

  available(): boolean {
    return this.session.available()
  }

  async ready(): Promise<boolean> {
    return await this.session.ready(this.spec.fetchUrl)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    assertHttpUrl(request.url)
    const { maxCharacters } = this.spec
    const reply = await this.session.post('web fetch', this.spec.fetchUrl, { url: request.url, max_characters: maxCharacters }, signal)
    return normalizeTokamakFetch(parseJson(PROVIDER, reply.body, TokamakFetchReply), request.url, maxCharacters)
  }
}
