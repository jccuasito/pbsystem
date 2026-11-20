// Real Vue screens, synthetic records and mocked reads only; no database access.
// NODE_PATH=<Playwright modules> node scripts/test-progressive-lists-ui.cjs
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const sfc=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.data/progressive-list-tests')
fs.mkdirSync(out,{recursive:true})
async function fixture(file){
 const css=['base','theme','components','dashboard','payroll-processing','interactions'].map(name=>fs.readFileSync(path.join(root,'assets/css/'+name+'.css'),'utf8'))
 const result=await build({stdin:{resolveDir:root,contents:`import{createApp,h,reactive,ref,KeepAlive}from'vue';import Screen from'./${file}';const props=reactive(window.fixtureProps||{}),active=ref(true);window.screenProps=props;window.screenActive=active;const app=createApp({setup(){return()=>h('div',{class:'page dash-page','data-theme':document.documentElement.dataset.theme||'light'},[h(KeepAlive,null,()=>active.value?h(Screen,props):null)])}});app.component('NuxtLink',{setup(props,{slots}){return()=>h('a',slots.default?.())}});app.mount('#app');window.screenApp=app`,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"','import.meta.client':'true'},plugins:[{name:'vue-fixture',setup(build){
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-imports',namespace:'qa'}))
  build.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const useHead=()=>{},onBeforeRouteLeave=()=>{},useRoute=()=>({query:{}}),useRouter=()=>({push(){},replace(){}});',loader:'js'}))
  build.onLoad({filter:/\.css$/},args=>{css.push(fs.readFileSync(args.path,'utf8'));return{contents:'',loader:'js'}})
  build.onLoad({filter:/\.vue$/},args=>{
   let source=fs.readFileSync(args.path,'utf8'),descriptor=sfc.parse(source,{filename:args.path}).descriptor
   const original=sfc.compileScript(descriptor,{id:'bindings'})
   const missing=['ref','reactive','computed','watch','watchEffect','onMounted','onBeforeUnmount','onActivated','onDeactivated','onUnmounted','nextTick','shallowRef','useId'].filter(name=>!original.bindings[name]&&new RegExp('\\b'+name+'\\b').test(source.slice(0,source.indexOf('</script>'))))
   if(missing.length){source=source.replace(/(<script setup[^>]*>)/,'$1\nimport {'+missing.join(',')+'} from "vue";');descriptor=sfc.parse(source,{filename:args.path}).descriptor}
   const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8),script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
   for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);css.push(compiled.code)}
   return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:css.join('\n')}
}
async function mount(page,built,props,responses,dark=false,manual=false){
 await page.route('https://**/*',route=>route.abort());page.setDefaultTimeout(12000)
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('Page error: '+error.message)});page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.log('Console error: '+message.text())}})
 await page.setContent(`<html data-theme="${dark?'dark':'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${built.css}</style></head><body><div id="app"></div></body></html>`)
 await page.evaluate(({props,responses,manual})=>{
  if(manual)window.IntersectionObserver=undefined
  window.fixtureProps=props;window.fixtureReads=[];window.fixtureResponses=responses;window.pendingList=[];window.failNext=false;window.delayNext=false
  window.$fetch=async(url,options={})=>{
   if(options.method)throw Error('Unexpected write in list fixture: '+url)
   const query={...options.query};window.fixtureReads.push({url,query,signal:options.signal})
   let value=window.fixtureResponses[url];if(!value)throw Error('Unexpected fixture request '+url)
   value=structuredClone(value)
   const collection=value.requests||value
   if(query.search==='narrow')collection.items=collection.items.slice(0,3)
   if(collection.pagination&&query.page){const total=collection.items.length,size=collection.pagination.pageSize||25;collection.items=collection.items.slice((query.page-1)*size,query.page*size);collection.pagination={page:query.page,pageSize:size,pages:Math.max(1,Math.ceil(total/size)),total}}
   if(window.failNext){window.failNext=false;throw Error('Simulated read failure')}
   if(window.delayNext){window.delayNext=false;return new Promise(resolve=>window.pendingList.push(()=>resolve(value)))}
   return value
  }
 },{props,responses,manual})
 await page.addScriptTag({content:built.script});return errors
}
const many=make=>Array.from({length:60},(_,index)=>make(index+1))
const name=id=>String(id).padStart(3,'0')

