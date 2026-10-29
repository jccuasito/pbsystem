// Browser QA uses synthetic snapshots and mocked portal responses, never live accounts.
// Run with NODE_PATH pointing to a Playwright installation and PORTAL_BROWSER_PATH
// pointing to a Chromium browser. No extra application dependency is required.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data','payslip-account-settings-tests')
async function buildFixture(){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './app/pages/employees/portal-accounts/index.vue';const app=createApp(Portal);app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});window.testApp=app;app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>({path:path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2))+'.ts'}))
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-head-fixture',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead = value => { document.title = value.title }',loader:'js'}))
  build.onLoad({filter:/\.vue$/},args=>{
   if(args.path.endsWith('SearchableSelect.vue'))return{contents:"import {h} from 'vue';export default {props:['modelValue','options'],setup:()=>()=>h('select',{},[h('option','Select ID type')])}",loader:'js'}
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-'+require('node:crypto').createHash('sha1').update(path.relative(root,args.path)).digest('hex').slice(0,8)
   const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'})
   for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
   return{contents:script.content+`;__component.__scopeId=${JSON.stringify(id)};export default __component;`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}



test('employee portal accounts organize access, recovery and private activity without payroll reads',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  await page.setViewportSize({width:1440,height:980})
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f7f9fd}</style><div id="app"></div>')
  await page.addStyleTag({content:fixture.css})
  await page.evaluate(()=>{
   window.requests=[];window.manager=true;window.portalStatus='Active';window.pendingCode=false
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}})
   const employees=[{EmployeeID:1,EmployeeNumber:'TEST-1',EmployeeName:'SYNTHETIC EMPLOYEE ONE',AgencyName:'Agency A',PositionName:'Guard',Status:'Active',PortalStatus:'Active',PortalEmail:'alpha@example.invalid',PortalContactNumber:'09000000001',PayslipCount:3,PostedPayslipCount:2,LastCutoffEnd:'2026-09-30',PortalLastSignInAt:'2026-10-26T02:52:00.000Z'},{EmployeeID:2,EmployeeNumber:'TEST-2',EmployeeName:'SYNTHETIC EMPLOYEE TWO',AgencyName:'Agency B',PositionName:'Supervisor',Status:'Active',PortalStatus:'Inactive',PortalEmail:'beta@example.invalid',PortalContactNumber:'09000000002',PayslipCount:0},{EmployeeID:3,EmployeeNumber:'TEST-3',EmployeeName:'UNREGISTERED EMPLOYEE',AgencyName:'Agency A',PositionName:'Guard',Status:'Active',PortalStatus:'Not registered',PortalEmail:null,PayslipCount:0}]
   const cutoffs=[['2026-09-16','2026-09-30','Posted'],['2026-09-01','2026-09-15','Not Posted'],['2025-09-01','2025-09-15','Posted']].map(([start,end,status],index)=>({key:start+':'+end+':regular',periodStart:start,periodEnd:end,publicationStatus:status,postedAt:status==='Posted'?'2026-10-26T02:52:00.000Z':null,status:'Approved',assignmentType:'Regular',siteName:null,payrollIds:[index+1],gross:1000,deductions:100,net:900,sources:[{payrollId:index+1,batchId:index+1,siteName:'Synthetic site '+index,clientName:'Synthetic client',gross:1000,deductions:100,net:900}],lines:[{section:'earnings',label:'Regular',hours:8,amount:1000},{section:'government',label:'SSS',hours:0,amount:100}]}))
   const events=[{EventID:1,Action:'Signed in',ActorUserID:null,ActorName:'',CreatedAt:'2026-10-26T02:52:00.000Z'}]
   window.$fetch=async(url,options={})=>{
    window.requests.push({url,query:options.query,method:options.method,body:options.body})
    const id=Number(options.query?.employeeId||options.body?.employeeId||1),employee=employees.find(row=>row.EmployeeID===id)
    if(url.endsWith('/account')){
     if(options.method==='POST'){
      if(!window.manager)throw{data:{statusMessage:'Forbidden'}}
      const action=options.body.action;events.unshift({EventID:events.length+1,Action:action==='recovery'?'HR issued recovery code':'HR '+action+'d account',ActorUserID:42,ActorName:'Synthetic HR',CreatedAt:'2026-10-26T03:00:00.000Z'})
      if(action==='recovery'){window.pendingCode=true;return{success:true,recoveryCode:'012345',expiresAt:new Date(Date.now()+900000).toISOString()}}
      window.portalStatus=action==='activate'?'Active':'Inactive';window.pendingCode=false;return{success:true}
     }
     if(id===3)return{canManage:window.manager,account:null,activity:{items:[],pagination:{page:1,pages:1,total:0}}}
     if(!window.manager)return{canManage:false,account:{Status:id===1?window.portalStatus:'Inactive'}}
     return{canManage:true,account:{Status:id===1?window.portalStatus:'Inactive',Email:employee.PortalEmail,ContactNumber:employee.PortalContactNumber,CreatedAt:'2026-10-20T02:30:00.000Z',AgreementVersion:'2026-10-25-v1',AgreementAcceptedAt:'2026-10-20T02:30:00.000Z',LastSignInAt:'2026-10-26T02:52:00.000Z',ActiveSessions:window.pendingCode?0:1,RecoveryPending:window.pendingCode?1:0,RecoveryExpiresAt:new Date(Date.now()+900000).toISOString()},activity:{items:events,pagination:{page:1,pages:1,total:events.length}}}
    }
    if(url==='/api/employees/portal-accounts'){
     if(options.method==='POST')throw new Error('Employee tracker must not post or withdraw payslips')
     if(options.query?.employeeId)return{employee,cutoffs:id===1?cutoffs:[],canPost:true}
     const all=employees.map(row=>({...row,PortalStatus:row.EmployeeID===1?window.portalStatus:row.PortalStatus,...(!window.manager?{PortalEmail:null,PortalContactNumber:null,PortalLastSignInAt:null}: {})}))
     const query=(options.query?.search||'').toLowerCase(),base=all.filter(row=>(!options.query?.agencyId||row.AgencyName===(options.query.agencyId==='1'?'Agency A':'Agency B'))&&[row.EmployeeName,row.EmployeeNumber,window.manager?row.PortalEmail:''].join(' ').toLowerCase().includes(query))
     const status=options.query?.accountStatus,items=base.filter(row=>!status||row.PortalStatus===(status==='active'?'Active':status==='inactive'?'Inactive':'Not registered'))
     return{items,canManageAccounts:window.manager,accountSummary:{total:base.length,active:base.filter(row=>row.PortalStatus==='Active').length,inactive:base.filter(row=>row.PortalStatus==='Inactive').length,unregistered:base.filter(row=>row.PortalStatus==='Not registered').length},agencies:[{AgencyID:1,AgencyName:'Agency A'},{AgencyID:2,AgencyName:'Agency B'}],pagination:{page:1,pages:1,total:items.length}}
    }
    throw new Error('Unexpected fixture request '+url)
   }
  })
  await page.addScriptTag({content:fixture.script})
  await page.getByRole('heading',{name:'Portal Accounts',exact:true}).waitFor()
  await page.getByRole('button',{name:'Manage account',exact:true}).first().waitFor()
  assert.equal(await page.locator('.employee-table tbody tr').count(),3)
  await page.getByRole('button',{name:/^Active accounts/}).click();await page.waitForFunction(()=>document.querySelectorAll('.employee-table tbody tr').length===1)
  assert.match(await page.locator('.employee-table').innerText(),/alpha@example.invalid/)
  await page.screenshot({path:path.join(output,'accounts-list.png'),fullPage:true})
  await page.getByRole('button',{name:'Manage account',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Portal account for SYNTHETIC EMPLOYEE ONE',exact:true});await dialog.waitFor()
  await dialog.locator('.login-email').waitFor();assert.equal(await dialog.locator('.login-email').innerText(),'alpha@example.invalid')
  assert.match(await dialog.locator('.account-details').innerText(),/10:52 AM/)
  assert.equal(await dialog.getByRole('button',{name:/Post payslip|Withdraw payslip/}).count(),0)
  await page.screenshot({path:path.join(output,'account-settings.png'),fullPage:true})
  await dialog.getByRole('button',{name:'Issue recovery code',exact:true}).click();await dialog.locator('.recovery-result code').waitFor()
  assert.equal(await dialog.locator('.recovery-result code').innerText(),'012345')
  await dialog.getByRole('button',{name:'Copy code',exact:true}).click();assert.equal(await page.evaluate(()=>window.copied),'012345')
  await dialog.getByRole('button',{name:'Account activity',exact:true}).click()
  assert.match(await dialog.locator('.activity-table').innerText(),/HR issued recovery code/);assert.match(await dialog.locator('.activity-table').innerText(),/Synthetic HR/)
  await page.screenshot({path:path.join(output,'account-activity.png'),fullPage:true})
  assert.equal(await dialog.getByRole('button',{name:'Payslip history',exact:true}).count(),0,'Financial history stays in Payroll > Payslips');assert.equal(await dialog.getByRole('button',{name:'PDF archive',exact:true}).count(),0)
  await dialog.getByRole('button',{name:'Portal account',exact:true}).click()
  await dialog.getByRole('button',{name:'Deactivate access',exact:true}).click();await dialog.getByRole('button',{name:'Activate access',exact:true}).waitFor()
  assert.equal(await dialog.getByRole('button',{name:'Issue recovery code',exact:true}).isDisabled(),true)
  assert.equal(await dialog.locator('.recovery-result').count(),0,'Access change clears the displayed secret')
  await dialog.getByRole('button',{name:'Activate access',exact:true}).click();await dialog.getByRole('button',{name:'Deactivate access',exact:true}).waitFor()
  for(const width of [375,320]){await page.setViewportSize({width,height:850});const fit=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.ok(fit,'Account layout fits '+width);await page.screenshot({path:path.join(output,'account-settings-'+width+'.png'),fullPage:true})}
  await dialog.getByRole('button',{name:'Close profile'}).click();await dialog.waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  await page.setViewportSize({width:1440,height:980})
  await page.getByRole('button',{name:/^Not registered/}).click();await page.getByRole('button',{name:'View employee',exact:true}).click()
  const missing=page.getByRole('dialog',{name:'Portal account for UNREGISTERED EMPLOYEE',exact:true});await missing.getByRole('heading',{name:'Not registered yet'}).waitFor();assert.equal(await missing.getByRole('button',{name:'Issue recovery code'}).count(),0)
  await missing.getByRole('button',{name:'Close profile'}).click()
  await page.evaluate(()=>{window.manager=false});await page.getByRole('button',{name:/^All employees/}).click()
  await page.getByRole('button',{name:'Manage account',exact:true}).first().click();await dialog.waitFor()
  await dialog.getByText('Only authorized Admins and Supervisors with edit access can view contact details and manage portal accounts.').waitFor()
  assert.equal(await dialog.locator('.login-email').count(),0);assert.equal(await dialog.getByRole('button',{name:'Issue recovery code'}).count(),0)
  await dialog.getByRole('button',{name:'Account activity',exact:true}).click();assert.equal(await dialog.locator('.activity-table').count(),0)
  await page.evaluate(()=>window.testApp.unmount());assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  assert.equal((await page.evaluate(()=>window.requests.filter(row=>row.url.startsWith('/api/payroll/')))).length,0,'Account management does not fetch payroll data');
  assert.deepEqual(errors,[])
  assert.ok((await page.evaluate(()=>window.requests.filter(row=>row.method==='POST'))).every(row=>row.url.endsWith('/account')))
 }finally{await browser.close()}
})
