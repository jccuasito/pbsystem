// Reuses an explicitly named synthetic fixture. Never creates another database
// or writes business test records in the ordinary local application schema.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import mysql from 'mysql2/promise'
import {ensureActivityHistoryIndexes} from './helpers/activity-history-schema.mjs'
import jwt from 'jsonwebtoken'
import {localConfig,identifier,root} from './helpers/scale-fixture.mjs'

const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database||'')||database===process.env.DB_NAME)throw Error('Exact generated synthetic database required')
const manifest=JSON.parse(await fs.readFile(path.join(root,database,'manifest.json'),'utf8'));assert.equal(manifest.syntheticOnly,true)
const db=await mysql.createConnection({...localConfig(),database})
const [[marker]]=await db.execute('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_6000_500_150_V1')
const base='http://127.0.0.1:3199',user='audit_'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),secret=randomBytes(48).toString('hex')
const tag='ACTIVITY SYNTHETIC '+randomBytes(5).toString('hex'),ids=[],staff=[],checks=[],logs=[]
let child,granted=false,trigger=false
const note=(label,result=true)=>{checks.push({label,result});console.log(label,JSON.stringify(result))}
const cookie=(id=1,role='Admin')=>'pbs_session='+jwt.sign({sub:id,email:'audit@example.invalid',userType:role},secret,{issuer:'pbsystem',audience:'pbsystem-web',expiresIn:'1h'})
async function request(route,body,options={}){
 const response=await fetch(base+route,{method:options.method||(body===undefined?'GET':'POST'),headers:{cookie:options.anonymous?'':cookie(options.actor||1,options.role||'Admin'),origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 const json=await response.json();assert.equal(response.status,options.status||200,`${route}: ${JSON.stringify(json).slice(0,180)}`)
 return{json,history:response.headers.get('x-activity-history')}
}
try{
 try{await fetch(base+'/health/live',{signal:AbortSignal.timeout(300)});throw Error('Owned test port occupied')}catch(e){if(e.message==='Owned test port occupied')throw e}
 await db.query(await fs.readFile('database/user-activity-history.sql','utf8'));await ensureActivityHistoryIndexes(db)
 for(const role of ['Encoder','Supervisor']){
  const [result]=await db.execute("INSERT INTO `user`(FirstName,LastName,Gender,Email,EmailVerified,DepartmentID,UserType,Status) VALUES(?,?,'Prefer not to say',?,1,1,?,'Active')",['Activity',role,'activity-'+randomBytes(6).toString('hex')+'@example.invalid',role]);staff.push(Number(result.insertId))
 }
 await db.query('CREATE USER ?@? IDENTIFIED BY ?',[user,'localhost',password]);granted=true
 await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(database)}.* TO ?@?`,[user,'localhost'])
 const limited=await mysql.createConnection({...localConfig(),database,user,password})
 try{await assert.rejects(limited.query('SELECT 1 FROM '+identifier(manifest.sourceSchema)+'.employee LIMIT 1'),/denied/i)}finally{await limited.end()}
 child=spawn(process.execPath,['--max-old-space-size=512','.output/server/index.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DB_NAME:database,DB_USER:user,DB_PASSWORD:password,JWT_SECRET:secret,APP_URL:base,HOST:'127.0.0.1',PORT:'3199',NITRO_HOST:'127.0.0.1',NITRO_PORT:'3199',PAYROLL_QUEUE_ENABLED:'true',PAYROLL_QUEUE_WORKER:'true',DB_AUTO_BACKUP:'false',LEGAL_HOLIDAY_AUTO_SEED:'false',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',GOOGLE_CLIENT_ID:''}})
 for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{logs.push(chunk.toString());if(logs.length>100)logs.shift()})
 let ready=false
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Test app exited');try{if((await fetch(base+'/health/ready')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}
 assert.ok(ready)
 await request('/api/activity-history',undefined,{anonymous:true,status:401})
 assert.equal((await request('/api/settings/health')).json.activityHistory.recorderRegistered,true)
 const created=await request('/api/organization/agency',{AgencyName:tag,Status:'Active'},{actor:staff[0],role:'Encoder'})
 ids.push(created.json.id);assert.equal(created.history,'recorded')
 await request('/api/organization/agency',{id:ids[0],AgencyName:tag+' CHANGED',AgencyAddress:'Synthetic address verification',Status:'Active'},{method:'PUT'})
 await request('/api/organization/agency',{id:ids[0]},{method:'DELETE'})
 const team=(await request('/api/activity-history?scope=organization-agency')).json
 assert.equal(team.visibility,'Team');assert.ok(team.items.some(r=>r.action==='Create'&&r.actorId===staff[0]));assert.ok(team.items.some(r=>r.action==='Update'));assert.ok(team.items.some(r=>r.operation==='Deactivated agency'));assert.ok(team.items.some(r=>r.action==='Update'&&r.fields.includes('AgencyAddress')));assert.ok(!JSON.stringify(team).includes('Synthetic address verification'))
 const own=(await request('/api/activity-history?scope=organization-agency',undefined,{actor:staff[0],role:'Encoder'})).json
 assert.equal(own.visibility,'Own');assert.ok(own.items.length>0);assert.ok(own.items.every(r=>r.actorId===staff[0]))
 const viewer=(await request('/api/activity-history?scope=organization-agency',undefined,{actor:2,role:'Viewer'})).json;assert.ok(viewer.items.every(r=>r.actorId===2))
 const supervisor=(await request('/api/activity-history?scope=organization-agency',undefined,{actor:staff[1],role:'Supervisor'})).json;assert.equal(supervisor.visibility,'Team')
 note('Real HTTP create/update/delete history, actor snapshots, guest denial and per-role visibility verified')
 // 100 concurrent real mutations: one compact event per request, no row-level log fanout.
 const started=performance.now(),burst=await Promise.all(Array.from({length:100},(_,i)=>request('/api/organization/agency',{AgencyName:tag+' '+i,Status:'Active'})))
 for(const result of burst){ids.push(result.json.id);assert.equal(result.history,'recorded')}
 const latest=(await request('/api/activity-history?scope=organization-agency')).json;assert.equal(latest.items.length,25);assert.ok(latest.nextCursor)
 const older=(await request('/api/activity-history?scope=organization-agency&before='+latest.nextCursor)).json
 assert.equal(older.items.length,25);assert.ok(!older.items.some(row=>latest.items.some(first=>first.id===row.id)))
 // A cached older page cannot bypass a permission revocation on the next request.
 await request('/api/activity-history?scope=organization-agency&before='+latest.nextCursor,undefined,{actor:staff[1],role:'Supervisor'})
 await db.execute("INSERT INTO user_module_permission(UserID,ModuleKey,CanView,CanEdit) VALUES(?,'organization',0,0)",[staff[1]])
 await request('/api/activity-history?scope=organization-agency&before='+latest.nextCursor,undefined,{actor:staff[1],role:'Supervisor',status:403})
 const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM user_activity_event WHERE Scope=?',['organization-agency']);assert.ok(Number(count.n)>=103)
 note('100 concurrent mutations recorded; 25-row keyset pages and warm-cache permission revocation verified',{elapsedMs:Math.round(performance.now()-started)})
 // A supplemental audit outage must not falsely report a committed mutation
 // as failed, and must never trigger an automatic business-action retry.
 await db.query("CREATE TRIGGER activity_test_failure BEFORE INSERT ON user_activity_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic history failure'");trigger=true
 const failedLog=await request('/api/organization/agency',{AgencyName:tag+' LOG FAILURE',Status:'Active'});ids.push(failedLog.json.id);assert.equal(failedLog.history,'unavailable')
 const [[saved]]=await db.execute('SELECT AgencyName FROM agency WHERE AgencyID=?',[failedLog.json.id]);assert.equal(saved.AgencyName,tag+' LOG FAILURE')
 await db.query('DROP TRIGGER activity_test_failure');trigger=false
 assert.ok((await request('/api/settings/health')).json.activityHistory.failures>=1)
 note('History-storage failure is reported in diagnostics; successful business write is not replayed')
 // Use one unused synthetic cutoff to verify actual queue completion logging
 // is committed with payroll, rather than logging submission as completion.
 const [[batch]]=await db.execute("SELECT d.BatchID FROM attendance_dtr d WHERE d.Status='Draft' AND NOT EXISTS(SELECT 1 FROM payroll_job j WHERE j.BatchID=d.BatchID) ORDER BY d.BatchID LIMIT 1")
 assert.ok(batch,'An unused synthetic DTR is needed for the queued-completion check')
 await request(`/api/attendance/dtr/${batch.BatchID}/compute`,{target:'payroll'})
 const preview=(await request(`/api/payroll/processing?page=1&pageSize=1&batchId=${batch.BatchID}&periodStart=2026-09-01&periodEnd=2026-09-15&status=Pending&includeLookups=0`)).json.items[0]
 assert.ok(preview.reviewHash)
 const queued=(await request('/api/payroll/jobs',{batchId:batch.BatchID,requestKey:randomUUID(),expectedHash:preview.reviewHash},{status:202})).json.job
 let done
 for(let i=0;i<100;i++){done=(await request('/api/payroll/jobs/'+queued.id)).json.job;if(['Succeeded','Failed','NeedsReview'].includes(done.status))break;await new Promise(r=>setTimeout(r,300))}
 assert.equal(done.status,'Succeeded',JSON.stringify(done))
 const [[completed]]=await db.execute('SELECT ActorUserID,Outcome FROM user_activity_event WHERE EventKey=?',['payroll-job:'+queued.id]);assert.equal(completed.ActorUserID,1);assert.equal(completed.Outcome,'Completed')
 const [[duplicate]]=await db.execute('SELECT COUNT(*) AS n FROM user_activity_event WHERE EventKey=?',['payroll-job:'+queued.id]);assert.equal(Number(duplicate.n),1)
 note('Actual queued payroll completion and one durable transaction-bound activity event verified',{batchId:batch.BatchID})
 await fs.writeFile(path.join(root,database,'activity-history-result.json'),JSON.stringify({database,syntheticOnly:true,at:new Date().toISOString(),checks},null,2))
}finally{
 if(child&&child.exitCode===null){child.kill();await once(child,'exit')}
 if(trigger)await db.query('DROP TRIGGER activity_test_failure')
 for(const id of ids)await db.execute('DELETE FROM agency WHERE AgencyID=? AND AgencyName LIKE ?',[id,tag+'%'])
 for(const id of staff){await db.execute('DELETE FROM user_module_permission WHERE UserID=?',[id]);await db.execute('DELETE FROM `user` WHERE UserID=? AND Email LIKE ?',[id,'activity-%@example.invalid'])}
 if(granted)await db.query('DROP USER IF EXISTS ?@?',[user,'localhost'])
 await db.end()
}
