const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,Buffer,Date,console,process,defineNitroPlugin:fn=>fn,require:name=>{if(name in deps)return deps[name];if(!name.startsWith('.'))return require(name);throw Error(name)}});return module.exports}
const shared=load('shared/utils/activityHistory.ts')
const h3={getMethod:e=>e.method,getResponseStatus:e=>e.status||200,getRequestURL:e=>new URL('http://localhost'+e.path),getQuery:e=>e.query||{},setHeader:()=>{},createError:d=>Object.assign(Error(d.statusMessage),d)}
const policy=load('server/utils/activityHistoryPolicy.ts',{'h3':h3,'../../shared/utils/activityHistory':shared})
const actor={UserID:7,FirstName:'Test',LastName:'Staff',UserType:'Encoder'}
const event=(path='/api/employees/15',method='PUT',body={})=>({path,method,context:{securityActor:actor,activityInput:policy.activityInput(body)}})

test('staff mutation routes have a server-owned scope; read-only and portal actions are excluded',()=>{
 const files=fs.readdirSync('server/api',{recursive:true}).map(String).filter(n=>/\.(post|put|delete|patch)\.ts$/.test(n))
 const excluded=/^(auth\/(?:login|register|google|google-code|forgot-password|reset-password|verify-email|resend-verification|logout)|employee-portal\/|assistant\/|notifications\/|employees\/(duplicates|documents\/government\/recognize))/
 for(const file of files){const normalized=file.replaceAll('\\','/');if(excluded.test(normalized))continue
  const path='/api/'+normalized.replace(/\.(post|put|delete|patch)\.ts$/,'').replace(/\/index$/,'').replaceAll('[id]','15')
  const resources=path.includes('/organization/')?['agency','position','agency-position','client','client-policy','site','site-account','site-policy','site-shift','shift-code','region']:path.includes('/rates/')?['payroll-rate','billing-rate','site-rate']:['classification','loan-type','deduction-type']
  for(const resource of resources){const target=path.replace('[resource]',resource);assert.ok(shared.activityScopeForPath(target),target)}
 }
 for(const path of ['/api/employee-portal/information','/api/auth/login','/api/notifications/read','/api/employees/duplicates','/api/assistant/query'])assert.equal(shared.activityScopeForPath(path),null,path)
 assert.equal(shared.historyScopeForView('attendance-dtr-reliever'),'attendance-dtr')
})

test('metadata keeps bounded references and field names, never sensitive values or imported row contents',()=>{
 const secret='PRIVATE-DO-NOT-LOG',input=policy.activityInput({EmployeeID:123,FirstName:secret,password:secret,token:secret,recoveryCode:secret,Email:secret,PhotoDataUrl:secret,Rows:Array.from({length:5000},()=>({Email:secret})),action:'constructor',SSSNumber:secret})
 assert.ok(!JSON.stringify(input).includes(secret));assert.equal(input.action,null);assert.equal(input.counts['Rows submitted'],5000)
 assert.deepEqual(Array.from(input.references),['EmployeeID #123']);assert.ok(!input.fields.includes('password'));assert.ok(!input.fields.includes('SSSNumber'))
 const entry=policy.activityCandidate(event('/api/attendance/dtr/9/records','POST',{ImportRows:true,Rows:[{TimeIn:secret}]}),{body:{added:3,token:secret}})
 assert.equal(entry.action,'Import');assert.equal(entry.details.counts.added,3);assert.ok(!JSON.stringify(entry).includes(secret))
 assert.equal(policy.activityCandidate(event('/api/employees/15/permanent','DELETE'),{body:{success:true}}).action,'Delete')
})

