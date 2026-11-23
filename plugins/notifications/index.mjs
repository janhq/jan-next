import Schema from '@janhq/schemastery'

/** Cordis identity of the desktop notification plugin. */
export const name = 'jan-notifications'

/** Notification preferences, edited from Settings › General. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile().description('Show desktop notifications.'),
  finished: Schema.boolean().default(true).volatile().description('Notify when a chat finishes.'),
  failed: Schema.boolean().default(true).volatile().description('Notify when a chat stops with an error.'),
  waiting: Schema.boolean().default(true).volatile().description('Notify when a chat waits for your approval or answer.'),
})

/** Notifications run in the client; the Host only owns the preferences and serves the client entry. */
export function apply() {}
