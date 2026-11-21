/**
 * Host half of the Jan theme plugin. It hands the browser half the accent the
 * user picked in the app and serves the logo and fonts. The browser half is
 * `client.js`, found by the client-module scanner through `jan.client`.
 */
import { readFile } from 'node:fs/promises'
import z from '@janhq/schemastery'
import { registerApi } from '@janhq/jan-plugin-api'
import { mountAgentSettings } from './agent-settings.mjs'
import { mountStartupHealth } from './startup-health.mjs'
import { mountProjectHome } from './project-home.mjs'

export const Config = z.object({
  look: z.any().default(null),
  appearance: z.dict(z.any()).default({}).volatile(),
  // Rows are validated independently by mountAgentSettings so an invalid saved row cannot block the theme.
  mcpServers: z.array(z.any()).default([]),
  skillDirectories: z.array(z.string()).default([]),
})

export const name = 'jan-theme'
export const inject = ['webServer', 'connection', 'settings', 'configEditor', 'credentials', 'skills', 'tools']

const ASSETS = new URL('./assets/', import.meta.url)
// A fixed list: the route serves these files and nothing else in the folder.
const TYPES = {
  'logo.png': 'image/png',
  'jan-original.png': 'image/png',
  'hand-wave.svg': 'image/svg+xml',
  'InterVariable.woff2': 'font/woff2',
  'StudioFeixenSans-Medium.otf': 'font/otf',
}

/**
 * @param {import('@janhq/cordis').Context} ctx
 * @param {{ look?: { primary: string, sidebar: { light: string, dark: string } } }} config
 */
export async function apply(ctx, config = {}) {
  mountStartupHealth(ctx)
  mountProjectHome(ctx)
  await mountAgentSettings(ctx, config)
  const appearance = () => config.appearance.get()
  const entry = ctx.fiber.entry?.options.id
  let writes = Promise.resolve()
  ctx.effect(() => registerApi(ctx, 'appearance', {
    get: () => appearance(),
    save: ({ accent, coloredUserBubble, navigationButtons = false }) => {
      const colors = ['gray', 'red', 'orange', 'yellow', 'green', 'emerald', 'teal', 'cyan', 'blue', 'purple', 'pink', 'rose']
      if (!colors.includes(accent) || typeof coloredUserBubble !== 'boolean' || typeof navigationButtons !== 'boolean') throw new Error('Choose a valid accent color, message bubble and Back and Forward preference.')
      const operation = writes.then(async () => {
        const settings = ctx.get('settings')
        if (!settings || !entry) throw new Error('Appearance settings are unavailable. Reopen Settings and try again.')
        const next = { accent, coloredUserBubble, navigationButtons }
        await settings.update(entry, { appearance: next })
        return appearance()
      })
      writes = operation.catch(() => { })
      return operation
    },
  }), 'jan-theme: appearance preferences')
  // Desktop applies the structured boot rows to its local document without rendering Host HTML.
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__JAN_THEME__', value: { look: config.look ?? null, appearance: appearance() } })
  }, { prepend: true })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/jan-theme',
    async handler(req, res) {
      const file = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/jan-theme\/assets\//, '')
      const type = Object.hasOwn(TYPES, file) ? TYPES[file] : undefined
      if (type === undefined || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404)
        res.end()
        return
      }
      const body = await readFile(new URL(file, ASSETS))
      res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=86400' })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'jan-theme: assets')
}
