import { performance } from 'node:perf_hooks'

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const base = new URL(option('url', 'http://127.0.0.1:3106'))
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw Error('This controlled load check only targets localhost. Test hosting separately with its permission and quotas.')
const users = Number(option('users', '50')), rounds = Number(option('rounds', '2'))
if (!Number.isInteger(users) || users < 1 || users > 50 || !Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw Error('Use 1–50 clients and 1–5 rounds.')
if (!process.env.LOAD_TEST_COOKIE) throw Error('Provide an existing staff session in LOAD_TEST_COOKIE; it is never printed or stored by this script.')
const routes = ['/api/dashboard/stats', '/api/dashboard/recent-payroll', '/api/dashboard/recent-activity', '/api/dashboard/payroll-progress']
const durations = [], statuses = {}, started = performance.now()
await Promise.all(Array.from({ length: users }, async () => {
  for (let n = 0; n < rounds; n++) for (const route of routes) {
    const start = performance.now()
    try {
      const response = await fetch(new URL(route, base), { headers: { cookie: process.env.LOAD_TEST_COOKIE }, signal: AbortSignal.timeout(15000) })
      await response.arrayBuffer()
      statuses[response.status] = (statuses[response.status] || 0) + 1
    } catch { statuses.networkError = (statuses.networkError || 0) + 1 }
    durations.push(performance.now() - start)
  }
}))
durations.sort((a, b) => a - b)
const percentile = p => Math.round(durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)])
console.log(JSON.stringify({ concurrentReadClients: users, requests: durations.length, elapsedMs: Math.round(performance.now() - started), statuses, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1), scope: 'read-only dashboard requests on this machine; not a hosting or mixed-write capacity guarantee' }, null, 2))
if (Object.keys(statuses).some(status => status !== '200')) process.exitCode = 1