test('capture distinguishes accepted jobs and excludes failed requests, guests and reads',()=>{
 const queued=event('/api/payroll/jobs','POST',{batchId:2});queued.status=202
 assert.equal(policy.activityCandidate(queued,{body:{job:{id:'private'}}}).outcome,'Accepted')
 for(const e of [event('/api/employees','GET'),{...event(),status:403},{...event(),context:{}},{...event(),context:{securityActor:actor,activityFailed:true}}])assert.equal(policy.activityCandidate(e,{}),null)
 assert.equal(policy.activityCandidate(event(),{body:{success:false}}),null)
 assert.equal(policy.activityCandidate(event('/api/employees/duplicates','POST'),{}),null)
})

function service(db,rights={employees:{canView:true},organization:{canView:true}},registered=true){
 const auth={requireSession:e=>({sub:e.actor?.UserID||7})},access={currentActor:async e=>e.actor||actor,accessForUser:async()=>rights}
 const pending=new Map(),coalesceRead=(k,fn)=>{if(pending.has(k))return pending.get(k);const p=Promise.resolve().then(fn).finally(()=>pending.delete(k));pending.set(k,p);return p}
 const api=load('server/utils/activityHistory.ts',{'h3':h3,'../connection/dbconnect':db,'./auth':auth,'./settingsAccess':access,'./requestCapacity':{coalesceRead},'../../shared/utils/activityHistory':shared});if(registered)api.registerActivityRecorder();return api
}
const row=id=>({id:String(id),Scope:'employees-list',ActorUserID:7,ActorName:'Test Staff',ActorRole:'Encoder',Action:'Update',Operation:'update employees',Outcome:'Completed',DetailsJson:'{"references":[],"fields":[],"counts":{}}',CreatedAt:new Date(),CursorAt:'2026-11-28 00:00:00.000000'})
test('keyset reads are bound, limited and coalesced; current permissions are checked before cache access',async()=>{
 let reads=0,last,allow=true
 const rights={employees:{get canView(){return allow}}},db={execute:async(sql,params)=>{reads++;last={sql,params};await new Promise(r=>setTimeout(r,3));return[Array.from({length:26},(_,i)=>row(100-i))]}}
 const api=service(db,rights),e={query:{scope:'employees-list',before:'9007199254740993'}}
 const results=await Promise.all(Array.from({length:40},()=>api.listActivityHistory(e)))
 assert.equal(reads,1);assert.equal(results[0].items.length,25);assert.equal(Buffer.from(results[0].nextCursor,'base64url').toString(),'2026-11-28 00:00:00.000000|76');assert.equal(results[0].visibility,'Own')
 assert.ok(last.sql.includes('ActorUserID=?'));assert.ok(last.params.includes('9007199254740993'));assert.ok(last.params.includes(7));assert.match(last.sql,/LIMIT 26/)
 results[0].items[0].actorName='mutated';assert.equal((await api.listActivityHistory(e)).items[0].actorName,'Test Staff');assert.equal(reads,1)
 allow=false;await assert.rejects(api.listActivityHistory(e),e=>e.statusCode===403);assert.equal(reads,1)
 for(const query of [{scope:'__proto__'},{scope:'employees-list',before:'1 OR 1=1'},{scope:'employees-list',action:'DROP'},{scope:'employees-list',actor:1}])await assert.rejects(api.listActivityHistory({query}),e=>e.statusCode===400)
})

test('supervisor team access is module-scoped; settings and all-page history stay own-only',async()=>{
 let sql
 const api=service({execute:async statement=>{sql=statement;return[[]]}})
 await api.listActivityHistory({actor:{...actor,UserType:'Supervisor'},query:{scope:'employees-list'}});assert.ok(!sql.includes('ActorUserID=?'))
 await api.listActivityHistory({actor:{...actor,UserType:'Supervisor'},query:{scope:'settings'}});assert.ok(sql.includes('ActorUserID=?'))
 await api.listActivityHistory({actor:{...actor,UserType:'Supervisor'},query:{scope:'all'}});assert.ok(sql.includes('ActorUserID=?'))
 await api.listActivityHistory({actor:{...actor,UserType:'Admin'},query:{scope:'settings'}});assert.ok(!sql.includes('ActorUserID=?'))
})

