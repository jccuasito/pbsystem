const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),bcrypt=require('bcrypt'),{transformSync}=require('esbuild'),sfc=require('@vue/compiler-sfc')
function evaluate(file,dependencies={},globals={}){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,Buffer,process,defineEventHandler:fn=>fn,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected import '+name)},...globals});return module.exports}
const h3={createError:d=>Object.assign(new Error(d.statusMessage),d),getQuery:e=>e.query||{},readBody:async e=>e.body,getCookie:(e,key)=>e.cookies?.[key],setCookie:(e,key,value)=>{e.cookies??={};e.cookies[key]=value},getRequestHeader:(e,key)=>e.headers?.[key],getRequestURL:e=>new URL(e.url||'http://localhost:3000'),setHeader:(e,key,value)=>{e.responseHeaders??={};e.responseHeaders[key]=value}}
const staffAuth={requireSession:e=>{if(!e.actor)throw h3.createError({statusCode:401});return e.actor},hashPassword:value=>bcrypt.hash(value,12),passwordMatches:(value,hash)=>bcrypt.compare(value,hash),normalizeEmail:value=>value.trim().toLowerCase(),assertPassword:value=>{if(value.length<12||!/[a-z]/i.test(value)||!/[0-9]/.test(value))throw h3.createError({statusCode:400})}}
const government=evaluate('shared/utils/governmentIds.ts'),privacy=evaluate('shared/utils/employeePortal.ts'),presentation=evaluate('shared/utils/payslipPresentation.ts')
const publicEvent=(ip='127.0.0.5')=>({cookies:{},headers:{'content-type':'application/json',origin:'http://localhost:3000'},url:'http://localhost:3000',node:{req:{socket:{remoteAddress:ip}}}})
test('portal pages compile and privacy terms do not waive employee rights',()=>{
 for(const file of ['app/pages/employee-portal/index.vue','app/pages/payroll/payslip/index.vue','app/components/EmployeePayslipSheet.vue']){
  const {descriptor,errors}=sfc.parse(fs.readFileSync(file,'utf8'),{filename:file});assert.deepEqual(errors,[])
  const script=sfc.compileScript(descriptor,{id:file});assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
  for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename:file,id:file,scoped:style.scoped}).errors,[])
 }
 assert.match(privacy.portalPrivacySections.map(row=>row.text).join(' '),/do not waive your privacy rights/)
 assert.equal(privacy.normalizePortalName('  María   Cruz '),'MARÍA CRUZ')
})
test('staff posting rejects anonymous and read-only actors before database work',async()=>{
 const module=evaluate('server/utils/payslipPublication.ts',{'h3':h3,'../connection/dbconnect':{getConnection:()=>{throw new Error('Database must not be reached')}},'./auth':staffAuth,'./payslipCrud':{}})
 await assert.rejects(()=>module.publishPayslip({body:{}}),e=>e.statusCode===401)
 await assert.rejects(()=>module.publishPayslip({actor:{sub:1,userType:'Viewer'},body:{}}),e=>e.statusCode===403)
 await assert.rejects(()=>module.publishPayslip({actor:{sub:1,userType:'Encoder'},context:{moduleCanEdit:false},body:{}}),e=>e.statusCode===403)
})

