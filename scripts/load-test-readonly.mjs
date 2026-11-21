import { performance } from 'node:perf_hooks'

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const base = new URL(option('url', 'http://127.0.0.1:3106'))
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw Error('This controlled load check only targets localhost. Test hosting separately with its permission and quotas.')
const users = Number(option('users', '50')), rounds = Number(option('rounds', '2'))
if (!Number.isInteger(users) || users < 1 || users > 50 || !Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw Error('Use 1–50 clients and 1–5 rounds.')
if (!process.env.LOAD_TEST_COOKIE) throw Error('Provide an existing staff session in LOAD_TEST_COOKIE; it is never printed or stored by this script.')
const suite=option('suite','dashboard')
if(!['dashboard','lists'].includes(suite))throw Error('Use --suite=dashboard or --suite=lists.')
const routes=suite==='lists'?['/api/organization/site','/api/organization/client','/api/rates/site-rate','/api/rates/payroll-rate?view=groups','/api/rates/billing-rate?view=groups','/api/attendance/dtr'].map(route=>route+(route.includes('?')?'&':'?')+'page=1&pageSize=25&includeLookups=0'):['/api/dashboard/stats','/api/dashboard/recent-payroll','/api/dashboard/recent-activity','/api/dashboard/payroll-progress']
async function health(){
 if(option('health','false')!=='true')return undefined
 const response=await fetch(new URL('/api/settings/health',base),{headers:{cookie:process.env.LOAD_TEST_COOKIE},redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw Error('Admin health check failed with HTTP '+response.status)
 const {memoryMb,heapUsedMb,cpuMs,eventLoop,pool,requests}=await response.json()
 return{memoryMb,heapUsedMb,cpuMs,eventLoop,pool,activeRequests:requests.active,peakRequests:requests.peak,rejectedRequests:requests.rejected,slowRequests:requests.slow}
}
const before=await health(),byRoute={}
const durations = [], statuses = {}, started = performance.now()
await Promise.all(Array.from({ length: users }, async () => {
  for (let n = 0; n < rounds; n++) for (const template of routes) {
    const route=suite==='lists'&&n===0?template.replace('includeLookups=0','includeLookups=1'):template
    const start = performance.now()
    try {
      const response = await fetch(new URL(route, base), { headers: { cookie: process.env.LOAD_TEST_COOKIE }, redirect:'error',signal: AbortSignal.timeout(15000) })
      await response.arrayBuffer()
      statuses[response.status] = (statuses[response.status] || 0) + 1
    } catch { statuses.networkError = (statuses.networkError || 0) + 1 }
    const elapsed=performance.now()-start
    durations.push(elapsed);(byRoute[route.split('?')[0]] ||= []).push(elapsed)
  }
}))
durations.sort((a, b) => a - b)
const percentile = p => Math.round(durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)])
const after=await health()
console.log(JSON.stringify({suite,concurrentReadClients:users,requests:durations.length,elapsedMs:Math.round(performance.now()-started),statuses,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:percentile(1),byRoute:Object.fromEntries(Object.entries(byRoute).map(([route,times])=>{times.sort((a,b)=>a-b);return[route,{requests:times.length,p95Ms:Math.round(times[Math.ceil(times.length*.95)-1]),maxMs:Math.round(times.at(-1))}]})),before,after,scope:'Loopback reads and current local dataset; not a hosting or mixed-write capacity guarantee'},null,2))
if (Object.keys(statuses).some(status => status !== '200')) process.exitCode = 1
