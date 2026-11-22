import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import mysql from 'mysql2/promise'
import {identifier,localConfig,root} from './helpers/scale-fixture.mjs'
const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database||'')||database===process.env.DB_NAME)throw Error('Exact generated synthetic database required')
const folder=path.join(root,database)
let suite
for(let i=0;;i++){
 suite=JSON.parse(await fs.readFile(path.join(folder,'suite-progress.json'),'utf8'))
 assert.equal(suite.database,database)
 if(suite.complete)break
 if(suite.phases.some(p=>p.status==='failed'))throw Error('Suite has a failed phase; not a completed capacity result')
 if(!process.argv.includes('--wait')||i>=1080)throw Error('Suite is not complete')
 await new Promise(r=>setTimeout(r,10000))
}
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'))
assert.equal(manifest.profile,'million');assert.equal(manifest.syntheticOnly,true)
const db=await mysql.createConnection({...localConfig(),database})
try{
 const [[marker]]=await db.query('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_MILLION_4_500_150_V1')
 const counts={}
 for(const [table,expected]of[['employee',1000000],['agency',4],['site',500],['client',150],['attendance',15000000],['employee_portal_account',1000000],['employee_portal_session',1000000]]){
  const [[r]]=await db.query('SELECT COUNT(*) AS n FROM '+identifier(table));counts[table]=Number(r.n);assert.equal(Number(r.n),expected)
 }
 const [[financial]]=await db.query(`SELECT
  (SELECT COUNT(*) FROM payroll WHERE Status='Approved') AS payrolls,
  (SELECT COUNT(DISTINCT EmployeeID) FROM payroll WHERE Status='Approved') AS payrollEmployees,
  (SELECT COUNT(*) FROM payroll_processing_posting WHERE Status='Active') AS postings,
  (SELECT COUNT(DISTINCT PayrollID) FROM payroll_processing_posting WHERE Status='Active') AS postingPayrollIds,
  (SELECT COUNT(*) FROM payslip_publication WHERE Status='Posted') AS payslips,
  (SELECT COUNT(*) FROM payslip_publication_source) AS publicationSources,
  (SELECT COUNT(DISTINCT PayrollID) FROM payslip_publication_source) AS publicationPayrollIds,
  (SELECT COUNT(*) FROM employee_account_transaction WHERE Status='Posted') AS receipts,
  (SELECT COUNT(*) FROM employee_loan WHERE RemainingBalance<>IF(MOD(EmployeeID,30)=0,6000,5500)) AS badLoanBalances,
  (SELECT COUNT(*) FROM employee_deduction WHERE RemainingBalance<>875) AS badInstallmentBalances`)
 for(const key of ['payrolls','payrollEmployees','postings','postingPayrollIds','payslips','publicationSources','publicationPayrollIds'])assert.equal(Number(financial[key]),1000000,key)
 assert.equal(Number(financial.receipts),550000);assert.equal(Number(financial.badLoanBalances),0);assert.equal(Number(financial.badInstallmentBalances),0)
 const [[money]]=await db.query(`SELECT
  (SELECT SUM(NetPay) FROM payroll WHERE Status='Approved') AS netPay,
  (SELECT SUM(Amount) FROM payroll_detail) AS detailAmount,
  (SELECT SUM(Amount) FROM payroll_deduction) AS deductionAmount`)
 const cents=value=>Math.round(Number(value)*100)
 assert.equal(cents(money.netPay),cents(money.detailAmount)-cents(money.deductionAmount))
 const phases=[]
 for(const phase of suite.phases){
  assert.equal(phase.status,'complete')
  const log=await fs.readFile(phase.log,'utf8'),line=log.trim().split(/\r?\n/).reverse().find(l=>l.startsWith('{"phase":'))
  assert.ok(line,'Phase report missing: '+phase.phase)
  const meta=JSON.parse(line);assert.equal(path.dirname(path.resolve(meta.reportPath)),folder);assert.equal(meta.failed,false)
  const result=JSON.parse(await fs.readFile(meta.reportPath,'utf8'));assert.equal(result.running,false);assert.ok(!result.error)
  phases.push({phase:phase.phase,report:path.basename(meta.reportPath),requests:meta.requests,
   loadStages:result.checks.filter(c=>c.label.includes('concurrent users')).map(c=>({label:c.label,...c.details})),
   capacitySamples:result.checks.filter(c=>c.label.includes('100 staff readers')).map(c=>c.details),
   memoryMb:result.healthAfter?.result?.memoryMb,pool:result.healthAfter?.result?.pool})
 }
 const [[settings]]=await db.query('SELECT @@global.max_allowed_packet AS packetBytes,@@innodb_buffer_pool_size AS bufferBytes')
 assert.equal(Number(settings.packetBytes),1048576);assert.equal(Number(settings.bufferBytes),16777216)
 const lease=JSON.parse(await fs.readFile(path.join(folder,'packet-override.json'),'utf8'))
 const [[temporary]]=await db.execute('SELECT COUNT(*) AS n FROM mysql.user WHERE User=? AND Host=?',[lease.user,'localhost']);assert.equal(Number(temporary.n),0)
 const portOpen=await new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:3197});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value)};socket.on('connect',()=>finish(true));socket.on('error',()=>finish(false));socket.setTimeout(500,()=>finish(false))})
 assert.equal(portOpen,false)
 for(const table of ['employee','attendance_dtr','payroll'])await db.query('SELECT 1 FROM '+identifier(manifest.sourceSchema)+'.'+identifier(table)+' LIMIT 1')
 const summary={database,completed:new Date().toISOString(),counts,financial,money,phases,
  cleanup:{settings,latestTemporaryAccountRemoved:true,testPortClosed:true,ordinaryEmployeeDtrPayrollTablesReadable:true},
  conditions:{localOnly:true,temporaryPacketMiB:16,temporaryBufferMiB:256,heavySlots:2,apiAdmissionLimit:128,poolSize:10,siteSize:2000,cutoffs:1},
  limitations:['One million simultaneous portal clients were not generated. Portal load ramps up to 100 authenticated clients.',
   'Pre-established sessions and disabled test passwords do not benchmark login, signup, OAuth or email.',
   'Normalized attendance was seeded; this is not a fifteen-million-row workbook import test.',
   'Expected 503 backpressure is reported separately and is not an all-requests-success capacity pass.',
   'No live deployment, original business-data mutation, real payment, host failover or multi-year capacity certification.']}
 await fs.writeFile(path.join(folder,'summary.json'),JSON.stringify(summary,null,2))
 console.log(JSON.stringify({database,summary:path.join(folder,'summary.json'),financial,cleanup:summary.cleanup}))
}finally{await db.end()}
