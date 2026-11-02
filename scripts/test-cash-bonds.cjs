const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test'),{transformSync}=require('esbuild')
function load(file,resolve){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,require:resolve,console,Date});return module.exports}
test('refundable overrides and posted collections are isolated by catalog item, employee and cutoff',()=>{
 const helper=load('server/utils/cashBondLedger.ts',name=>name==='h3'?{}:name.includes('rateVersions')?{dateOnly:value=>String(value||'').slice(0,10)}:{})
 const batch={AgencyID:1,PeriodStart:'2026-09-01',PeriodEnd:'2026-09-15'},person={EmployeeID:1},item={recordId:1,accountTypeId:1,amount:200},data={overrides:[{EmployeeID:1,AgencyID:1,DeductionTypeID:1,PeriodStart:batch.PeriodStart,PeriodEnd:batch.PeriodEnd,Amount:400}],posted:[]}
 assert.equal(helper.cashBondDue(data,person,batch,item).amount,400)
 assert.equal(helper.cashBondDue(data,person,batch,{...item,accountTypeId:2}).amount,200)
 assert.equal(helper.cashBondDue(data,{EmployeeID:2},batch,item).amount,200)
 assert.equal(helper.cashBondDue(data,person,{...batch,PeriodStart:'2026-10-01',PeriodEnd:'2026-10-15'},item).amount,200)
 data.overrides[0].Amount=0;assert.equal(helper.cashBondDue(data,person,batch,item).amount,0)
 data.posted=[{...data.overrides[0],DeductionTypeID:2}];assert.equal(helper.cashBondDue(data,person,batch,{...item,accountTypeId:2}).alreadyCollected,true)
 assert.equal(helper.cashBondDue(data,person,batch,item).alreadyCollected,false)
})

