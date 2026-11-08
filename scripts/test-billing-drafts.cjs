const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const {transformSync}=require('esbuild')
const {billingLineAmount,calculateBillingDraft,defaultBillingSettings,normalizeBillingDraft}=require('../shared/utils/billingDraft.ts')

const line=(overrides={})=>({id:'service',description:'Sample service',quantity:100,unit:'hour',rate:100,direction:'Charge',category:'Service',...overrides})
const jiti=require('jiti').createJiti(__filename)
const {defaultBillingProfile,normalizeBillingProfile,profileBillingLines}=jiti('../shared/utils/billingProfile.ts')
function profile(mode='site') {
  const value=defaultBillingProfile();value.mode=mode
  for(const rule of value.rules)rule.enabled=['RegularHours','OTHours','NightDiffHours'].includes(rule.code)
  return normalizeBillingProfile(value)
}

test('client profiles whitelist components, require explicit service selection and keep fees configurable',()=>{
  assert.throws(()=>normalizeBillingProfile(defaultBillingProfile()),/at least one/)
  const value=profile();value.rules[0].code='NetPay'
  assert.throws(()=>normalizeBillingProfile(value),/Invalid/)
  const wrong=profile();wrong.rules[0].divisor=8
  assert.throws(()=>normalizeBillingProfile(wrong),/one hour/)
  assert.throws(()=>normalizeBillingProfile({...profile(),hoursPerDay:0}),/hours per billing day/)
  assert.equal(profile().settings.vatPercent,0)
})

test('client-specific billing excludes disabled extension and private payroll money, and handles day contracts and layouts',()=>{
  const people=[{SiteName:'Site A',PositionName:'Guard',components:[{code:'RegularHours',hours:8},{code:'OTHours',hours:2},{code:'OTExtHours',hours:3},{code:'NightDiffHours',hours:1}],billingRate:{RegularRate:100,OTRate:120,NightDiffRate:10},netPreview:1,deductions:[{amount:9999}]},
    {SiteName:'Site B',PositionName:'Guard',components:[{code:'RegularHours',hours:8}],billingRate:{RegularRate:110}}]
  const config=profile('client'),lines=profileBillingLines(people,config)
  assert.equal(lines.length,4,'different regular prices remain separate')
  assert.ok(!lines.some(item=>/extension|net|deduction/i.test(item.description)))
  assert.equal(calculateBillingDraft(lines,config.settings).totalDue,1930)
  config.rules[0].unit='day';config.rules[0].divisor=8;config.rules[0].rateMode='fixed';config.rules[0].rate=1200
  const days=profileBillingLines(people,config)
  assert.equal(days[0].quantity,2);assert.equal(days[0].rate,1200)
  config.layout='site'
  assert.equal(profileBillingLines(people,config).filter(item=>item.unit==='day').length,2)
  assert.match(profileBillingLines(people,config)[0].description,/Site A/)
})

