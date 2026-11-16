// Host half. It runs in the DSH Node process and serves one JSON route the
// browser half reads. Delete the route when a plugin is browser-only.
export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/open-waifu-plugin-hello/greeting',
    handler(_req, res) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ text: `Hello from the host, ${new Date().toLocaleTimeString()}` }))
    },
  }), 'hello: greeting route')
}
