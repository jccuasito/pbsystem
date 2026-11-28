// Local synthetic integration: real HTTP, two app processes, real transactions.
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import jwt from 'jsonwebtoken'
import {localConfig,identifier,root,insert,expectedPay,rates} from './helpers/scale-fixture.mjs'

const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database||'')||database===process.env.DB_NAME)throw Error('Exact generated local synthetic database required')
const folder=path.join(root,database),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'))
assert.equal(manifest.syntheticOnly,true)
const db=await mysql.createConnection({...localConfig(),database})
const [[marker]]=await db.execute('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_6000_500_150_V1')
const user='queue_'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),secret=randomBytes(48).toString('hex')
const children=new Map(),logs=[],requests=[],checks=[]
let created=false,failed
const note=(label,details=true)=>{checks.push({label,details});console.log(label,JSON.stringify(details))}
const cookie=id=>'pbs_session='+jwt.sign({sub:id,email:id===1?'admin@scale.example.invalid':id===2?'viewer@scale.example.invalid':'supervisor@scale.example.invalid',userType:id===1?'Admin':id===2?'Viewer':'Supervisor'},secret,{issuer:'pbsystem',audience:'pbsystem-web',expiresIn:'2h'})
async function request(route,body,options={}){
  const base='http://127.0.0.1:'+(options.port||3198),start=performance.now()
  const response=await fetch(base+route,{method:options.method||(body===undefined?'GET':'POST'),headers:{cookie:options.anonymous?'':cookie(options.actor||1),origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)})
  const result=await response.json();requests.push({route,status:response.status,ms:Math.round(performance.now()-start)})
  assert.ok((options.status||[200]).includes(response.status),`${response.status} ${route}: ${JSON.stringify(result).slice(0,250)}`)
  return result
}
async function stop(port){const child=children.get(port);if(!child)return;if(child.exitCode===null){child.kill();await once(child,'exit')}children.delete(port)}
async function start(port,worker){
  try{await fetch(`http://127.0.0.1:${port}/health/live`,{signal:AbortSignal.timeout(300)});throw Error('Owned test port already occupied')}catch(e){if(e.message==='Owned test port already occupied')throw e}
  const base=`http://127.0.0.1:${port}`
  const child=spawn(process.execPath,['--max-old-space-size=512','.output/server/index.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DB_NAME:database,DB_USER:user,DB_PASSWORD:password,JWT_SECRET:secret,APP_URL:base,HOST:'127.0.0.1',PORT:String(port),NITRO_HOST:'127.0.0.1',NITRO_PORT:String(port),PAYROLL_QUEUE_ENABLED:'true',PAYROLL_QUEUE_WORKER:String(worker),DB_AUTO_BACKUP:'false',LEGAL_HOLIDAY_AUTO_SEED:'false',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',GOOGLE_CLIENT_ID:'',DB_BACKUP_DIR:path.join(folder,'backups')}})
  children.set(port,child)
  for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{logs.push(chunk.toString());if(logs.length>200)logs.shift()})
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Test app exited: '+logs.join('').slice(-1000))
    try{if((await fetch(base+'/health/ready')).ok){const me=await request('/api/auth/me',undefined,{port});assert.ok(JSON.stringify(me).includes('admin@scale.example.invalid'));return}}catch{}
    await new Promise(r=>setTimeout(r,200))
  }
  throw Error('Test app readiness timeout')
}
async function parallel(items,concurrency,work){let i=0,error;await Promise.all(Array.from({length:Math.min(items.length,concurrency)},async()=>{while(!error&&i<items.length){const item=items[i++];try{await work(item)}catch(e){error||=e}}}));if(error)throw error}
async function preview(batch){const r=await request(`/api/payroll/processing?page=1&pageSize=1&batchId=${batch}&periodStart=2026-09-01&periodEnd=2026-09-15&status=Pending&includeLookups=0`);assert.equal(r.items.length,1);assert.match(r.items[0].reviewHash,/^[a-f0-9]{64}$/);return r.items[0]}
async function waitForJobs(){
  for(let i=0;i<180;i++){
    const [counts]=await db.execute('SELECT Status,COUNT(*) AS n FROM payroll_job GROUP BY Status')
    if(i%5===0)console.log('Job progress',JSON.stringify(counts))
    if(!counts.some(r=>['Queued','Running'].includes(r.Status)))return counts
    await new Promise(r=>setTimeout(r,2000))
  }
  throw Error('Queued jobs did not drain within six minutes')
}
try{
  const [[used]]=await db.execute('SELECT COUNT(*) AS n FROM payroll');assert.equal(Number(used.n),0,'Fresh financial fixture required')
  const ddl=await fs.readFile('database/runtime-queue-cache.sql','utf8')+';'+await fs.readFile('database/user-activity-history.sql','utf8')
  for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.query(sql)
  await insert(db,'user',[{UserID:3,FirstName:'SCALE',LastName:'Supervisor',Gender:'Prefer not to say',Email:'supervisor@scale.example.invalid',EmailVerified:1,DepartmentID:1,UserType:'Supervisor'}])
  await db.query('CREATE USER ?@? IDENTIFIED BY ?',[user,'localhost',password]);created=true
  await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(database)}.* TO ?@?`,[user,'localhost'])
  const limited=await mysql.createConnection({...localConfig(),database,user,password})
  try{await assert.rejects(limited.query('SELECT 1 FROM '+identifier(manifest.sourceSchema)+'.employee LIMIT 1'),/denied/i)}finally{await limited.end()}
  await start(3198,false);await start(3199,false)
  const before=await request('/api/settings/health')
  for(let i=0;i<10;i++)await request('/api/organization/agency?page=1&pageSize=25')
  const viewer=await request('/api/organization/agency?page=1&pageSize=25',undefined,{actor:2});assert.equal(viewer.canEdit,false)
  await request('/api/organization/agency?page=1',undefined,{anonymous:true,status:[401]})
  const warm=await request('/api/organization/agency?page=1&pageSize=25',undefined,{port:3199})
  const previous=warm.items.find(r=>r.AgencyID===10).AgencyName,newName='SCALE cache invalidation verified'
  await request('/api/organization/agency',{id:10,AgencyName:newName,Status:'Active'},{method:'PUT'})
  const fresh=await request('/api/organization/agency?page=1&pageSize=25',undefined,{port:3199})
  assert.equal(fresh.items.find(r=>r.AgencyID===10).AgencyName,newName)
  await request('/api/organization/agency',{id:10,AgencyName:previous,Status:'Active'},{method:'PUT'})
  const after=await request('/api/settings/health');assert.ok(after.lookupCache.hits-before.lookupCache.hits>=9)
  note('Metadata cache hits, per-caller edit access, authentication and cross-process invalidation verified',{hits:after.lookupCache.hits-before.lookupCache.hits})
  await stop(3199)
  const batches=Array.from({length:101},(_,i)=>i+1),bodies=new Map(),jobIds=new Map()
  await parallel(batches,2,async batch=>{
    await request(`/api/attendance/dtr/${batch}/compute`,{target:'payroll'})
    const site=await preview(batch);bodies.set(batch,{batchId:batch,requestKey:randomUUID(),expectedHash:site.reviewHash})
  })
  const first=await request('/api/payroll/jobs',bodies.get(1),{status:[202]});jobIds.set(1,first.job.id)
  const begin=requests.length
  await parallel(batches.slice(1),100,async batch=>{const r=await request('/api/payroll/jobs',bodies.get(batch),{actor:batch===3?3:1,status:[202]});jobIds.set(batch,r.job.id)})
  note('100 simultaneous distinct payroll submissions durably accepted',requests.slice(begin).map(r=>r.status).reduce((s,c)=>(s[c]=(s[c]||0)+1,s),{}))
  assert.equal((await request('/api/payroll/jobs',bodies.get(1))).job.id,first.job.id)
  await request('/api/payroll/jobs',{...bodies.get(1),expectedHash:'a'.repeat(64)},{status:[409]})
  await request('/api/payroll/jobs',bodies.get(1),{actor:2,status:[403]})
  await request('/api/payroll/jobs/'+first.job.id,undefined,{actor:3,status:[404]})
  const [[queued]]=await db.execute('SELECT COUNT(*) AS n FROM payroll_job');assert.equal(Number(queued.n),101)
  await db.execute("UPDATE attendance SET RegularHours=RegularHours+1 WHERE BatchID=2 AND EmployeeID=13 AND AttendanceDate='2026-09-01'")
  await db.execute("UPDATE `user` SET UserType='Viewer' WHERE UserID=3")
  await db.query("CREATE TRIGGER scale_job_rollback BEFORE UPDATE ON payroll_job FOR EACH ROW BEGIN IF NEW.Status='Succeeded' AND NEW.BatchID=4 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic atomic job completion failure'; END IF; END")
  await stop(3198)
  await db.beginTransaction();await db.execute('SELECT BatchID FROM attendance_dtr WHERE BatchID=1 FOR UPDATE')
  await start(3198,true)
  let running=false
  for(let i=0;i<100;i++){const [[job]]=await db.execute('SELECT Status FROM payroll_job WHERE JobID=?',[first.job.id]);if(job.Status==='Running'){running=true;break}await new Promise(r=>setTimeout(r,100))}
  assert.ok(running);await stop(3198)
  const [connections]=await db.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=? AND DB=?',[user,database])
  for(const connection of connections)await db.query('KILL CONNECTION '+Number(connection.ID))
  await db.rollback();await start(3198,true)
  const stages=await waitForJobs()
  assert.equal(Number(stages.find(r=>r.Status==='Succeeded').n),98)
  assert.equal(Number(stages.find(r=>r.Status==='NeedsReview').n),1)
  assert.equal(Number(stages.find(r=>r.Status==='Failed').n),2)
  const [[recovered]]=await db.execute('SELECT Status,Attempts FROM payroll_job WHERE JobID=?',[first.job.id]);assert.equal(recovered.Status,'Succeeded');assert.equal(Number(recovered.Attempts),2)
  const [[blocked]]=await db.execute('SELECT COUNT(*) AS n FROM payroll_processing_posting WHERE BatchID IN (2,3,4)');assert.equal(Number(blocked.n),0)
  const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM payroll');assert.equal(Number(count.n),1176)
  note('Restart recovery, changed-preview rejection, revoked-role rejection and atomic rollback verified',stages)
  await db.query('DROP TRIGGER scale_job_rollback');await db.execute("UPDATE `user` SET UserType='Supervisor' WHERE UserID=3")
  for(const batch of[2,3,4]){const site=await preview(batch);await request('/api/payroll/jobs',{batchId:batch,requestKey:randomUUID(),expectedHash:site.reviewHash},{actor:batch===3?3:1,status:[202]})}
  await waitForJobs()
  const [payroll]=await db.execute('SELECT EmployeeID,GrossPay,TotalDeduction,NetPay FROM payroll ORDER BY EmployeeID')
  assert.equal(payroll.length,1212)
  for(const row of payroll){const expected=expectedPay(Number(row.EmployeeID),0);if(Number(row.EmployeeID)===13){const extra=Math.round(rates(1,2).RegularRate*100);expected.gross+=extra;expected.net+=extra}for(const [col,key]of[['GrossPay','gross'],['TotalDeduction','deductions'],['NetPay','net']])assert.equal(Math.round(Number(row[col])*100),expected[key],`${row.EmployeeID} ${col}`)}
  const [[duplicates]]=await db.execute('SELECT COUNT(*) AS n FROM (SELECT EmployeeID,StartDate,EndDate FROM payroll GROUP BY EmployeeID,StartDate,EndDate HAVING COUNT(*)>1) repeated');assert.equal(Number(duplicates.n),0)
  const [loans]=await db.execute('SELECT EmployeeID,RemainingBalance FROM employee_loan')
  for(const row of loans)assert.equal(Number(row.RemainingBalance),Number(row.EmployeeID)<=1212&&Number(row.EmployeeID)%30!==0?5500:6000)
  const [deductions]=await db.execute('SELECT EmployeeID,RemainingBalance FROM employee_deduction')
  for(const row of deductions)assert.equal(Number(row.RemainingBalance),Number(row.EmployeeID)<=1212?875:1000)
  assert.equal((await request('/api/payroll/jobs/'+first.job.id)).job.status,'Succeeded')
  assert.equal((await request('/api/payroll/jobs',bodies.get(1))).job.status,'Succeeded')
  note('1,212 queued payrolls match independent cents; all balances correct; completed request replay creates no duplicate')
}catch(error){failed=error.stack;console.error(error);process.exitCode=1}
finally{
  await db.rollback().catch(()=>{})
  for(const port of[3198,3199])await stop(port)
  const [connections]=await db.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=? AND DB=?',[user,database])
  for(const connection of connections)await db.query('KILL CONNECTION '+Number(connection.ID))
  if(created)await db.query('DROP USER ?@?',[user,'localhost'])
  await db.end()
  await fs.writeFile(path.join(folder,'queue-cache-result.json'),JSON.stringify({database,finished:new Date().toISOString(),error:failed,checks,requests},null,2))
  await fs.writeFile(path.join(folder,'queue-cache-server.log'),logs.join(''))
}
