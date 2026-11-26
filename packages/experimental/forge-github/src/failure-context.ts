/** GitHub review feedback and failed Actions step excerpts for an explicit fix-context action. */

import type {
  ChangeRequestBlockingReview, ChangeRequestCheck, ChangeRequestFailureLog,
  ChangeRequestFailureSelection, ChangeRequestSnapshot, ForgeFailure,
} from '@janhq/jan-experimental-forge'
import { z } from 'zod'
import { stripVTControlCharacters } from 'node:util'
import { decode, readInBatches, type ReadGitHubEndpoint } from './assets.ts'

const feedback = z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({
  latestOpinionatedReviews: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(z.object({
      state: z.string(), author: z.object({ login: z.string() }).nullable(), body: z.string(),
      comments: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean() }),
        nodes: z.array(z.object({
          path: z.string(), body: z.string(),
          line: z.number().int().positive().nullable(), originalLine: z.number().int().positive().nullable(),
        })),
      }),
    })),
  }),
}) }) }), errors: z.array(z.object({ message: z.string() })).optional() })

const jobSchema = z.object({
  id: z.number(), run_id: z.number(), head_sha: z.string(),
  steps: z.array(z.object({
    name: z.string(), conclusion: z.string().nullable(), started_at: z.iso.datetime().nullable(), completed_at: z.iso.datetime().nullable(),
  })),
})
const JOB_LIMIT = 6
const STEP_LIMIT = 3
const LOG_CHARS = 3_000
const LOG_LINES = 30

/**
 * Read the latest opinionated review per reviewer, so superseded requests for changes are not copied.
 * @param read - GraphQL reader on the configured GitHub host.
 * @param snapshot - validated change request identity.
 * @returns active blocking feedback or GitHub's error.
 */
export async function readBlockingReviews(read: ReadGitHubEndpoint, snapshot: ChangeRequestSnapshot): Promise<{
  readonly reviews: readonly ChangeRequestBlockingReview[]
  readonly truncated: boolean
} | ForgeFailure> {
  const { owner, name } = snapshot.ref.repository
  const body = decode(await read(`query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${String(snapshot.ref.number)}) { latestOpinionatedReviews(first: 20) {
      pageInfo { hasNextPage }
      nodes { state author { login } body comments(first: 40) {
        pageInfo { hasNextPage } nodes { path line originalLine body }
      } }
    } }
  } }`), feedback)
  if ('code' in body) return body
  if (body.errors?.length) return { code: 'unavailable', message: body.errors[0]?.message ?? 'Could not read GitHub reviews' }
  const listing = body.data.repository.pullRequest.latestOpinionatedReviews
  let truncated = listing.pageInfo.hasNextPage
  const reviews: ChangeRequestBlockingReview[] = []
  for (const review of listing.nodes) {
    if (review.state !== 'CHANGES_REQUESTED') continue
    truncated ||= review.comments.pageInfo.hasNextPage
    reviews.push({ author: review.author?.login ?? null, body: review.body, comments: review.comments.nodes.map(comment => ({
      path: comment.path, line: comment.line ?? comment.originalLine, body: comment.body,
    })) })
  }
  return { reviews, truncated }
}

/**
 * Limit Actions reads to actual failed jobs of the selected checks at the requested head.
 * @param read - bounded API reader on the configured GitHub host.
 * @param snapshot - complete checks for the displayed head.
 * @param selection - whole request or a single check.
 * @returns failed step tails, any read failures, and whether more matching logs were omitted.
 */
