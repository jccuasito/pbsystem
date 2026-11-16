const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {performance}=require('node:perf_hooks'),{transformSync}=require('esbuild')
const shared=require('../shared/utils/thirteenthMonth.ts')
const capacityModule={exports:{}}
vm.runInThisContext('(function(module,require){'+transformSync(fs.readFileSync('server/utils/requestCapacity.ts','utf8'),{loader:'ts',format:'cjs'}).code+'\n})')(capacityModule,require)
const {coalesceRead}=capacityModule.exports
function load(file,db){
 const module={exports:{}}
 const req=name=>name==='node:crypto'?require(name):name==='h3'?{getQuery:e=>e.query||{},readBody:async e=>e.body,setHeader(){},createError:o=>Object.assign(Error(o.statusMessage),o)}:name.includes('dbconnect')?db:name.endsWith('/auth')?{requireSession:e=>{if(!e.session)throw Object.assign(Error('Please sign in'),{statusCode:401});return e.session}}:name.includes('thirteenthMonth')?shared:name.includes('requestCapacity')?{coalesceRead}:{}
 vm.runInThisContext('(function(module,require){'+transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code+'\n})')(module,req)
 return module.exports
}
function fixture(count=200){
 const agencies=[{AgencyID:1,AgencyName:'Synthetic agency'}],employees=Array.from({length:count},(_,n)=>({EmployeeID:n+1,EmployeeNumber:'SYN-'+(n+1),EmployeeName:'Synthetic employee '+(n+1),Status:'Active',DateHired:'2026-01-01',AgencyID:1,PositionName:'Synthetic position'}))
 const snapshots=new Map(),payrolls=[]
 for(let batch=1;batch<=24;batch++){
  const m=Math.ceil(batch/2),month=String(m).padStart(2,'0'),start=`2026-${month}-${batch%2?'01':'16'}`,end=`2026-${month}-${batch%2?'15':new Date(Date.UTC(2026,m,0)).getUTCDate()}`
  const people=employees.map(e=>({EmployeeID:e.EmployeeID,components:[{code:'RegularHours',amount:1000,direction:'Earning'},{code:'LateHours',amount:10,direction:'Deduction'},{code:'OTHours',amount:100,direction:'Earning'}],allowance:50,adjustments:batch===1&&e.EmployeeID===1?[{lineId:1,amount:120,direction:'Earning'}]:[]}))
  snapshots.set(batch,JSON.stringify({employees:people}))
  for(const e of employees)payrolls.push({PayrollID:(batch-1)*count+e.EmployeeID,EmployeeID:e.EmployeeID,AgencyID:1,BatchID:batch,SiteName:'Synthetic site',PeriodStart:start,PeriodEnd:end})
 }
 const headers=[{ThirteenthMonthID:1,EmployeeID:1,AgencyID:1,CoverageStart:'2026-01-01',CoverageEnd:'2026-12-31',Status:'Draft',SnapshotJson:'{"synthetic":true}',SourceHash:'previous-source'}]
 const imports=[{EarningID:1,EmployeeID:1,AgencyID:1,PeriodStart:'2026-01-10',PeriodEnd:'2026-01-10',BasicEarned:60,EntryKind:'Basic adjustment',Reference:'SYN-CORRECTION',Status:'Active'}]
 const adjustments=[{AdjustmentLineID:1,ComponentCode:'ManualAmount',Description:'Synthetic correction',Direction:'Earning',Amount:120,EmployeeID:1,PayrollID:1,AgencyID:1,BatchID:1,IncludedInBasic:1,ClassificationReason:'Synthetic review',EarnedDate:'2026-01-01'}]
 const releases=[{ReleaseID:1,ThirteenthMonthID:1,Amount:100,NetAmount:90,Status:'Active',PaymentDate:'2026-01-31'},{ReleaseID:2,ThirteenthMonthID:1,Amount:999,NetAmount:999,Status:'Voided',PaymentDate:'2026-01-31'}]
 const events=[{EventID:1,ThirteenthMonthID:1,Action:'save',Reason:'Synthetic review'}]
 const stats={queries:0,snapshotRows:0,snapshotBytes:0,agencyReads:0}
 const record=row=>{stats.snapshotRows++;stats.snapshotBytes+=Buffer.byteLength(row.SnapshotJson||'');return row}
 const db={execute:async(sql,args=[])=>{
  stats.queries++;await Promise.resolve()
  if(sql.startsWith('SELECT AgencyID')){stats.agencyReads++;return[agencies]}
  if(sql.includes('FROM employee e'))return[employees]
  if(sql.startsWith('SELECT BatchID,SnapshotJson'))return[args.filter(id=>snapshots.has(id)).map(id=>record({BatchID:id,SnapshotJson:snapshots.get(id)}))]
  if(sql.startsWith('SELECT py.PayrollID'))return[payrolls.map(row=>sql.includes('r.SnapshotJson')?record({...row,SnapshotJson:snapshots.get(row.BatchID)}):{...row})]
  if(sql.includes('FROM thirteenth_month_earning'))return[imports]
  if(sql.includes('FROM thirteenth_month_release'))return[releases]
  if(sql.includes('FROM thirteenth_month_event'))return[events]
  if(sql.includes('FROM thirteenth_month_pay'))return[headers]
  if(sql.includes('FROM payroll_adjustment pa'))return[adjustments.map(({BatchID,...row})=>sql.includes('r.SnapshotJson')?record({...row,SnapshotJson:snapshots.get(BatchID)}):{...row,BatchID})]
  throw Error('Unexpected synthetic query: '+sql.slice(0,80))
 }}
 return{db,stats,snapshots,agencies,imports}
}
const current='server/utils/thirteenthMonthCrud.ts'
test('200 employees / 24 cutoffs read each full batch snapshot once and preserve annual values',async()=>{
 const data=fixture(),api=load(current,data.db),start=performance.now(),result=await api.thirteenthMonthData(2026),elapsed=performance.now()-start
 assert.equal(result.items.length,200);assert.equal(data.stats.snapshotRows,24);assert.equal(data.stats.queries,9)
 assert.equal(result.items[1].summary.basicEarned,23760);assert.equal(result.items[1].summary.entitlement,1980)
 assert.equal(result.items[0].summary.basicEarned,23940);assert.equal(result.items[0].summary.entitlement,1995);assert.equal(result.items[0].summary.paid,100);assert.equal(result.items[0].summary.balance,1895)
 assert.equal(result.items[0].summary.gaps.length,0);assert.equal(result.items[0].events.length,1);assert.equal(result.items[0].adjustmentReviews[0].BatchID,undefined)
 console.log(JSON.stringify({scenario:'200 employees, 24 cutoffs',optimizedMs:Math.round(elapsed),snapshotRows:data.stats.snapshotRows,snapshotBytes:data.stats.snapshotBytes}))
 if(process.env.ANNUAL_PERFORMANCE_BASELINE){
  const old=fixture(),before=performance.now(),baseline=await load(process.env.ANNUAL_PERFORMANCE_BASELINE,old.db).thirteenthMonthData(2026),baselineMs=performance.now()-before
  assert.deepEqual(JSON.parse(JSON.stringify(result)),JSON.parse(JSON.stringify(baseline)),'All amounts, coverage, hashes, sources, saved rows, releases and histories must remain identical')
  assert.ok(data.stats.snapshotBytes<old.stats.snapshotBytes/100)
  const report={scenario:'Synthetic 200 employees / 24 cutoffs',sameResponse:true,baselineMs:Math.round(baselineMs),optimizedMs:Math.round(elapsed),baselineSnapshotRows:old.stats.snapshotRows,optimizedSnapshotRows:data.stats.snapshotRows,baselineSnapshotBytes:old.stats.snapshotBytes,optimizedSnapshotBytes:data.stats.snapshotBytes}
  fs.mkdirSync('.data/performance-work',{recursive:true});fs.writeFileSync('.data/performance-work/annual-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 }
})
test('concurrent GETs coalesce raw data only; each caller retains its own permissions and subsequent reads are fresh',async()=>{
 const data=fixture(3),api=load(current,data.db)
 const event=role=>({session:{sub:role==='Admin'?1:2,userType:role},context:{moduleCanEdit:role==='Admin'},query:{year:2026}})
 const [admin,viewer]=await Promise.all([api.listThirteenthMonth(event('Admin')),api.listThirteenthMonth(event('Viewer'))])
 assert.equal(data.stats.agencyReads,1);assert.equal(admin.permissions.canApprove,true);assert.equal(viewer.permissions.canApprove,false);assert.equal(viewer.permissions.canEdit,false)
 await api.listThirteenthMonth(event('Admin'));assert.equal(data.stats.agencyReads,2,'Do not cache settled payroll data')
 const other=event('Admin');other.query.agencyId=1
 await Promise.all([api.listThirteenthMonth(event('Admin')),api.listThirteenthMonth(other)]);assert.equal(data.stats.agencyReads,4,'Different filter sets cannot share a read')
 const fresh=event('Admin');fresh.query.fresh='1'
 await Promise.all([api.listThirteenthMonth(event('Admin')),api.listThirteenthMonth(fresh)]);assert.equal(data.stats.agencyReads,6,'Manual/post-save read must not share an older in-flight computation')
 const invalid=event('Admin');invalid.query.fresh='yes';await assert.rejects(()=>api.listThirteenthMonth(invalid),e=>e.statusCode===400)
 const count=data.stats.queries
 await assert.rejects(()=>api.listThirteenthMonth({query:{year:2026}}),e=>e.statusCode===401);assert.equal(data.stats.queries,count)
})
test('invalid snapshots still report missing evidence; former-employer grouping and snapshot order are preserved',async()=>{
 const data=fixture(3);data.snapshots.set(1,'invalid JSON')
 data.agencies.push({AgencyID:2,AgencyName:'Former synthetic employer'})
 data.imports.push({EarningID:2,EmployeeID:1,AgencyID:2,PeriodStart:'2026-01-01',PeriodEnd:'2026-01-31',BasicEarned:100,EntryKind:'Previous earnings',Reference:'SYN-FORMER',Status:'Active'})
 const result=await load(current,data.db).thirteenthMonthData(2026)
 assert.match(result.items[0].sources.find(row=>row.id==='payroll:1').issues.join(' '),/snapshot is missing/)
 assert.match(result.items[0].sources.find(row=>row.id==='adjustment:1').issues.join(' '),/missing from the finalized snapshot/)
 const dates=result.items[0].sources.map(row=>row.start);assert.deepEqual(dates,[...dates].sort())
 assert.equal(result.items.length,4);const former=result.items.find(row=>row.AgencyID===2);assert.equal(former.AgencyName,'Former synthetic employer');assert.equal(former.summary.basicEarned,100)
})
