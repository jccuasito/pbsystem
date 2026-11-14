import crypto from 'node:crypto'
import { createError, getRequestHeader, getRequestURL, setHeader } from 'h3'
import { validateRequestObject } from './inputValidation'

const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const attempts = new Map<string, { count: number; expires: number }>()

export function assertSameOrigin(event: any) {
  const origin = getRequestHeader(event, 'origin'), referer = getRequestHeader(event, 'referer')
  const configured = process.env.APP_URL
  // A configured production URL is authoritative behind a TLS reverse proxy.
  const target = configured && process.env.NODE_ENV === 'production' ? new URL(configured).origin : getRequestURL(event).origin
  if (getRequestHeader(event, 'sec-fetch-site') === 'cross-site') throw createError({ statusCode: 403, statusMessage: 'Open the system directly to continue.' })
  if (origin || referer) {
    let source = ''
    try { source = new URL(origin || referer!).origin } catch { /* reject malformed / opaque origins */ }
    if (source !== target) throw createError({ statusCode: 403, statusMessage: 'Open the system directly to continue.' })
  }
}

export function limitAuthentication(event: any, path: string, body: Record<string, unknown> = {}) {
  if (!/^\/api\/(?:auth\/|employee-portal\/auth\/)/.test(path) || path.endsWith('/logout')) return
  const action = path.split('/').pop()!, now = Date.now(), window = 15 * 60 * 1000
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key)
  const address = event.node.req.socket?.remoteAddress || 'unknown'
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const specific = ['verify-email', 'recovery', 'forgot-password', 'resend-verification'].includes(action) ? 5 : 15
  const keys: [string, number][] = [[`${path}:ip:${address}`, 60]]
  if (email) keys.push([`${path}:identity:${email}`, specific])
  for (const [identity, max] of keys) {
    const key = crypto.createHash('sha256').update(identity).digest('hex')
    let state = attempts.get(key)
    if (!state) {
      if (attempts.size >= 10000) throw createError({ statusCode: 429, statusMessage: 'Too many requests. Try again later.' })
      state = { count: 0, expires: now + window }; attempts.set(key, state)
    }
    if (++state.count > max) {
      setHeader(event, 'Retry-After', Math.ceil((state.expires - now) / 1000))
      throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Try again in 15 minutes.' })
    }
  }
}

export function bodyLimit(path: string) {
  if (path === '/api/settings/backups/import') return 101 * 1024 * 1024
  if (/^\/api\/auth\//.test(path)) return path.endsWith('/upload-avatar') ? 3 * 1024 * 1024 : 16384
  if (/^\/api\/employee-portal\//.test(path)) return 16384
  return 10 * 1024 * 1024
}

/** Cache a bounded buffer for h3 readers, including chunked requests with no Content-Length. */
export async function readBoundedBody(event: any, maximum: number): Promise<Buffer> {
  const req = event.node.req, symbol = Symbol.for('h3RawBody')
  const claimed = getRequestHeader(event, 'content-length')
  if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > maximum)) throw createError({ statusCode: 413, statusMessage: 'This request is too large.' })
  const saved = event._requestBody || req[symbol] || req.rawBody || req.body
  const result: Buffer = saved ? Buffer.from(await saved) : await new Promise((resolve, reject) => {
    let size = 0, chunks: Buffer[] = []
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted) }
    const failed = () => { cleanup(); reject(createError({ statusCode: 400, statusMessage: 'Unable to read this request.' })) }
    const aborted = () => failed()
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > maximum) { cleanup(); chunks = []; req.resume(); reject(createError({ statusCode: 413, statusMessage: 'This request is too large.' })); return }
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    req.on('data', data); req.on('end', end); req.on('error', failed); req.on('aborted', aborted)
    if (req.readableEnded) end()
  })
  if (result.length > maximum) throw createError({ statusCode: 413, statusMessage: 'This request is too large.' })
  req[symbol] = Promise.resolve(result)
  return result
}

export async function secureApiRequest(event: any, path: string) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const url = getRequestURL(event), params = url.searchParams
  if (url.search.length > 16384 || [...params].length > 100) throw createError({ statusCode: 400, statusMessage: 'Too many query parameters.' })
  const names = new Set<string>()
  for (const [name, value] of params) {
    if (names.has(name) || ['__proto__', 'constructor', 'prototype'].includes(name) || /[\u0000-\u001f\u007f]/.test(name + value) || value.length > 4096) throw createError({ statusCode: 400, statusMessage: 'Invalid or repeated query parameter.' })
    names.add(name)
  }
  if (!mutations.has(event.method || event.node.req.method)) return
  assertSameOrigin(event)
  const type = (getRequestHeader(event, 'content-type') || '').split(';')[0].trim().toLowerCase()
  const multipart = path === '/api/settings/backups/import' && type === 'multipart/form-data'
  const hasBody = Number(getRequestHeader(event, 'content-length') || 0) > 0 || Boolean(getRequestHeader(event, 'transfer-encoding'))
  if (!multipart && type !== 'application/json' && (hasBody || type)) throw createError({ statusCode: 415, statusMessage: 'Send an application/json request.' })
  const raw = await readBoundedBody(event, bodyLimit(path))
  if (multipart) return
  if (!raw.length && !['/api/auth/logout', '/api/employee-portal/auth/logout', '/api/settings/backups'].includes(path)) throw createError({ statusCode: 400, statusMessage: 'Send a JSON object.' })
  let body: Record<string, unknown> = {}
  if (raw.length) {
    try { body = JSON.parse(raw.toString('utf8')) } catch { throw createError({ statusCode: 400, statusMessage: 'Send valid JSON.' }) }
    const dtrImportRows = (event.method || event.node.req.method) === 'POST'
      && /^\/api\/attendance\/dtr\/[1-9]\d*\/records$/.test(path) && body?.ImportRows === true
    validateRequestObject(body, { dtrImportRows })
  }
  limitAuthentication(event, path, body)
}
