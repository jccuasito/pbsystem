// Reuses an explicitly named synthetic fixture. Never creates another database
// or writes business test records in the ordinary local application schema.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import mysql from 'mysql2/promise'
import {ensureActivityHistoryIndexes} from './helpers/activity-history-schema.mjs'
import jwt from 'jsonwebtoken'
import {localConfig,identifier,root} from './helpers/scale-fixture.mjs'

const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11)
if(!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database||'')||database===process.env.DB_NAME)throw Error('Exact generated synthetic database required')
const manifest=JSON.parse(await fs.readFile(path.join(root,database,'manifest.json'),'utf8'));assert.equal(manifest.syntheticOnly,true)
const db=await mysql.createConnection({...localConfig(),database})
const [[marker]]=await db.execute('SELECT Marker FROM scale_test_manifest');assert.equal(marker.Marker,'SYNTHETIC_ONLY_6000_500_150_V1')
const base='http://127.0.0.1:3199',user='audit_'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),secret=randomBytes(48).toString('hex')
const tag='ACTIVITY SYNTHETIC '+randomBytes(5).toString('hex'),ids=[],staff=[],checks=[],logs=[]
let child,granted=false,trigger=false
const note=(label,result=true)=>{checks.push({label,result});console.log(label,JSON.stringify(result))}
const cookie=(id=1,role='Admin')=>'pbs_session='+jwt.sign({sub:id,email:'audit@example.invalid',userType:role},secret,{issuer:'pbsystem',audience:'pbsystem-web',expiresIn:'1h'})
async function request(route,body,options={}){
 const response=await fetch(base+route,{method:options.method||(body===undefined?'GET':'POST'),headers:{cookie:options.anonymous?'':cookie(options.actor||1,options.role||'Admin'),origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 const json=await response.json();assert.equal(response.status,options.status||200,`${route}: ${JSON.stringify(json).slice(0,180)}`)
 return{json,history:response.headers.get('x-activity-history')}
}
const covered=new Set(),steps=[];
async function mutation(route,body,scope,label,method='POST'){
 const [[before]]=await db.execute('SELECT COALESCE(MAX(EventID),0) AS id FROM user_activity_event');
 const result=await request(route,body,{method});assert.equal(result.history,'recorded',route);
 const [events]=await db.execute('SELECT Scope,DetailsJson,Action FROM user_activity_event WHERE EventID>? ORDER BY EventID',[before.id]);
 assert.equal(events.length,1,route+' should create one HTTP action event');assert.equal(events[0].Scope,scope,route);
 const details=JSON.parse(events[0].DetailsJson);assert.ok(details.subjects?.length>0,route+' needs a named record');
 if(label)assert.ok(details.subjects.some(s=>s.label.toUpperCase().includes(label.toUpperCase())),route+' wrong record name');
 const feed=(await request('/api/activity-history?scope='+scope)).json;assert.ok(feed.items[0].subjects?.length>0,route+' history DTO missing subject');
 covered.add(scope);steps.push({route,method,scope,action:events[0].Action});console.log('Verified',method,route,scope);
 return{...result.json,details};
}
try{
 try{await fetch(base+'/health/live',{signal:AbortSignal.timeout(300)});throw Error('Owned test port occupied')}catch(e){if(e.message==='Owned test port occupied')throw e}
 await db.query(await fs.readFile('database/user-activity-history.sql','utf8'));await ensureActivityHistoryIndexes(db);
 await db.query('CREATE USER ?@? IDENTIFIED BY ?',[user,'localhost',password]);granted=true;
 await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(database)}.* TO ?@?`,[user,'localhost']);
 const limited=await mysql.createConnection({...localConfig(),database,user,password});try{await assert.rejects(limited.query('SELECT 1 FROM '+identifier(manifest.sourceSchema)+'.employee LIMIT 1'),/denied/i)}finally{await limited.end()}
 child=spawn(process.execPath,['--max-old-space-size=512','.output/server/index.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DB_NAME:database,DB_USER:user,DB_PASSWORD:password,JWT_SECRET:secret,APP_URL:base,HOST:'127.0.0.1',PORT:'3199',NITRO_HOST:'127.0.0.1',NITRO_PORT:'3199',PAYROLL_QUEUE_ENABLED:'true',PAYROLL_QUEUE_WORKER:'false',DB_AUTO_BACKUP:'false',LEGAL_HOLIDAY_AUTO_SEED:'false',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',GOOGLE_CLIENT_ID:''}});
 for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{logs.push(chunk.toString());if(logs.length>100)logs.shift()});
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Test app exited');try{if((await fetch(base+'/health/ready')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}assert.ok(ready);
 assert.equal((await request('/api/settings/health')).json.activityHistory.recorderRegistered,true);
 const agencyBody={AgencyName:tag,AgencyAddress:'Synthetic address one',Status:'Active'};
 const agency=await mutation('/api/organization/agency',agencyBody,'organization-agency',tag);
 const address=await mutation('/api/organization/agency',{...agencyBody,id:agency.id,AgencyAddress:'Synthetic address two'},'organization-agency',tag,'PUT');
 assert.deepEqual(address.details.changedFields,['AgencyAddress']);assert.ok(!JSON.stringify(address.details).includes('Synthetic address two'));
 const renamed=await mutation('/api/organization/agency',{...agencyBody,id:agency.id,AgencyName:tag+' RENAMED',AgencyAddress:'Synthetic address two'},'organization-agency',tag+' RENAMED','PUT');assert.equal(renamed.details.subjects[0].previousLabel,tag);
 const same=await mutation('/api/organization/agency',{...agencyBody,id:agency.id,AgencyName:tag+' RENAMED',AgencyAddress:'Synthetic address two'},'organization-agency',tag+' RENAMED','PUT');assert.deepEqual(same.details.changedFields,[]);
 await mutation('/api/organization/agency',{id:agency.id},'organization-agency',tag+' RENAMED','DELETE');
 const client=await mutation('/api/organization/client',{ClientName:tag,ClientAddress:'Synthetic client address',Status:'Active'},'organization-client',tag);
 const account=await mutation('/api/organization/site-account',{SiteAccountName:tag,Status:'Active'},'organization-site-accounts',tag);
 const [existingRegions]=await db.execute('SELECT RegionCode FROM region');const regionCode=Array.from({length:100},(_,i)=>String(i).padStart(2,'0')).find(code=>!existingRegions.some(r=>r.RegionCode===code));assert.ok(regionCode);
 const region=await mutation('/api/organization/region',{RegionCode:regionCode,RegionName:tag,Status:'Active'},'organization-region',tag);
 const position=await mutation('/api/organization/position',{PositionName:tag,Status:'Active'},'organization-position',tag);
 const shift=await mutation('/api/organization/shift-code',{AgencyID:1,ShiftCode:'HIST'+randomBytes(3).toString('hex'),ShiftName:tag,ShiftType:'DS',TimeIn:'07:00',TimeOut:'19:00',RegularHours:8,RegularOTCap:4,WorkdayCount:1,NDEnabled:0,NDStartTime:'22:00',NDEndTime:'06:00',Status:'Active'},'attendance-shift-code',tag);
 const site=await mutation('/api/organization/site',{ClientID:client.id,RegionID:region.id,SiteName:tag,SiteAddress:'Synthetic site',AgencyIDs:[1],AgencyAccounts:[{AgencyID:1,SiteAccountID:account.id}],Status:'Active'},'organization-site',tag);
 const payrollRate=await mutation('/api/rates/payroll-rate',{AgencyPositionID:1,RegionID:region.id,EffectiveDate:'2028-01-01',RegularRate:100,Status:'Active'},'rates-payroll');
 const billingRate=await mutation('/api/rates/billing-rate',{AgencyPositionID:1,RegionID:region.id,EffectiveDate:'2028-01-01',RegularRate:120,Status:'Active'},'rates-billing');
 const newSiteRate=await mutation('/api/rates/site-rate',{SiteID:site.id,AgencyID:1,AgencyPositionID:1,PayrollRateID:payrollRate.id,BillingRateID:billingRate.id,Status:'Active'},'rates-site');
 await mutation('/api/organization/site-shift',{SiteID:site.id,ShiftCodeID:1,NDPolicyOverride:'Inherit',Status:'Active'},'organization-site',tag);
 const deployment={SiteRateID:newSiteRate.id,SiteID:site.id,ShiftCodeID:1,ClientID:client.id,AgencyID:1};
 await mutation('/api/organization/shift-code',{id:shift.id,permanent:true},'attendance-shift-code',tag,'DELETE');
 const [deletedShift]=await db.execute('SELECT 1 FROM shift_code WHERE ShiftCodeID=?',[shift.id]);assert.equal(deletedShift.length,0);
 const employeeBody={AgencyPositionID:1,FirstName:'History',LastName:tag,Birthday:'1990-01-01',DateHired:'2026-01-01',Gender:'Male',CivilStatus:'Single',Email:'history-'+randomBytes(5).toString('hex')+'@example.invalid',ContactNumber:'09'+String(parseInt(randomBytes(4).toString('hex'),16)%1000000000).padStart(9,'0'),BeneficiaryNotApplicable:true,PaymentMethod:'Cash',Status:'Active',ConfirmPossibleDuplicate:true};
 const employee=await mutation('/api/employees',employeeBody,'employees-list',tag);
 await mutation('/api/employees/'+employee.id,{...employeeBody,id:employee.id,Address:'Synthetic employee address'},'employees-list',tag,'PUT');
 await mutation('/api/employees/documents',{section:'education',employeeId:employee.id,EducationLevel:'College',School:'Synthetic school',Course:'Synthetic course',YearGraduated:2010},'employees-documents',tag);
 await mutation('/api/employees/status/attendance',{EmployeeID:employee.id,StartDate:'2028-07-01',EndDate:'2028-07-01',AttendanceStatus:'On-Leave',Remarks:'Synthetic history test'},'employees-status',tag);
 await mutation('/api/employees/deployments',{EmployeeID:employee.id,SiteID:deployment.SiteID,SiteRateID:deployment.SiteRateID,ShiftCodeID:deployment.ShiftCodeID,DeploymentType:'Regular',StartDate:'2028-06-01'},'employees-deployments',tag);
 let year=2030;for(;year<2100;year++){const [[used]]=await db.execute('SELECT BatchID FROM attendance_dtr WHERE SiteID=? AND PeriodStart=? LIMIT 1',[deployment.SiteID,year+'-06-01']);if(!used)break;}
 const batch=await mutation('/api/attendance/dtr',{AgencyID:1,ClientID:deployment.ClientID,SiteID:deployment.SiteID,PeriodStart:year+'-06-01',PeriodEnd:year+'-06-15'},'attendance-dtr');
 const batchId=batch.id||batch.batchId||batch.BatchID;assert.ok(batchId);
 await mutation('/api/attendance/dtr/'+batchId+'/records',{EmployeeID:employee.id,AttendanceDate:year+'-06-02',ShiftCodeID:deployment.ShiftCodeID,AttendanceStatus:'Present',TimeIn:year+'-06-02 07:00',TimeOut:year+'-06-02 19:00'},'attendance-dtr',tag);
 await mutation('/api/rates/site-rate',{id:newSiteRate.id,SiteID:site.id,PayrollRateID:payrollRate.id,BillingRateID:billingRate.id,AgencyID:1,AgencyPositionID:1,Status:'Active'},'rates-site',tag,'PUT');
 const classification=await mutation('/api/deductions-loans/classification',{ClassificationName:tag,AppliesTo:'Loan',Status:'Active'},'deductions-loans-catalog',tag);
 const loanType=await mutation('/api/deductions-loans/loan-type',{ClassificationID:classification.id,LoanName:tag,Status:'Active'},'deductions-loans-catalog',tag);
 await mutation('/api/deductions-loans/employee-records',{EmployeeID:employee.id,EntryType:'Loan',CatalogItemID:loanType.id,IssuanceDate:'2028-06-01',OriginalAmount:1000,IssuanceNumber:String(parseInt(randomBytes(5).toString('hex'),16)),RepaymentStartDate:'2028-06-01',RepaymentPeriods:2,RepaymentCutoff:'First'},'employee-loans-deductions',tag);
 const contributionClass=await mutation('/api/deductions-loans/classification',{ClassificationName:tag+' CONTRIBUTION',AppliesTo:'Contribution',Status:'Active'},'deductions-loans-catalog',tag);
 const contribution=await mutation('/api/deductions-loans/deduction-type',{ClassificationID:contributionClass.id,DeductionName:tag+' CONTRIBUTION',DeductionPeriod:'Semi-Monthly',Status:'Active'},'deductions-loans-catalog',tag);
 await mutation('/api/deductions-loans/agency-contributions',{AgencyID:1,AgencyPositionID:1,DeductionTypeID:contribution.id,AmountPerCutoff:5,DeductOn:'First',EffectiveStartDate:year+'-06-01',Status:'Active'},'deductions-loans-contributions',tag);
 const bondClass=await mutation('/api/deductions-loans/classification',{ClassificationName:tag+' BOND',AppliesTo:'Recurring Deduction',Status:'Active'},'deductions-loans-catalog',tag);
 const bondType=await mutation('/api/deductions-loans/deduction-type',{ClassificationID:bondClass.id,DeductionName:tag+' BOND',DeductionCategory:'Company',DeductionPeriod:'Semi-Monthly',IsRefundable:1,Status:'Active'},'deductions-loans-catalog',tag);
 await mutation('/api/deductions-loans/agency-contributions',{AgencyID:1,AgencyPositionID:1,DeductionTypeID:bondType.id,AmountPerCutoff:10,DeductOn:'First',EffectiveStartDate:year+'-06-01',Status:'Active'},'deductions-loans-contributions',tag);
 await mutation('/api/attendance/holidays',{HolidayName:tag,HolidayDate:year+'-06-10',HolidayType:'Special',Recurring:0,Status:'Active'},'attendance-holiday-manager',tag);
 const bcrypt=await import('bcrypt');await db.execute('INSERT INTO employee_portal_account(EmployeeID,Email,ContactNumber,PasswordHash,AgreementVersion,AgreementText) VALUES(?,?,?,?,?,?)',[employee.id,employeeBody.Email,employeeBody.ContactNumber,await bcrypt.default.hash(randomBytes(16).toString('hex'),4),'SYNTHETIC_TEST','Synthetic local test only']);
 await mutation('/api/employees/portal-accounts/account',{employeeId:employee.id,action:'deactivate'},'employees-portal-accounts',tag);
 await mutation('/api/attendance/dtr/'+batchId+'/compute',{target:'payroll'},'attendance-dtr');
 await mutation('/api/deductions-loans/cash-bonds/cutoff',{BatchID:batchId,EmployeeID:employee.id,DeductionTypeID:bondType.id,Action:'set',Amount:10,Reason:'Synthetic history verification'},'deductions-loans-cash-bonds',tag,'PUT');
 await mutation('/api/payroll/adjustments',{EmployeeID:employee.id,TargetBatchID:batchId,ManualAmount:10,AdjustmentName:'Synthetic history adjustment',Reason:'Synthetic history verification'},'payroll-adjustments',tag);
 const {build}=await import('esbuild');const bundled=await build({entryPoints:['shared/utils/billingProfile.ts'],bundle:true,write:false,platform:'node',format:'esm'});const {defaultBillingProfile}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));const config=defaultBillingProfile();config.rules[0].enabled=true;
 await mutation('/api/billing/profiles',{agencyId:1,clientId:deployment.ClientID,revision:0,config},'billing-generate');
 const processing=(await request('/api/payroll/processing?page=1&pageSize=1&batchId='+batchId+'&periodStart='+year+'-06-01&periodEnd='+year+'-06-15&status=Pending&includeLookups=0')).json.items[0];assert.ok(processing.reviewHash);
 await mutation('/api/payroll/processing/'+batchId,{action:'finalize',expectedHash:processing.reviewHash},'payroll-processing',tag);
 const review=(await request('/api/payroll/payslips/sites?batchId='+batchId)).json;assert.ok(review.reviewToken);
 await mutation('/api/payroll/payslips/sites',{batchId,employeeIds:[employee.id],reviewToken:review.reviewToken,action:'post'},'payslip-sites',tag);
 const profile=(await request('/api/payroll/payslips?employeeId='+employee.id)).json;assert.ok(profile.cutoffs?.[0]?.key);
 await mutation('/api/payroll/payslips',{employeeId:employee.id,key:profile.cutoffs[0].key,action:'withdraw'},'payslip',tag);
 const currentYear=new Date().getUTCFullYear(),annual=(await request('/api/payroll/thirteenth-month?year='+currentYear+'&agencyId=1')).json.items.find(row=>Number(row.EmployeeID)===employee.id);
 await mutation('/api/payroll/thirteenth-month',{year:currentYear,employeeId:employee.id,agencyId:1,action:'import',expectedHash:annual?.sourceHash,revision:annual?.header?.Revision,reason:'Synthetic history verification',rows:[{start:currentYear+'-01-01',end:currentYear+'-01-15',basic:100,kind:'Previous earnings',reference:tag}]},'payroll-thirteenth-month',tag);
 const department=await mutation('/api/settings/departments',{name:tag},'settings',tag);
 await mutation('/api/settings/departments/'+department.department.id,{},'settings',tag,'DELETE');
 // A forbidden or invalid write must not produce a successful action event.
 const [[last]]=await db.execute('SELECT MAX(EventID) AS id FROM user_activity_event');
 await request('/api/organization/agency',{id:agency.id,AgencyName:tag,Status:'Active'},{method:'PUT',actor:2,role:'Viewer',status:403});
 const [[after]]=await db.execute('SELECT MAX(EventID) AS id FROM user_activity_event');assert.equal(String(after.id),String(last.id));
 note('Named history verified across actual page mutations',{pages:[...covered],mutations:steps.length});
 await fs.writeFile(path.join(root,database,'activity-pages-result.json'),JSON.stringify({database,syntheticOnly:true,at:new Date().toISOString(),pages:[...covered],steps},null,2));
}finally{
 if(child&&child.exitCode===null){child.kill();await once(child,'exit')}
 if(granted)await db.query('DROP USER IF EXISTS ?@?',[user,'localhost']);
 await db.end();
}
