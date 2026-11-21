// Local SELECT/EXPLAIN only. Prints plans and measurements, never row values,
// SQL parameters, sessions or credentials. Small data is not a capacity test.
import mysql from 'mysql2/promise'
import {createRequire} from 'node:module'
const {readOnlyApi,event,localConfig}=createRequire(import.meta.url)('./helpers/read-only-api-fixture.cjs')
const db=await mysql.createConnection(localConfig()),queries=[]
try{
 await db.query('SET SESSION TRANSACTION READ ONLY')
 const api=await readOnlyApi(db,queries),results=[]
 for(const [resource,load] of [['site',api.listOrganizationResource],['client',api.listOrganizationResource],['site-rate',api.listRateResource],['payroll-rate',api.listRateResource],['billing-rate',api.listRateResource],['dtr',api.listDtrs]]){
  const start=queries.length,started=performance.now()
  const result=await load(event(resource,{page:'1',pageSize:'25',includeLookups:'0',...(resource==='payroll-rate'||resource==='billing-rate'?{view:'groups'}:{})}))
  const duration=performance.now()-started,plans=[]
  for(const query of queries.slice(start)){
   const [explain]=await db.execute('EXPLAIN '+query.sql,query.params)
   plans.push({queryMs:Number(query.ms.toFixed(2)),steps:explain.map(row=>({table:row.table,type:row.type,key:row.key,estimatedRows:row.rows,extra:row.Extra}))})
  }
  results.push({resource,returned:result.items.length,total:result.pagination.total,responseBytes:Buffer.byteLength(JSON.stringify(result)),durationMs:Number(duration.toFixed(2)),plans})
 }
 console.log(JSON.stringify({scope:'Loopback SELECT/EXPLAIN on current data; not a hosting capacity test',results},null,2))
}finally{await db.end()}
