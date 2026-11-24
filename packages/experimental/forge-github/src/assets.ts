/** On-demand GitHub deployment previews and Actions artifacts for one pull request head. */

import type { ChangeRequestArtifact, ChangeRequestAssets, ChangeRequestPreview, ForgeFailure } from '@janhq/jan-experimental-forge'
import { z } from 'zod'
import { webUrl } from './urls.ts'

/** Reads one API endpoint with the provider's cancellation and output limits. */
export type ReadGitHubEndpoint = (endpoint: string) => Promise<string | ForgeFailure>

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const deployments = z.array(z.object({ id, environment: z.string() }))
const statuses = z.array(z.object({ state: z.string(), environment_url: z.string().nullable().optional() }))
const runs = z.object({
  total_count: z.number().optional(),
  workflow_runs: z.array(z.object({
    id, head_sha: z.string(), event: z.string(), pull_requests: z.array(z.object({ number: id })),
  })),
})
const artifacts = z.object({
  total_count: z.number().optional(),
  artifacts: z.array(z.object({
    id, name: z.string(), size_in_bytes: z.number().nonnegative(), expires_at: z.iso.datetime(), expired: z.boolean(),
  })),
})
const comments = z.array(z.object({ body: z.string().nullable(), user: z.object({ login: z.string(), type: z.string() }).nullable() }))
const PREVIEW_BOTS = new Set(['vercel[bot]', 'netlify[bot]', 'cloudflare-pages[bot]'])
const DEPLOYMENT_LIMIT = 10
const RUN_PAGE = 20
const RUN_LIMIT = 10
const ARTIFACT_PAGE = 30
const COMMENT_PAGE = 30

/**
 * Decode one API response or retain the provider's structured failure.
 * @param response - bounded output of a `gh api` request.
 * @param schema - fields this consumer needs.
 * @returns a validated response or the reason it was not read.
 */
export function decode<T>(response: string | ForgeFailure, schema: z.ZodType<T>): T | ForgeFailure {
  if (typeof response !== 'string') return response
  let json: unknown
  try { json = JSON.parse(response) } catch (error) {
    return { code: 'unavailable', message: `Invalid GitHub JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const result = schema.safeParse(json)
  return result.success ? result.data : { code: 'unavailable', message: 'Unexpected GitHub response fields' }
}

/**
 * Limit parallel `gh` child processes while preserving the order of their results.
 * @param values - items to read.
 * @param read - operation for one item.
 * @returns results in input order.
 */
export async function readInBatches<T, R>(values: readonly T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < values.length; i += 3) results.push(...await Promise.all(values.slice(i, i + 3).map(read)))
  return results
}

/**
 * Read assets without following untrusted API or download URLs supplied by a response.
 * @param read - bounded API reader for the configured host.
 * @param repository - repository API path, with validated owner and repository name.
 * @param web - repository browser URL on the same host.
 * @param number - pull request number.
 * @param headSha - exact commit whose assets to read.
 * @returns available previews and artifacts, plus any source failures and cap status.
 */
export async function readAssets(
  read: ReadGitHubEndpoint, repository: string, web: string, number: number, headSha: string,
): Promise<ChangeRequestAssets> {
  const [deploymentList, runList, commentList] = await Promise.all([
    read(`${repository}/deployments?sha=${headSha}&per_page=${String(DEPLOYMENT_LIMIT)}`).then(value => decode(value, deployments)),
    read(`${repository}/actions/runs?head_sha=${headSha}&per_page=${String(RUN_PAGE)}`).then(value => decode(value, runs)),
    read(`${repository}/issues/${String(number)}/comments?direction=desc&sort=created&per_page=${String(COMMENT_PAGE)}`).then(value => decode(value, comments)),
  ])
  const failures: ForgeFailure[] = []
  const previews = new Map<string, ChangeRequestPreview>()
  const files: ChangeRequestArtifact[] = []
  let truncated = false
  if ('code' in deploymentList) failures.push(deploymentList)
  else {
    truncated ||= deploymentList.length >= DEPLOYMENT_LIMIT
    const seen = new Set<string>()
    const newest = deploymentList.filter(({ environment }) => {
      if (seen.has(environment)) return false
      seen.add(environment)
      return true
    }).slice(0, DEPLOYMENT_LIMIT)
    for (const { environment, status } of await readInBatches(newest, async deployment => ({
      environment: deployment.environment,
      status: decode(await read(`${repository}/deployments/${String(deployment.id)}/statuses?per_page=1`), statuses),
    }))) {
      if ('code' in status) { failures.push(status); continue }
      const latest = status[0]
      if (latest?.state !== 'success') continue
      const url = webUrl(latest.environment_url ?? null)
      if (url !== null && !previews.has(url)) previews.set(url, { url, label: environment })
    }
  }
  if ('code' in commentList) failures.push(commentList)
  else {
    truncated ||= commentList.length >= COMMENT_PAGE
    for (const { body, user } of commentList.slice(0, COMMENT_PAGE)) {
      if (body === null || user?.type !== 'Bot' || !PREVIEW_BOTS.has(user.login)) continue
      // Recognize explicitly labeled links only from known deployment bots, not arbitrary links in discussion.
      for (const match of body.matchAll(/\[([^\]\r\n]{1,60})\]\((https?:\/\/[^\s)<>]+)\)/gi)) {
        const [, label = '', address = ''] = match
        if (!/^(?:visit |deploy |deployment )?preview(?: (?:url|link|deployment))?$/i.test(label)) continue
        const url = webUrl(address)
        if (url !== null && !previews.has(url)) previews.set(url, { label, url })
      }
    }
  }
  if ('code' in runList) failures.push(runList)
  else {
    const related = runList.workflow_runs.filter(run => run.head_sha === headSha && (run.pull_requests.some(pr => pr.number === number)
      || run.pull_requests.length === 0 && (run.event === 'pull_request' || run.event === 'pull_request_target' || run.event === 'push')))
    truncated ||= related.length > RUN_LIMIT || (runList.total_count ?? 0) > runList.workflow_runs.length
    for (const { run, listing } of await readInBatches(related.slice(0, RUN_LIMIT), async run => ({
      run: run.id, listing: decode(await read(`${repository}/actions/runs/${String(run.id)}/artifacts?per_page=${String(ARTIFACT_PAGE)}`), artifacts),
    }))) {
      if ('code' in listing) { failures.push(listing); continue }
      truncated ||= (listing.total_count ?? listing.artifacts.length) > ARTIFACT_PAGE
      for (const artifact of listing.artifacts.slice(0, ARTIFACT_PAGE)) files.push({
        url: `${web}/actions/runs/${String(run)}/artifacts/${String(artifact.id)}`,
        name: artifact.name, sizeBytes: artifact.size_in_bytes, expiresAt: artifact.expires_at, expired: artifact.expired,
      })
    }
  }
  return { previews: [...previews.values()], artifacts: files, failures, truncated }
}
