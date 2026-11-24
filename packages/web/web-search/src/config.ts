/**
 * Plugin configuration and its explicit resolution into the per-backend specs the providers run
 * with. Every endpoint, credential reference, limit, and the set of registered backends is a
 * validated field; misconfiguration fails at plugin load.
 * @module @janhq/jan-web-search/config
 */

import { credentialRef, isCredentialRefName } from '@janhq/jan-credentials'
import type { CredentialRef } from '@janhq/jan-credentials'
import z from '@janhq/schemastery'

/** Registry id of the Tokamak search and fetch providers. */
export const TOKAMAK_PROVIDER_ID = 'tokamak'

/** Registry id of the Exa search and fetch providers. */
export const EXA_PROVIDER_ID = 'exa'

/** Registry id of the Tavily search and fetch providers. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Registry id of the SearXNG search provider. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/** Registry id of the You.com search and fetch providers. */
export const YOU_PROVIDER_ID = 'you'

/** The backends this package can register: Tokamak, then the order Jan's web search plugin lists them. */
export const BACKEND_IDS = [TOKAMAK_PROVIDER_ID, EXA_PROVIDER_ID, TAVILY_PROVIDER_ID, SEARXNG_PROVIDER_ID, YOU_PROVIDER_ID] as const

/** One backend id from {@link BACKEND_IDS}. */
export type BackendId = 'tokamak' | 'exa' | 'tavily' | 'searxng' | 'you'

/** Upper bound on the result count every backend is asked for; a caller's `maxResults` is clamped to it. */
export const MAX_RESULTS = 20

/** Tokamak endpoint and result cap; requests authenticate with the signed-in Tokamak account. */
export interface TokamakConfig {
  /** API base URL on the account's deployment; `/web_search` and `/web_fetch` are appended. */
  apiUrl?: string
  /** Largest result count one search asks for, at most {@link MAX_RESULTS}; the deployment rejects counts above its provider's cap. */
  maxResults?: number
}

/** Exa endpoints and credential. */
export interface ExaConfig {
  /** Hosted MCP endpoint used while no API key resolves. */
  mcpUrl?: string
  /** REST API base URL used with an API key; `/search` and `/contents` are appended. */
  apiUrl?: string
  /** Credential reference holding the Exa API key. */
  apiKeyEnv?: string
  /** Characters of page text each keyed search result carries as its summary. */
  searchTextCharacters?: number
}

/** Tavily endpoint and credential; Tavily answers only with an API key. */
export interface TavilyConfig {
  /** REST API base URL; `/search` and `/extract` are appended. */
  apiUrl?: string
  /** Credential reference holding the Tavily API key. */
  apiKeyEnv?: string
}

/** SearXNG instance; required when `providers` lists `searxng`. */
export interface SearxngConfig {
  /** Base URL of a SearXNG instance with the JSON format enabled; `/search` is appended. */
  url?: string
}

/** You.com endpoints and credential. */
export interface YouConfig {
  /** Hosted MCP endpoint used for search while no API key resolves. */
  mcpUrl?: string
  /** Keyless page-extraction endpoint used for fetch while no API key resolves. */
  extractUrl?: string
  /** REST API base URL used with an API key; `/v1/search` and `/v1/contents` are appended. */
  apiUrl?: string
  /** Credential reference holding the You.com API key. */
  apiKeyEnv?: string
  /** `User-Agent` header sent on every You.com request. */
  userAgent?: string
}