export async function readFailureLogs(
  read: (endpoint: string, rawLog?: true) => Promise<string | ForgeFailure>,
  snapshot: ChangeRequestSnapshot, selection: ChangeRequestFailureSelection,
): Promise<{
  readonly logs: readonly ChangeRequestFailureLog[]
  readonly failures: readonly ForgeFailure[]
  readonly truncated: boolean
}> {
  const { host, owner, name } = snapshot.ref.repository
  const base = `/${owner}/${name}/actions/runs/`.toLowerCase()
  const jobs = new Map<string, { url: string; run: number; job: number }>()
  for (const check of snapshot.checks) {
    if (!selectedFailure(check, selection) || check.state !== 'failure' || check.url === null) continue
    const page = URL.parse(check.url)
    if (page?.host.toLowerCase() !== host || !page.pathname.toLowerCase().startsWith(base)) continue
    const match = /^(\d+)\/job\/(\d+)\/?$/.exec(page.pathname.slice(base.length))
    if (match === null) continue
    const run = Number(match[1])
    const job = Number(match[2])
    if (Number.isSafeInteger(run) && Number.isSafeInteger(job) && run > 0 && job > 0) jobs.set(check.url, { url: check.url, run, job })
  }
  const ordered = [...jobs.values()].sort((a, b) => a.job - b.job)
  const reads = await readInBatches(ordered.slice(0, JOB_LIMIT), async ({ url, run, job }) => {
    const endpoint = `repos/${owner}/${name}/actions/jobs/${String(job)}`
    const metadata = decode(await read(endpoint), jobSchema)
    if ('code' in metadata) return metadata
    if (metadata.id !== job || metadata.run_id !== run || metadata.head_sha !== snapshot.headSha) {
      return { code: 'unavailable', message: 'GitHub job does not match the displayed check' } satisfies ForgeFailure
    }
    const failed = metadata.steps.filter(step => step.conclusion === 'failure' && step.started_at !== null && step.completed_at !== null)
    if (failed.length === 0) return { logs: [], truncated: false }
    const raw = await read(`${endpoint}/logs`, true)
    if (typeof raw !== 'string') return raw
    const logs: ChangeRequestFailureLog[] = []
    for (const step of failed.slice(-STEP_LIMIT)) {
      const excerpt = logTail(raw, Date.parse(step.started_at ?? ''), Date.parse(step.completed_at ?? ''))
      if (excerpt.text !== '') logs.push({ url, step: step.name, ...excerpt })
    }
    return { logs, truncated: failed.length > STEP_LIMIT }
  })
  const logs: ChangeRequestFailureLog[] = []
  const failures: ForgeFailure[] = []
  let truncated = ordered.length > JOB_LIMIT
  for (const result of reads) {
    if ('code' in result) failures.push(result)
    else { logs.push(...result.logs); truncated ||= result.truncated }
  }
  return { logs, failures, truncated }
}

function selectedFailure(check: ChangeRequestCheck, selection: ChangeRequestFailureSelection): boolean {
  return selection.kind === 'all' || (selection.kind === 'check' && check.name === selection.name
    && check.workflow === selection.workflow && check.url === selection.url)
}

function logTail(raw: string, start: number, end: number): { text: string; truncated: boolean } {
  const lines: string[] = []
  let truncated = false
  let stepStarted = false
  // REST step times have second precision; raw log timestamps have subsecond precision.
  for (const match of raw.matchAll(/^(\S+) ([^\r\n]*)/gm)) {
    const stamp = Date.parse(match[1] ?? '')
    if (!Number.isFinite(stamp) || stamp < start) continue
    if (stamp >= end + 1_000) break
    const line = stripVTControlCharacters(match[2] ?? '').trimEnd()
    if (line === 'Post job cleanup.' || line === 'Cleaning up orphan processes') break
    if (line.startsWith('##[group]Run ')) {
      if (stepStarted && stamp >= end) break
      if (!stepStarted && stamp < start + 1_000) {
        // Setup and a quick failing command can share a timestamp in the REST metadata.
        lines.length = 0
        truncated = false
        stepStarted = true
      } else if (stamp >= end) break
    }
    if (line === '') continue
    lines.push(line.slice(-LOG_CHARS))
    truncated ||= line.length > LOG_CHARS
    if (lines.length > LOG_LINES) { lines.shift(); truncated = true }
  }
  const text = lines.join('\n')
  return { text: text.slice(-LOG_CHARS).trim(), truncated: truncated || text.length > LOG_CHARS }
}
