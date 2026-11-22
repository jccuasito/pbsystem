import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import mysql from 'mysql2/promise'
import {localConfig,root} from './helpers/scale-fixture.mjs'
const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database||'')||database===process.env.DB_NAME)throw Error('Exact local synthetic database required')
const folder=path.join(root,database),stateFile=path.join(folder,'suite-progress.json')
let manifest
for(let i=0;i<240;i++){
 try{manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));break}catch(e){if(e.code!=='ENOENT')throw e}
 if(i===239)throw Error('Synthetic copy has not completed within 40 minutes')
 await new Promise(r=>setTimeout(r,10000))
}
assert.equal(manifest.profile,'million');assert.equal(manifest.seedComplete,true);assert.equal(manifest.syntheticOnly,true)
const db=await mysql.createConnection({...localConfig(),database})
try{
 const [[marker]]=await db.query('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_MILLION_4_500_150_V1')
 await db.query('SELECT PayrollID FROM payroll LIMIT 0')
 // Existing optional migration index, applied only to this disposable fixture.
 // The active-name index is unnecessarily wide for a million-row status count.
 const [indexes]=await db.query("SHOW INDEX FROM employee WHERE Key_name='ix_employee_status_hired'")
 if(!indexes.length){
  const times=[]
  for(const label of ['before','after']){
   if(label==='after')await db.query('ALTER TABLE employee ADD INDEX ix_employee_status_hired(Status,DateHired),ALGORITHM=INPLACE,LOCK=NONE')
   const start=performance.now(),[[r]]=await db.query("SELECT COUNT(*) AS n FROM employee WHERE Status='Active'");assert.equal(Number(r.n),1000000)
   const [plan]=await db.query("EXPLAIN SELECT COUNT(*) FROM employee WHERE Status='Active'")
   times.push({label,ms:Math.round(performance.now()-start),plan})
  }
  await fs.writeFile(path.join(folder,'million-count-index.json'),JSON.stringify({database,times},null,2));console.log('Measured and installed synthetic active-count index')
 }
}finally{await db.end()}
let state
try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));assert.equal(state.database,database)}catch(e){if(e.code!=='ENOENT')throw e;state={database,started:new Date().toISOString(),phases:[]}}
const phases=['pilot','portal-load','burst','mixed','payroll','directory','staff-load','portal-load','preview-bounded']
for(let i=0;i<phases.length;i++){
 if(state.phases[i]?.status==='complete')continue
 const phase=phases[i],log=path.join(folder,`suite-${String(i+1).padStart(2,'0')}-${phase}.log`)
 state.phases[i]={phase,started:new Date().toISOString(),status:'running',log};state.complete=false;await fs.writeFile(stateFile,JSON.stringify(state,null,2))
 console.log('Starting million suite phase',i+1,phase)
 const stream=createWriteStream(log),child=spawn(process.execPath,['--max-old-space-size=256','--env-file=.env','scripts/test-million-scale.mjs',phase,'--database='+database,'--packet-mb=16','--buffer-mb=256'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false})
 const [code,signal]=await once(child,'exit');stream.end();await once(stream,'finish')
 state.phases[i].finished=new Date().toISOString();state.phases[i].status=code===0?'complete':'failed';state.phases[i].exitCode=code;state.phases[i].signal=signal
 await fs.writeFile(stateFile,JSON.stringify(state,null,2));console.log('Finished million suite phase',i+1,phase,state.phases[i].status)
 if(code!==0)throw Error('Stopped suite; inspect '+log)
}
state.complete=true;state.finished=new Date().toISOString();await fs.writeFile(stateFile,JSON.stringify(state,null,2));console.log('Million suite complete',stateFile)
