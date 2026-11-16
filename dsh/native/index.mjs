import * as native from './runtime.mjs'

export const name = 'ow-native'
export const inject = []
export async function apply(ctx) {
  await native.connectEvents()
  ctx.provide('owNative', native)
  ctx.effect(() => () => native.disconnectEvents(), 'ow-native: event connection')
}
