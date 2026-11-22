// A remote MCP server behind OAuth, the way hosted servers such as Linear or Figma answer: 401 with a
// resource-metadata challenge, an authorization server with dynamic registration and PKCE, and an
// authorize page that approves at once. Run on its own (`node oauth-mcp-fixture.mjs [port]`) for a
// manual walk.

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

/**
 * @param {{ port?: number, refuseRegistration?: boolean, expiresIn?: number }} [options]
 */
export async function startOAuthMcpFixture({ port = 0, refuseRegistration = false, expiresIn = 3600 } = {}) {
  const clients = new Map()
  const codes = new Map()
  const access = new Set()
  const refresh = new Set()
  const log = []
  let base = ''
  const token = () => randomBytes(16).toString('hex')
  const json = (response, status, body, headers = {}) => response.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body))
  const body = request => new Promise(resolve => { let text = ''; request.on('data', chunk => { text += chunk }); request.on('end', () => resolve(text)) })
  const issue = () => {
    const pair = { access_token: `at-${token()}`, refresh_token: `rt-${token()}`, token_type: 'Bearer', expires_in: expiresIn }
    access.add(pair.access_token); refresh.add(pair.refresh_token)
    return pair
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', base)
    log.push(`${request.method} ${url.pathname}`)
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['mcp'] })
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(response, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp'],
      })
    }
    if (url.pathname === '/register' && request.method === 'POST') {
      if (refuseRegistration) return response.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden')
      const metadata = JSON.parse(await body(request))
      const client = { ...metadata, client_id: `client-${token()}`, client_id_issued_at: Math.floor(Date.now() / 1000) }
      clients.set(client.client_id, client)
      return json(response, 201, client)
    }
    if (url.pathname === '/authorize') {
      const client = clients.get(url.searchParams.get('client_id'))
      const redirect = url.searchParams.get('redirect_uri')
      if (!client || !client.redirect_uris.includes(redirect) || url.searchParams.get('code_challenge_method') !== 'S256') return response.writeHead(400).end('bad authorize request')
      const code = `code-${token()}`
      codes.set(code, { client: client.client_id, redirect, challenge: url.searchParams.get('code_challenge') })
      const back = new URL(redirect)
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      back.searchParams.set('iss', base)
      return response.writeHead(302, { location: back.href }).end()
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await body(request))
      if (form.get('grant_type') === 'authorization_code') {
        const grant = codes.get(form.get('code'))
        codes.delete(form.get('code'))
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
        if (!grant || grant.challenge !== challenge || grant.redirect !== form.get('redirect_uri')) return json(response, 400, { error: 'invalid_grant' })
        return json(response, 200, issue())
      }
      if (form.get('grant_type') === 'refresh_token' && refresh.delete(form.get('refresh_token'))) return json(response, 200, issue())
      return json(response, 400, { error: 'invalid_grant' })
    }
    if (url.pathname === '/mcp') {
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '')
      if (!bearer || !access.has(bearer)) {
        await body(request)
        return response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="mcp"`, 'content-type': 'text/plain' }).end('Unauthorized')
      }
      if (request.method !== 'POST') return response.writeHead(405).end()
      const message = JSON.parse(await body(request))
      if (message.id === undefined) return response.writeHead(202).end()
      const reply = result => json(response, 200, { jsonrpc: '2.0', id: message.id, result })
      if (message.method === 'initialize') return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'oauth-fixture', version: '1.0.0' } })
      if (message.method === 'tools/list') return reply({ tools: [{ name: 'whoami', description: 'Says which signed-in account is connected.', inputSchema: { type: 'object', properties: {} } }] })
      if (message.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'Signed in as the fixture account.' }] })
      if (message.method === 'ping') return reply({})
      return json(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
    }
    response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  return {
    url: `${base}/mcp`, base, log, clients, access,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = await startOAuthMcpFixture({ port: Number(process.argv[2] ?? 0), refuseRegistration: process.argv.includes('--refuse') })
  console.log(`OAuth MCP fixture at ${fixture.url}`)
}