test('growing directories and grouped rates reveal batches while retaining complete matches and print rows',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LISTS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 const sites=many(id=>({SiteID:id,SiteName:'Site '+name(id),ClientName:'Client '+name(id),AgencyName:'Agency A',AgencyNames:'Agency A',AgencyIDs:[1],AgencyAccounts:[{SiteAccountName:'Account A'}],Status:'Active'}))
 const plans=many(id=>({AgencyContributionID:id,AgencyID:1,AgencyName:'Agency A',AgencyPositionID:1,PositionName:'Guard',DeductionTypeID:id,DeductionName:'Plan '+name(id),ClassificationName:'Contribution',CatalogKind:'Contribution',IsRefundable:0,AmountPerCutoff:100,DeductOn:'Second',EffectiveStartDate:'2026-01-01',Status:'Active',Versions:[],DateCorrections:[],CurrentAmountPerCutoff:100,CurrentDeductOn:'Second'}))
 const rates=many(id=>({PayrollRateID:id,AgencyPositionID:id,AgencyID:1,AgencyName:'Agency A',RegionID:1,RegionCode:'13',RegionName:'NCR',PositionName:'Position '+name(id),Status:'Active',EffectiveDate:'2026-01-01',RegularRate:100,OTRate:125}))
 const specs=[
  {file:'components/OrganizationCrud.vue',props:{resource:'site',title:'Sites',fields:[],columns:[{key:'SiteName',label:'Site'},{key:'ClientName',label:'Client'},{key:'Status',label:'Status'}]},responses:{'/api/organization/site':{items:sites,canEdit:true}},rows:'.desktop-table tbody tr',search:'.filters input',term:'Site 060'},
  {file:'components/SiteRateCrud.vue',responses:{'/api/rates/site-rate':{items:sites.map(site=>({...site,SiteRateID:site.SiteID,PositionName:'Guard',PayrollRegularRate:100,BillingRegularRate:120}))}},rows:'.desktop-table tbody tr'},
  {file:'app/pages/attendance/shift-code/index.vue',responses:{'/api/organization/shift-code':{items:many(id=>({ShiftCodeID:id,ShiftCode:'SHIFT-'+name(id),ShiftName:'Shift '+name(id),ShiftType:'DS',Status:'Active',TimeIn:'07:00:00',TimeOut:'19:00:00',RegularHours:8,RegularOTCap:4})),agencies:[]}},rows:'.table-wrap tbody tr'},
  {file:'app/pages/attendance/holiday-manager/index.vue',responses:{'/api/attendance/holidays':{items:many(id=>({HolidayID:id,HolidayName:'Holiday '+name(id),HolidayDate:new Date(Date.UTC(new Date().getFullYear(),0,id)).toISOString().slice(0,10),HolidayType:'Legal',Recurring:0}))}},rows:'.table-wrap tbody tr'},
  {file:'app/pages/attendance/daily-time-records/index.vue',responses:{'/api/attendance/dtr':{items:sites.map(site=>({...site,BatchID:site.SiteID,AgencyID:1,AgencyName:'Agency A',ClientID:1,PeriodStart:'2026-11-01',PeriodEnd:'2026-11-15',Status:'Draft',PeopleCount:10})),agencies:[],clients:[],sites:[]}},rows:'.dtr-list-table tbody tr'},
  {file:'components/RateGroups.vue',props:{resource:'payroll-rate',items:rates,allItems:rates,agencyPositions:[],regionalRates:[{AgencyID:1,AgencyName:'Agency A',RegionID:1,RegionCode:'13',RegionName:'NCR',RegionRateID:1,RegularRate:100,CurrentRate:{RegularRate:100}}],filters:{},loading:false},responses:{},rows:'.position-table tbody tr',open:async page=>page.getByRole('button',{name:'View Agency A NCR position rates',exact:true}).click()},
  {file:'app/pages/deductions-loans/contributions/index.vue',responses:{'/api/deductions-loans/agency-contributions':{items:plans,agencies:[],positions:[],catalogItems:[]}},rows:'.plan-table tbody tr',open:async page=>{for(const selector of ['.agency-toggle','.position-toggle']){const button=page.locator(selector);await button.waitFor();if(await button.getAttribute('aria-expanded')!=='true')await button.click()}}},
  {file:'app/pages/deductions-loans/catalog/index.vue',responses:{'/api/deductions-loans/classification':{items:[{ClassificationID:1,ClassificationName:'Loans',AppliesTo:'Loan',Status:'Active'}]},'/api/deductions-loans/loan-type':{items:many(id=>({LoanTypeID:id,LoanName:'Loan '+name(id),ClassificationID:1,Status:'Active'}))},'/api/deductions-loans/deduction-type':{items:[]}},rows:'.desktop-table .subclassification-row',open:async page=>{for(const selector of ['.catalog-type-toggle','.classification-toggle']){const button=page.locator(selector).first();await button.waitFor();if(await button.getAttribute('aria-expanded')!=='true')await button.click()}}},
  {file:'app/components/BillingWorkspace.vue',props:{history:false},responses:{'/api/billing/drafts':{accounts:sites.map(site=>({AgencyID:1,AgencyName:'Agency A',ClientID:site.SiteID,ClientName:site.ClientName,profile:null})),sources:[],drafts:[],permissions:{canEdit:false}}},rows:'.client-card'},
  {file:'app/components/RefundableDeductionBalances.vue',responses:{'/api/deductions-loans/cash-bonds':{accounts:many(id=>({AccountID:id,EmployeeID:id,EmployeeName:'Employee '+name(id),DeductionName:'Cash Bond',AgencyName:'Agency A',TotalCollected:100,TotalRefunded:0,Balance:100})),entries:[],canEdit:false}},rows:'.table-wrap tbody tr'},
 ]
 try{
  for(const spec of specs){
   console.log('Checking '+spec.file)
   const page=await browser.newPage({viewport:{width:1440,height:750}}),errors=await mount(page,await fixture(spec.file),spec.props||{},spec.responses)
   if(spec.open)await spec.open(page)
   await page.waitForFunction(selector=>document.querySelectorAll(selector).length===25,spec.rows).catch(async error=>{console.log('Failed initial count',await page.locator(spec.rows).count(),await page.locator('.list-progress').allTextContents());await page.screenshot({path:path.join(out,'failed-'+path.basename(path.dirname(spec.file))+'.png')});throw error})
   const first=await page.locator(spec.rows).first().innerText()
   await page.getByRole('button',{name:'Load more',exact:true}).first().scrollIntoViewIfNeeded()
   await page.waitForFunction(selector=>document.querySelectorAll(selector).length===50,spec.rows)
   assert.equal(await page.locator(spec.rows).first().innerText(),first,spec.file+' retains earlier rows')
   if(spec.search){
    await page.locator(spec.search).fill(spec.term)
    await page.waitForFunction(selector=>document.querySelectorAll(selector).length===1,spec.rows)
    assert.ok((await page.locator(spec.rows).first().innerText()).includes(spec.term),'Search includes records not yet revealed')
    await page.locator(spec.search).fill('');await page.waitForFunction(selector=>document.querySelectorAll(selector).length===25,spec.rows).catch(async error=>{console.log('Failed initial count',await page.locator(spec.rows).count(),await page.locator('.list-progress').allTextContents());await page.screenshot({path:path.join(out,'failed-'+path.basename(path.dirname(spec.file))+'.png')});throw error})
   }
   const beforePrint=await page.locator(spec.rows).count()
   await page.emulateMedia({media:'print'});await page.waitForFunction(selector=>document.querySelectorAll(selector).length===60,spec.rows)
   await page.emulateMedia({media:'screen'});await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector:spec.rows,count:beforePrint})
   assert.deepEqual(errors,[],spec.file)
   await page.screenshot({path:path.join(out,path.basename(path.dirname(spec.file))+'-'+path.basename(spec.file,'.vue')+'.png')})
   await page.close()
  }
 }finally{await browser.close()}
})

