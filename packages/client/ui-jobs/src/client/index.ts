/**
 * Browser contributions for background jobs: the composer dock list and
 * live status beside the tool call that started a job.
 */
import type { Context as ClientContext } from '@janhq/cordis'
import type { JobId } from '@janhq/jan-jobs/brand'
import { JobCallStatus, type JobCallStatusInjected } from './JobCallStatus.tsx'
import { JobListAction } from './JobListAction.tsx'
import type { JobListInjected } from './JobListAction.tsx'
import type {} from '@janhq/jan-client-ui-tool/client'
import type {} from '@janhq/jan-api-job-controller/client'
import type {} from '@janhq/jan-client-locale/client'
import type {} from '@janhq/jan-client-ui-renderer/client'
import type {} from '@janhq/jan-client-ui-session/client'
import { en, ja, es, fr, de, ru, pt, NS, zh, type JobKey } from './locales.ts'

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps, JobListInjected } from './JobListAction.tsx'
export type { JobCallStatusInjected, JobCallStatusProps } from './JobCallStatus.tsx'

/** Required services: the jobs rosters, observations, and kill, the slot registry, and dictionaries. */
export const inject = ['jobs', 'slots', 'locale']

/**
 * Register the job dictionaries and slot contributions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-jobs: dictionaries')
  ctx.slots.inject(
    'conversation.composer.dock',
    () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'job-list',
      order: 2,
      locale: NS,
      inject: (): JobListInjected => ({
        hooks: { jobs: ctx.jobs.state },
        watchRows: sessionId => ctx.jobs.watchRows(sessionId),
        observe: (sessionId, id) => ctx.jobs.observe(sessionId, id),
        // The brand is nominal typing only; the row key is the registry id the
        // roster stream delivered, so the wire boundary stamps it back here.
        killJob: async (sessionId, jobId) => (await ctx.jobs.kill(sessionId, jobId as JobId)).ok,
      }),
    }, JobListAction),
  )
  ctx.slots.inject('tool.call.status', () => ctx.slots.register({
    name: 'tool.call.status',
    priority: 100,
    locale: NS,
    inject: (): JobCallStatusInjected => ({
      hooks: { jobs: ctx.jobs.state },
      watchRows: sessionId => ctx.jobs.watchRows(sessionId),
      observe: (sessionId, id) => ctx.jobs.observe(sessionId, id),
    }),
  }, JobCallStatus))
}
