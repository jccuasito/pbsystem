const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{test}=require('node:test'),{transformSync}=require('esbuild'),sfc=require('@vue/compiler-sfc'),vue=require('vue')
function evaluate(source,globals={}){const module={exports:{}};vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,...globals});return module.exports}
const h3={createError:d=>Object.assign(new Error(d.statusMessage),d),getQuery:e=>e.query||{}}
const auth={requireSession:e=>{if(e.anonymous)throw h3.createError({statusCode:401});return{sub:1}}}
function api(db={execute:async()=>[[]]}){return evaluate(fs.readFileSync('server/utils/payrollProgress.ts','utf8'),{require:name=>name==='h3'?h3:name.includes('dbconnect')?db:name.endsWith('/auth')?auth:{}})}
test('progress counts distinct company/site runs, includes missing DTRs and never rounds partial completion to 100%',()=>{
 const source=api(),rows=[]
 for(let i=0;i<5;i++)rows.push({AgencyID:1,AgencyName:'Company A',SiteID:i+1,SiteName:'Site '+i,SiteAccountID:1,SiteAccountName:'SM Account',DtrCount:i===4?0:1,FinalizedDtrCount:i<3?1:0})
 rows.push({...rows[0]},{...rows[0],AgencyID:2,AgencyName:'Company B',FinalizedDtrCount:0})
 const result=source.groupPayrollProgress(rows)
 assert.equal(result.companies[0].groups[0].Percent,60);assert.equal(result.companies[0].groups[0].ExpectedSites,5)
 assert.equal(result.companies[0].groups[0].MissingDtrSites,1);assert.equal(result.companies[1].Percent,0)
 assert.equal(source.payrollProgressPercent(0,0),null);assert.equal(source.payrollProgressPercent(1999,2000),99.9);assert.equal(source.payrollProgressPercent(5,5),100)
 assert.equal(source.groupPayrollProgress(rows,1).totals.Percent,null,'Unconfigured sites cannot make an overall 100% claim')
 const unassigned=source.groupPayrollProgress([{...rows[0],SiteAccountID:null,SiteAccountName:null}]);assert.equal(unassigned.companies[0].groups[0].SiteAccountName,'Unassigned Site Account')
})
test('progress endpoint rejects anonymous and invalid cutoff requests before SQL and belongs to Dashboard access',async()=>{
 let reads=0;const source=api({execute:async()=>{reads++;return[[]]}})
 await assert.rejects(()=>source.listPayrollProgress({anonymous:true}),e=>e.statusCode===401)
 for(const query of [{periodStart:'2026-02-30',periodEnd:'2026-03-15'},{periodStart:'2026-10-01'},{periodStart:'2026-10-16',periodEnd:'2026-10-01'},{periodStart:['2026-10-01'],periodEnd:'2026-10-15'}])await assert.rejects(()=>source.listPayrollProgress({query}),e=>e.statusCode===400)
 assert.equal(reads,0)
 const permissions=evaluate(fs.readFileSync('server/utils/settingsAccess.ts','utf8'),{require:name=>name==='h3'?h3:name.endsWith('/auth')?auth:{}})
 assert.equal(permissions.moduleForPath('/api/dashboard/payroll-progress'),'dashboard')
})
test('progress view compiles and displays the company/group layout without financial amounts',async()=>{
 const file='app/components/PayrollRunProgress.vue',source=fs.readFileSync(file,'utf8')
 const {descriptor,errors}=sfc.parse(source,{filename:file});assert.deepEqual(errors,[])
 const script=sfc.compileScript(descriptor,{id:file});assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
 for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename:file,id:file,scoped:style.scoped}).errors,[])
 const dataset=api().groupPayrollProgress([{AgencyID:1,AgencyName:'Company A',SiteID:1,SiteName:'Site A',SiteAccountID:1,SiteAccountName:'SM Account',DtrCount:1,FinalizedDtrCount:1},{AgencyID:1,AgencyName:'Company A',SiteID:2,SiteName:'Site B',SiteAccountID:1,SiteAccountName:'SM Account',DtrCount:0,FinalizedDtrCount:0}])
 const prepared=source.replace(/const report=ref<any>\([^\n]+\)/,`const report=ref<any>(${JSON.stringify({...dataset,cutoffs:[],period:null})})`).replace('loading=ref(true)','loading=ref(false)')
 const compiled=sfc.compileScript(sfc.parse(prepared,{filename:file}).descriptor,{id:file,inlineTemplate:true})
 const component=evaluate(compiled.content,{require:name=>name==='vue'?vue:{useRealtimeRefresh(){}}}).default
 const html=await require('@vue/server-renderer').renderToString(vue.createSSRApp(component))
 assert.ok(html.includes('Company A'));assert.ok(html.includes('SM Account'));assert.ok(html.includes('50%'));assert.ok(html.includes('aria-valuenow="50"'));assert.ok(html.includes('Without DTR'));assert.ok(!/GrossPay|TotalDeduction|NetPay/.test(html))
 assert.match(fs.readFileSync('app/pages/dashboard/index.vue','utf8'),/<PayrollRunProgress \/>/)
})
test('late responses and failed cutoff changes keep progress tied to its displayed period',async()=>{
 const scope=vue.effectScope(),pending=[]
 const source=sfc.parse(fs.readFileSync('app/components/PayrollRunProgress.vue','utf8')).descriptor.scriptSetup.content
 const state=scope.run(()=>evaluate(source+'\nmodule.exports={load,report,cutoff};',{AbortController,require:name=>name==='vue'?{...vue,onMounted(){},onBeforeUnmount(){}}:{useRealtimeRefresh(){}},$fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}))
 try{
  const first=state.load();state.cutoff.value='2026-10-01:2026-10-15';const next=state.load()
  const result={companies:[],totals:{Percent:60},cutoffs:[],period:{PeriodStart:'2026-10-01',PeriodEnd:'2026-10-15'}}
  pending[1].resolve(result);await next;pending[0].resolve({...result,totals:{Percent:100},period:{PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'}});await first
  assert.equal(state.report.value.totals.Percent,60)
  state.cutoff.value='2026-11-01:2026-11-15';const failed=state.load();pending[2].reject(Error('offline'));await failed
  assert.equal(state.cutoff.value,'2026-10-01:2026-10-15')
 }finally{scope.stop()}
})
test('expected-site denominator, finalization, multiple companies and cutoff isolation use temporary SQL tables', {skip:process.env.PAYROLL_PROGRESS_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  for(const statement of [
   'CREATE TEMPORARY TABLE agency(AgencyID INT PRIMARY KEY,AgencyName VARCHAR(100),Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE site(SiteID INT PRIMARY KEY,SiteName VARCHAR(100),SiteAccountID INT NULL,Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE site_account(SiteAccountID INT PRIMARY KEY,SiteAccountName VARCHAR(100))',
   'CREATE TEMPORARY TABLE site_agency(SiteID INT,AgencyID INT,Status VARCHAR(20),SiteAccountID INT NULL,PRIMARY KEY(SiteID,AgencyID))',
   'CREATE TEMPORARY TABLE attendance_dtr(BatchID INT PRIMARY KEY,SiteID INT,AgencyID INT,PeriodStart DATE,PeriodEnd DATE)',
   'CREATE TEMPORARY TABLE payroll(PayrollID INT PRIMARY KEY,Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE payroll_processing_posting(BatchID INT,PayrollID INT,Status VARCHAR(20))',
  ])await db.query(statement)
  await db.query("INSERT INTO agency VALUES(1,'Company A','Active'),(2,'Company B','Active')")
  await db.query("INSERT INTO site_account VALUES(1,'SM Account'),(2,'Other Posts'),(3,'Residential')")
  await db.query("INSERT INTO site VALUES(1,'Shared site',1,'Active'),(2,'Missing DTR',1,'Active'),(3,'Partial payroll',2,'Active'),(4,'Historical inactive site',3,'Inactive'),(5,'Unassigned group',NULL,'Active'),(6,'No company setup',2,'Active')")
  await db.query("INSERT INTO site_agency VALUES(1,1,'Active',1),(1,2,'Active',3),(2,1,'Active',1),(3,1,'Active',2),(5,1,'Active',NULL),(4,2,'Inactive',3)")
  await db.query("INSERT INTO attendance_dtr VALUES(1,1,1,'2026-09-16','2026-09-30'),(2,3,1,'2026-09-16','2026-09-30'),(3,4,2,'2026-09-16','2026-09-30'),(4,5,1,'2026-09-16','2026-09-30'),(5,1,1,'2026-10-01','2026-10-15')")
  await db.query("INSERT INTO payroll VALUES(1,'Approved'),(2,'Approved'),(3,'Draft'),(4,'Released'),(5,'Approved'),(6,'Approved'),(7,'Approved')")
  await db.query("INSERT INTO payroll_processing_posting VALUES(1,1,'Active'),(1,1,'Active'),(2,2,'Active'),(2,3,'Active'),(3,4,'Active'),(4,5,'Active'),(5,6,'Active'),(2,7,'Cancelled')")
  const source=api({execute:(...args)=>db.execute(...args)}),query={periodStart:'2026-09-16',periodEnd:'2026-09-30'}
  let result=await source.listPayrollProgress({query})
  assert.equal(result.totals.ExpectedSites,6);assert.equal(result.totals.CompletedSites,3);assert.equal(result.totals.MissingDtrSites,2)
  assert.equal(result.totals.Percent,null);assert.equal(result.totals.UnconfiguredSites,1)
  const company=result.companies.find(row=>row.AgencyID===1),group=company.groups.find(row=>row.SiteAccountID===1)
  assert.equal(group.Percent,50);assert.equal(group.ExpectedSites,2);assert.equal(company.Percent,50)
  assert.equal(result.companies.find(row=>row.AgencyID===2).Percent,50);assert.equal(result.companies.find(row=>row.AgencyID===2).groups[0].SiteAccountID,3,'Shared site uses Company B account instead of Company A account')
  assert.ok(!JSON.stringify(result).match(/GrossPay|TotalDeduction|NetPay|EmployeeID/),'Only completion data is read/returned')
  await db.query("INSERT INTO site_agency VALUES(6,1,'Active',2)")
  result=await source.listPayrollProgress({query});assert.equal(result.totals.ExpectedSites,7);assert.equal(result.totals.Percent,42.8)
  await db.query("UPDATE payroll SET Status='Approved' WHERE PayrollID=3")
  result=await source.listPayrollProgress({query});assert.equal(result.totals.CompletedSites,4)
  await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=1")
  result=await source.listPayrollProgress({query});assert.equal(result.totals.CompletedSites,3)
  const next=await source.listPayrollProgress({query:{periodStart:'2026-10-01',periodEnd:'2026-10-15'}})
  assert.equal(next.totals.CompletedSites,1,'Only the selected cutoff can supply completed payrolls')
 }finally{await db.end()}
})