/** Plugin config; every field except `searxng.url` has a default. */
export interface Config {
  /** Backends to register; `searxng` registers search only, the others search and fetch. */
  providers?: BackendId[]
  /** Tokamak settings. */
  tokamak?: TokamakConfig
  /** Exa settings. */
  exa?: ExaConfig
  /** Tavily settings. */
  tavily?: TavilyConfig
  /** SearXNG settings. */
  searxng?: SearxngConfig
  /** You.com settings. */
  you?: YouConfig
  /** Results requested when the caller sets no bound, at most {@link MAX_RESULTS}. */
  numResults?: number
  /** Characters of page text one fetch returns. */
  maxCharacters?: number
  /** Milliseconds one search or fetch may take. */
  timeoutMs?: number
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Validates {@link Config} and applies its defaults. */
export const Config: z<Config> = z.object({
  providers: z.array(z.union([...BACKEND_IDS])).default([TOKAMAK_PROVIDER_ID, EXA_PROVIDER_ID, TAVILY_PROVIDER_ID, YOU_PROVIDER_ID]),
  tokamak: z.object({
    apiUrl: z.string().default('https://api.tokamak.sh/v1'),
    maxResults: z.natural().min(1).max(MAX_RESULTS).default(10),
  }),
  exa: z.object({
    mcpUrl: z.string().default('https://mcp.exa.ai/mcp'),
    apiUrl: z.string().default('https://api.exa.ai'),
    apiKeyEnv: z.string().role('credential-ref').default('EXA_API_KEY'),
    searchTextCharacters: z.natural().min(1).default(800),
  }),
  tavily: z.object({
    apiUrl: z.string().default('https://api.tavily.com'),
    apiKeyEnv: z.string().role('credential-ref').default('TAVILY_API_KEY'),
  }),
  searxng: z.object({
    url: z.string(),
  }),
  you: z.object({
    mcpUrl: z.string().default('https://api.you.com/mcp?profile=free'),
    extractUrl: z.string().default('https://api.you.com/v1/extract'),
    apiUrl: z.string().default('https://ydc-index.io'),
    apiKeyEnv: z.string().role('credential-ref').default('YDC_API_KEY'),
    userAgent: z.string().default('jan-web-search (+https://github.com/janhq/jan-next)'),
  }),
  numResults: z.natural().min(1).max(MAX_RESULTS).default(5),
  maxCharacters: z.natural().min(1).default(40_000),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
})

/** Limits every backend shares. */
export interface SharedSpec {
  /** Results requested when the caller sets no bound. */
  readonly numResults: number
  /** Characters of page text one fetch returns. */
  readonly maxCharacters: number
  /** Milliseconds one operation may take. */
  readonly timeoutMs: number
}

/** Resolved Tokamak settings. */
export interface TokamakSpec extends SharedSpec {
  readonly searchUrl: string
  readonly fetchUrl: string
  readonly maxResults: number
}

/** Resolved Exa settings. */
export interface ExaSpec extends SharedSpec {
  readonly mcpUrl: string
  readonly searchUrl: string
  readonly contentsUrl: string
  readonly apiKeyEnv: CredentialRef
  readonly searchTextCharacters: number
}

/** Resolved Tavily settings. */
export interface TavilySpec extends SharedSpec {
  readonly searchUrl: string
  readonly extractUrl: string
  readonly apiKeyEnv: CredentialRef
}

/** Resolved SearXNG settings. */
export interface SearxngSpec extends SharedSpec {
  readonly searchUrl: string
}

/** Resolved You.com settings. */
export interface YouSpec extends SharedSpec {
  readonly mcpUrl: string
  readonly extractUrl: string
  readonly searchUrl: string
  readonly contentsUrl: string
  readonly apiKeyEnv: CredentialRef
  readonly userAgent: string
}

/** The complete resolved plugin configuration. */
export interface Spec {
  /** Backends to register, without duplicates, in configured order. */
  readonly providers: readonly BackendId[]
  readonly tokamak: TokamakSpec
  readonly exa: ExaSpec
  readonly tavily: TavilySpec
  /** Absent unless `providers` lists `searxng`. */
  readonly searxng?: SearxngSpec
  readonly you: YouSpec
}

/**
 * Resolve schemastery output into the specs the providers run with, validating what the schema
 * cannot express.
 * @param config - the plugin config after schemastery applied its defaults.
 * @returns the resolved spec.
 * @throws {Error} naming the field, for a missing field, a non-http(s) URL, an invalid credential
 * reference, an empty or duplicated provider list, a listed `searxng` without `searxng.url`, or an
 * empty `User-Agent`.
 */
export function resolve(config: Config): Spec {
  const providers = required('providers', config.providers)
  if (providers.length === 0) throw new Error('web-search: providers must name at least one backend')
  if (new Set(providers).size !== providers.length) throw new Error('web-search: providers must not repeat a backend')
  const exa = required('exa', config.exa)
  const tavily = required('tavily', config.tavily)
  const you = required('you', config.you)
  const tokamak = required('tokamak', config.tokamak)
  const shared: SharedSpec = {
    numResults: required('numResults', config.numResults),
    maxCharacters: required('maxCharacters', config.maxCharacters),
    timeoutMs: required('timeoutMs', config.timeoutMs),
  }
  const exaApi = httpUrl('exa.apiUrl', exa.apiUrl)
  const tavilyApi = httpUrl('tavily.apiUrl', tavily.apiUrl)
  const youApi = httpUrl('you.apiUrl', you.apiUrl)
  const tokamakApi = httpUrl('tokamak.apiUrl', tokamak.apiUrl)
  const userAgent = required('you.userAgent', you.userAgent)
  if (userAgent.trim().length === 0) throw new Error('web-search: you.userAgent must not be empty')
  const searxngUrl = config.searxng?.url
  if (providers.includes(SEARXNG_PROVIDER_ID) && searxngUrl === undefined) {
    throw new Error('web-search: providers lists searxng, so searxng.url must name a SearXNG instance')
  }
  return {
    providers,
    tokamak: {
      ...shared,
      searchUrl: joinPath(tokamakApi, 'web_search'),
      fetchUrl: joinPath(tokamakApi, 'web_fetch'),
      maxResults: required('tokamak.maxResults', tokamak.maxResults),
    },
    exa: {
      ...shared,
      mcpUrl: httpUrl('exa.mcpUrl', exa.mcpUrl).href,
      searchUrl: joinPath(exaApi, 'search'),
      contentsUrl: joinPath(exaApi, 'contents'),
      apiKeyEnv: reference('exa.apiKeyEnv', exa.apiKeyEnv),
      searchTextCharacters: required('exa.searchTextCharacters', exa.searchTextCharacters),
    },
    tavily: {
      ...shared,
      searchUrl: joinPath(tavilyApi, 'search'),
      extractUrl: joinPath(tavilyApi, 'extract'),
      apiKeyEnv: reference('tavily.apiKeyEnv', tavily.apiKeyEnv),
    },
    ...searxngUrl === undefined ? {} : { searxng: { ...shared, searchUrl: joinPath(httpUrl('searxng.url', searxngUrl), 'search') } },
    you: {
      ...shared,
      mcpUrl: httpUrl('you.mcpUrl', you.mcpUrl).href,
      extractUrl: httpUrl('you.extractUrl', you.extractUrl).href,
      searchUrl: joinPath(youApi, 'v1/search'),
      contentsUrl: joinPath(youApi, 'v1/contents'),
      apiKeyEnv: reference('you.apiKeyEnv', you.apiKeyEnv),
      userAgent,
    },
  }
}

function required<T>(field: string, value: T | undefined): T {
  if (value === undefined) throw new Error(`web-search: ${field} is required`)
  return value
}

function httpUrl(field: string, value: string | undefined): URL {
  const raw = required(field, value)
  const url = URL.canParse(raw) ? new URL(raw) : undefined
  if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error(`web-search: ${field} is not an http(s) URL: ${raw}`)
  }
  return url
}

function joinPath(base: URL, path: string): string {
  const url = new URL(base.href)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`
  return url.href
}

function reference(field: string, value: string | undefined): CredentialRef {
  const raw = required(field, value)
  if (!isCredentialRefName(raw)) throw new Error(`web-search: ${field} is not an environment-variable name: ${raw}`)
  return credentialRef(raw)
}
