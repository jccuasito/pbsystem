const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{transformSync}=require('esbuild'),{PDFDocument}=require('pdf-lib')
function evaluate(file,dependencies){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,Buffer,process,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw Error('Unexpected import '+name)}});return module.exports}
const h3={createError:d=>Object.assign(Error(d.statusMessage),d),getQuery:e=>e.query||{},getRouterParam:(e,key)=>e.params?.[key],readBody:async e=>e.body,getRequestHeader:(e,key)=>e.headers?.[key],setHeader:(e,key,value)=>{e.responseHeaders??={};e.responseHeaders[key]=value}}
const staffAuth={requireSession:e=>{if(!e.actor)throw h3.createError({statusCode:401});return e.actor}}
const portalAuth={requireEmployeeSession:async e=>{if(!e.employee)throw h3.createError({statusCode:401});return e.employee},portalNoStore:e=>h3.setHeader(e,'Cache-Control','no-store'),portalMutation:e=>{if(e.headers?.origin!=='http://portal.test')throw h3.createError({statusCode:403})}}
const importHelpers=evaluate('shared/utils/payslipArchiveImport.ts',{})
test('generated cutoffs cover ordinary and leap-year February',()=>{
 for(const [year,last] of [[2024,'29'],[2025,'28'],[1900,'28'],[2000,'29']]){const values=importHelpers.archiveCutoffs(year);assert.equal(values.length,24);assert.equal(values.find(item=>item.start===year+'-02-16').end,year+'-02-'+last)}
 assert.equal(importHelpers.archiveCutoffs(2101).length,0)

})
const fields=evaluate('shared/utils/employeeInformation.ts',{})
const actor={sub:42,userType:'Admin'},staff=(body,query={})=>({actor,context:{moduleCanEdit:true},body,query}),employee=(body,id=1)=>({employee:{EmployeeID:id,AccountID:id},headers:{origin:'http://portal.test'},body})
const expectCode=(fn,code)=>assert.rejects(fn,e=>e.statusCode===code)
function modules(database){const deps={'h3':h3,'../connection/dbconnect':database,'./auth':staffAuth,'./employeePortalAuth':portalAuth};return{information:evaluate('server/utils/employeeInformationCrud.ts',{...deps,'../../shared/utils/employeeInformation':fields}),archive:evaluate('server/utils/payslipArchiveCrud.ts',{...deps,'node:fs':{promises:fsp},'node:path':path,'node:crypto':crypto,'pdf-lib':{PDFDocument}})}}
test('archive and correction endpoints reject unauthenticated/restricted users before database work',async()=>{
 const {archive,information}=modules({getConnection(){throw Error('DB must not be reached')},execute(){throw Error('DB must not be reached')}})
 for(const fn of [archive.employeePayslipArchive,archive.employeeArchivePdf,information.employeeInformation,information.submitInformationRequest])await expectCode(()=>fn({}),401)
 for(const fn of [archive.listPayslipArchive,archive.managePayslipArchive,archive.staffArchivePdf,information.listInformationRequests,information.reviewInformationRequest])await expectCode(()=>fn({}),401)
 await expectCode(()=>archive.managePayslipArchive({...staff({}),actor:{sub:42,userType:'Viewer'}}),403)
 await expectCode(()=>archive.managePayslipArchive({...staff({}),context:{moduleCanEdit:false}}),403)
 for(const userType of ['Encoder','Viewer'])await expectCode(()=>information.listInformationRequests({...staff({}),actor:{sub:42,userType}}),403)
 await expectCode(()=>information.reviewInformationRequest({...staff({}),context:{moduleCanEdit:false}}),403)
})
test('private historical PDFs and HR requests use isolated temporary tables',{skip:process.env.EMPLOYEE_PORTAL_TEST_DATABASE!=='1'},async()=>{
 const db=await require('mysql2/promise').createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',dateStrings:true})
 const storage=path.resolve('.data','archive-isolation-'+crypto.randomBytes(8).toString('hex')),previous=process.env.PAYSLIP_ARCHIVE_STORAGE_DIR;process.env.PAYSLIP_ARCHIVE_STORAGE_DIR=storage
 try{
  await db.query("SET time_zone='+08:00'")
  const columns=[...new Set([...fs.readFileSync('server/utils/employeeInformationCrud.ts','utf8').matchAll(/\be\.([A-Za-z]+)/g)].map(match=>match[1]))].filter(key=>!['EmployeeID','AgencyPositionID'].includes(key))
  await db.query('CREATE TEMPORARY TABLE employee(EmployeeID INT PRIMARY KEY,AgencyPositionID INT,'+columns.map(key=>'`'+key+'` VARCHAR(255) NULL').join(',')+')')
  for(const sql of ['CREATE TEMPORARY TABLE department(DepartmentID INT PRIMARY KEY,DepartmentName VARCHAR(100))','CREATE TEMPORARY TABLE `user`(UserID INT PRIMARY KEY,FirstName VARCHAR(100),LastName VARCHAR(100),UserType VARCHAR(30),DepartmentID INT)','CREATE TEMPORARY TABLE agency_position(AgencyPositionID INT PRIMARY KEY,AgencyID INT,PositionID INT)','CREATE TEMPORARY TABLE agency(AgencyID INT PRIMARY KEY,AgencyName VARCHAR(100))','CREATE TEMPORARY TABLE `position`(PositionID INT PRIMARY KEY,PositionName VARCHAR(100))'])await db.query(sql)
  for(const schemaFile of ['database/payslip-portal-history-requests.sql']){
   const schema=fs.readFileSync(schemaFile,'utf8').replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMPORARY TABLE').replace(/^\s*CONSTRAINT[^\n]*\n/gm,'').replace(/,\s*\)/g,'\n)')
   for(const statement of schema.split(';').map(value=>value.trim()).filter(Boolean))await db.query(statement)
  }
  await db.query('CREATE TEMPORARY TABLE client(ClientID INT PRIMARY KEY,ClientName VARCHAR(100))')
  await db.query('CREATE TEMPORARY TABLE site(SiteID INT PRIMARY KEY,SiteName VARCHAR(100),ClientID INT,Status VARCHAR(20))')
  await db.query('CREATE TEMPORARY TABLE site_agency(SiteID INT,AgencyID INT,Status VARCHAR(20))')
  await db.query("INSERT INTO client VALUES(1,'Synthetic client')");await db.query("INSERT INTO site VALUES(1,'Actual historical site',1,'Active'),(2,'Inactive historic site',1,'Inactive')");await db.query("INSERT INTO site_agency VALUES(1,1,'Active'),(2,1,'Inactive')")
  await db.query("INSERT INTO employee(EmployeeID,AgencyPositionID,EmployeeNumber,FirstName,LastName,PresentCityMunicipality,Status) VALUES(1,1,'TEST-1','TEST','ONE','Old city','Active'),(2,1,'TEST-2','TEST','TWO','Other city','Active')")
  await db.query("INSERT INTO `user` VALUES(42,'Synthetic','HR','Supervisor',1)");await db.query("INSERT INTO department VALUES(1,'Human Resources')");await db.query('INSERT INTO agency_position VALUES(1,1,1)');await db.query("INSERT INTO agency VALUES(1,'Synthetic agency')");await db.query("INSERT INTO `position` VALUES(1,'Synthetic position')")
  const connection={execute:(...args)=>db.execute(...args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback(),release(){}}
  const {archive,information}=modules({...connection,getConnection:async()=>connection})
  const own=await information.employeeInformation({...employee(),query:{employeeId:2}})
  assert.equal(own.fields.find(field=>field.key==='PresentAddress').value,'Old city');assert.ok(own.fields.every(field=>!/(password|bank|government|sss|tax)/i.test(field.key)))
  await expectCode(()=>information.submitInformationRequest({...employee({}),headers:{origin:'https://other.invalid'}}),403)
  await expectCode(()=>information.submitInformationRequest(employee({fieldKey:'PasswordHash',proposedValue:'secret',message:'change'})),400)
  const created=await information.submitInformationRequest(employee({fieldKey:'PresentAddress',employeeId:2,proposedValue:'New city',recordedValue:'Fake recorded value',message:'Please correct my address.'}))
  let request=(await information.employeeInformation(employee())).requests.items[0]
  assert.equal(request.EmployeeID,1);assert.equal(request.RecordedValue,'Old city');assert.equal(request.Version,1);assert.equal(request.messages.length,1)
  assert.equal((await information.employeeInformation(employee(undefined,2))).requests.items.length,0)
  await expectCode(()=>information.submitInformationRequest(employee({action:'message',requestId:created.requestId,version:1,message:'Not mine'},2)),404)
  await information.reviewInformationRequest(staff({requestId:created.requestId,version:1,status:'In review',message:'We are checking your address.'}))
  await expectCode(()=>information.reviewInformationRequest(staff({requestId:created.requestId,version:1,status:'Resolved',message:'Stale edit'})),409)
  request=(await information.employeeInformation(employee())).requests.items[0];assert.equal(request.Status,'In review');assert.equal(request.messages[1].StaffName,'Synthetic HR');assert.equal(request.messages[1].StaffRole,'Supervisor');assert.equal(request.messages[1].StaffDepartment,'Human Resources');assert.equal(request.messages[1].Email,undefined)
  await information.submitInformationRequest(employee({action:'message',requestId:created.requestId,version:2,message:'Thank you.'}))
  await information.reviewInformationRequest(staff({requestId:created.requestId,version:3,status:'Resolved',message:'Reviewed with HR.'}))
  await expectCode(()=>information.submitInformationRequest(employee({action:'message',requestId:created.requestId,version:4,message:'Closed request'})),409)
  for(const closedStatus of ['Resolved','Declined','Cancelled']){
   // Arrange closed states only in this connection's synthetic TEMPORARY table.
   await db.execute('UPDATE employee_information_request SET Status=? WHERE RequestID=?',[closedStatus,created.requestId])
   for(const targetStatus of ['In review','Resolved','Declined'])await expectCode(()=>information.reviewInformationRequest(staff({requestId:created.requestId,version:4,status:targetStatus,message:'Must not append or reopen'})),409)
   for(const action of ['message','cancel'])await expectCode(()=>information.submitInformationRequest(employee({action,requestId:created.requestId,version:4,message:'Must stay closed'})),409)
   const [[closed]]=await db.query('SELECT Status,Version FROM employee_information_request WHERE RequestID=?',[created.requestId]);assert.equal(closed.Status,closedStatus);assert.equal(closed.Version,4)
   const [[messages]]=await db.query('SELECT COUNT(*) Total FROM employee_information_message WHERE RequestID=?',[created.requestId]);assert.equal(messages.Total,4,'Closed requests cannot acquire a reply or status event')
  }
  await db.execute('UPDATE employee_information_request SET Status=? WHERE RequestID=?',['Resolved',created.requestId])
  assert.equal((await information.listInformationRequests(staff(undefined,{status:'Resolved',search:'TEST-1'}))).pagination.total,1)
  assert.equal((await information.listInformationRequests(staff(undefined,{employeeId:2}))).pagination.total,0)
  const cancelled=await information.submitInformationRequest(employee({fieldKey:'Other',proposedValue:'Please check',message:'A correction'}))
  await information.submitInformationRequest(employee({action:'cancel',requestId:cancelled.requestId,version:1}))
  await expectCode(()=>information.reviewInformationRequest(staff({requestId:cancelled.requestId,version:2,status:'In review',message:'No'})),409)
  const [[unchanged]]=await db.query('SELECT PresentCityMunicipality FROM employee WHERE EmployeeID=1');assert.equal(unchanged.PresentCityMunicipality,'Old city','Requests and replies never update an employee record')
  for(let index=0;index<5;index++)await information.submitInformationRequest(employee({fieldKey:'Other',proposedValue:'Correction '+index,message:'Please check.'}))
  await expectCode(()=>information.submitInformationRequest(employee({fieldKey:'Other',proposedValue:'Too many',message:'Please check.'})),409)
  const active=(await information.employeeInformation(employee())).requests.items.find(item=>item.Status==='Pending')
  await information.submitInformationRequest(employee({action:'message',requestId:active.RequestID,version:active.Version,message:'A follow-up'}))
  await expectCode(()=>information.submitInformationRequest(employee({action:'message',requestId:active.RequestID,version:active.Version+1,message:'Over the message quota'})),429)
  // Synthetic in-memory PDF fixture, not a user artifact or a real employee payslip.
  const pdf=await PDFDocument.create();pdf.addPage([600,300]);const bytes=Buffer.from(await pdf.save())
  assert.equal(await archive.validateArchivedPdf(bytes),1)
  for(const invalid of [Buffer.from('not a PDF'),Buffer.from('%PDF-broken'),Buffer.alloc(5*1024*1024+1)])await expectCode(()=>archive.validateArchivedPdf(invalid),400)
  const tooMany=await PDFDocument.create();for(let index=0;index<31;index++)tooMany.addPage();await expectCode(async()=>archive.validateArchivedPdf(Buffer.from(await tooMany.save())),400)
  const upload={action:'import',employeeId:1,periodStart:'2026-09-01',periodEnd:'2026-09-15',employeeOnly:true,fileName:'Synthetic.pdf',pdfData:'data:application/pdf;base64,'+bytes.toString('base64'),agencyName:'Previous agency',siteLabel:'Previous site'}
  await expectCode(()=>archive.managePayslipArchive(staff({...upload,employeeOnly:false})),400)
  await expectCode(()=>archive.managePayslipArchive(staff({...upload,periodEnd:'2026-02-30'})),400)
  const result=await archive.managePayslipArchive(staff(upload)),archiveId=result.archiveId
  assert.equal((await archive.listPayslipArchive(staff(undefined,{employeeId:1}))).items[0].Status,'Draft')
  assert.equal((await archive.employeePayslipArchive(employee())).items.length,0,'Draft PDFs are private to staff')
  await expectCode(()=>archive.employeeArchivePdf({...employee(),params:{id:archiveId}}),404)
  await assert.rejects(()=>archive.managePayslipArchive(staff(upload)),error=>error.statusCode===409&&error.data.code==='ARCHIVE_DUPLICATE'&&error.data.archiveId===archiveId&&error.data.status==='Draft');assert.equal((await fsp.readdir(storage)).length,1,'Duplicate imports clean up the new private file')
  const change=(action,status)=>archive.managePayslipArchive(staff({employeeId:1,archiveId,action,expectedStatus:status}))
  await change('post','Draft')
  const archiveList=await archive.employeePayslipArchive({...employee(),query:{employeeId:2}});assert.equal(archiveList.items.length,1);assert.equal(archiveList.items[0].FilePath,undefined);assert.equal(archiveList.items[0].FileSHA256,undefined)
  assert.equal((await archive.employeePayslipArchive(employee(undefined,2))).items.length,0)
  await expectCode(()=>archive.employeeArchivePdf({...employee(undefined,2),params:{id:archiveId}}),404)
  const download={...employee(),params:{id:archiveId},query:{download:'1'}};assert.ok((await archive.employeeArchivePdf(download)).equals(bytes));assert.match(download.responseHeaders['Content-Disposition'],/2026-09-01-2026-09-15\.pdf/);assert.equal(download.responseHeaders['Cache-Control'],'no-store')
  await expectCode(()=>change('withdraw','Draft'),409)
  await change('withdraw','Posted');assert.equal((await archive.employeePayslipArchive(employee())).items.length,0)
  await expectCode(()=>archive.employeeArchivePdf({...employee(),params:{id:archiveId}}),404)
  await change('remove','Withdrawn')
  assert.equal((await archive.listPayslipArchive(staff(undefined,{employeeId:1}))).items.length,0,'Removed PDFs are excluded from staff lists')
  await expectCode(()=>archive.staffArchivePdf({...staff(),params:{id:archiveId}}),404)
  const [[removed]]=await db.query('SELECT Status FROM payslip_archive WHERE ArchiveID=?',[archiveId]);assert.equal(removed.Status,'Removed','Soft removal retains the audit record')
  await change('restore','Removed')
  const [[count]]=await db.query('SELECT COUNT(*) Total FROM payslip_archive_event WHERE ArchiveID=?',[archiveId]);assert.equal(count.Total,5)
  const siteUpload={...upload,employeeId:2,siteId:1,agencyId:1,agencyName:'Forged agency',siteLabel:'Forged site'}
  await expectCode(()=>archive.managePayslipArchive(staff({...siteUpload,agencyId:2})),404)
  const siteResult=await archive.managePayslipArchive(staff(siteUpload))
  const siteRecord=(await archive.listPayslipArchive(staff(undefined,{employeeId:2}))).items[0]
  assert.equal(siteRecord.SiteID,1);assert.equal(siteRecord.AgencyID,1);assert.equal(siteRecord.AgencyName,'Synthetic agency');assert.equal(siteRecord.SiteLabel,'Actual historical site')
  await archive.managePayslipArchive(staff({employeeId:2,archiveId:siteResult.archiveId,action:'post',expectedStatus:'Draft'}))
  const [[stored]]=await db.query('SELECT FilePath FROM payslip_archive WHERE ArchiveID=?',[archiveId]);await fsp.writeFile(path.join(storage,stored.FilePath),Buffer.from('tampered'))
  await expectCode(()=>archive.staffArchivePdf({...staff(),params:{id:archiveId}}),409)
  await expectCode(()=>change('post','Draft'),409)
  assert.equal((await archive.listPayslipArchive(staff(undefined,{employeeId:1}))).items[0].Status,'Draft','An integrity failure cannot release a PDF')
 }finally{
  await db.end();if(previous===undefined)delete process.env.PAYSLIP_ARCHIVE_STORAGE_DIR;else process.env.PAYSLIP_ARCHIVE_STORAGE_DIR=previous
  // Only individual random test files under this verified task directory are removed.
  if(storage.startsWith(path.resolve('.data')+path.sep)){for(const file of await fsp.readdir(storage).catch(()=>[])){assert.match(file,/^[a-f0-9]{32}\.pdf$/);await fsp.unlink(path.join(storage,file))}await fsp.rmdir(storage).catch(()=>{})}
 }
})