test('server-paged screens append once, retain totals, retry safely and cancel hidden workspace reads',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LISTS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 const transactions=many(id=>({EntryType:'Loan',TransactionRecordID:id,TransactionID:'TXN-'+name(id),AccountReference:'LN-'+name(id),TransactionDate:'2026-11-15',Amount:100,BalanceBefore:200,BalanceAfter:100,Status:'Posted',PayrollStatus:'Approved',EmployeeID:id,EmployeeName:'Employee '+name(id),AgencyName:'Agency A',ItemName:'Sample loan'}))
 const requests=many(id=>({RequestID:id,EmployeeName:'Employee '+name(id),FieldLabel:'Address',Message:'Sample request',Version:1,Status:'Pending',messages:[]}))
 const pageMeta={page:1,pageSize:25,pages:3,total:60}
 const specs=[
  {file:'app/pages/deductions-loans/transactions/index.vue',responses:{'/api/deductions-loans/transactions':{items:transactions,agencies:[],summary:{Total:60,Loans:60,Deductions:0,TotalAmount:6000},pagination:pageMeta}},rows:'.receipt-table-wrap tbody tr',search:'.receipt-filters input[type="search"]'},
  {file:'app/pages/payroll/history/index.vue',responses:{'/api/payroll/history':{items:many(id=>({BatchID:id,AgencyName:'Agency A',ClientName:'Client A',SiteName:'Site '+name(id),PeriodStart:'2026-11-01',PeriodEnd:'2026-11-15',ActiveCount:1,CancelledCount:0,Gross:100,Deductions:0,Net:100,status:'Finalized'})),agencies:[],cutoffs:[],summary:{Total:60,EmployeeCount:60,Gross:6000,Deductions:0,Net:6000},pagination:pageMeta}},rows:'.table-wrap tbody tr'},
  {file:'app/components/EmployeePayslipWorkspace.vue',props:{mode:'accounts'},responses:{'/api/employees/portal-accounts':{items:many(id=>({EmployeeID:id,EmployeeNumber:'EMP-'+name(id),EmployeeName:'Employee '+name(id),Status:'Active',AgencyName:'Agency A',PortalStatus:'Active'})),canManageAccounts:true,agencies:[],accountSummary:{total:60,active:60,inactive:0,unregistered:0},pagination:pageMeta}},rows:'.employee-table tbody tr'},
  {file:'app/components/PortalRequestsAdmin.vue',responses:{'/api/employees/portal-accounts/requests':{items:requests,pagination:pageMeta}},rows:'.request-list>article'},
  {file:'app/components/EmployeeInformationPanel.vue',responses:{'/api/employee-portal/information':{fields:[],requestFields:[],requests:{items:requests,pagination:pageMeta}}},rows:'.request-inbox>.request-heading',open:async page=>page.getByRole('tab',{name:/My requests/}).click()},
 ]
 try{
  for(const spec of specs){
   console.log('Checking '+spec.file)
   const page=await browser.newPage({viewport:{width:1440,height:700}}),errors=await mount(page,await fixture(spec.file),spec.props||{},spec.responses,true)
   if(spec.open)await spec.open(page)
   await page.waitForFunction(selector=>document.querySelectorAll(selector).length===25,spec.rows).catch(async error=>{console.log('Failed initial count',await page.locator(spec.rows).count(),await page.locator('.list-progress').allTextContents());await page.screenshot({path:path.join(out,'failed-'+path.basename(path.dirname(spec.file))+'.png')});throw error})
   assert.equal(await page.evaluate(()=>window.fixtureReads.length),1,spec.file+' requests one initial batch')
   await page.evaluate(()=>window.failNext=true)
   await page.getByRole('button',{name:'Load more',exact:true}).first().scrollIntoViewIfNeeded()
   await page.getByRole('button',{name:'Retry loading',exact:true}).waitFor()
   assert.equal(await page.locator(spec.rows).count(),25,'Failure retains visible rows')
   const failedCalls=await page.evaluate(()=>window.fixtureReads.length)
   await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.fixtureReads.length),failedCalls,'No automatic retry loop')
   await page.getByRole('button',{name:'Retry loading',exact:true}).click()
   await page.waitForFunction(selector=>document.querySelectorAll(selector).length===50,spec.rows)
   if(spec.search)assert.ok((await page.locator('.summary-grid').innerText()).includes('6,000.00'),'Filtered server totals are independent of loaded-row counts')
   await page.evaluate(()=>window.delayNext=true)
   await page.getByRole('button',{name:'Load more',exact:true}).first().scrollIntoViewIfNeeded()
   await page.waitForFunction(()=>window.pendingList.length===1)
   await page.locator('.list-progress__button').first().evaluate(el=>{el.click();el.click()})
   assert.equal(await page.evaluate(()=>window.fixtureReads.filter(call=>call.query.page===3).length),1,'Concurrent triggers do not duplicate page requests')
   if(spec.search){
    await page.locator(spec.search).fill('narrow')
    assert.notEqual(await page.evaluate(()=>window.fixtureReads.at(-1).query.search),'narrow','Unsubmitted text does not change the append query')
    await page.getByRole('button',{name:'Search',exact:true}).click()
    await page.waitForFunction(selector=>document.querySelectorAll(selector).length===3,spec.rows)
    await page.evaluate(()=>window.pendingList.shift()())
    await page.waitForTimeout(100)
    assert.equal(await page.locator(spec.rows).count(),3,'A stale append cannot overwrite new search results')
    await page.locator(spec.search).fill('');await page.getByRole('button',{name:'Search',exact:true}).click()
    await page.waitForFunction(selector=>document.querySelectorAll(selector).length===25,spec.rows)
    await page.evaluate(()=>window.delayNext=true)
    await page.getByRole('button',{name:'Load more',exact:true}).first().scrollIntoViewIfNeeded()
    await page.waitForFunction(()=>window.pendingList.length===1)
   }
   const retainedCount=await page.locator(spec.rows).count()
   await page.evaluate(()=>window.screenActive.value=false)
   await page.waitForFunction(()=>window.fixtureReads.at(-1).signal.aborted)
   await page.evaluate(()=>window.pendingList.shift()())
   await page.evaluate(()=>window.screenActive.value=true)
   await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length>=count,{selector:spec.rows,count:retainedCount})
   assert.deepEqual(errors,[],spec.file)
   await page.close()
  }
 }finally{await browser.close()}
})