test('billing pages and print styles compile and billing endpoints use module authorization',()=>{
  const {parse,compileScript,compileTemplate,compileStyle}=require('@vue/compiler-sfc')
  for(const filename of ['app/components/BillingWorkspace.vue','app/components/BillingDraftModal.vue','app/components/ClientBillingSetupModal.vue','app/pages/billing/generate/index.vue','app/pages/billing/history/index.vue']) {
    const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(errors,[])
    const script=compileScript(descriptor,{id:filename})
    assert.deepEqual(compileTemplate({source:descriptor.template.content,filename,id:filename,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
    for(const style of descriptor.styles)assert.deepEqual(compileStyle({source:style.content,filename,id:filename,scoped:style.scoped}).errors,[])
  }
  const module={exports:{}}
  vm.runInNewContext(transformSync(fs.readFileSync('server/utils/settingsAccess.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,require:()=>({})})
  assert.equal(module.exports.moduleForPath('/api/billing/drafts/preview'),'billing')
  assert.equal(module.exports.moduleForPath('/api/billing/profiles'),'billing')
})

function backend(db,session={sub:1,userType:'Admin'}) {
  const module={exports:{}}
  const h3={createError:details=>Object.assign(new Error(details.statusMessage),details),readBody:async event=>event.body,getQuery:event=>event.query||{},getRouterParam:(event,name)=>event[name]}
  vm.runInNewContext(transformSync(fs.readFileSync('server/utils/billingDraftCrud.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,require:name=>name==='node:crypto'?require(name):name==='h3'?h3:name==='./auth'?{requireSession:()=>session}:name.includes('dbconnect')?{execute:(...args)=>db.execute(...args),getConnection:async()=>({execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}})}:name==='./rateVersions'?jiti('../server/utils/rateVersions.ts'):name.includes('billingProfile')?jiti('../shared/utils/billingProfile.ts'):name.includes('billingDraft')?jiti('../shared/utils/billingDraft.ts'):{}})
  return module.exports
}

test('read-only billing users cannot save profiles or drafts',async()=>{
  const api=backend({getConnection(){throw Error('Reached a write')}},{sub:1,userType:'Viewer'})
  await assert.rejects(api.saveBillingDraft({context:{}}),error=>error.statusCode===403)
  await assert.rejects(api.saveBillingProfile({context:{}}),error=>error.statusCode===403)
  await assert.rejects(api.changeBillingStatus({context:{}}),error=>error.statusCode===403)
  await assert.rejects(backend({}, {sub:1,userType:'Admin'}).changeBillingStatus({context:{moduleCanEdit:false}}),error=>error.statusCode===403)
})

test('finalized payroll billing integration uses only connection-local temporary tables',{skip:process.env.BILLING_DRAFT_TEST_DATABASE!=='1'},async()=>{
  const mysql=require('mysql2/promise'),env={...require('node:util').parseEnv(fs.readFileSync('.env','utf8')),...process.env}
  const db=await mysql.createConnection({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER||'root',password:env.DB_PASSWORD,database:env.DB_NAME||'pbsystem',timezone:'Z'})
  try {
    const tables={
      agency:'AgencyID INT PRIMARY KEY,AgencyName VARCHAR(100),AgencyAddress VARCHAR(100),AgencyContact VARCHAR(100),Status VARCHAR(20)',
      client:'ClientID INT PRIMARY KEY,ClientName VARCHAR(100),ClientAddress VARCHAR(100),Status VARCHAR(20)',
      site:'SiteID INT PRIMARY KEY,ClientID INT,SiteName VARCHAR(100)',site_agency:'SiteID INT,AgencyID INT',
      attendance_dtr:'BatchID INT PRIMARY KEY,AgencyID INT,ClientID INT,SiteID INT,PeriodStart DATE,PeriodEnd DATE,Status VARCHAR(40)',
      payroll_processing_review:'BatchID INT PRIMARY KEY,ReviewStatus VARCHAR(40),SnapshotJson LONGTEXT',
      payroll_processing_posting:'BatchID INT,EmployeeID INT,PayrollID INT,Status VARCHAR(20)',payroll:'PayrollID INT PRIMARY KEY,Status VARCHAR(20)',
      billing_client_profile:'AgencyID INT,ClientID INT,Revision INT,ConfigJson LONGTEXT,Status VARCHAR(20) DEFAULT \'Active\',UpdatedBy INT,PRIMARY KEY(AgencyID,ClientID)',
      site_rate:'SiteRateID INT PRIMARY KEY,SiteID INT,BillingRateID INT',agency_position:'AgencyPositionID INT PRIMARY KEY,AgencyID INT',
      billing_rate:'BillingRateID INT PRIMARY KEY,AgencyPositionID INT,EffectiveDate DATE,RegularRate DECIMAL(10,2),OTRate DECIMAL(10,2),NightDiffRate DECIMAL(10,2),OTExtRate DECIMAL(10,2)',
      billing_rate_version:'BillingRateVersionID INT PRIMARY KEY,BillingRateID INT,EffectiveDate DATE,RegularRate DECIMAL(10,2),OTRate DECIMAL(10,2),NightDiffRate DECIMAL(10,2),OTExtRate DECIMAL(10,2)',
      billing:'BillingID INT AUTO_INCREMENT PRIMARY KEY,ClientID INT,BillingPeriod VARCHAR(50),BillingDate DATE,TotalAmount DECIMAL(12,2),Status VARCHAR(30)',
      billing_draft:'BillingID INT PRIMARY KEY,AgencyID INT,ClientID INT,PeriodStart DATE,PeriodEnd DATE,Revision INT,SourceHash CHAR(64),SnapshotJson LONGTEXT,CreatedBy INT,UpdatedBy INT,UpdatedAt DATETIME',
      billing_draft_source:'BillingID INT,BatchID INT UNIQUE',billing_detail:'BillingID INT,EmployeeID INT NULL,SiteID INT NULL,Description VARCHAR(150),Quantity DECIMAL(10,2),Rate DECIMAL(10,2),Amount DECIMAL(10,2)',
      billing_draft_revision:'BillingID INT,Revision INT,SnapshotJson LONGTEXT,ActorUserID INT,CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE(BillingID,Revision)',
      user:'UserID INT,FirstName VARCHAR(100),LastName VARCHAR(100)',
    }
    for(const [name,columns] of Object.entries(tables))await db.query(`CREATE TEMPORARY TABLE \`${name}\`(${columns}) ENGINE=InnoDB`)
    await db.query("INSERT INTO agency VALUES(1,'Agency A','','','Active'),(2,'Agency B','','','Active')")
    await db.query("INSERT INTO client VALUES(1,'Client A','','Active'),(2,'Client B','','Active')")
    await db.query("INSERT INTO site VALUES(1,1,'Site A'),(2,1,'Site B'),(3,2,'Site C')")
    await db.query("INSERT INTO `user` VALUES(1,'Billing','Officer')")
    await db.query('INSERT INTO site_agency VALUES(1,1),(2,1),(3,2)')
    await db.query("INSERT INTO attendance_dtr VALUES(1,1,1,1,'2026-09-16','2026-09-30','Computed to Payroll'),(2,1,1,2,'2026-09-16','2026-09-30','Computed to Both'),(3,2,2,3,'2026-09-16','2026-09-30','Computed to Payroll')")
    const snap=(batch,site,employee)=>({BatchID:batch,AgencyID:batch===3?2:1,ClientID:batch===3?2:1,SiteID:site,SiteName:'Site '+site,employees:[{EmployeeID:employee,EmployeeName:'Synthetic Employee',AttendanceType:'Reliever',PositionName:'Guard',SiteRateID:site,netPreview:1,deductions:[{amount:99999}],components:[{code:'RegularHours',hours:16},{code:'OTHours',hours:4},{code:'NightDiffHours',hours:2},{code:'OTExtHours',hours:3}]}]})
    for(const [batch,site,employee] of [[1,1,1],[2,2,2],[3,3,3]])await db.execute("INSERT INTO payroll_processing_review VALUES(?,'Approved',?)",[batch,JSON.stringify(snap(batch,site,employee))])
    await db.query("INSERT INTO payroll VALUES(1,'Approved'),(2,'Released'),(3,'Approved')")
    await db.query("INSERT INTO payroll_processing_posting VALUES(1,1,1,'Active'),(2,2,2,'Active'),(3,3,3,'Active')")
    await db.query('INSERT INTO site_rate VALUES(1,1,1),(2,2,1),(3,3,2)')
    await db.query('INSERT INTO agency_position VALUES(1,1),(2,2)')
    await db.query("INSERT INTO billing_rate VALUES(1,1,'2026-01-01',100,120,10,130),(2,2,'2026-01-01',100,120,10,130)")
    await db.query("INSERT INTO billing_rate_version VALUES(1,1,'2026-09-20',150,160,15,180),(2,1,'2026-10-01',999,999,999,999)")
    const api=backend(db),config=profile('client')
    await api.saveBillingProfile({context:{},body:{agencyId:1,clientId:1,revision:0,config}})
    await api.saveBillingProfile({context:{},body:{agencyId:2,clientId:2,revision:0,config}})
    await assert.rejects(api.saveBillingProfile({context:{},body:{agencyId:1,clientId:1,revision:0,config}}),e=>e.statusCode===409)
    const list=await api.listBillingDrafts({context:{},query:{}})
    assert.equal(list.accounts.length,2);assert.equal(list.sources.length,3)
    const preview=await api.previewBillingDraft({context:{},query:{batchIds:'1,2'}})
    assert.equal(preview.source.batch.BatchIDs.length,2)
    const source=await api.billingSourceData(db,[1,2])
    assert.equal(source.lines.find(item=>item.description==='Regular').quantity,32)
    assert.equal(source.lines.find(item=>item.description==='Regular').rate,150)
    assert.equal(source.lines.some(item=>/extension/i.test(item.description)),false)
    assert.equal(source.employees[0].type,'Reliever')
    assert.ok(!JSON.stringify(source).includes('99999'),'No employee deductions in billing response')
    await assert.rejects(api.billingSourceData(db,[1,3]),e=>e.statusCode===400)
    const input={batchIds:[1,2],revision:0,sourceHash:source.sourceHash,lines:source.lines,settings:source.settings,billingDate:'2026-10-03',notes:'Synthetic fixture',totalDue:1,Status:'Paid'}
    await db.beginTransaction()
    const first=await api.saveBillingDraftData(db,input,1)
    const [[header]]=await db.execute('SELECT * FROM billing WHERE BillingID=?',[first.billingId])
    assert.equal(header.Status,'Draft');assert.equal(Number(header.TotalAmount),calculateBillingDraft(source.lines,source.settings).totalDue)
    const [[details]]=await db.query('SELECT SUM(Amount) total,COUNT(*) count FROM billing_detail')
    assert.equal(Number(details.total),Number(header.TotalAmount))
    const [[nullOwners]]=await db.query('SELECT COUNT(*) count FROM billing_detail WHERE EmployeeID IS NULL AND SiteID IS NULL')
    assert.equal(nullOwners.count,details.count)
    const detailAfterSave=await api.getBillingDraft({id:String(first.billingId),context:{}})
    assert.equal(detailAfterSave.permissions.canEdit,true)
    assert.equal(detailAfterSave.history.length,1)
    await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=1")
    const readonly=await api.getBillingDraft({id:String(first.billingId),context:{}})
    assert.equal(readonly.permissions.canEdit,false);assert.ok(readonly.sourceIssue);assert.ok(readonly.draft.snapshot.lines.length)
    await db.query("UPDATE payroll SET Status='Approved' WHERE PayrollID=1")
    await assert.rejects(api.previewBillingDraft({context:{},query:{batchIds:'1,2'}}),e=>e.statusCode===409)
    await assert.rejects(api.saveBillingDraftData(db,input,1),e=>e.statusCode===409)
    await assert.rejects(api.saveBillingDraftData(db,{...input,billingId:first.billingId,revision:0},1),e=>e.statusCode===409)
    await assert.rejects(api.saveBillingDraftData(db,{...input,billingId:first.billingId,revision:1,sourceHash:'stale'},1),e=>e.statusCode===409)
    const updated=await api.saveBillingDraftData(db,{...input,billingId:first.billingId,revision:1,settings:{...input.settings,adminPercent:5}},1)
    assert.equal(updated.revision,2)
    assert.equal((await db.query('SELECT COUNT(*) n FROM billing_draft_revision'))[0][0].n,2)
    const billId=first.billingId,action={action:'finalize',revision:2,sourceHash:source.sourceHash}
    await assert.rejects(api.changeBillingStatusData(db,billId,{...action,action:'Paid'},1),e=>e.statusCode===400)
    await assert.rejects(api.changeBillingStatusData(db,billId,{...action,revision:1},1),e=>e.statusCode===409)
    await assert.rejects(api.changeBillingStatusData(db,billId,{...action,sourceHash:'stale'},1),e=>e.statusCode===409)
    await db.query('UPDATE billing_client_profile SET Revision=Revision+1 WHERE AgencyID=1 AND ClientID=1')
    await assert.rejects(api.changeBillingStatusData(db,billId,action,1),e=>e.statusCode===409)
    await db.query('UPDATE billing_client_profile SET Revision=Revision-1 WHERE AgencyID=1 AND ClientID=1')
    await db.execute('UPDATE billing SET TotalAmount=1 WHERE BillingID=?',[billId])
    await assert.rejects(api.changeBillingStatusData(db,billId,action,1),e=>e.statusCode===409)
    const beforeFinal=(await api.getBillingDraft({id:String(billId),context:{}})).draft.snapshot
    await db.execute('UPDATE billing SET TotalAmount=? WHERE BillingID=?',[beforeFinal.totals.totalDue,billId])
    const final=await api.changeBillingStatusData(db,billId,action,1)
    assert.equal(final.status,'Finalized');assert.equal(final.revision,3)
    await assert.rejects(api.changeBillingStatusData(db,billId,{...action,revision:3},1),e=>e.statusCode===409)
    await assert.rejects(api.saveBillingDraftData(db,{...input,billingId:billId,revision:3},1),e=>e.statusCode===409)
    await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=1")
    const frozen=await api.getBillingDraft({id:String(billId),context:{}})
    assert.equal(frozen.source,null);assert.equal(frozen.sourceIssue,'');assert.equal(frozen.draft.status,'Finalized')
    assert.equal(frozen.permissions.canEdit,false);assert.equal(frozen.permissions.canReopen,true)
    assert.equal(frozen.history[0].action,'Finalized');assert.equal(frozen.history[0].ActorName,'Billing Officer');assert.ok(frozen.history[0].CreatedAt)
    assert.deepEqual(frozen.draft.snapshot.lines,beforeFinal.lines);assert.deepEqual(frozen.draft.snapshot.totals,beforeFinal.totals)
    await assert.rejects(api.changeBillingStatusData(db,billId,{action:'reopen',revision:3,reason:' '},1),e=>e.statusCode===400)
    await assert.rejects(api.changeBillingStatusData(db,billId,{action:'reopen',revision:3,reason:'a'.repeat(501)},1),e=>e.statusCode===400)
    const reopened=await api.changeBillingStatusData(db,billId,{action:'reopen',revision:3,reason:'Correct client contract rate'},1)
    assert.equal(reopened.status,'Draft');assert.equal(reopened.revision,4)
    const audit=await api.getBillingDraft({id:String(billId),context:{}})
    assert.equal(audit.history[0].action,'Reopened');assert.equal(audit.history[0].reason,'Correct client contract rate')
    assert.equal(audit.permissions.canEdit,false,'Reopening cannot bypass invalid payroll sources')
    await db.query("UPDATE payroll SET Status='Approved' WHERE PayrollID=1")
    assert.equal((await api.getBillingDraft({id:String(billId),context:{}})).permissions.canFinalize,true)
    await assert.rejects(api.changeBillingStatusData(db,billId,{action:'reopen',revision:4,reason:'Duplicate click'},1),e=>e.statusCode===409)
    const finalizedRevision=JSON.parse((await db.execute('SELECT SnapshotJson FROM billing_draft_revision WHERE BillingID=? AND Revision=3',[billId]))[0][0].SnapshotJson)
    assert.equal(finalizedRevision.workflow.status,'Finalized','Reopening preserves the finalized version')
    await db.rollback()
    assert.equal((await db.query('SELECT COUNT(*) n FROM billing'))[0][0].n,0)
    // Separate site invoices and cancelled/missing finalized sources are rejected.
    await api.saveBillingProfile({context:{},body:{agencyId:1,clientId:1,revision:1,config:profile('site')}})
    await assert.rejects(api.billingSourceData(db,[1,2]),/separate bill/)
    await db.query("UPDATE payroll_processing_review SET ReviewStatus='Cancelled' WHERE BatchID=1")
    await assert.rejects(api.billingSourceData(db,[1]),/finalized payroll/)
    await db.query("UPDATE payroll_processing_review SET ReviewStatus='Approved' WHERE BatchID=1")
    await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=1")
    await assert.rejects(api.billingSourceData(db,[1]),/still be finalized/)
    await db.query("UPDATE payroll SET Status='Approved' WHERE PayrollID=1")
    const detail=await api.billingSourceData(db,[1])
    // Inject a mid-save failure through the actual route: both header and lines must roll back.
    const wrapped={execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO billing_detail'))throw Error('Injected detail failure');return db.execute(sql,args)},beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
    await assert.rejects(backend(wrapped).saveBillingDraft({context:{},body:{...input,batchIds:[1],sourceHash:detail.sourceHash,lines:detail.lines,settings:detail.settings}}),/Injected detail failure/)
    assert.equal((await db.query('SELECT COUNT(*) n FROM billing'))[0][0].n,0)
    const created=await api.saveBillingDraft({context:{},body:{...input,batchIds:[1],sourceHash:detail.sourceHash,lines:detail.lines,settings:detail.settings}})
    const failingAudit={execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO billing_draft_revision'))throw Error('Injected audit failure');return db.execute(sql,args)},beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback()}
    await assert.rejects(backend(failingAudit).changeBillingStatus({id:String(created.billingId),context:{},body:{action:'finalize',revision:1,sourceHash:detail.sourceHash}}),/Injected audit failure/)
    const rolledBack=await api.getBillingDraft({id:String(created.billingId),context:{}})
    assert.equal(rolledBack.draft.status,'Draft');assert.equal(rolledBack.draft.revision,1);assert.equal(rolledBack.history.length,1)
  } finally { await db.end() }
})
test('billing defaults have no unconfirmed administrative cost, tax or benefits',()=>{
  const totals=calculateBillingDraft([line()],defaultBillingSettings(10))
  assert.equal(totals.totalDue,10000)
  for(const key of ['administrative','vat','withholding','retirement','uniform'])assert.equal(totals[key],0)
})
test('manual daily contract lines use days times the agreed daily price once',()=>{
  const input=normalizeBillingDraft([line({quantity:6,unit:'day',rate:1200})],defaultBillingSettings())
  assert.equal(calculateBillingDraft(input.lines,input.settings).totalDue,7200)
})
test('administrative-only VAT and withholding use the explicitly configured bases',()=>{
  const settings={...defaultBillingSettings(10),adminPercent:20,vatPercent:12,withholdingPercent:2,retirementRate:20,uniformRate:5}
  const totals=calculateBillingDraft([line(),line({id:'night',description:'Sample ND',quantity:20,rate:10})],settings)
  assert.equal(totals.serviceSubtotal,10200)
  assert.equal(totals.administrative,2040)
  assert.equal(totals.vat,244.80)
  assert.equal(totals.withholding,40.80)
  assert.equal(totals.vatExemptSales,10450)
  assert.equal(totals.gross,12734.80)
  assert.equal(totals.totalDue,12694)
})
test('service credits reduce fees and additional client charges follow their selected base',()=>{
  const lines=[line(),line({id:'credit',quantity:1,rate:200,direction:'Credit'}),line({id:'extra',quantity:1,rate:500,category:'Additional'})]
  const settings={...defaultBillingSettings(),adminPercent:10,vatPercent:12,vatBase:'beforeTax',withholdingPercent:2,withholdingBase:'beforeTax',adminBase:'serviceAndExtras'}
  const totals=calculateBillingDraft(lines,settings)
  assert.equal(totals.serviceSubtotal,9800)
  assert.equal(totals.administrative,1030)
  assert.equal(totals.vat,1359.60)
  assert.equal(totals.vatExemptSales,0)
  assert.equal(totals.withholding,226.60)
  assert.equal(totals.totalDue,12463)
  assert.equal(billingLineAmount(lines[1]),-200)
})
test('invalid numbers, duplicate lines, invalid bases and negative totals cannot be saved',()=>{
  for(const bad of [{quantity:-1},{rate:NaN},{rate:Infinity},{quantity:1e6},{unit:'month'},{direction:'Unknown'}])assert.throws(()=>normalizeBillingDraft([line(bad)],defaultBillingSettings()))
  assert.throws(()=>normalizeBillingDraft([line(),line()],defaultBillingSettings()),/identifier/)
  assert.throws(()=>normalizeBillingDraft([line()],{...defaultBillingSettings(),vatBase:'guessed'}),/base/)
  assert.throws(()=>calculateBillingDraft([line({direction:'Credit'})],defaultBillingSettings()),/Credits/)
})


test('invoice print uses escaped business text, current quantities, credits and configured totals',()=>{
  const {renderBillingInvoice}=jiti('../shared/utils/billingInvoicePrint.ts')
  const settings={...defaultBillingSettings(10),adminPercent:20,vatPercent:12,withholdingPercent:2,retirementRate:20,uniformRate:5}
  const lines=[line(),line({id:'credit',description:'UT / Tardiness',quantity:1,rate:200,direction:'Credit'})]
  const html=renderBillingInvoice({metadata:{AgencyName:'Agency <script>alert(1)</script>',ClientName:'Client & Co.',ClientAddress:'Address',SiteName:'Site A',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'},lines,settings,billingDate:'2026-10-03',reference:'BILL-0001',finalized:false})
  assert.match(html,/Agency &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html,/Client &amp; Co\./);assert.ok(!html.includes('<script>'))
  assert.match(html,/DRAFT - FOR REVIEW/);assert.match(html,/October 3, 2026/)
  assert.match(html,/September 16, 2026 - September 30, 2026/)
  assert.match(html,/\(200\.00\)/,'Credits retain their negative amount')
  const totals=calculateBillingDraft(lines,settings)
  assert.ok(html.includes(new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(totals.totalDue)))
  assert.match(html,/Retirement pay/);assert.match(html,/Uniform allowance/);assert.match(html,/Withholding \(2%\)/)
  assert.ok(!html.includes('Zero Rated Sales'),'Do not invent tax classifications from the sample photo')
})

test('finalized invoice print labels its status and retains every line in long statements',()=>{
  const {renderBillingInvoice}=jiti('../shared/utils/billingInvoicePrint.ts')
  const lines=Array.from({length:75},(_,i)=>line({id:'line-'+i,description:'Service line '+(i+1)}))
  const html=renderBillingInvoice({metadata:{AgencyName:'Agency A',ClientName:'Client A'},lines,settings:defaultBillingSettings(),billingDate:'2026-10-03',reference:'BILL-0001',finalized:true})
  assert.match(html,/FINALIZED BILLING STATEMENT/);assert.ok(!html.includes('DRAFT ONLY'))
  assert.match(html,/Service line 75/);assert.equal((html.match(/Service line /g)||[]).length,75)
  assert.match(html,/display:table-header-group/,'Column headings repeat across pages')
})
