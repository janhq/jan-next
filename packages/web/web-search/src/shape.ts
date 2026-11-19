/**
 * Normalization shared by every backend: request-count clamping, display snippets, excerpt
 * sources, page-text bounds, and fetch-URL validation.
 * @module @janhq/jan-web-search/shape
 */

import { WebError } from '@janhq/jan-web'
import type { WebFetchResult, WebSearchSource } from '@janhq/jan-web'
import { MAX_RESULTS } from './config.ts'
import { clipChars } from './transport.ts'

/** Longest display snippet taken from a result's excerpt, before the `…` marking a cut. */
export const SNIPPET_CHARS = 300

/**
 * The result count to ask a backend for.
 * @param maxResults - the caller's bound, when set.
 * @param configured - the configured count used without a caller bound.
 * @returns the count clamped to 1 through {@link MAX_RESULTS}.
 */
export function requestCount(maxResults: number | undefined, configured: number): number {
  return Math.max(1, Math.min(maxResults ?? configured, MAX_RESULTS))
}

/**
 * A display snippet from an excerpt.
 * @param excerpt - the trimmed excerpt.
 * @returns the excerpt, cut to {@link SNIPPET_CHARS} with a trailing `…` when longer.
 */
export function snippetOf(excerpt: string): string {
  return excerpt.length > SNIPPET_CHARS ? `${clipChars(excerpt, SNIPPET_CHARS).trimEnd()}…` : excerpt
}

/**
 * A search source from a backend result whose excerpt serves as both snippet and summary.
 * @param url - the result URL.
 * @param title - the result title, when reported.
 * @param excerpt - the trimmed excerpt; empty when the backend reported none.
 * @param publishedAt - the reported publication date, when any.
 * @returns the source, omitting empty or blank fields.
 */
export function excerptSource(
  url: string,
  title: string | null | undefined,
  excerpt: string,
  publishedAt: string | null | undefined,
): WebSearchSource {
  const trimmedTitle = title?.trim()
  const trimmedDate = publishedAt?.trim()
  return {
    url,
    ...trimmedTitle === undefined || trimmedTitle.length === 0 ? {} : { title: trimmedTitle },
    ...excerpt.length === 0 ? {} : { snippet: snippetOf(excerpt), summary: excerpt },
    ...trimmedDate === undefined || trimmedDate.length === 0 ? {} : { publishedAt: trimmedDate },
  }
}

/**
 * A fetch result for extracted page text. Backends report no HTTP status for the page they read,
 * so a returned page reports 200.
 * @param url - the page URL the backend reported, or the requested URL.
 * @param text - the extracted page text.
 * @param maxCharacters - the page-text bound.
 * @returns a `text` body cut to `maxCharacters`, flagged truncated when cut.
 */
export function boundPage(url: string, text: string, maxCharacters: number): WebFetchResult {
  const content = clipChars(text, maxCharacters)
  return { url, statusCode: 200, body: { kind: 'text', content }, truncated: content.length < text.length }
}

/**
 * Refuse a fetch URL that is not http(s) before it is sent to a backend.
 * @param url - the requested URL.
 * @throws {@link WebError} `WEB_INVALID_URL`.
 */
export function assertHttpUrl(url: string): void {
  if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
    throw new WebError(`Not an http(s) URL: ${url}`, 'WEB_INVALID_URL')
  }
}