test('cash bond payroll ledger, cutoff overrides, refunds, idempotency, cancellation and re-finalization are transactional',{skip:process.env.CASH_BOND_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  const [tables]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
  for(const row of tables){assert.match(row.TABLE_NAME,/^[a-zA-Z0-9_]+$/);const [[definition]]=await db.query('SHOW CREATE TABLE `'+row.TABLE_NAME+'`');await db.query(definition['Create Table'].replace(/^CREATE TABLE/,'CREATE TEMPORARY TABLE').split('\n').filter(line=>!/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g,'\n)'))}
  const sql=[
   "INSERT INTO deduction_loan_classification(ClassificationID,ClassificationName,AppliesTo,Status) VALUES(1,'Refundable deposits','Deduction','Active'),(2,'SSS','Contribution','Active'),(3,'Insurance','Recurring Deduction','Active'),(4,'Mixed items','Deduction','Active')",
   "INSERT INTO deduction_type(DeductionTypeID,DeductionName,ClassificationID,DeductionCategory,DeductionPeriod,IsRefundable,Status) VALUES(1,'Cash bond',1,'Company','Semi-Monthly',1,'Active'),(2,'Equipment deposit',1,'Company','Semi-Monthly',1,'Active'),(3,'Premium',2,'Government','Monthly',0,'Active'),(4,'Insurance premium',3,'Company','Semi-Monthly',0,'Active'),(5,'Medical exam',4,'Company','One-Time',0,'Active'),(6,'Refundable deposit',4,'Company','Semi-Monthly',1,'Active')",
   "INSERT INTO `user`(UserID,FirstName,LastName,Gender,Email,UserType,Status) VALUES(1,'Test','Admin','Prefer not to say','bond@example.invalid','Admin','Active')",
   "INSERT INTO agency(AgencyID,AgencyName,Status) VALUES(1,'Test agency','Active')",
   "INSERT INTO `position`(PositionID,PositionName,Status) VALUES(1,'Guard','Active')",
   "INSERT INTO agency_position(AgencyPositionID,AgencyID,PositionID,Status) VALUES(1,1,1,'Active')",
   "INSERT INTO client(ClientID,ClientName,Status) VALUES(1,'Test client','Active')",
   "INSERT INTO site(SiteID,ClientID,SiteName,Status) VALUES(1,1,'Test site','Active')",
   "INSERT INTO payroll_rate(PayrollRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES(1,1,80,'2026-01-01','Active')",
   "INSERT INTO billing_rate(BillingRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES(1,1,100,'2026-01-01','Active')",
   "INSERT INTO site_rate(SiteRateID,SiteID,PayrollRateID,BillingRateID,Status) VALUES(1,1,1,1,'Active')",
   "INSERT INTO employee(EmployeeID,AgencyPositionID,FirstName,LastName,Status) VALUES(1,1,'First','Employee','Active'),(2,1,'Second','Employee','Active')",
   "INSERT INTO employee_deployment(DeploymentID,EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES(1,1,1,1,'Regular',1,'2026-01-01'),(2,2,1,1,'Regular',1,'2026-01-01')",
   "INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(2,1,1,1,'2026-09-01','2026-09-15','Computed to Payroll',1),(3,1,1,1,'2026-10-01','2026-10-15','Computed to Payroll',1),(4,1,1,1,'2026-09-16','2026-09-30','Computed to Payroll',1)",
  ];for(const statement of sql)await db.query(statement)
  const migrate=require('./lib/recurring-catalog-migration.cjs');assert.equal((await migrate(db)).moved,3);assert.equal((await migrate(db)).moved,0,'Migration is idempotent')
  const [migrated]=await db.query('SELECT d.DeductionTypeID,d.ClassificationID,c.AppliesTo FROM deduction_type d JOIN deduction_loan_classification c USING(ClassificationID)');assert.equal(migrated.find(r=>r.DeductionTypeID===1).ClassificationID,1,'Cash bond IDs are retained');assert.equal(migrated.find(r=>r.DeductionTypeID===5).AppliesTo,'Deduction');assert.equal(migrated.find(r=>r.DeductionTypeID===6).AppliesTo,'Recurring Deduction')
  for(const batch of [2,3,4]){await db.query("INSERT INTO attendance_dtr_employee(BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES(?,1,1,'Regular',1,1),(?,2,2,'Regular',1,1)",[batch,batch]);await db.query("INSERT INTO attendance(EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES(1,1,?,?,'Present',8,1),(2,2,?,?,'Present',8,1)",[batch,batch===2?'2026-09-10':batch===3?'2026-10-10':'2026-09-20',batch,batch===2?'2026-09-10':batch===3?'2026-10-10':'2026-09-20'])}
  const connection={execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}},pool={execute:connection.execute,getConnection:async()=>connection},h3={setHeader(){},readBody:async e=>e.body,getQuery:e=>e.query||{},getRouterParam:(e,key)=>e.params[key],createError:o=>Object.assign(Error(o.statusMessage),o)}
  let payroll
  const resolve=name=>name==='h3'?h3:name==='node:crypto'?require('node:crypto'):name.includes('dbconnect')?pool:name.endsWith('/auth')?{requireSession:e=>e.session||{sub:1,userType:'Admin'}}:name.includes('rateVersions')?versions:name.includes('payrollPreview')?require('../shared/utils/payrollPreview.ts'):name.includes('dtrWorkflowAudit')?{recordDtrWorkflowEvent:async()=>{}}:name.includes('cashBondLedger')?ledger:name.includes('payrollProcessingCrud')?{payrollProcessingData:(...args)=>payroll.payrollProcessingData(...args)}:{}
  const versions=load('server/utils/rateVersions.ts',name=>name.includes('rateFields')?require('../shared/utils/rateFields.ts'):{}),ledger=load('server/utils/cashBondLedger.ts',resolve),api=load('server/utils/cashBondCrud.ts',resolve);payroll=load('server/utils/payrollProcessingCrud.ts',resolve)
  const plans=load('server/utils/agencyContributionCrud.ts',resolve),catalog=load('server/utils/deductionLoanCatalogCrud.ts',resolve),event=(body,batch=2)=>({body,params:{id:String(batch)},context:{moduleCanEdit:true}})
  await assert.rejects(()=>plans.saveAgencyContribution({...event({}),session:{sub:1,userType:'Viewer'}}),e=>e.statusCode===403)
  await plans.saveAgencyContribution(event({AgencyID:1,AgencyPositionID:1,DeductionTypeID:1,EffectiveStartDate:'2026-01-01',AmountPerCutoff:200,DeductOn:'First',Status:'Active'}))
  const period=batch=>batch===2?['2026-09-01','2026-09-15']:batch===3?['2026-10-01','2026-10-15']:['2026-09-16','2026-09-30']
  const preview=async(batch=2)=>(await payroll.payrollProcessingData(...period(batch),connection)).sites.find(s=>Number(s.BatchID)===batch)
  assert.equal((await preview()).employees[0].netPreview,440);assert.equal((await preview(4)).employees[0].netPreview,640)
  await api.changeCashBondCutoff(event({BatchID:2,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:400,Reason:'Catch-up cash bond'}))
  assert.equal((await preview()).employees[0].netPreview,240);assert.equal((await preview()).employees[1].netPreview,440)
  assert.equal((await preview(3)).employees[0].netPreview,440,'Next first cutoff returns to 200')
  await api.changeCashBondCutoff(event({BatchID:2,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:350,Reason:'Corrected catch-up amount'}));assert.equal((await preview()).employees[0].netPreview,290)
  await api.changeCashBondCutoff(event({BatchID:2,EmployeeID:1,DeductionTypeID:1,Action:'reset'}));assert.equal((await preview()).employees[0].netPreview,440)
  await api.changeCashBondCutoff(event({BatchID:2,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:400,Reason:'Final catch-up amount'}))
  await payroll.reviewPayrollProcessing(event({action:'finalize'}))
  let accounts=(await api.listCashBonds({query:{employeeId:1}})).accounts,a=accounts.find(row=>Number(row.EmployeeID)===1)
  assert.equal(Number(a.Balance),400);assert.equal(Number(a.TotalCollected),400)
  assert.equal((await db.query('SELECT COUNT(*) n FROM cash_bond_ledger WHERE EntryType=\'Collection\''))[0][0].n,2)
  await assert.rejects(()=>payroll.reviewPayrollProcessing(event({action:'finalize'})),/already finalized/)
  await assert.rejects(()=>api.changeCashBondCutoff(event({BatchID:2,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:350,Reason:'Too late update'})),/Finalized/)
  const [[py]]=await db.query('SELECT * FROM payroll WHERE EmployeeID=1 ORDER BY PayrollID LIMIT 1')
  const [[deducted]]=await db.query("SELECT Amount,DeductionTypeID FROM payroll_deduction WHERE PayrollID=? AND ReferenceType='Agency Contribution'",[py.PayrollID]);assert.equal(Number(deducted.Amount),400);assert.equal(Number(deducted.DeductionTypeID),1)
  const refund={Action:'refund',AccountID:a.AccountID,Revision:a.Revision,Amount:150,TransactionDate:'2026-10-16',Reference:'Receipt-10001',Reason:'Employee partial refund',RequestKey:'cash-bond-test-refund-1'}
  const posted=await api.cashBondRefund(event(refund));assert.equal(posted.balance,250)
  assert.equal((await api.cashBondRefund(event(refund))).duplicate,true,'Lost-response retry does not refund twice')
  await assert.rejects(()=>api.cashBondRefund(event({...refund,Amount:400,RequestKey:'cash-bond-test-refund-2'})),/exceeds/)
  await assert.rejects(()=>api.cashBondRefund(event({...refund,Amount:100,RequestKey:'cash-bond-test-refund-3'})),/balance changed/)
  await assert.rejects(()=>payroll.reviewPayrollProcessing(event({action:'cancel',reason:'Cancellation after refund'})),/Later refundable deduction/)
  a=(await api.listCashBonds({query:{employeeId:1}})).accounts.find(row=>Number(row.EmployeeID)===1)
  const reverse={...refund,Action:'reverse-refund',Amount:undefined,SourceRefundID:posted.id,Revision:a.Revision,RequestKey:'cash-bond-test-reversal-1',Reason:'Correct recorded refund'}
  assert.equal((await api.cashBondRefund(event(reverse))).balance,400)
  await assert.rejects(()=>api.cashBondRefund(event({...reverse,RequestKey:'cash-bond-test-reversal-2'})),/already reversed/)
  await payroll.reviewPayrollProcessing(event({action:'cancel',reason:'Correct this payroll batch'}))
  a=(await api.listCashBonds({query:{employeeId:1}})).accounts.find(row=>Number(row.EmployeeID)===1);assert.equal(Number(a.Balance),0);assert.equal(Number(a.TotalCollected),0);assert.equal(Number(a.TotalRefunded),0)
  await db.query("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=2");await db.query("UPDATE payroll_processing_review SET ReviewStatus='Pending',SnapshotJson=NULL WHERE BatchID=2")
  await payroll.reviewPayrollProcessing(event({action:'finalize'}))
  a=(await api.listCashBonds({query:{employeeId:1}})).accounts.find(row=>Number(row.EmployeeID)===1);assert.equal(Number(a.Balance),400,'Re-finalizing collects once after the old collection was voided')
  await payroll.reviewPayrollProcessing(event({action:'finalize'},3))
  await assert.rejects(()=>payroll.reviewPayrollProcessing(event({action:'cancel',reason:'Older collection blocked'})),/Later refundable deduction/)
  await api.changeCashBondCutoff(event({BatchID:4,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:350,Reason:'Catch-up on second cutoff'}));assert.equal((await preview(4)).employees[0].netPreview,290)
  await api.changeCashBondCutoff(event({BatchID:4,EmployeeID:2,DeductionTypeID:1,Action:'set',Amount:0,Reason:'No deduction this cutoff'}));assert.equal((await preview(4)).employees[1].netPreview,640)
  await payroll.reviewPayrollProcessing(event({action:'finalize'},4))
  a=(await api.listCashBonds({query:{employeeId:1}})).accounts.find(row=>Number(row.EmployeeID)===1);assert.equal(Number(a.Balance),950);assert.equal(Number(a.TotalCollected),950)
  const full=await api.cashBondRefund(event({...refund,Amount:950,Revision:a.Revision,RequestKey:'cash-bond-test-full-refund'}));assert.equal(full.balance,0)
  // Other catalog deductions share single/bulk/date/history behavior, with separate balances.
  const bulk={AgencyID:1,EffectiveDate:'2026-01-01',Rows:[{AgencyPositionID:1,DeductionTypeID:2,AmountPerCutoff:75,DeductOn:'Both'},{AgencyPositionID:1,DeductionTypeID:3,AmountPerCutoff:20,DeductOn:'Second'},{AgencyPositionID:1,DeductionTypeID:4,AmountPerCutoff:25,DeductOn:'Both'}]}
  assert.equal((await plans.bulkSaveAgencyContributions(event({...bulk,DryRun:true}))).counts.create,3)
  assert.equal((await db.query('SELECT COUNT(*) n FROM agency_contribution_plan'))[0][0].n,1,'Preview does not save')
  await plans.bulkSaveAgencyContributions(event(bulk))
  const list=await plans.listAgencyContributions({});assert.equal(list.catalogItems.length,5);assert.equal(list.items.length,4)
  const other=list.items.find(p=>Number(p.DeductionTypeID)===2)
  await plans.saveAgencyContribution(event({AgencyContributionID:other.AgencyContributionID,mode:'version',EffectiveDate:'2026-10-01',AmountPerCutoff:80,DeductOn:'Both',Reason:'Updated equipment deposit'}))
  assert.equal((await plans.listAgencyContributions({})).items.find(p=>Number(p.DeductionTypeID)===2).Versions.length,1)
  await db.query("INSERT INTO attendance_dtr(BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES(5,1,1,1,'2026-10-16','2026-10-31','Computed to Payroll',1)")
  await db.query("INSERT INTO attendance_dtr_employee(BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES(5,1,1,'Regular',1,1)")
  await db.query("INSERT INTO attendance(EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES(1,1,5,'2026-10-20','Present',8,1)")
  await api.changeCashBondCutoff(event({BatchID:5,EmployeeID:1,DeductionTypeID:1,Action:'set',Amount:200,Reason:'Cash bond catch up'}))
  const site=(await payroll.payrollProcessingData('2026-10-16','2026-10-31',connection)).sites.find(s=>Number(s.BatchID)===5)
  assert.equal(site.employees[0].netPreview,315,'200 cash bond + 80 equipment deposit + 20 contribution + 25 non-refundable insurance')
  await payroll.reviewPayrollProcessing(event({action:'finalize'},5))
  accounts=(await api.listCashBonds({query:{employeeId:1}})).accounts
  const cash=accounts.find(r=>Number(r.EmployeeID)===1&&Number(r.DeductionTypeID)===1),equipment=accounts.find(r=>Number(r.EmployeeID)===1&&Number(r.DeductionTypeID)===2)
  assert.equal(Number(cash.Balance),200);assert.equal(Number(equipment.Balance),80)
  const combined=await plans.employeeContributionHistory({query:{employeeId:1}});assert.deepEqual([...new Set(combined.items.map(r=>r.CatalogKind))].sort(),['Contribution','Recurring Deduction']);assert.equal(Number(combined.items.find(r=>Number(r.DeductionTypeID)===4).Amount),25,'Non-refundable recurring deductions are included in Others');assert.equal(combined.items.every(r=>Number(r.IsRefundable)===0||r.CatalogKind==='Recurring Deduction'),true)
  await api.cashBondRefund(event({...refund,AccountID:equipment.AccountID,Revision:equipment.Revision,Amount:40,TransactionDate:'2026-11-01',RequestKey:'equipment-refund-test-1'}))
  accounts=(await api.listCashBonds({query:{employeeId:1}})).accounts
  assert.equal(Number(accounts.find(r=>r.AccountID===cash.AccountID).Balance),200);assert.equal(Number(accounts.find(r=>r.AccountID===equipment.AccountID).Balance),40)
  await assert.rejects(()=>catalog.updateDeductionLoanCatalog({params:{resource:'deduction-type'},body:{id:1,DeductionName:'Cash bond',ClassificationID:1,DeductionCategory:'Company',DeductionPeriod:'Semi-Monthly',IsRefundable:false,Status:'Active'}}),/Refundability is locked/)
  assert.equal(accounts.some(r=>Number(r.DeductionTypeID)===4),false,'Non-refundable scheduled deduction creates no refundable account')
  const employeeApi=load('server/utils/employeeLoanDeductionCrud.ts',resolve)
  assert.equal(Number((await employeeApi.listEmployeeLoanDeductions({query:{employeeId:1}})).employee.RefundableBalance),240,'Profile shows refundable funds without debt or insurance')
  const employeeList=await employeeApi.listEmployeeLoanDeductions({query:{}});assert.equal(Number(employeeList.items.find(r=>r.EmployeeID===1).RefundableBalance),240);assert.equal(Number(employeeList.items.find(r=>r.EmployeeID===2).RefundableBalance),400,'Employee funds stay separate')
  assert.equal((await api.listCashBonds({query:{employeeId:1}})).accounts.every(r=>r.EmployeeID===1),true)
  await assert.rejects(()=>plans.saveAgencyContribution(event({AgencyID:1,AgencyPositionID:1,DeductionTypeID:5,EffectiveStartDate:'2026-01-01',AmountPerCutoff:100,DeductOn:'First',Status:'Active'})),/catalog contribution or recurring deduction/)
  const equipmentNow=accounts.find(r=>r.AccountID===equipment.AccountID)
  const refundEntry=(await api.listCashBonds({query:{employeeId:1}})).entries.find(r=>r.AccountID===equipment.AccountID&&r.EntryType==='Refund')
  await api.cashBondRefund(event({...refund,Action:'reverse-refund',SourceRefundID:refundEntry.EntryID,AccountID:equipment.AccountID,Revision:equipmentNow.Revision,TransactionDate:'2026-11-01',RequestKey:'equipment-reverse-test-1'}))
  await payroll.reviewPayrollProcessing(event({action:'cancel',reason:'Cancel multiple refundable deductions'},5))
  accounts=(await api.listCashBonds({query:{employeeId:1}})).accounts
  assert.equal(Number(accounts.find(r=>r.AccountID===cash.AccountID).Balance),0);assert.equal(Number(accounts.find(r=>r.AccountID===equipment.AccountID).Balance),0)
  const recurring=load('server/utils/recurringDeductionCrud.ts',resolve)
  await assert.rejects(()=>recurring.saveRecurringDeduction(event({EmployeeID:1,DeductionTypeID:1,AmountPerCutoff:200,DeductOn:'First',EffectiveStartDate:'2026-01-01'})),/Contributions and Others/)

  const catalogEvent=(resource,body)=>({params:{resource},body})
  const parent=await catalog.createDeductionLoanCatalog(catalogEvent('classification',{ClassificationName:'Additional recurring items',AppliesTo:'Recurring Deduction',Status:'Active'}))
  const regular=await catalog.createDeductionLoanCatalog(catalogEvent('deduction-type',{ClassificationID:parent.id,DeductionName:'Monthly service',DeductionCategory:'Company',Status:'Active'}))
  const deposit=await catalog.createDeductionLoanCatalog(catalogEvent('deduction-type',{ClassificationID:parent.id,DeductionName:'Returnable deposit',DeductionCategory:'Company',IsRefundable:true,Status:'Active'}))
  const [flags]=await db.query('SELECT DeductionTypeID,IsRefundable FROM deduction_type WHERE DeductionTypeID IN (?,?)',[regular.id,deposit.id]);assert.equal(Number(flags.find(r=>r.DeductionTypeID===regular.id).IsRefundable),0,'Refundable is optional');assert.equal(Number(flags.find(r=>r.DeductionTypeID===deposit.id).IsRefundable),1)
  await assert.rejects(()=>catalog.createDeductionLoanCatalog(catalogEvent('deduction-type',{ClassificationID:2,DeductionName:'Invalid refundable contribution',IsRefundable:true})),/Only recurring deduction/)

 }finally{await db.end()}
})
