/**
 * Host half of the open-waifu shell plugin. It hands the browser half the
 * accent the user picked in the app and serves the logo and fonts. The browser half is
 * `client.js`, found by DSH's client-module scanner through `dsh.client`.
 */
import { readFile } from 'node:fs/promises'

export const name = 'open-waifu-shell'
export const inject = ['webServer']

const ASSETS = new URL('./assets/', import.meta.url)
// A fixed list: the route serves these files and nothing else in the folder.
const TYPES = {
  'logo.png': 'image/png',
  'InterVariable.woff2': 'font/woff2',
  'StudioFeixenSans-Medium.otf': 'font/otf',
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ look?: { primary: string, sidebar: { light: string, dark: string } } }} config
 */
export function apply(ctx, config = {}) {
  const shell = { look: config.look ?? null }
  // `<` escaped so a value can never close the script element.
  const json = JSON.stringify(shell).replaceAll('<', '\\u003c')
  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    const script = `<script>window.__OW_SHELL__ = ${json}</script>`
    const head = html.indexOf('<head>')
    return head === -1 ? script + html : html.slice(0, head + 6) + script + html.slice(head + 6)
  }), 'open-waifu-shell: config')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ow-shell',
    async handler(req, res) {
      const file = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/ow-shell\/assets\//, '')
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
  }), 'open-waifu-shell: assets')
}
