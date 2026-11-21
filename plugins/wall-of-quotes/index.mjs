import Schema from '@janhq/schemastery'

/** Cordis identity of the Wall of Quotes plugin. */
export const name = 'jan-wall-of-quotes'

/** Live quote preferences, edited from Customize > Plugins > Wall of Quotes. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Show quotes on new chats.'),
  builtIn: Schema.boolean().default(true).description('Show quotes from the built-in list.'),
  custom: Schema.boolean().default(true).description('Show quotes you added.'),
  quotes: Schema.array(Schema.object({
    text: Schema.string().required().pattern(/\S/),
    author: Schema.string().default(''),
  })).default([]).description('Quotes you added.'),
}).volatile()

/** Keep the generated editor out of the way of the plugin's custom settings page.
 * @param {import('@janhq/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
}
