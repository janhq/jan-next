/**
 * Search through a self-hosted SearXNG instance's JSON API, which needs no key. SearXNG has no
 * content-extraction endpoint, so this backend registers no fetch provider; the anonymous `http`
 * fetch provider of `jan-web-fetch-http` reads pages directly.
 * @module @janhq/jan-web-search/searxng
 */

import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@janhq/jan-web'
import z from '@janhq/schemastery'
import { SEARXNG_PROVIDER_ID } from './config.ts'
import type { SearxngSpec } from './config.ts'
import { excerptSource, requestCount } from './shape.ts'
import { assertOk, getJson, parseJson } from './transport.ts'

const PROVIDER = 'SearXNG'

/** The fields read from a `/search?format=json` reply. */
export interface SearxngReply {
  results: { url?: string; title?: string; content?: string; publishedDate?: string | null }[]
}

const SearxngReply: z<SearxngReply> = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    publishedDate: z.union([z.string(), z.const(null)]),
  })).default([]),
})

/**
 * Map a search reply to sources. SearXNG has no result-count parameter, so the reply is cut to
 * `count`. `content` becomes the snippet and summary. A result without a parseable URL is dropped.
 * @param reply - the validated reply.
 * @param count - the most sources returned.
 * @returns at most `count` sources, in SearXNG's order.
 */
export function normalizeSearxngSearch(reply: SearxngReply, count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const result of reply.results) {
    if (sources.length === count) break
    if (result.url === undefined || !URL.canParse(result.url)) continue
    const excerpt = result.content?.trim() ?? ''
    sources.push(excerptSource(result.url, result.title, excerpt, result.publishedDate))
  }
  return sources
}

const DESCRIPTION: NonNullable<WebSearchProvider['description']> = {
  en: 'Web search through your SearXNG instance. Needs no key; queries go only to that instance and the engines it uses.',
  zh: '通过你的 SearXNG 实例搜索网页。无需密钥；查询只发送到该实例及其使用的搜索引擎。',
  ja: 'お使いの SearXNG インスタンスによる Web 検索です。キーは不要です。クエリはそのインスタンスと、それが使う検索エンジンにのみ送信されます。',
  es: 'Búsqueda web a través de tu instancia de SearXNG. No requiere clave; las consultas solo van a esa instancia y a los motores que usa.',
  fr: 'Recherche web via votre instance SearXNG. Aucune clé requise ; les requêtes ne vont qu’à cette instance et aux moteurs qu’elle utilise.',
  de: 'Websuche über Ihre SearXNG-Instanz. Kein Schlüssel nötig; Anfragen gehen nur an diese Instanz und die von ihr genutzten Suchmaschinen.',
  ru: 'Веб-поиск через ваш экземпляр SearXNG. Ключ не нужен; запросы уходят только в этот экземпляр и используемые им поисковики.',
  pt: 'Pesquisa na web através da sua instância SearXNG. Não requer chave; as consultas vão apenas para essa instância e os motores que ela usa.',
}

/** SearXNG search provider. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID
  readonly title = PROVIDER
  readonly description = DESCRIPTION

  /** @param spec - resolved SearXNG settings. */
  constructor(private readonly spec: SearxngSpec) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const url = new URL(this.spec.searchUrl)
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
    const reply = await getJson({ provider: PROVIDER, url: url.href, timeoutMs: this.spec.timeoutMs }, signal)
    assertOk(PROVIDER, reply)
    const parsed = parseJson(PROVIDER, reply.body, SearxngReply, 'enable the json format in the instance\'s search.formats setting')
    return { sources: normalizeSearxngSearch(parsed, requestCount(request.maxResults, this.spec.numResults)), truncated: false }
  }
}
