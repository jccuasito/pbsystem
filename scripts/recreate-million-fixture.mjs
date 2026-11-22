// Recreate only a marked synthetic fixture after an interrupted DB instance.
// Preserve the old database; copy readable base data, not financial postings.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import {identifier,localConfig,root} from './helpers/scale-fixture.mjs'
import {resourceCheck} from './helpers/million-fixture.mjs'
const previous=process.argv.find(a=>a.startsWith('--from='))?.slice(7)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(previous||'')||previous===process.env.DB_NAME)throw Error('Exact generated synthetic database required')
const old=JSON.parse(await fs.readFile(path.join(root,previous,'manifest.json'),'utf8'))
assert.equal(old.profile,'million');assert.equal(old.syntheticOnly,true);assert.equal(old.seedComplete,true)
const database='pbsystem_scale_'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_'+randomBytes(2).toString('hex')
const folder=path.join(root,database);await fs.mkdir(folder,{recursive:true})
const d=await mysql.createConnection(localConfig())
// Configuration and base data seeded by million-fixture; all money postings
// and audit history start empty and must be produced by the real app APIs.
const base=new Set(['agency','agency_contribution_plan','agency_position','attendance','attendance_dtr','attendance_dtr_employee',
 'billing_rate','billing_rate_version','client','deduction_loan_classification','deduction_type','department','loan_type','employee','employee_deduction',
 'employee_deployment','employee_loan','employee_portal_account','employee_portal_session','employee_recurring_deduction',
 'payroll_rate','payroll_rate_version','position','region','shift_code','site','site_account','site_agency','site_policy','site_rate','user'])
try{
 const [[marker]]=await d.query(`SELECT Marker FROM ${identifier(previous)}.scale_test_manifest`)
 assert.equal(marker.Marker,'SYNTHETIC_ONLY_MILLION_4_500_150_V1')
 const [[storage]]=await d.query('SELECT @@datadir AS directory');resourceCheck(storage.directory)
 await d.query('USE '+identifier(previous));const [tables]=await d.query('SHOW FULL TABLES');const [triggers]=await d.query('SHOW TRIGGERS')
 await d.query('CREATE DATABASE '+identifier(database)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
 await d.query('USE '+identifier(database));await d.query('SET SESSION FOREIGN_KEY_CHECKS=0')
 const definitions=[]
 for(const row of tables){const [name,type]=Object.values(row);if(name==='scale_test_manifest')continue
  // Only payroll is unreadable in the old fixture. Its unchanged definition
  // is read from the ordinary schema, without copying any business rows.
  const schema=name==='payroll'?old.sourceSchema:previous
  const [[definition]]=await d.query('SHOW CREATE TABLE '+identifier(schema)+'.'+identifier(name))
  let sql=Object.values(definition)[1].replace(/ AUTO_INCREMENT=\d+/g,'').replace(/DEFINER=`[^`]+`@`[^`]+`/g,'').replace('SQL SECURITY DEFINER','SQL SECURITY INVOKER')
  sql=sql.split('`'+schema+'`.').join('`'+database+'`.')
  definitions.push({name,type,sql})
 }
 for(const table of definitions.filter(t=>t.type==='BASE TABLE'))await d.query(table.sql)
 for(const table of definitions.filter(t=>t.type==='VIEW'))await d.query(table.sql)
 const progress=[]
 for(const table of definitions.filter(t=>base.has(t.name))){
  resourceCheck(storage.directory)
  const name=identifier(table.name),source=identifier(previous)+'.'+name
  const [[{n}]]=await d.query('SELECT COUNT(*) AS n FROM '+source)
  const [columns]=await d.query('SHOW COLUMNS FROM '+name)
  const key=columns.find(c=>c.Key==='PRI');assert.ok(key,'Primary key required for bounded copy: '+table.name)
  assert.match(key.Field,/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  const k='`'+key.Field+'`',numeric=/^(tinyint|smallint|mediumint|int|bigint)/i.test(key.Type)
  if(numeric){
   const [[range]]=await d.query(`SELECT MIN(${k}) AS low,MAX(${k}) AS high FROM ${source}`)
   const step=Math.max(1,Math.floor((Number(range.high)-Number(range.low)+1)*10000/Math.max(1,Number(n))))
   for(let low=Number(range.low);n&&low<=Number(range.high);low+=step){resourceCheck(storage.directory);await d.execute(`INSERT INTO ${name} SELECT * FROM ${source} WHERE ${k}>=? AND ${k}<?`,[low,low+step])}
  }else{
   let last=null
   while(true){resourceCheck(storage.directory);const [insert]=await d.execute(`INSERT INTO ${name} SELECT * FROM ${source}${last===null?'':` WHERE ${k}>?`} ORDER BY ${k} LIMIT 10000`,last===null?[]:[last]);if(!insert.affectedRows)break
    const [[end]]=await d.query(`SELECT ${k} AS lastKey FROM ${name} ORDER BY ${k} DESC LIMIT 1`);last=end.lastKey}
  }
  const [[copied]]=await d.query('SELECT COUNT(*) AS n FROM '+name);assert.equal(Number(copied.n),Number(n))
  progress.push({table:table.name,rows:Number(n)});await fs.writeFile(path.join(folder,'copy-progress.json'),JSON.stringify({previous,database,progress},null,2));console.log('Copied synthetic base table',table.name,Number(n))
 }
 await d.query("UPDATE employee_loan SET RemainingBalance=LoanAmount")
 await d.query("UPDATE employee_deduction SET RemainingBalance=Amount")
 await d.query("UPDATE attendance_dtr SET Status='Draft'")
 await d.query('SET SESSION FOREIGN_KEY_CHECKS=1')
 for(const [table,count]of[['department',1],['loan_type',1]]){
  const [[r]]=await d.query('SELECT COUNT(*) AS n FROM '+identifier(table));assert.equal(Number(r.n),count)
 }
 for(const trigger of triggers)await d.query(`CREATE TRIGGER ${identifier(trigger.Trigger)} ${trigger.Timing} ${trigger.Event} ON ${identifier(trigger.Table)} FOR EACH ROW ${trigger.Statement}`)
 await d.query('CREATE TABLE scale_test_manifest(Marker varchar(80) PRIMARY KEY,CreatedAt timestamp DEFAULT current_timestamp())')
 await d.execute('INSERT INTO scale_test_manifest(Marker) VALUES(?)',['SYNTHETIC_ONLY_MILLION_4_500_150_V1'])
 const manifest={...old,database,createdAt:new Date().toISOString(),recreatedFrom:previous,seedComplete:true}
 for(const [table,count]of[['employee',1000000],['attendance',15000000],['payroll',0],['employee_account_transaction',0],['payslip_publication',0]]){
  const [[r]]=await d.query('SELECT COUNT(*) AS n FROM '+identifier(table));assert.equal(Number(r.n),count)
 }
 await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2))
 console.log(JSON.stringify({database,folder,employees:1000000,attendance:15000000,financialPostings:0,previousPreserved:true}))
}finally{await d.end()}
