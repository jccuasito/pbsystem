const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),bcrypt=require('bcrypt'),{transformSync}=require('esbuild'),sfc=require('@vue/compiler-sfc')
function evaluate(file,dependencies={},globals={}){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,Buffer,process,defineEventHandler:fn=>fn,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected import '+name)},...globals});return module.exports}
const h3={createError:d=>Object.assign(new Error(d.statusMessage),d),getQuery:e=>e.query||{},readBody:async e=>e.body,getCookie:(e,key)=>e.cookies?.[key],setCookie:(e,key,value)=>{e.cookies??={};e.cookies[key]=value},getRequestHeader:(e,key)=>e.headers?.[key],getRequestURL:e=>new URL(e.url||'http://localhost:3000'),setHeader:(e,key,value)=>{e.responseHeaders??={};e.responseHeaders[key]=value}}
const staffAuth={requireSession:e=>{if(!e.actor)throw h3.createError({statusCode:401});return e.actor},hashPassword:value=>bcrypt.hash(value,12),passwordMatches:(value,hash)=>bcrypt.compare(value,hash),normalizeEmail:value=>value.trim().toLowerCase(),assertPassword:value=>{if(value.length<12||!/[a-z]/i.test(value)||!/[0-9]/.test(value))throw h3.createError({statusCode:400})}}

const staff={actor:{sub:42,userType:'Admin'},context:{moduleCanEdit:true},query:{}}
test('site endpoints reject anonymous and read-only posting before database work',async()=>{
 const sites=evaluate('server/utils/payslipSiteCrud.ts',{'node:crypto':crypto,h3,'../connection/dbconnect':{},'./auth':staffAuth,'./payslipCrud':{},'./payslipPublication':{}})
 await assert.rejects(()=>sites.listSitePayslips({}),e=>e.statusCode===401)
 for(const actor of [{userType:'Viewer'}, {userType:'Encoder'}])await assert.rejects(()=>sites.publishSitePayslips({actor,context:{moduleCanEdit:false}}),e=>e.statusCode===403)
})
test('site roster, combined payslips and bulk posting share employee publication state',{skip:process.env.EMPLOYEE_PORTAL_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  const schema=fs.readFileSync('database/employee-portal.sql','utf8').replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMPORARY TABLE').replace(/^\s*CONSTRAINT[^\n]*\n/gm,'').replace(/,\s*\)/g,'\n)')
  for(const statement of schema.split(';').map(row=>row.trim()).filter(Boolean))await db.query(statement)
  for(const sql of [
   'CREATE TEMPORARY TABLE employee(EmployeeID INT PRIMARY KEY,EmployeeNumber VARCHAR(40),FirstName VARCHAR(100),MiddleName VARCHAR(100),LastName VARCHAR(100),Status VARCHAR(20),AgencyPositionID INT)',
   'CREATE TEMPORARY TABLE government(GovernmentID INT PRIMARY KEY,EmployeeID INT,GovernmentTypeKey VARCHAR(80),GovernmentNumberKey VARCHAR(50))',
   'CREATE TEMPORARY TABLE agency_position(AgencyPositionID INT PRIMARY KEY,AgencyID INT,PositionID INT)',
   'CREATE TEMPORARY TABLE agency(AgencyID INT PRIMARY KEY,AgencyName VARCHAR(100),Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE `position`(PositionID INT PRIMARY KEY,PositionName VARCHAR(100))',
   'CREATE TEMPORARY TABLE payroll(PayrollID INT PRIMARY KEY,EmployeeID INT,Status VARCHAR(20),StartDate DATE,EndDate DATE,GrossPay DECIMAL(12,2),TotalDeduction DECIMAL(12,2),NetPay DECIMAL(12,2),DeploymentID INT)',
   'CREATE TEMPORARY TABLE payroll_processing_posting(PayrollID INT,BatchID INT,Status VARCHAR(20))',
   'CREATE TEMPORARY TABLE attendance_dtr(BatchID INT PRIMARY KEY,SiteID INT,ClientID INT)',
   'CREATE TEMPORARY TABLE attendance_dtr_employee(BatchID INT,EmployeeID INT,AttendanceType VARCHAR(30))',
   'CREATE TEMPORARY TABLE employee_deployment(DeploymentID INT PRIMARY KEY,SiteID INT,DeploymentType VARCHAR(30),EmployeeID INT,IsPermanentSite INT,StartDate DATE,EndDate DATE)',
   "CREATE TEMPORARY TABLE site(SiteID INT PRIMARY KEY,SiteName VARCHAR(100),ClientID INT DEFAULT 1,Status VARCHAR(20) DEFAULT 'Active')",
   'CREATE TEMPORARY TABLE client(ClientID INT PRIMARY KEY,ClientName VARCHAR(100))',
   'CREATE TEMPORARY TABLE payroll_detail(PayrollDetailID INT,PayrollID INT,Description VARCHAR(150),Quantity DECIMAL(12,2),Amount DECIMAL(12,2))',
   'CREATE TEMPORARY TABLE payroll_deduction(PayrollDeductionID INT,PayrollID INT,ReferenceType VARCHAR(40),DeductionTypeID INT,Amount DECIMAL(12,2))',
   'CREATE TEMPORARY TABLE deduction_type(DeductionTypeID INT,DeductionName VARCHAR(100),ClassificationID INT)',
   'CREATE TEMPORARY TABLE deduction_loan_classification(ClassificationID INT,ClassificationName VARCHAR(100))',
   'CREATE TEMPORARY TABLE employee_account_transaction(TransactionRecordID INT,PayrollID INT,EntryType VARCHAR(30),ItemName VARCHAR(100),ClassificationName VARCHAR(100),Amount DECIMAL(12,2),Status VARCHAR(20))'
  ])await db.query(sql)
  await db.query("CREATE TEMPORARY TABLE site_account(SiteAccountID INT PRIMARY KEY,SiteAccountName VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,Status VARCHAR(20))")
  await db.query("CREATE TEMPORARY TABLE site_agency(SiteID INT,AgencyID INT,SiteAccountID INT,Status VARCHAR(20),PRIMARY KEY(SiteID,AgencyID))")
  await db.query("INSERT INTO employee VALUES(1,'TEST-1','TEST','MIDDLE','PERSON','Active',1),(2,'TEST-2','OTHER',NULL,'PERSON','Active',1)")
  await db.query("INSERT INTO government VALUES(11,1,'sss','1234567890'),(12,2,'sss','9876543210')")
  await db.query("INSERT INTO agency VALUES(1,'Synthetic agency','Active')");await db.query('INSERT INTO agency_position VALUES(1,1,1)');await db.query("INSERT INTO `position` VALUES(1,'Synthetic position')")
  await db.query("INSERT INTO site(SiteID,SiteName) VALUES(1,'Fixed site'),(2,'Reliever site')");await db.query("INSERT INTO client VALUES(1,'Synthetic client')")
  await db.query("INSERT INTO employee_deployment VALUES(1,1,'Regular',1,1,'2000-01-01',NULL),(2,2,'Regular',2,1,'2000-01-01',NULL),(3,2,'Reliever',1,0,'2000-01-01','2001-01-01'),(4,2,'Regular',1,1,'2099-01-01',NULL)")
  await db.query("INSERT INTO attendance_dtr VALUES(1,1,1),(2,2,1)");await db.query("INSERT INTO attendance_dtr_employee VALUES(1,1,'Regular'),(2,1,'Reliever'),(1,2,'Regular')")
  await db.query("INSERT INTO payroll VALUES(1,1,'Approved','2026-10-01','2026-10-15',1000,100,900,NULL),(2,1,'Approved','2026-10-01','2026-10-15',500,0,500,NULL),(3,2,'Approved','2026-10-01','2026-10-15',2000,100,1900,NULL)")
  await db.query("INSERT INTO payroll_processing_posting VALUES(1,1,'Active'),(2,2,'Active'),(3,1,'Active')")
  const connection={execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
  const database={...connection,getConnection:async()=>connection}

  // Match the existing installation: attendance and legacy deployment columns use
  // different collations. Uniform temporary-table defaults used to hide this error.
  await db.query('ALTER TABLE attendance_dtr_employee MODIFY AttendanceType VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  await db.query('ALTER TABLE employee_deployment MODIFY DeploymentType VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci')
  await db.query("ALTER TABLE attendance_dtr ADD AgencyID INT DEFAULT 1,ADD PeriodStart DATE DEFAULT '2026-10-01',ADD PeriodEnd DATE DEFAULT '2026-10-15'")
  await db.query("INSERT INTO agency VALUES(2,'Other agency','Inactive')")
  await db.query("INSERT INTO attendance_dtr VALUES(3,1,1,2,'2026-10-01','2026-10-15'),(4,1,1,1,'2026-10-16','2026-10-31')")
  await db.query("INSERT INTO attendance_dtr_employee VALUES(3,1,'Regular'),(4,2,'Regular')")
  await db.query("INSERT INTO payroll VALUES(4,1,'Released','2026-10-01','2026-10-15',300,0,300,NULL),(5,2,'Cancelled','2026-10-16','2026-10-31',200,0,200,NULL)")
  await db.query("INSERT INTO payroll_processing_posting VALUES(4,3,'Active'),(5,4,'Cancelled')")
  await db.query('ALTER TABLE payroll_processing_posting ADD EmployeeID INT')
  await db.query('UPDATE payroll_processing_posting pp JOIN payroll py ON py.PayrollID=pp.PayrollID SET pp.EmployeeID=py.EmployeeID')
  const trace=[];const execute=connection.execute;connection.execute=(sql,...args)=>{trace.push(sql);return execute(sql,...args)}
  const slips=evaluate('server/utils/payslipCrud.ts',{'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth})
  const publication=evaluate('server/utils/payslipPublication.ts',{'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth,'./payslipCrud':slips})
  const sites=evaluate('server/utils/payslipSiteCrud.ts',{'node:crypto':crypto,h3,'../connection/dbconnect':database,'./auth':staffAuth,'./payslipCrud':slips,'./payslipPublication':publication})
  const list=query=>sites.listSitePayslips({...staff,query}),roster=()=>list({batchId:1})
  let all=await list({});assert.equal(all.pagination.total,3,'Cancelled batches excluded; agencies at one physical site stay separate')
  assert.equal(all.items.find(row=>row.BatchID===1).EmployeeCount,2)
  assert.equal((await list({agencyId:2})).items.length,1,'Historical inactive agency remains filterable')
  assert.equal((await list({search:'Other agency'})).items[0].BatchID,3)
  assert.equal((await list({postingStatus:'posted'})).items.length,0)
  const reviewed=await roster();assert.equal(reviewed.items.length,2)
  const employee=reviewed.items.find(row=>row.employee.EmployeeID===1)
  assert.equal(employee.cutoffs.length,1,'Other site reliever stays separate')
  assert.equal(employee.cutoffs[0].payrollIds.length,2,'Regular group includes other agency site source')
  assert.equal(employee.cutoffs[0].gross,1300)
  const submit=(ids,extra={})=>sites.publishSitePayslips({...staff,body:{batchId:1,employeeIds:ids,reviewToken:reviewed.reviewToken,action:'post',...extra}})
  await assert.rejects(()=>submit([1]),e=>e.statusCode===409,'Combined scope must be explicitly acknowledged')
  await assert.rejects(()=>submit([99],{includeCombined:true}),e=>e.statusCode===400)
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM payslip_publication'))[0][0].total,0,'Invalid bulk request writes nothing')
  trace.length=0
  const posted=await submit([1],{includeCombined:true});assert.equal(posted.changed,1)
  assert.ok(trace.slice(0,4).every(sql=>sql.endsWith('FOR UPDATE')),'All reads before employee/payroll locks are current locking reads')
  assert.match(trace[3],/FROM payroll WHERE EmployeeID/)
  assert.equal((await slips.listPayslips({...staff,query:{postingStatus:'partial'}})).items.length,1)

  assert.equal((await submit([1],{includeCombined:true})).unchanged,1,'Duplicate bulk post is idempotent')
  all=await list({postingStatus:'partial'});assert.equal(all.items.length,1);assert.equal(all.items[0].BatchID,1)
  assert.equal((await list({postingStatus:'posted'})).items[0].BatchID,3,'Other site reflects combined group posting')
  assert.equal((await slips.readEmployeePayslips(1)).cutoffs.find(row=>row.assignmentType==='Regular').publicationStatus,'Posted')
  assert.equal((await slips.readEmployeePayslips(1)).cutoffs.find(row=>row.assignmentType==='Reliever').publicationStatus,'Not Posted')
  await publication.publishPayslip({...staff,body:{employeeId:2,key:reviewed.items.find(row=>row.employee.EmployeeID===2).cutoffs[0].key,action:'post'}})
  assert.equal((await list({postingStatus:'posted'})).items.length,2,'Individual posting updates site list')
  await submit([1,2],{action:'withdraw',includeCombined:true});assert.equal((await list({postingStatus:'posted'})).items.length,0)
  // A late source changes both the review token and the whole-group posting validity.
  await submit([1],{includeCombined:true})
  await db.query("INSERT INTO payroll VALUES(6,1,'Approved','2026-10-01','2026-10-15',100,0,100,NULL)")
  assert.equal((await list({postingStatus:'posted'})).items.length,0,'An added source invalidates the old posted snapshot on every affected site')
  assert.equal((await slips.listPayslips({...staff,query:{postingStatus:'posted'}})).items.length,0,'Employee list also invalidates old combined snapshots')
  await assert.rejects(()=>submit([1],{includeCombined:true}),e=>e.statusCode===409,'Stale review cannot post changed payroll')
  const fresh=await roster()
  await sites.publishSitePayslips({...staff,body:{batchId:1,employeeIds:[1,2],reviewToken:fresh.reviewToken,action:'post',includeCombined:true}})
  assert.equal((await slips.readEmployeePayslips(1)).cutoffs.find(row=>row.assignmentType==='Regular').gross,1400)
  await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=4")
  assert.equal((await list({postingStatus:'posted'})).items.length,0,'Cancelled group source hides stale publications')
  // Simulate a write failure after the first selected employee: all writes must roll back.
  const updated=await roster();let calls=0
  const failing=evaluate('server/utils/payslipSiteCrud.ts',{'node:crypto':crypto,h3,'../connection/dbconnect':database,'./auth':staffAuth,'./payslipCrud':slips,'./payslipPublication':{writePayslipPublication:async(...args)=>{if(++calls===2)throw new Error('Synthetic write failure');return publication.writePayslipPublication(...args)}}})
  const before=(await db.query('SELECT COUNT(*) AS total FROM payslip_publication_event'))[0][0].total
  await assert.rejects(()=>failing.publishSitePayslips({...staff,body:{batchId:1,employeeIds:[1,2],reviewToken:updated.reviewToken,action:'withdraw',includeCombined:true}}),/Synthetic write failure/)
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM payslip_publication_event'))[0][0].total,before,'Bulk rollback retains all prior employee states')
  // Account scope: two agencies may use the same global account name. Keep them
  // separate, while collecting all finalized sites in one agency/cutoff.
  for(const table of ['payslip_publication_event','payslip_publication_source','payslip_publication'])await db.query('DELETE FROM '+table)
  await db.query('DELETE FROM payroll WHERE PayrollID=6')
  await db.query("INSERT INTO employee VALUES(3,'TEST-3','THIRD',NULL,'PERSON','Active',1),(4,'TEST-4','FOURTH',NULL,'PERSON','Active',1)")
  await db.query("UPDATE payroll SET Status='Approved',EmployeeID=3 WHERE PayrollID=4")
  await db.query('UPDATE attendance_dtr_employee SET EmployeeID=3 WHERE BatchID=3')
  await db.query('UPDATE payroll_processing_posting SET EmployeeID=3 WHERE PayrollID=4')
  await db.query("INSERT INTO site(SiteID,SiteName) VALUES(3,'Third site'),(4,'Outside account site'),(5,'Unassigned site'),(6,'Not finalized yet')")
  await db.query("INSERT INTO site_account VALUES(10,'Global test account','Active'),(20,'Other test account','Active')")
  await db.query("INSERT INTO site_agency VALUES(1,1,10,'Active'),(2,1,10,'Active'),(3,1,10,'Active'),(1,2,10,'Inactive'),(4,1,20,'Active'),(6,1,10,'Active')")
  await db.query("INSERT INTO attendance_dtr VALUES(5,3,1,1,'2026-10-01','2026-10-15'),(6,4,1,1,'2026-10-01','2026-10-15'),(7,5,1,1,'2026-10-01','2026-10-15'),(8,1,1,1,'2026-10-16','2026-10-31'),(9,6,1,1,'2026-10-01','2026-10-15')")
  await db.query("INSERT INTO attendance_dtr_employee VALUES(5,1,'Regular'),(6,1,'Regular'),(7,4,'Regular'),(8,4,'Regular'),(9,4,'Regular')")
  await db.query("INSERT INTO payroll VALUES(7,1,'Approved','2026-10-01','2026-10-15',700,0,700,NULL),(9,4,'Approved','2026-10-01','2026-10-15',400,0,400,NULL),(10,4,'Approved','2026-10-16','2026-10-31',600,0,600,NULL)")
  await db.query("INSERT INTO payroll_processing_posting VALUES(7,5,'Active',1),(9,7,'Active',4),(10,8,'Active',4)")
  const accountScope={siteAccountId:10,agencyId:1,periodStart:'2026-10-01',periodEnd:'2026-10-15'}
  let grouped=await list({groupBy:'account'})
  assert.equal(grouped.items.length,4,'Account list keeps agencies, unassigned entries and cutoffs separate')
  const group=grouped.items.find(row=>row.AgencyID===1&&row.SiteAccountID===10&&row.PeriodEnd==='2026-10-15')
  assert.equal(group.SiteCount,3);assert.equal(group.PayrollCount,4);assert.equal(group.EmployeeCount,2,'An employee at multiple sites is counted once')
  assert.equal(Number(group.GrossPay),4200);assert.equal(Number(group.TotalDeduction),200)
  assert.equal((await list({groupBy:'account',search:'Global test account'})).items.length,3)
  const accountReview=()=>list(accountScope)
  let account=await accountReview();assert.deepEqual(Array.from(account.header.BatchIDs),[1,2,5]);assert.equal(account.items.length,2)
  assert.equal(account.items.find(row=>row.employee.EmployeeID===1).cutoffs.length,2,'Regular is combined once, reliever is separate')
  const accountPost=(review,ids,extra={})=>sites.publishSitePayslips({...staff,body:{...accountScope,employeeIds:ids,reviewToken:review.reviewToken,action:'post',...extra}})
  await assert.rejects(()=>accountPost(account,[3]),e=>e.statusCode===400,'Another agency employee cannot be posted with this account')
  trace.length=0
  let action=await accountPost(account,[1]);assert.equal(action.changed,2,'Multiple sites inside the account need no outside-scope acknowledgement')
  assert.ok(trace.slice(0,5).every(sql=>sql.endsWith('FOR UPDATE')),'Account DTR/coverage/mapping/employee/payroll locks precede consistent reads')
  assert.match(trace[4],/FROM payroll WHERE EmployeeID/)
  assert.equal((await accountPost(account,[1])).unchanged,2,'Account retries do not create duplicate snapshots/events')
  await accountPost(account,[2]);assert.equal((await list({groupBy:'account',postingStatus:'posted'})).items.length,1)
  const individual=await slips.readEmployeePayslips(1)
  assert.equal(individual.cutoffs.filter(row=>row.publicationStatus==='Posted').length,2)
  await accountPost(account,[1,2],{action:'withdraw'})
  assert.equal((await list({groupBy:'account',postingStatus:'posted'})).items.length,0)
  // A regular source outside this account must be acknowledged and is still a
  // whole-payslip action, consistent with per-employee posting and portal visibility.
  await db.query("INSERT INTO payroll VALUES(8,1,'Approved','2026-10-01','2026-10-15',300,0,300,NULL)")
  await db.query("INSERT INTO payroll_processing_posting VALUES(8,6,'Active',1)")
  account=await accountReview()
  await assert.rejects(()=>accountPost(account,[1]),e=>e.statusCode===409)
  assert.equal((await accountPost(account,[1],{includeCombined:true})).changed,2)
  // Unassigned remains accessible but cannot borrow another site's account.
  const unassigned=await list({...accountScope,siteAccountId:0})
  assert.equal(unassigned.items[0].employee.EmployeeID,4);assert.deepEqual(Array.from(unassigned.header.BatchIDs),[7])
  // A new finalized site and a reassigned site both invalidate an earlier review.
  account=await accountReview()
  await db.query("INSERT INTO payroll VALUES(11,4,'Approved','2026-10-01','2026-10-15',800,0,800,NULL)")
  await db.query("INSERT INTO payroll_processing_posting VALUES(11,9,'Active',4)")
  await assert.rejects(()=>accountPost(account,[1],{includeCombined:true}),e=>e.statusCode===409,'New account site must be reviewed before posting')
  account=await accountReview()
  await db.query('UPDATE site_agency SET SiteAccountID=20 WHERE SiteID=3 AND AgencyID=1')
  await assert.rejects(()=>accountPost(account,[1],{includeCombined:true}),e=>e.statusCode===409,'Account reassignments cannot silently change scope')
  await db.query('UPDATE site_agency SET SiteAccountID=10 WHERE SiteID=3 AND AgencyID=1')
  account=await accountReview()
  let accountWrites=0
  const failingAccount=evaluate('server/utils/payslipSiteCrud.ts',{'node:crypto':crypto,h3,'../connection/dbconnect':database,'./auth':staffAuth,'./payslipCrud':slips,'./payslipPublication':{writePayslipPublication:async(...args)=>{if(++accountWrites===2)throw new Error('Synthetic account write failure');return publication.writePayslipPublication(...args)}}})
  const eventCount=(await db.query('SELECT COUNT(*) AS total FROM payslip_publication_event'))[0][0].total
  await assert.rejects(()=>failingAccount.publishSitePayslips({...staff,body:{...accountScope,employeeIds:[1,2],reviewToken:account.reviewToken,action:'withdraw',includeCombined:true}}),/Synthetic account write failure/)
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM payslip_publication_event'))[0][0].total,eventCount,'Account bulk action rolls back as a unit')

 }finally{await db.end()}
})
