// Browser QA uses synthetic snapshots and mocked portal responses, never live accounts.
// Run with NODE_PATH pointing to a Playwright installation and PORTAL_BROWSER_PATH
// pointing to a Chromium browser. No extra application dependency is required.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data','payslip-sites-tests')
async function buildFixture(){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './app/pages/payroll/payslip-sites/index.vue';const app=createApp(Portal);app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>({path:path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2))+'.ts'}))
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-head-fixture',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead = value => { document.title = value.title }',loader:'js'}))
  build.onLoad({filter:/\.vue$/},args=>{
   if(args.path.endsWith('SearchableSelect.vue'))return{contents:"import {h} from 'vue';export default {props:['modelValue','options'],setup:()=>()=>h('select',{},[h('option','Select ID type')])}",loader:'js'}
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-'+Buffer.from(path.relative(root,args.path)).toString('hex').slice(-18)
   const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'})
   for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
   return{contents:script.content+`;__component.__scopeId=${JSON.stringify(id)};export default __component;`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}


test('account review selection, included sites and shared employee posting work in the browser',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  for(const width of [320,1280]){
   await page.setViewportSize({width,height:850})
   await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><div id="app"></div>')
   await page.addStyleTag({content:fixture.css})
   await page.evaluate(()=>{
    window.requests=[];window.posted=[]
    const employee=id=>({EmployeeID:id,EmployeeNumber:'TEST-'+id,EmployeeName:'SYNTHETIC EMPLOYEE '+id,AgencyName:'Synthetic agency',PositionName:'Guard',Status:'Active'})
    const cutoff=id=>({key:'2026-10-01:2026-10-15:regular',periodStart:'2026-10-01',periodEnd:'2026-10-15',status:'Approved',assignmentType:'Regular',siteName:null,payrollIds:id===1?[id,100,200]:[id],gross:id===1?1200:1000,deductions:100,net:id===1?1100:900,publicationStatus:window.posted.includes(id)?'Posted':'Not Posted',lines:[{section:'earnings',label:'Regular',hours:8,amount:id===1?1200:1000},{section:'government',label:'SSS',hours:0,amount:100}],sources:[{payrollId:id,batchId:1,siteName:'Synthetic North Site',clientName:'Synthetic client',gross:1000,deductions:100,net:900},...(id===1?[{payrollId:100,batchId:2,siteName:'Synthetic South Site',clientName:'Synthetic client',gross:200,deductions:0,net:200},{payrollId:200,batchId:3,siteName:'Outside account site',clientName:'Synthetic client',gross:300,deductions:0,net:300}]:[])]})
    const scope={siteAccountId:10,agencyId:1,periodStart:'2026-10-01',periodEnd:'2026-10-15'}
    const header={Scope:scope,SiteAccountID:10,SiteAccountName:'Synthetic Account',AgencyID:1,AgencyName:'Synthetic agency',SiteCount:2,BatchIDs:[1,2],IncludedSites:[{BatchID:1,SiteID:1,SiteName:'Synthetic North Site',ClientName:'Synthetic client'},{BatchID:2,SiteID:2,SiteName:'Synthetic South Site',ClientName:'Synthetic client'}],PeriodStart:'2026-10-01',PeriodEnd:'2026-10-15'}
    window.$fetch=async(url,options={})=>{
     window.requests.push({url,...options})
     if(url.endsWith('/sites')){
      if(options.method==='POST'){window.posted=options.body.action==='post'?[...new Set([...window.posted,...options.body.employeeIds])]:window.posted.filter(id=>!options.body.employeeIds.includes(id));return{changed:options.body.employeeIds.length,unchanged:0}}
      if(options.query?.siteAccountId!==undefined)return{header,items:Array.from({length:27},(_,index)=>({employee:employee(index+1),cutoffs:[cutoff(index+1)]})),reviewToken:'a'.repeat(64),canPost:true}
      return{items:[{...header,EmployeeCount:27,PayrollCount:27,PostedPayrollCount:window.posted.length,PublicationStatus:window.posted.length===27?'Posted':window.posted.length?'Partially posted':'Not Posted',GrossPay:27000,TotalDeduction:2700,NetPay:24300}],agencies:[{AgencyID:1,AgencyName:'Synthetic agency'}],cutoffs:[header],canPost:true,pagination:{page:1,pages:1,total:1}}
     }
     if(url.endsWith('/account'))return{canManage:true,account:{Status:'Active',Email:'synthetic@example.invalid',ContactNumber:'09000000000',AgreementVersion:'test',AgreementAcceptedAt:'2026-10-25'}}
     if(url.endsWith('/payslips')&&options.query?.employeeId)return{employee:employee(options.query.employeeId),cutoffs:[cutoff(options.query.employeeId)],canPost:true}
     throw new Error('Unexpected fixture request: '+url)
    }
   })
   await page.addScriptTag({content:fixture.script})
   await page.getByRole('button',{name:'Review account'}).click()
   const dialog=page.getByRole('dialog',{name:'Synthetic Account',exact:true});await dialog.waitFor()
   await dialog.locator('.included-sites summary').click()
   assert.match(await dialog.locator('.included-sites').innerText(),/Synthetic North Site/)
   assert.match(await dialog.locator('.included-sites').innerText(),/Synthetic South Site/)
   assert.doesNotMatch(await dialog.locator('.included-sites').innerText(),/Outside account site/)
   assert.equal(await dialog.locator('tbody tr').count(),25,'Large rosters use pages')
   await dialog.getByRole('button',{name:'Select all filtered (27)',exact:true}).click()
   const post=dialog.getByRole('button',{name:'Post selected payslips',exact:true})
   assert.equal(await post.isDisabled(),true,'Combined payslip requires acknowledgement')
   await dialog.getByRole('checkbox',{name:/selected employee.*combined payslip/}).check()
   assert.equal(await post.isEnabled(),true)
   await dialog.getByRole('button',{name:'Next',exact:true}).click()
   assert.equal(await dialog.locator('tbody tr').count(),2)
   assert.equal(await dialog.getByRole('checkbox',{name:'Select SYNTHETIC EMPLOYEE 27',exact:true}).isChecked(),true,'Selection spans pages')
   await post.click()
   await dialog.getByRole('status').waitFor()
   const request=await page.evaluate(()=>window.requests.find(row=>row.method==='POST'))
   assert.equal(request.body.employeeIds.length,27);assert.equal(request.body.batchId,undefined);assert.equal(request.body.siteAccountId,10);assert.equal(request.body.agencyId,1);assert.equal(request.body.periodStart,'2026-10-01');assert.equal(request.body.periodEnd,'2026-10-15');assert.equal(request.body.includeCombined,true);assert.equal(request.body.action,'post')
   assert.equal(await post.isDisabled(),true,'Selection clears after successful post')
   await dialog.getByRole('button',{name:'Previous',exact:true}).click()
   await dialog.getByRole('button',{name:'View payslip',exact:true}).first().click()
   const preview=page.getByRole('dialog',{name:'Payslip preview',exact:true});await preview.waitFor()
   assert.match(await preview.locator('.sheet-site').innerText(),new RegExp('Synthetic North Site / Synthetic South Site'))
   await preview.getByRole('button',{name:'Close payslip preview'}).click()
   await dialog.getByRole('button',{name:'Employee profile',exact:true}).first().click()
   const profile=page.getByRole('dialog',{name:'Payslips for SYNTHETIC EMPLOYEE 1',exact:true});await profile.waitFor()
   await profile.getByRole('button',{name:'Issue recovery code',exact:true}).waitFor()
   assert.equal(await profile.getByRole('button',{name:'Deactivate access',exact:true}).count(),1)
   assert.equal(await page.getByRole('heading',{name:'Payslips',exact:true}).count(),0,'Embedded profile does not render a second employee list')
   await profile.getByRole('button',{name:'Close profile'}).click();await profile.waitFor({state:'hidden'})
   await dialog.getByRole('button',{name:'Select all filtered (27)',exact:true}).click()
   await dialog.getByRole('checkbox',{name:/selected employee.*combined payslip/}).check()
   await dialog.getByRole('button',{name:'Withdraw selected',exact:true}).click()
   await dialog.getByRole('status').waitFor()
   assert.equal((await page.evaluate(()=>window.requests.filter(row=>row.method==='POST').at(-1))).body.action,'withdraw')
   const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,modalWidth:document.querySelector('.review-modal').getBoundingClientRect().width}))
   assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));assert.ok(sizes.modalWidth<=width)
   await dialog.locator('.modal-body').evaluate(el=>{el.scrollTop=0;const table=el.querySelector('.table-wrap');if(table)table.scrollLeft=0})
   await page.screenshot({path:path.join(output,'site-review-'+width+'.png'),fullPage:true})
   await dialog.getByRole('button',{name:'Close account payroll'}).click();await dialog.waitFor({state:'hidden'})
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  }
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
