function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function registerApi(ctx, feature, methods) {
  return ctx.webServer.register({
    kind: 'exact', path: `/ow-api/${feature}`,
    async handler(req, res) {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') { send(res, 415, { error: 'Expected application/json.' }); return }
      try {
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 1024 * 1024) { send(res, 413, { error: 'Request exceeds 1 MiB.' }); return }
          chunks.push(chunk)
        }
        const { method, params = {} } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (typeof method !== 'string' || !Object.hasOwn(methods, method)) { send(res, 404, { error: 'Unknown plugin operation.' }); return }
        if (!params || typeof params !== 'object' || Array.isArray(params)) { send(res, 400, { error: 'Expected an operation parameter object.' }); return }
        const result = await methods[method](params)
        send(res, 200, { result: result ?? null })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