test('100 concurrent appends are awaited and batched; failure is observable without replaying the action',async()=>{
 let writes=0,fail=false
 const api=service({execute:async()=>{writes++;await new Promise(r=>setTimeout(r,3));if(fail)throw Error('SQL secret');return[{}]}})
 const entry=policy.activityCandidate(event(),{})
 const results=await Promise.all(Array.from({length:100},()=>api.appendActivity({...entry,key:require('node:crypto').randomUUID()})))
 assert.ok(results.every(Boolean));assert.ok(writes<=4);assert.equal(api.activityHistoryMetrics().recorded,100)
 fail=true;assert.equal(await api.appendActivity(entry),false);assert.equal(api.activityHistoryMetrics().failures,1);assert.equal(api.activityHistoryMetrics().pending,0)
})

test('queued completion writes the actor and stable event key on its financial transaction connection',async()=>{
 const calls=[],api=service({execute:()=>{throw Error('Must use transaction')}})
 const connection={execute:async(sql,params)=>{calls.push({sql,params});return sql.startsWith('SELECT')?[[{RequestedBy:9,BatchID:4,FirstName:'Queue',LastName:'Actor',UserType:'Admin'}]]:[{}]}}
 await api.recordQueuedPayrollActivity(connection,'a-valid-job')
 assert.equal(calls.length,2);assert.ok(calls[1].params.includes('payroll-job:a-valid-job'));assert.ok(calls[1].params.includes('Queue Actor'));assert.ok(calls[1].params.includes('Completed'))
})


test('missing recorder is visible in health and cannot masquerade as empty successful history',async()=>{
 const api=service({execute:async()=>{throw Error('Must not read records without a recorder')}},undefined,false)
 assert.equal(api.activityHistoryMetrics().recorderRegistered,false)
 await assert.rejects(api.listActivityHistory({query:{scope:'employees-list'}}),e=>e.statusCode===503)
 api.registerActivityRecorder();assert.equal(api.activityHistoryMetrics().recorderRegistered,true)
})

test('recording plugin registers at startup and logs an agency address save exactly once',async()=>{
 const hooks={},entries=[];let registered=0
 const plugin=load('server/plugins/activity-history.ts',{'h3':h3,'../utils/activityHistory':{registerActivityRecorder:()=>registered++,appendActivity:async entry=>{entries.push(entry);return true}},'../utils/activityHistoryPolicy':policy,'../utils/activitySubject':{finishActivitySubjects:async()=>{}}}).default
 plugin({hooks:{hook:(name,callback)=>hooks[name]=callback}});assert.equal(registered,1)
 const e=event('/api/organization/agency','PUT',{id:1,AgencyAddress:'PRIVATE SAMPLE ADDRESS'})
 await hooks.beforeResponse(e,{body:{success:true}});await hooks.beforeResponse(e,{body:{success:true}})
 assert.equal(entries.length,1);assert.equal(entries[0].scope,'organization-agency');assert.ok(entries[0].details.fields.includes('AgencyAddress'))
 assert.ok(!JSON.stringify(entries).includes('PRIVATE SAMPLE ADDRESS'))
})


