const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test'),{transformSync}=require('esbuild')
const shared=require('../shared/utils/thirteenthMonth.ts')
const {annualBasic,annualSummary,annualDate}=shared
const source=(changes={})=>({id:'1',start:'2026-01-01',end:'2026-01-31',reference:'Test payroll',site:'Test site',kind:'Finalized payroll',basic:20000,timeDeductions:0,adjustments:0,excluded:0,issues:[],...changes})
test('basic earnings exclude OT, ND, premiums and account deductions; unpaid time is applied once',()=>{
 const result=annualBasic([{code:'RegularHours',amount:20000,direction:'Earning'},{code:'OTHours',amount:3000,direction:'Earning'},{code:'NightDiffHours',amount:600,direction:'Earning'},{code:'LegalHolidayHours',amount:1000,direction:'Earning'},{code:'LateHours',amount:100,direction:'Deduction'},{code:'UndertimeHours',amount:200,direction:'Deduction'}])
 assert.equal(result.basic,20000);assert.equal(result.timeDeductions,300);assert.equal(result.excluded,4600)
 assert.equal(annualSummary([source(result)],'2026-01-01','2026-01-31').entitlement,1641.67)
})
test('rate changes and multiple sites aggregate actual earnings with one annual rounding',()=>{
 const summary=annualSummary([source({basic:10000}),source({id:'2',basic:12000}),source({id:'3',basic:0.03})],'2026-01-01','2026-01-31')
 assert.equal(summary.basicEarned,22000.03);assert.equal(summary.entitlement,1833.34)
})
test('partial-year service retains divisor twelve and advances use gross benefit, not net payment',()=>{
 const summary=annualSummary([source({basic:120000})],'2026-01-01','2026-01-31',[{Status:'Active',Amount:3000,NetAmount:2700},{Status:'Voided',Amount:1000}])
 assert.equal(summary.entitlement,10000);assert.equal(summary.paid,3000);assert.equal(summary.balance,7000)
})
test('coverage gaps, zero verified earnings, cross-month records and out-of-range sources are explicit',()=>{
 const gap=annualSummary([source({end:'2026-01-15'})],'2026-01-01','2026-01-31');assert.deepEqual(gap.gaps,[{start:'2026-01-16',end:'2026-01-31'}])
 const complete=annualSummary([source({end:'2026-01-15'}),source({id:'2',kind:'Previous earnings',start:'2026-01-16',basic:0})],'2026-01-01','2026-01-31');assert.equal(complete.gaps.length,0)
 assert.equal(annualSummary([source({kind:'Basic adjustment'})],'2026-01-01','2026-01-31').gaps.length,1)
 assert.ok(annualSummary([source({end:'2026-02-15'})],'2026-01-01','2026-01-31').issues.length>=2)
})
test('manual adjustments require classification, and approved deductions reduce the basic adjustment',()=>{
 assert.equal(annualBasic([],[{code:'ManualAmount',amount:1000,lineId:1,direction:'Earning'}]).issues.length,1)
 assert.equal(annualBasic([],[{code:'ManualAmount',amount:1000,lineId:1,direction:'Earning',included:true}]).adjustments,1000)
 assert.equal(annualBasic([],[{code:'RegularHours',amount:1000,direction:'Deduction'}]).adjustments,-1000)
 const correction=annualBasic([],[{code:'RegularHours',amount:1000,direction:'Deduction'}]);assert.equal(correction.issues.length,0,'A valid basic correction can reduce previously earned basic pay')
 assert.equal(annualSummary([source(),source({...correction,id:'correction',kind:'Basic adjustment',start:'2026-01-10',end:'2026-01-10'})],'2026-01-01','2026-01-31').basicEarned,19000)
 assert.equal(annualDate('2026-02-30'),'');assert.equal(annualDate('2024-02-29'),'2024-02-29')
})
function load(pool){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync('server/utils/thirteenthMonthCrud.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,require:name=>name==='node:crypto'?require(name):name==='h3'?{getQuery:e=>e.query||{},readBody:async e=>e.body,setHeader(){},createError:o=>Object.assign(Error(o.statusMessage),o)}:name.includes('dbconnect')?pool:name.endsWith('/auth')?{requireSession:e=>{if(!e.session)throw Object.assign(Error('Please sign in.'),{statusCode:401});return e.session}}:name.includes('thirteenthMonth')?shared:{},console,Date});return module.exports}
test('authentication and review permissions are enforced before database access',async()=>{
 const api=load({getConnection(){throw Error('Database must not be accessed')}})
 await assert.rejects(()=>api.listThirteenthMonth({}),e=>e.statusCode===401)
 await assert.rejects(()=>api.updateThirteenthMonth({session:{sub:1,userType:'Viewer'},context:{},body:{}}),e=>e.statusCode===403)
 await assert.rejects(()=>api.updateThirteenthMonth({session:{sub:1,userType:'Encoder'},context:{moduleCanEdit:false},body:{}}),e=>e.statusCode===403)
 await assert.rejects(()=>api.updateThirteenthMonth({session:{sub:1,userType:'Encoder'},context:{},body:{year:2026,employeeId:1,agencyId:1,action:'approve'}}),e=>e.statusCode===403)
})

test('annual import, approval, advances, releases, reopening and cancellation checks use temporary tables only',{skip:process.env.THIRTEENTH_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  const [tables]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
  for(const row of tables){assert.match(row.TABLE_NAME,/^[a-zA-Z0-9_]+$/);const [[definition]]=await db.query('SHOW CREATE TABLE `'+row.TABLE_NAME+'`');await db.query(definition['Create Table'].replace(/^CREATE TABLE/,'CREATE TEMPORARY TABLE').split('\n').filter(line=>!/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g,'\n)'))}
  for(const sql of [
   "INSERT INTO `user`(UserID,FirstName,LastName,Gender,Email,UserType,Status) VALUES(1,'Test','Admin','Prefer not to say','annual@example.invalid','Admin','Active')",
   "INSERT INTO agency(AgencyID,AgencyName,Status) VALUES(1,'Test agency','Active'),(2,'Other employer','Active')",
   "INSERT INTO `position`(PositionID,PositionName,Status) VALUES(1,'Guard','Active')",
   "INSERT INTO agency_position(AgencyPositionID,AgencyID,PositionID,Status) VALUES(1,1,1,'Active')",
   "INSERT INTO employee(EmployeeID,AgencyPositionID,FirstName,LastName,DateHired,Status) VALUES(1,1,'Test','Employee','2026-01-01','Active')",
   "INSERT INTO client(ClientID,ClientName,Status) VALUES(1,'Test client','Active')",
   "INSERT INTO site(SiteID,ClientID,SiteName,Status) VALUES(1,1,'Fixed site','Active'),(2,1,'Reliever site','Active')",
   "INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(1,1,1,1,'2026-01-01','2026-01-15','Computed to Payroll',1),(2,1,1,2,'2026-01-16','2026-01-31','Computed to Payroll',1),(3,2,1,2,'2026-01-01','2026-01-15','Computed to Payroll',1)",
   "INSERT INTO payroll(PayrollID,EmployeeID,DeploymentID,PayrollType,StartDate,EndDate,PayrollDate,GrossPay,NetPay,Status) VALUES(1,1,1,'Regular','2026-01-01','2026-01-15','2026-01-15',16000,10000,'Approved'),(2,1,2,'Regular','2026-01-16','2026-01-31','2026-01-31',16000,10000,'Approved'),(3,1,3,'Regular','2026-01-01','2026-01-15','2026-01-15',6000,6000,'Approved')",
   "INSERT INTO payroll_processing_posting(BatchID,EmployeeID,PayrollID) VALUES(1,1,1),(2,1,2),(3,1,3)",
  ])await db.query(sql)
  for(let batch=1;batch<=3;batch++){
   const components=[{code:'RegularHours',amount:batch===3?6000:12000,direction:'Earning'},{code:'OTHours',amount:2000,direction:'Earning'},{code:'NightDiffHours',amount:1000,direction:'Earning'}]
   if(batch===1)components.push({code:'LateHours',amount:600,direction:'Deduction'},{code:'UndertimeHours',amount:400,direction:'Deduction'})
   const snapshot={employees:[{EmployeeID:1,components,allowance:1000,adjustments:batch===1?[{lineId:1,amount:1000,direction:'Earning',description:'Verified back pay'}]:[]}]}
   await db.execute("INSERT INTO payroll_processing_review(BatchID,ReviewStatus,SnapshotJson) VALUES(?,'Approved',?)",[batch,JSON.stringify(snapshot)])
  }
  await db.query("INSERT INTO payroll_adjustment(AdjustmentID,EmployeeID,TargetBatchID,AdjustmentType,Reason,Status,TargetPayrollID,CreatedBy) VALUES(1,1,1,'Back pay','Test verification','Applied',1,1)")
  await db.query("INSERT INTO payroll_adjustment_line(AdjustmentLineID,AdjustmentID,SourceDate,ComponentCode,Description,EntrySource,Direction,Quantity,Rate,Amount) VALUES(1,1,'2026-01-10','ManualAmount','Verified back pay','Manual Amount','Earning',1,1000,1000)")
  const connection={execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
  const api=load({execute:connection.execute,getConnection:async()=>connection}),event={session:{sub:1,userType:'Admin'},context:{moduleCanEdit:true}}
  const get=async(agency=1)=>(await api.thirteenthMonthData(2026,agency,db)).items.find(row=>row.EmployeeID===1)
  const post=async(action,extra={},agency=1)=>{const p=await get(agency);return api.updateThirteenthMonth({...event,body:{year:2026,employeeId:1,agencyId:agency,action,expectedHash:p.sourceHash,revision:p.header?.Revision,reason:'Reviewed synthetic payroll evidence',...extra}})}
  let p=await get();assert.equal(p.summary.basicEarned,23000);assert.equal(p.summary.entitlement,1916.67);assert.equal((await get(2)).summary.basicEarned,6000,'Separate employing agencies')
  const coverage={coverageStart:'2026-01-01',coverageEnd:'2026-01-31',eligibilityConfirmed:true}
  await post('save',coverage);await assert.rejects(()=>post('approve',coverage),e=>e.statusCode===409)
  await assert.rejects(()=>post('classify',{lineId:1,included:true,earnedDate:'1999-01-10'}),e=>e.statusCode===400)
  await post('classify',{lineId:1,included:true,earnedDate:'2026-01-10'})
  p=await get();assert.equal(p.summary.basicEarned,24000);assert.equal(p.summary.entitlement,2000)
  fs.mkdirSync('.data',{recursive:true});fs.writeFileSync('.data/thirteenth-month-fixture.json',JSON.stringify({...await api.thirteenthMonthData(2026,1,db),permissions:{canEdit:true,canApprove:true}}))
  await post('previous-payment',{amount:500,withholding:50,paymentDate:'2026-01-31',reference:'ADVANCE-001',paymentConfirmed:true})
  await post('approve',coverage);p=await get();assert.equal(p.header.Status,'Approved');assert.equal(p.summary.balance,1500)
  await assert.rejects(()=>post('release',{amount:1500.01,paymentDate:'2026-02-01',reference:'PAY-OVER',paymentConfirmed:true}),e=>e.statusCode===409)
  await assert.rejects(()=>post('release',{amount:100,paymentDate:'2026-02-01',reference:'ADVANCE-001',paymentConfirmed:true}),e=>e.statusCode===409)
  const beforeRelease=await get()
  await post('release',{amount:1500,withholding:100,paymentDate:'2026-02-01',reference:'PAY-001',paymentConfirmed:true})
  p=await get();assert.equal(p.header.Status,'Released');assert.equal(p.summary.balance,0);assert.equal(Number(p.releases[0].NetAmount),1400)
  await assert.rejects(()=>api.updateThirteenthMonth({...event,body:{year:2026,employeeId:1,agencyId:1,action:'release',expectedHash:beforeRelease.sourceHash,revision:beforeRelease.header.Revision,reason:'Retry same payment',amount:1500,withholding:100,paymentDate:'2026-02-01',reference:'PAY-001',paymentConfirmed:true}}),e=>e.statusCode===409)
  await post('reopen');assert.equal((await get()).summary.paid,2000)
  await assert.rejects(()=>post('import',{rows:[{start:'2026-01-01',end:'2026-01-15',basic:1000,reference:'DUPLICATE',kind:'Previous earnings'}]}),e=>e.statusCode===409)
  await assert.rejects(()=>post('import',{rows:[{start:'2026-02-01',end:'2026-02-15',basic:1000,reference:'ROLLBACK-ROW',kind:'Previous earnings'},{start:'2026-01-01',end:'2026-01-15',basic:1000,reference:'BAD-OVERLAP',kind:'Previous earnings'}]}),e=>e.statusCode===409)
  assert.equal((await get()).imports.length,0,'A bad bulk row rolls back the entire import')
  await post('import',{rows:[{start:'2026-01-20',end:'2026-01-20',basic:1200,reference:'BASIC-CORRECTION',kind:'Basic adjustment'}]})
  await post('save',coverage);await post('approve',coverage);assert.equal((await get()).summary.balance,100)
  await post('release',{amount:100,withholding:0,paymentDate:'2026-02-01',reference:'PAY-002',paymentConfirmed:true})
  p=await get();await post('void-payment',{releaseId:p.releases[0].ReleaseID});p=await get();assert.equal(p.header.Status,'Approved');assert.equal(p.summary.balance,100)
  await db.query("UPDATE payroll_processing_posting SET Status='Cancelled' WHERE PayrollID=2")
  assert.equal((await get()).sourceChanged,true)
  await assert.rejects(()=>post('release',{amount:100,paymentDate:'2026-02-01',reference:'PAY-STALE',paymentConfirmed:true}),e=>e.statusCode===409)
  const [events]=await db.query('SELECT Action FROM thirteenth_month_event ORDER BY EventID');assert.equal(events.length,11);assert.deepEqual(events.map(row=>row.Action),['save','classify','previous-payment','approve','release','reopen','import','save','approve','release','void-payment'])
 }finally{await db.end()}
})