test('mobile directories share the same batches and keep a manual fallback in light and dark mode',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LISTS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),built=await fixture('components/OrganizationCrud.vue')
 try{
  for(const manual of [false,true]){
   const page=await browser.newPage({viewport:{width:manual?320:390,height:844},hasTouch:true,isMobile:true})
   const props={resource:'client',title:'Clients',fields:[],columns:[{key:'ClientName',label:'Client'},{key:'Status',label:'Status'}]}
   const errors=await mount(page,built,props,{'/api/organization/client':{items:many(id=>({ClientID:id,ClientName:'Client '+name(id),Status:'Active'})),canEdit:true}},manual,manual)
   await page.waitForFunction(()=>document.querySelectorAll('.mobile-list .record-card').length===25)
   const more=page.getByRole('button',{name:'Load more',exact:true})
   if(manual)await more.tap();else await more.scrollIntoViewIfNeeded()
   await page.waitForFunction(()=>document.querySelectorAll('.mobile-list .record-card').length===50)
   assert.equal(await page.locator('.desktop-table tbody tr').count(),50,'Desktop and mobile use the same batch state')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.locator('.filters input').fill('Client 060')
   await page.waitForFunction(()=>document.querySelectorAll('.mobile-list .record-card').length===1)
   await page.screenshot({path:path.join(out,manual?'clients-320-dark-fallback.png':'clients-390-light-auto.png')})
   assert.deepEqual(errors,[])
   await page.close()
  }
 }finally{await browser.close()}
})