test('subject snapshots use indexed server records, retain names after removal and ignore injected unrelated identities',async()=>{
 let label='SAVED AGENCY',queries=[];
 const subjects=load('server/utils/activitySubject.ts',{'h3':h3,'../../shared/utils/activityHistory':shared,'../connection/dbconnect':{execute:async(sql,params)=>{queries.push({sql,params});return[label? [{label}]:[]]}}})
 const e=event('/api/organization/agency','PUT',{id:18,AgencyName:'FORGED LABEL',EmployeeID:999});
 await subjects.prepareActivitySubjects(e);assert.equal(e.context.activitySubjects[0].label,'SAVED AGENCY');assert.equal(queries.length,1);assert.match(queries[0].sql,/WHERE AgencyID=\?/);assert.ok(!queries[0].sql.includes('999'));
 label='RENAMED AGENCY';await subjects.finishActivitySubjects(e,{body:{success:true}});assert.equal(e.context.activitySubjects[0].label,label);assert.equal(e.context.activitySubjects[0].previousLabel,'SAVED AGENCY');
 label=null;await subjects.finishActivitySubjects(e,{body:{success:true}});assert.equal(e.context.activitySubjects[0].label,'RENAMED AGENCY');
 const entry=policy.activityCandidate(e,{body:{success:true}});assert.equal(entry.details.subjects[0].label,'RENAMED AGENCY');assert.ok(!JSON.stringify(entry).includes('FORGED LABEL'));
 queries=[];await subjects.prepareActivitySubjects(event('/api/employees','GET'));assert.equal(queries.length,0);
})

test('generated record IDs including nested department responses are named; failed name lookup never fabricates a label',async()=>{
 const resolver=load('server/utils/activitySubject.ts',{'h3':h3,'../../shared/utils/activityHistory':shared,'../connection/dbconnect':{execute:async()=>[[{label:'Synthetic department'}]]}})
 const e=event('/api/settings/departments','POST',{});await resolver.finishActivitySubjects(e,{body:{department:{id:9}}});assert.equal(e.context.activitySubjects[0].id,'9');assert.equal(e.context.activitySubjects[0].kind,'department');
 const unavailable=load('server/utils/activitySubject.ts',{'h3':h3,'../../shared/utils/activityHistory':shared,'../connection/dbconnect':{execute:async()=>{throw Error('private SQL failure')}}})
 const bad=event('/api/organization/agency','PUT',{id:1,AgencyName:'Unverified'});await unavailable.prepareActivitySubjects(bad);assert.equal(bad.context.activitySubjects.length,0);assert.equal(bad.context.activitySubjectUnavailable,true);
})


test('all primary resource families can resolve a named created record within their allowed module',async()=>{
 const resolver=load('server/utils/activitySubject.ts',{'h3':h3,'../../shared/utils/activityHistory':shared,'../connection/dbconnect':{execute:async()=>[[{label:'Verified record'}]]}})
 for(const [path,kind,body]of [
 ['/api/organization/agency','agency'],['/api/organization/client','client'],['/api/organization/site','site'],['/api/organization/position','position'],['/api/organization/region','region'],['/api/organization/shift-code','shift-code'],['/api/organization/site-account','site-account'],['/api/organization/agency-position','agency-position'],
 ['/api/employees','employee'],['/api/attendance/dtr','dtr'],['/api/attendance/holidays','holiday'],['/api/rates/payroll-rate','payroll-rate'],['/api/rates/billing-rate','billing-rate'],['/api/rates/site-rate','site-rate'],['/api/billing/drafts','billing'],['/api/deductions-loans/classification','classification'],['/api/deductions-loans/loan-type','loan-type'],['/api/deductions-loans/deduction-type','deduction-type'],['/api/deductions-loans/employee-records','loan-record',{EntryType:'Loan'}]
 ]){const e=event(path,'POST',body||{});await resolver.finishActivitySubjects(e,{body:{id:14}});assert.equal(e.context.activitySubjects[0]?.kind,kind,path)}
})


