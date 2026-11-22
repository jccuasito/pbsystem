// Test-only direct handler probe. Does not install an auth bypass in the app.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import mysql from 'mysql2/promise'
import { build } from 'esbuild'
import { localConfig, root } from './helpers/scale-fixture.mjs'
const require = createRequire(import.meta.url), database = process.argv.find(a => a.startsWith('--database='))?.slice(11)
if (!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database || '') || database === process.env.DB_NAME) throw Error('Exact generated synthetic database required')
const folder = path.join(root, database), output = path.join(folder, 'read-probe.cjs'), queries = []
const payslipsOnly=process.argv.includes('--payslips')
const db = await mysql.createConnection({ ...localConfig(), database })
try {
  const [[marker]] = await db.execute('SELECT Marker FROM scale_test_manifest')
  if (marker.Marker !== 'SYNTHETIC_ONLY_MILLION_4_500_150_V1') throw Error('Unexpected fixture')
  await db.execute('SET SESSION TRANSACTION READ ONLY')
  if(payslipsOnly)await db.query('SET SESSION max_statement_time=20')
  globalThis.millionProbeDb = { execute: async (sql, params = []) => {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw Error('Only SELECT queries permitted')
    const explainStart = performance.now()
    const [steps] = await db.execute('EXPLAIN ' + sql, params)
    const entry={sql,params,explainMs:Math.round(performance.now()-explainStart),plan:steps};queries.push(entry)
    const file=path.join(folder,payslipsOnly?'million-payslip-query-probe.json':'million-query-probe-queries.json')
    fs.writeFileSync(file,JSON.stringify({database,queries},null,2))
    const start=performance.now()
    try{const result=await db.execute(sql,params);entry.ms=Math.round(performance.now()-start);return result}
    catch(error){entry.error=error.message;entry.ms=Math.round(performance.now()-start);throw error}
    finally{fs.writeFileSync(file,JSON.stringify({database,queries},null,2))}
  } }
  await build({ stdin: { contents: "export {listEmployees} from './server/utils/employeeCrud'; export {listEmployeeLoanDeductions} from './server/utils/employeeLoanDeductionCrud'; export {listSitePayslips} from './server/utils/payslipSiteCrud';", resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'million-read-probe', setup(b) {
    b.onResolve({ filter: /connection\/dbconnect$/ }, () => ({ path: 'db', namespace: 'probe' }))
    b.onResolve({ filter: /^h3$/ }, () => ({ path: 'h3', namespace: 'probe' }))
    b.onLoad({ filter: /.*/, namespace: 'probe' }, args => ({ contents: args.path === 'db' ? 'export default globalThis.millionProbeDb;' : `export * from ${JSON.stringify(require.resolve('h3'))};export const getQuery=e=>e.query||{};export const setHeader=()=>{};`, resolveDir: process.cwd(), loader: 'js' }))
    b.onLoad({ filter: /[\\/]auth\.ts$/ }, () => ({ contents: "export function requireSession(e){if(!e.context?.syntheticSession)throw Error('Synthetic session required');return{sub:1,userType:'Viewer'}};export const hashPassword=()=>{throw Error('Not available in read probe')};", loader: 'js' }))
  } }] })
  const api = require(output), results = []
  if(payslipsOnly){
    const response=await api.listSitePayslips({query:{page:'1',periodStart:'2026-09-01',periodEnd:'2026-09-15'},context:{syntheticSession:true}})
    console.log(JSON.stringify({items:response.items.length,pagination:response.pagination,queries:queries.map(q=>({ms:q.ms,plan:q.plan}))}))
    process.exitCode=0
  }else{
  const after=Buffer.from(JSON.stringify({kind:'employee',values:['WORKER 001000','SYNTHETIC','MILLION-001000',1000]})).toString('base64url')
  for (const [label, read, query] of [['employee-first', api.listEmployees, { page: '1', pageSize: '25', includeLookups: '0' }], ['employee-deep-cursor', api.listEmployees, { page: '2', pageSize: '25', includeLookups: '0', after }], ['employee-id-search', api.listEmployees, { page: '1', search: 'EMP-1000000', includeLookups: '0' }], ['employee-accounts', api.listEmployeeLoanDeductions, { page: '1', pageSize: '25' }]]) {
    const before = queries.length, start = performance.now(), response = await read({ query, context: { syntheticSession: true } })
    results.push({ label, returned: response.items.length, pagination: response.pagination, ms: Math.round(performance.now() - start), queries: queries.slice(before) })
    fs.writeFileSync(path.join(folder, 'million-query-probe-progress.json'), JSON.stringify({ database, results }, null, 2))
    console.log(label, Math.round(performance.now() - start) + 'ms')
  }
  fs.writeFileSync(path.join(folder, 'million-query-plans-' + Date.now() + '.json'), JSON.stringify({ database, results }, null, 2))
  }
} finally { delete globalThis.millionProbeDb; await db.end() }