test('posted timestamps format the posting instant once in Philippine time',()=>{
 assert.equal(presentation.payslipPostedLabel('2026-10-25T02:44:00.000Z'),'Oct 25, 2026, 10:44 AM')
 assert.equal(presentation.payslipPostedLabel('2026-10-25T10:44:00+08:00'),'Oct 25, 2026, 10:44 AM')
 assert.equal(presentation.payslipPostedLabel('invalid'),'')
})
test('portal signup/session/publication isolation and recovery use synthetic temporary tables',{skip:process.env.EMPLOYEE_PORTAL_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 try{
  await db.query("SET time_zone = '+08:00'")
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
  const auth=evaluate('server/utils/employeePortalAuth.ts',{'node:crypto':crypto,'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth,'../../shared/utils/governmentIds':government,'../../shared/utils/employeePortal':privacy})
  const slips=evaluate('server/utils/payslipCrud.ts',{'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth})
  const publication=evaluate('server/utils/payslipPublication.ts',{'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth,'./payslipCrud':slips})
  const admin=evaluate('server/utils/employeePortalAdmin.ts',{'node:crypto':crypto,'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth})
  const portal=evaluate('server/api/employee-portal/payslips.get.ts',{'../../connection/dbconnect':database,'../../utils/employeePortalAuth':auth,'../../utils/payslipCrud':slips}).default
  const me=evaluate('server/api/employee-portal/me.get.ts',{'../../connection/dbconnect':database,'../../utils/employeePortalAuth':auth}).default
  const body={firstName:'test',middleName:' MIDDLE ',lastName:'PERSON',email:' Test@example.invalid ',contactNumber:'09123456789',password:'PortalTestPassword123',confirmPassword:'PortalTestPassword123',governmentType:'SSS',governmentNumber:'12-3456789-0',agreementAccepted:true,agreementVersion:privacy.portalAgreementVersion}
  await assert.rejects(()=>auth.registerEmployee(publicEvent(),{...body,agreementAccepted:false}),e=>e.statusCode===400)
  await assert.rejects(()=>auth.registerEmployee(publicEvent(),{...body,lastName:'WRONG'}),e=>e.statusCode===400)
  const owner=publicEvent();await auth.registerEmployee(owner,body)
  assert.ok(owner.cookies.pbs_employee_session);assert.equal(owner.cookies.pbs_session,undefined,'Portal does not grant a staff cookie')
  const profileSites=await me({...owner,query:{employeeId:2}})
  assert.equal(profileSites.account.CurrentSites.length,1);assert.equal(profileSites.account.CurrentSites[0].SiteName,'Fixed site','Current sites exclude other employees, ended and future deployments')
  const [[stored]]=await db.query('SELECT * FROM employee_portal_account WHERE EmployeeID=1');assert.notEqual(stored.PasswordHash,body.password);assert.ok(await bcrypt.compare(body.password,stored.PasswordHash));assert.equal(stored.Email,'test@example.invalid');assert.equal(stored.AgreementVersion,privacy.portalAgreementVersion)
  assert.equal(JSON.stringify(JSON.parse(stored.AgreementText)),JSON.stringify(privacy.portalPrivacySections),'Acceptance retains the exact server-provided notice text')
  await assert.rejects(()=>auth.registerEmployee(publicEvent('127.0.0.9'),{...body,password:'Password123'+'é'.repeat(40),confirmPassword:'Password123'+'é'.repeat(40)}),e=>e.statusCode===400,'Bcrypt cannot silently truncate long UTF-8 passwords')
  await assert.rejects(()=>auth.registerEmployee(publicEvent(),{...body,email:'second@example.invalid'}),e=>e.statusCode===409)
  await assert.rejects(()=>auth.registerEmployee(publicEvent(),{...body,firstName:'OTHER',middleName:'',governmentNumber:'98-7654321-0'}),e=>e.statusCode===409,'One login email cannot claim two employees')
  const other=publicEvent('127.0.0.6');await auth.registerEmployee(other,{...body,firstName:'OTHER',middleName:'',governmentNumber:'98-7654321-0',email:'other@example.invalid'})
  await assert.rejects(()=>auth.requireEmployeeSession({cookies:{pbs_session:'staff-cookie'}}),e=>e.statusCode===401)
  await assert.rejects(()=>auth.registerEmployee({...publicEvent(),headers:{'content-type':'application/json',origin:'https://attacker.invalid'}},body),e=>e.statusCode===403)
  assert.equal((await portal(owner)).payslips.length,0,'Finalized alone is not published')
  const staff={actor:{sub:42,userType:'Admin'},context:{moduleCanEdit:true},query:{}}
  let profile=await slips.readEmployeePayslips(1);assert.equal(profile.cutoffs.length,2)
  const regular=profile.cutoffs.find(row=>row.assignmentType==='Regular'),reliever=profile.cutoffs.find(row=>row.assignmentType==='Reliever')
  await publication.publishPayslip({...staff,body:{employeeId:1,key:regular.key,action:'post'}})
  await db.execute("UPDATE payslip_publication SET PostedAt='2026-10-25 10:44:00' WHERE EmployeeID=? AND GroupKey=?",[1,regular.key])
  let result=await portal({...owner,query:{employeeId:2}});assert.equal(result.payslips.length,1);assert.equal(result.payslips[0].employee.EmployeeID,1);assert.equal(result.payslips[0].cutoff.net,900)
  assert.equal(result.payslips[0].postedAt,'2026-10-25T02:44:00.000Z','Database-local posting time is returned with an explicit UTC offset')
  assert.equal(presentation.payslipPostedLabel(result.payslips[0].postedAt),'Oct 25, 2026, 10:44 AM')
  assert.equal((await slips.readEmployeePayslips(1)).cutoffs.find(row=>row.key===regular.key).postedAt,result.payslips[0].postedAt,'Staff and employee timestamps agree')
  // A UTC database session also produces the same unambiguous response format.
  await db.query("SET time_zone = '+00:00'")
  await db.execute("UPDATE payslip_publication SET PostedAt='2026-10-25 02:44:00' WHERE EmployeeID=? AND GroupKey=?",[1,regular.key])
  assert.equal((await portal(owner)).payslips[0].postedAt,'2026-10-25T02:44:00.000Z')
  await db.query("SET time_zone = '+08:00'")
  await db.execute("UPDATE payslip_publication SET PostedAt='2026-10-25 10:44:00' WHERE EmployeeID=? AND GroupKey=?",[1,regular.key])
  assert.equal((await portal({...other,query:{employeeId:1}})).payslips.length,0,'Browser employee ID cannot expose another employee payslip')
  let list=await slips.listPayslips({...staff,query:{postingStatus:'partial'}});assert.equal(list.items.length,1);assert.equal(list.items[0].PublicationStatus,'Partially posted')
  await publication.publishPayslip({...staff,body:{employeeId:1,key:reliever.key,action:'post'}})
  list=await slips.listPayslips({...staff,query:{postingStatus:'posted'}});assert.equal(list.items.length,1);assert.equal(list.items[0].EmployeeID,1)
  await publication.publishPayslip({...staff,body:{employeeId:1,key:regular.key,action:'post'}})
  const [[events]]=await db.query('SELECT COUNT(*) AS total FROM payslip_publication_event');assert.equal(events.total,2,'Duplicate post is idempotent')
  await publication.publishPayslip({...staff,body:{employeeId:1,key:regular.key,action:'withdraw'}});assert.equal((await portal(owner)).payslips.length,1)
  await db.query("UPDATE payroll SET Status='Cancelled' WHERE PayrollID=2");assert.equal((await portal(owner)).payslips.length,0,'Cancelled sources cannot remain visible')
  await assert.rejects(()=>publication.publishPayslip({...staff,body:{employeeId:1,key:reliever.key,action:'post'}}),e=>e.statusCode===409)
  await auth.updateEmployeeAccount(owner,{email:'updated@example.invalid',contactNumber:'09999999999',currentPassword:body.password,password:'NewPortalPassword123',confirmPassword:'NewPortalPassword123'})
  assert.equal((await auth.requireEmployeeSession(owner)).EmployeeID,1,'Email changes retain employee ownership')
  const oldToken=owner.cookies.pbs_employee_session
  await assert.rejects(()=>admin.managePortalAccount({actor:{sub:5,userType:'Encoder'},body:{employeeId:1,action:'recovery'}}),e=>e.statusCode===403)
  const recovery=await admin.managePortalAccount({...staff,body:{employeeId:1,action:'recovery'}})
  await assert.rejects(()=>auth.requireEmployeeSession({...publicEvent(),cookies:{pbs_employee_session:oldToken}}),e=>e.statusCode===401)
  await auth.recoverEmployeeAccount(owner,{code:recovery.recoveryCode,password:body.password,confirmPassword:body.password})
  await assert.rejects(()=>auth.recoverEmployeeAccount(publicEvent('127.0.0.7'),{code:recovery.recoveryCode,password:body.password,confirmPassword:body.password}),e=>e.statusCode===400)
  await auth.logoutEmployee(owner);await assert.rejects(()=>auth.requireEmployeeSession(owner),e=>e.statusCode===401)
  const login=publicEvent();await auth.loginEmployee(login,{email:'updated@example.invalid',password:body.password});assert.equal((await auth.requireEmployeeSession(login)).EmployeeID,1)
  await admin.managePortalAccount({...staff,body:{employeeId:1,action:'deactivate'}});await assert.rejects(()=>auth.requireEmployeeSession(login),e=>e.statusCode===401)
  for(let i=0;i<3;i++)await auth.portalLimit(publicEvent('127.0.0.99'),'limit-test','',3)
  await assert.rejects(()=>auth.portalLimit(publicEvent('127.0.0.99'),'limit-test','',3),e=>e.statusCode===429)
 }finally{await db.end()}
})