test('plain activity sentences preserve meaning without exposing routes or inventing changed fields',()=>{
 const {activitySentence}=load('app/utils/activityPresentation.ts',{'../../shared/utils/activityHistory':shared})
 const entry={id:'1',scope:'organization-agency',actorName:'Sample Staff',action:'Update',operation:'Updated agency',outcome:'Completed',subjects:[{kind:'agency',id:'18',label:'Sample Agency'}],references:['id #18'],fields:['AgencyName','AgencyAddress'],counts:{},changedFields:['AgencyAddress']}
 assert.deepEqual({...activitySentence(entry)},{text:'changed the address for agency',target:'Sample Agency',note:''})
 assert.equal(activitySentence({...entry,changedFields:null}).text,'updated agency')
 assert.equal(activitySentence({...entry,changedFields:[]}).note,'No tracked details changed.')
 assert.equal(activitySentence({...entry,operation:'Deactivated agency'}).text,'deactivated agency')
 assert.equal(activitySentence({...entry,action:'Delete',operation:'delete agency'}).text,'deleted agency')
 assert.equal(activitySentence({...entry,action:'Delete',operation:'delete employees / permanent'}).text,'permanently deleted agency')
 const queued=activitySentence({...entry,scope:'payroll-processing',action:'Process',operation:'finalize queued payroll',outcome:'Accepted',subjects:[{kind:'dtr',id:'7',label:'Site / cutoff'}]})
 assert.equal(queued.text,'queued payroll for DTR');assert.match(queued.note,/not confirmed complete/)
 assert.equal(activitySentence({...entry,scope:'payroll-processing',action:'Process',operation:'finalize queued payroll',subjects:[{kind:'dtr',id:'7',label:'Site / cutoff'}]}).text,'finalized payroll for DTR')
 const employee={kind:'employee',id:'9',label:'Sample Employee'}
 assert.equal(activitySentence({...entry,scope:'employees-documents',action:'Create',changedFields:null,subjects:[employee]}).text,'added an employee document for employee')
 assert.equal(activitySentence({...entry,scope:'employees-portal-accounts',operation:'deactivate employees / portal-accounts / account',subjects:[employee]}).text,'deactivated portal access for employee')
 assert.equal(activitySentence({...entry,scope:'deductions-loans-contributions',action:'Create',changedFields:null}).text,'added a contribution plan for agency')
 const legacy=activitySentence({...entry,subjects:[],changedFields:null,operation:'update agency'})
 assert.equal(legacy.text,'updated an agency');assert.equal(legacy.target,'')
 assert.equal(activitySentence({...entry,scope:'employees-documents',subjects:[],changedFields:null,operation:'update employees / documents / private-internal-route'}).text,'updated an employee document in Employee documents')
})


test('recent/archive use disjoint seven-day ranges and a time-plus-ID seek cursor with a stable boundary',async()=>{
 let last
 const api=service({execute:async(sql,params)=>{last={sql,params};return[[]]}})
 const asOf='2026-11-01T00:00:00.000Z',base={scope:'employees-list',asOf}
 await api.listActivityHistory({query:base})
 assert.ok(last.sql.includes('CreatedAt>=?'));assert.ok(last.params.includes('2026-10-25 00:00:00.000'))
 assert.match(last.sql,/ORDER BY CreatedAt DESC,EventID DESC LIMIT 26/);assert.ok(!last.sql.includes('OFFSET'))
 const before=Buffer.from('2026-10-24 12:00:00.123456|9007199254740993').toString('base64url')
 const feed=await api.listActivityHistory({query:{...base,period:'archive',before}})
 assert.equal(feed.period,'archive');assert.equal(feed.asOf,asOf);assert.equal(feed.cutoff,'2026-10-25T00:00:00.000Z')
 assert.ok(last.sql.includes('CreatedAt<?'));assert.ok(last.sql.includes('(CreatedAt<? OR (CreatedAt=? AND EventID<?))'))
 assert.ok(last.params.includes('2026-10-24 12:00:00.123456'));assert.ok(last.params.includes('9007199254740993'))
 for(const query of [{...base,period:'drop'},{...base,asOf:'2026-02-30T00:00:00.000Z'},{...base,before:Buffer.from('2026-02-30 00:00:00.000000|1').toString('base64url')},{...base,before:'garbage'}, {...base,asOf:'2099-01-01T00:00:00.000Z'}])await assert.rejects(api.listActivityHistory({query}),e=>e.statusCode===400)
})
