/** Desktop packaging workflow triggers, runners, unsigned packaging and release-only write access. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

interface Step {
  id?: string
  name?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
interface Job {
  name?: string
  'runs-on'?: string
  uses?: string
  if?: string
  needs?: string | string[]
  with?: Record<string, unknown>
  env?: Record<string, string>
  permissions?: Record<string, string>
  secrets?: unknown
  strategy?: { matrix: { include: Array<Record<string, string>> } }
  steps?: Step[]
}
interface Workflow {
  on: Record<string, unknown>
  permissions: Record<string, string>
  concurrency?: Record<string, unknown>
  jobs: Record<string, Job>
}

function source(file: string): string {
  return readFileSync(resolve(root, '.github/workflows', file), 'utf8')
}

function workflow(file: string): Workflow {
  return load(source(file)) as Workflow
}

// Evaluates the `inputs.*` mappings these workflows use; not a general Actions interpreter.
function evaluate(expression: string, inputs: Record<string, string>): unknown {
  const body = expression.trim().replace(/^\$\{\{|\}\}$/gu, '')
    .replace(/\binputs\.([a-z_]+)/gu, (_, name: string) => JSON.stringify(inputs[name] ?? ''))
  return runInNewContext(body, {}, { timeout: 1000 })
}

const TARGETS = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'] as const
const caller = workflow('desktop-package.yml')
const template = workflow('template-desktop-build.yml')

describe('desktop package workflow', () => {
  it('runs for jan-v tags and manual dispatches only', () => {
    expect(Object.keys(caller.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(caller.on.push).toEqual({ tags: ['jan-v*'] })
    const inputs = (caller.on.workflow_dispatch as { inputs: Record<string, { type: string; default: unknown }> }).inputs
    expect(Object.keys(inputs).sort()).toEqual(['build_version', 'publish', 'ref'])
    expect(inputs.publish).toMatchObject({ type: 'boolean', default: false })
    expect(caller.concurrency).toMatchObject({ 'cancel-in-progress': false })
  })

  it('rejects a tag that does not name the product version and derives manual build versions', () => {
    const run = caller.jobs['get-version']!.steps!.find(step => step.id === 'version')!.run!
    expect(run).toContain('if [[ "$REF_NAME" != "jan-v$product" ]]; then')
    expect(run).toContain('version="$product.$(date -u +%Y%m%d).$GITHUB_RUN_NUMBER.$GITHUB_RUN_ATTEMPT"')
    expect(run).toContain('version="$product-test.$(date -u +%Y%m%d).$GITHUB_RUN_NUMBER.$GITHUB_RUN_ATTEMPT"')
  })

  it('packages every target from the resolved commit through the shared template', () => {
    const builds = Object.values(caller.jobs).filter(job => job.uses === './.github/workflows/template-desktop-build.yml')
    expect(builds.map(job => job.with?.target).sort()).toEqual([...TARGETS].sort())
    for (const job of builds) {
      expect(job.needs).toBe('get-version')
      expect(job.with?.ref).toBe('${{ needs.get-version.outputs.commit }}')
      expect(job.secrets).toBeUndefined()
    }
  })

  it('grants write access only to the draft-release jobs, which run only when publishing', () => {
    expect(caller.permissions).toEqual({ contents: 'read' })
    expect(template.permissions).toEqual({ contents: 'read' })
    const writers = Object.entries(caller.jobs).filter(([, job]) => job.permissions?.contents === 'write').map(([name]) => name)
    expect(writers.sort()).toEqual(['create-draft-release', 'upload-release-assets'])
    for (const name of writers) expect(caller.jobs[name]!.if).toBe("needs.get-version.outputs.publish == 'true'")
    for (const job of Object.values(template.jobs)) expect(job.permissions).toBeUndefined()
    const upload = caller.jobs['upload-release-assets']!
    expect(upload.needs).toEqual(expect.arrayContaining(['create-draft-release', 'build-mac-arm64', 'build-mac-x64', 'build-windows-x64', 'build-linux-x64']))
  })

  it('builds unsigned packages without reading repository secrets', () => {
    for (const file of ['desktop-package.yml', 'template-desktop-build.yml']) {
      expect(source(file)).not.toMatch(/\bsecrets\b/u)
    }
    const build = template.jobs.package!.steps!.find(step => step.name === 'Build the unsigned installer')!
    expect(build.run).toContain('args=("$TARGET" --unsigned)')
    expect(build.run).toContain('pnpm --dir apps/desktop run package "${args[@]}"')
  })

  it.each(TARGETS)('builds %s on the runner and worker target that llama-worker.yml pairs', (target) => {
    const worker = workflow('llama-worker.yml')
    const run = worker.jobs.select!.steps![0]!.run!
    const table = JSON.parse(/table='(\[[\s\S]*?\])'/u.exec(run)![1]!) as Array<{ target: string; runner: string }>
    const workerTarget = evaluate(template.jobs.package!.env!.WORKER_TARGET!, { target })
    expect(evaluate(template.jobs['llama-worker']!.with!.targets as string, { target })).toBe(workerTarget)
    const entry = table.find(row => row.target === workerTarget)
    expect(entry).toBeDefined()
    expect(evaluate(template.jobs.package!['runs-on']!, { target })).toBe(entry!.runner)
  })

  it('stages only a worker built from the packaged commit', () => {
    const stage = template.jobs.package!.steps!.find(step => step.name === 'Stage the llama.cpp worker built from this checkout')!
    expect(stage.env?.SOURCE_COMMIT).toBe('${{ steps.checkout.outputs.commit }}')
    expect(stage.run).toContain('if [[ "$built" != "$SOURCE_COMMIT" ]]; then')
    expect(template.jobs.package!.needs).toBe('llama-worker')
  })
})
