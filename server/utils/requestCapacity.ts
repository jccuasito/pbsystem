import { createError, setHeader } from 'h3'

export function boundedSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

const limits = {
  requests: boundedSetting('API_CONCURRENCY_LIMIT', 128, 8, 512),
  heavy: boundedSetting('HEAVY_CONCURRENCY_LIMIT', 2, 1, 8),
}
const counts = { active: 0, peak: 0, completed: 0, rejected: 0, slow: 0, heavy: 0 }
export function requestCapacity() { return { ...counts, limits: { ...limits } } }

export function admitApiRequest(event: any, path: string) {
  if (event.context.capacityLease) return
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(event.method || event.node.req.method)
  const heavy = mutation && (/^\/api\/attendance\/dtr\//.test(path) || /^\/api\/(?:payroll|billing)\//.test(path) || /^\/api\/settings\/backups/.test(path))
  if (counts.active >= limits.requests || (heavy && counts.heavy >= limits.heavy)) {
    counts.rejected++
    setHeader(event, 'Retry-After', '3')
    setHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 503, statusMessage: heavy ? 'Other imports or payroll updates are running. Please try again shortly.' : 'The server is busy. Please try again shortly.' })
  }
  counts.active++; if (heavy) counts.heavy++
  counts.peak = Math.max(counts.peak, counts.active)
  event.context.capacityLease = { started: Date.now(), heavy }
}

// Called after the handler completes, including errors. A disconnected browser
// must not free capacity while its database transaction is still running.
export function completeApiRequest(event: any) {
  const lease = event.context.capacityLease
  if (!lease) return
  delete event.context.capacityLease
  counts.active--; if (lease.heavy) counts.heavy--
  counts.completed++
  const elapsed = Date.now() - lease.started
  if (elapsed >= boundedSetting('SLOW_REQUEST_MS', 2000, 100, 120000)) {
    counts.slow++
    // No query strings, bodies, cookies, tokens or SQL values in diagnostics.
    console.warn('[slow-request]', event.method, (event.path || '').split('?')[0], `${elapsed}ms`)
  }
}

const pending = new Map<string, Promise<unknown>>()
/** Share simultaneous dashboard reads only; never cache sessions or settled data. */
export function coalesceRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  if (pending.size >= 100) return read()
  const result = Promise.resolve().then(read).finally(() => { if (pending.get(key) === result) pending.delete(key) })
  pending.set(key, result)
  return result
}
