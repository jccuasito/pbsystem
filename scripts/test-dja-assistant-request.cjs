// Real HTTP -> security middleware -> assistant handler. Synthetic staff; no live DB.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http')
const {transformSync}=require('esbuild'),h3=require('h3')
const shared=require('../shared/utils/djaAssistant.ts')
function load(file,overrides={},cache=new Map()) {
 const full=path.resolve(file);if(cache.has(full))return cache.get(full).exports
 const module={exports:{}};cache.set(full,module)
 const req=name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('.')?load(path.resolve(path.dirname(full),name)+'.ts',overrides,cache):require(name)
 const code=transformSync(fs.readFileSync(full,'utf8'),{loader:'ts',format:'cjs'}).code
 vm.runInThisContext(`(function(module,exports,require,defineEventHandler){${code}\n})`,{filename:full})(module,module.exports,req,h3.defineEventHandler)
 return module.exports
}
let server,base,reads=0,sequence=0
const rights=Object.fromEntries(['dashboard','employees','attendance','deductions','billing','payroll','payslips','rates','organization','reports'].map(key=>[key,{canView:true,canEdit:false}]))
function actor(event) {
 const key=h3.getHeader(event,'x-test-staff')
 if(!key)throw h3.createError({statusCode:401})
 return{UserID:Number(key),UserType:'Viewer',Status:'Active'}
}
before(async()=>{
 const access={currentActor:async event=>actor(event),accessForUser:async id=>id===999?{employees:{canView:true}}:rights,requireAdmin:()=>{throw h3.createError({statusCode:403})}}
 const guard=load('server/middleware/00-security.ts',{'../utils/settingsAccess':access,'../utils/employeePortalAuth':{requireEmployeeSession:()=>{throw h3.createError({statusCode:401})}}}).default
 const api=load('server/utils/djaAssistant.ts',{'./settingsAccess':access,'./auth':{requireSession:event=>({sub:actor(event).UserID})},'../connection/dbconnect':{execute:async()=>{reads++;throw Error('Guide must not read business data')}},'../../shared/utils/djaAssistant':shared})
 const app=h3.createApp();app.use(guard)
 app.use(h3.defineEventHandler(async event=>event.path==='/api/assistant/query'?api.queryAssistant(event):{body:await h3.readBody(event)}))
 server=http.createServer(h3.toNodeListener(app));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 base='http://127.0.0.1:'+server.address().port
})
after(async()=>{await new Promise(resolve=>server.close(resolve))})
function post(body,route='/api/assistant/query',headers={},method='POST') {
 return fetch(base+route,{method,headers:{'content-type':'application/json',origin:base,'x-test-staff':String(++sequence),...headers},body:JSON.stringify(body)})
}
test('reported related-guide click and subsequent context pass through real request security',async()=>{
 const response=await post({prompt:'Link a rate to a site',view:'dashboard',locale:'auto',guideId:'site-rate-link',contextGuide:'system-start'})
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()))
 const result=await response.json();assert.equal(result.topic,'site-rate-link');assert.ok(result.steps.some(step=>step.includes('Save link')))
 assert.equal(response.headers.get('cache-control'),'private, no-store')
 const follow=await post({prompt:'ano ang kasunod?',view:'dashboard',locale:'fil',contextGuide:result.topic})
 assert.equal(follow.status,200);assert.equal((await follow.json()).topic,'shift-create')
 assert.equal(reads,0)
})
test('all approved topic IDs pass the middleware and remain checked by the assistant allowlist',async()=>{
 for(const guide of shared.assistantGuides)for(const locale of ['en','fil']){
  const response=await post({prompt:guide.title[locale],view:'dashboard',locale,guideId:guide.id})
  assert.equal(response.status,200,guide.id);assert.equal((await response.json()).topic,guide.id)
 }
 for(const guideId of ['unknown-guide','system-local-start','__proto__',1,{},[],true,'site-rate-link\u0000',null]){
  const response=await post({prompt:'Show steps',view:'dashboard',guideId})
  assert.equal(response.status,400,String(guideId))
 }
 assert.equal(reads,0)
})
test('guide ID exception is limited to the exact assistant POST field; numeric IDs and other security remain enforced',async()=>{
 const body={prompt:'Show steps',guideId:'site-rate-link'}
 for(const route of ['/api/employees','/api/employee-portal/auth/login','/api/assistant/query/other'])assert.equal((await post(body,route)).status,400,route)
 assert.equal((await post(body,'/api/assistant/query',{},'PUT')).status,400)
 for(const other of [{EmployeeID:'EMP-0011'},{id:'site-rate-link'},{GuideID:'site-rate-link'},{row:{guideId:'site-rate-link'}}])assert.equal((await post({...body,...other})).status,400)
 assert.equal((await post(body,'/api/assistant/query',{'x-test-staff':''})).status,401)
 assert.equal((await post(body,'/api/assistant/query',{'x-test-staff':'999'})).status,403)
 assert.equal((await post(body,'/api/assistant/query',{origin:'https://attacker.example'})).status,403)
 assert.equal((await post(body,'/api/assistant/query',{'content-type':'text/plain'})).status,415)
 assert.equal((await post({...body,extra:'unknown field'})).status,400)
 assert.equal(reads,0)
})
