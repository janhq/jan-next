/**
 * Status bar Host half: serves system load (CPU, memory, GPU) and holds the
 * keep-awake blocker at `/jan-api/status-bar`. The bar itself, its items and
 * its layout live in the browser half; every preference is a live Config field
 * edited from the bar's right-click menu and Customize > Plugins > Status bar.
 */
import Schema from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'
import { runNativeCommand } from '@janhq/jan-native-command'
import { createResourceSampler } from './resources.mjs'
import { AWAKE_MODES, createAwakeController } from './awake.mjs'

/** Cordis identity of the status bar plugin. */
export const name = 'jan-status-bar'
export const inject = ['webServer', 'connection']

const Placement = Schema.object({
  hidden: Schema.boolean().description('Hide this item.'),
  side: Schema.union([Schema.const('left'), Schema.const('right')]).description('Which end of the bar the item sits at.'),
  order: Schema.number().description('Position among the items on its side; lower is further left.'),
})

/** Live status bar preferences. */
export const Config = Schema.object({
  visible: Schema.boolean().default(true).description('Show the status bar.').volatile(),
  compact: Schema.boolean().default(false).description('Show icons only, with the details in each tooltip.').volatile(),
  interval: Schema.number().min(1).max(30).step(1).default(2).description('Seconds between system load readings.').volatile(),
  warnAt: Schema.number().min(1).max(100).step(1).default(60).description('Load in percent where a meter turns amber.').volatile(),
  criticalAt: Schema.number().min(1).max(100).step(1).default(85).description('Load in percent where a meter turns red.').volatile(),
  awake: Schema.union(AWAKE_MODES.map(mode => Schema.const(mode))).default('off').description('Keep the computer awake: on, while an agent works, or off.').volatile(),
  items: Schema.dict(Placement).default({
    // Shown out of the box: keep awake, CPU, memory and GPU. These three wait in the right-click menu.
    'jan.activity': { hidden: true },
    'jan.connection': { hidden: true },
    'jan.clock': { hidden: true },
  }).description('Your placement for each item, by item id.').volatile(),
})

/**
 * @param {import('@janhq/cordis').Context} ctx - Host context.
 * @param {{ awake: { get(): import('./awake.mjs').AwakeMode } }} config - live Config.
 */
export function apply(ctx, config) {
  const logger = ctx.logger('status-bar')
  const sampler = createResourceSampler({ run: runNativeCommand })
  const awake = createAwakeController({ run: runNativeCommand, logger })
  ctx.effect(() => () => { awake.dispose() })

  const follow = () => { awake.setMode(config.awake.get()) }
  follow()
  ctx.on('loader/volatile-update', follow)
  ctx.on('agent/status', ({ agent, status }) => { awake.setWorking(agent.id, status === 'running') }, { global: true })
  ctx.on('agent/disposed', ({ agent }) => { awake.setWorking(agent.id, false) }, { global: true })

  ctx.effect(() => registerApi(ctx, 'status-bar', {
    resources: () => sampler.read(),
    awake: () => awake.state(),
  }))
}
