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
 const asOf=new Date(Math.floor(Date.now()/60000)*60000).toISOString(),cutoff=new Date(Date.parse(asOf)-7*86400000)
 const recentIds=new Set(),archiveIds=new Set(),otherIds=new Set()
 const stamp=date=>date.toISOString().replace('T',' ').replace('Z','000')
 for(const [set,total,time,owner] of [[recentIds,100,new Date(+cutoff+3600000),staff[0]],[archiveIds,1000,new Date(+cutoff-3600000),staff[0]],[recentIds,1,cutoff,staff[0]],[archiveIds,1,new Date(+cutoff-1),staff[0]],[otherIds,10,new Date(+cutoff-3600000),staff[1]]]){
  for(let start=0;start<total;start+=50){
   const count=Math.min(50,total-start),values=[]
   for(let i=0;i<count;i++)values.push(randomUUID(),'organization-agency',owner,'Synthetic archive staff','Encoder',(start+i)%3?'Update':'Create','Updated agency','Completed',JSON.stringify({references:[],fields:[],counts:{},subjects:[{kind:'agency',id:'1',label:'SYNTHETIC ARCHIVE VERIFICATION'}]}),stamp(time))
   const [result]=await db.execute('INSERT INTO user_activity_event(EventKey,Scope,ActorUserID,ActorName,ActorRole,Action,Operation,Outcome,DetailsJson,CreatedAt) VALUES '+Array.from({length:count},()=>'(?,?,?,?,?,?,?,?,?,?)').join(','),values)
   for(let i=0;i<count;i++)set.add(String(Number(result.insertId)+i))
  }
 }
 const first=await request('/api/activity-history?scope=organization-agency&period=recent&asOf='+asOf,undefined,{actor:staff[0],role:'Encoder'})
 assert.equal(first.json.period,'recent');assert.equal(first.json.cutoff,cutoff.toISOString());assert.equal(first.json.items.length,25)
 async function collect(period,expected){
  let before,seen=new Set(),pages=0
  do{
   const query=new URLSearchParams({scope:'organization-agency',period,asOf,...(before?{before}:{})})
   const feed=(await request('/api/activity-history?'+query,undefined,{actor:staff[0],role:'Encoder'})).json
   assert.ok(feed.items.length<=25);assert.equal(feed.visibility,'Own');assert.equal(feed.asOf,asOf)
   for(const row of feed.items){assert.ok(expected.has(row.id),'Wrong period or owner');assert.ok(!seen.has(row.id),'Duplicate time/ID cursor row');seen.add(row.id)}
   before=feed.nextCursor;pages++;assert.ok(pages<100)
  }while(before)
  assert.equal(seen.size,expected.size);return pages
 }
 const recentPages=await collect('recent',recentIds),archivePages=await collect('archive',archiveIds)
 const archiveFirst=(await request('/api/activity-history?scope=organization-agency&period=archive&asOf='+asOf,undefined,{actor:staff[0],role:'Encoder'})).json
 const older='/api/activity-history?'+new URLSearchParams({scope:'organization-agency',period:'archive',asOf,before:archiveFirst.nextCursor})
 const concurrent=await Promise.all(Array.from({length:40},()=>request(older,undefined,{actor:staff[0],role:'Encoder'})))
 assert.ok(concurrent.every(response=>response.json.items.length===25&&response.json.items.every(row=>archiveIds.has(row.id))))
 const filtered=(await request('/api/activity-history?scope=organization-agency&period=archive&action=Create&asOf='+asOf,undefined,{actor:staff[0],role:'Encoder'})).json
 assert.ok(filtered.items.length);assert.ok(filtered.items.every(row=>row.action==='Create'))
 await db.execute("INSERT INTO user_module_permission(UserID,ModuleKey,CanView,CanEdit) VALUES(?,'organization',0,0)",[staff[0]])
 await request(older,undefined,{actor:staff[0],role:'Encoder',status:403})
 await db.execute('DELETE FROM user_module_permission WHERE UserID=?',[staff[0]])
 const [plan]=await db.execute('EXPLAIN SELECT EventID,CreatedAt FROM user_activity_event WHERE Scope=? AND ActorUserID=? AND CreatedAt<? ORDER BY CreatedAt DESC,EventID DESC LIMIT 26',['organization-agency',staff[0],stamp(cutoff)])
 assert.ok(plan[0].key);assert.notEqual(plan[0].type,'ALL');assert.ok(!String(plan[0].Extra).includes('filesort'))
 assert.equal(await ensureActivityHistoryIndexes(db),false,'Schema upgrade must be idempotent')
 const [[retained]]=await db.execute('SELECT COUNT(*) AS n FROM user_activity_event WHERE ActorUserID=?',[staff[0]])
 assert.equal(Number(retained.n),recentIds.size+archiveIds.size)
 const result={syntheticOnly:true,database,recentRows:recentIds.size,archivedRows:archiveIds.size,recentPages,archivePages,concurrentReads:40,recordsRetained:true,boundaryDisjoint:true,permissionsRechecked:true,index:plan[0].key,queryPlan:plan[0].type}
 await fs.writeFile(path.join(root,database,'activity-archive-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{
 if(child&&child.exitCode===null){child.kill();await once(child,'exit')}
 if(trigger)await db.query('DROP TRIGGER activity_test_failure')
 for(const id of ids)await db.execute('DELETE FROM agency WHERE AgencyID=? AND AgencyName LIKE ?',[id,tag+'%'])
 for(const id of staff){await db.execute('DELETE FROM user_module_permission WHERE UserID=?',[id]);await db.execute('DELETE FROM `user` WHERE UserID=? AND Email LIKE ?',[id,'activity-%@example.invalid'])}
 if(granted)await db.query('DROP USER IF EXISTS ?@?',[user,'localhost'])
 await db.end()
}
