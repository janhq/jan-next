export function loopbackFetch(input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Engine requests must stay on loopback.')
  return fetch(input, init)
}
