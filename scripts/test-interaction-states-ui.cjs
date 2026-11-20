// Real controls and synthetic responses only; no real accounts or database writes.
// INTERACTIONS_BROWSER_TEST=1 NODE_PATH=<Playwright modules> node scripts/test-interaction-states-ui.cjs
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {build}=require('esbuild'),sfc=require('@vue/compiler-sfc'),root=path.resolve(__dirname,'..'),output=path.join(root,'.data/interaction-states-tests')
async function fixture(accounts=false){
 const styles=['base','theme','components','auth','dashboard','payroll-processing','interactions'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8'))
 const dashboard=fs.readFileSync(path.join(root,'app/pages/dashboard/index.vue'),'utf8'),start=dashboard.indexOf('<button type="button" class="dash-icon-btn"'),themeButton=dashboard.slice(start,dashboard.indexOf('</button>',start)+9)
 const source=accounts?`<script setup>
 import Accounts from './app/pages/deductions-loans/employees/index.vue';
 </script><template><div class="page dash-page"><Accounts class="dash-workspace-page"/></div></template>`:`<script setup>
 import{ref,watchEffect}from'vue';import{provideAppTheme}from'./app/composables/useAppTheme';
 import Settings from './app/pages/settings/index.vue';import Bell from './app/components/NotificationBell.vue';import DateField from './components/ModernDateField.vue';import ImportReport from './app/components/DtrImportResultModal.vue';
 const {isDark}=provideAppTheme(),date=ref('2026-11-20'),report=ref(null),clicks=ref(0);window.interactionQa={isDark,clicks};watchEffect(()=>document.documentElement.dataset.theme=isDark.value?'dark':'light');
 </script><template><div class="page dash-page" :data-theme="isDark?'dark':'light'">
 <header class="dash-topbar"><div class="dash-topbar__right">${themeButton}<Bell/></div></header>
 <main class="dash-content"><Settings class="dash-workspace-page"/>
 <section class="interaction-samples"><h2>Shared controls</h2><a href="#" class="app-button" id="shared-action" @click.prevent="clicks++">Shared action</a><button class="app-button" id="shared-disabled" disabled @click="clicks++">Disabled action</button><button class="auth-submit" id="auth-disabled" disabled @click="clicks++">Disabled sign in</button><a href="#" class="app-button" id="aria-disabled" aria-disabled="true" @click.prevent>Unavailable link</a><button class="app-button" id="busy-action" aria-busy="true">Working</button><button class="app-button" id="show-report" @click="report={updated:3,reviewRows:[]}">Show import report</button><DateField v-model="date" label="Review date" :responsive="true"/><details><summary>Import rules</summary><p>Additional instructions.</p></details></section>
 </main><ImportReport :result="report" file-name="sample.xlsx" @close="report=null" @done="report=null"/></div></template>
 <style>.interaction-samples{display:flex;flex-wrap:wrap;align-items:start;gap:14px;padding:24px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.interaction-samples h2{width:100%;margin:0}.interaction-samples .auth-submit{margin:0}.interaction-samples details{width:100%}</style>`
 function compile(code,filename,resolveDir){
  if(filename.replaceAll('\\','/').endsWith('/deductions-loans/employees/index.vue')){
   code=code.replace('<script setup lang="ts">','<script setup lang="ts">\nimport {ref,reactive,computed,watch,onMounted} from "vue";')
  }
  const {descriptor,errors}=sfc.parse(code,{filename});assert.deepEqual(errors,[])
  const id='data-v-'+crypto.createHash('sha1').update(filename).digest('hex').slice(0,8)
  const script=descriptor.script||descriptor.scriptSetup?sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'}):{content:sfc.compileTemplate({source:descriptor.template.content,filename,id}).code.replace('export function render','function render')+';const Component={render}'}
  for(const style of descriptor.styles){const result=sfc.compileStyle({source:style.content,filename,id,scoped:style.scoped});assert.deepEqual(result.errors,[]);styles.push(result.code)}
  return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir}
 }
 const result=await build({stdin:{resolveDir:root,contents:"import{createApp}from'vue';import App from'interaction-fixture';createApp(App).mount('#app')"},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'controls',setup(build){
  build.onResolve({filter:/^interaction-fixture$/},()=>({path:'interactions.vue',namespace:'qa'}))
  build.onLoad({filter:/.*/,namespace:'qa'},args=>compile(source,args.path,root))
  build.onLoad({filter:/\.vue$/},args=>compile(fs.readFileSync(args.path,'utf8'),args.path,path.dirname(args.path)))
 }}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}
async function mount(page,built){
 await page.route('https://**/*',route=>route.abort())
 await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${built.css}</style></head><body><div id="app"></div></body></html>`)
 await page.evaluate(()=>{
  window.writes=[]
  window.$fetch=async(url,options={})=>{
   if(options.method){window.writes.push(url);throw new Error('Unexpected write in visual QA')}
   if(url==='/api/auth/me')return{user:{id:1,firstName:'Sample',lastName:'User',email:'sample@example.invalid',userType:'Admin',gender:'Female',image:null,departmentId:1}}
   if(url==='/api/settings/access')return{isAdmin:true,modules:[],access:{}}
   if(url==='/api/settings/users')return{users:[{id:1,name:'Sample User',email:'sample@example.invalid',role:'Admin',status:'Active',departmentId:1,image:null,access:{}}],departments:[{id:1,name:'Test Department',status:'Active'}]}
   if(url==='/api/settings/backups')return{backups:[],automatic:false}
   if(url==='/api/auth/departments')return{departments:[]}
   if(url==='/api/notifications')return{items:[],unreadCount:0,generatedAt:new Date().toISOString()}
   throw new Error('Unexpected fixture request '+url)
  }
 })
 await page.addScriptTag({content:built.script})
 await page.getByRole('button',{name:'Edit profile',exact:true}).waitFor()
}
const paint=locator=>locator.evaluate(el=>{const css=getComputedStyle(el);return{background:css.backgroundColor,color:css.color,border:css.borderColor,shadow:css.boxShadow,filter:css.filter}})
async function rest(page,locator){await locator.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(220)}
async function feedback(page,locator,{clickAfter,stationary=false,noFill=false}={}){
 await rest(page,locator);const normal=await paint(locator),base=await locator.boundingBox()
 await locator.hover();await page.waitForTimeout(220)
 const hover=await paint(locator);assert.notDeepEqual(hover,normal,'Hover must be visible: '+await locator.innerText())
 const hovered=await locator.boundingBox();assert.equal(hovered.width,base.width);assert.equal(hovered.height,base.height)
 await page.mouse.down();await page.waitForTimeout(90)
 const pressed=await paint(locator);assert.notDeepEqual(pressed,hover,'Pressed feedback differs from hover')
 if(noFill){
  assert.equal(normal.shadow,'none','Text tabs have no baseline shadow')
  for(const state of [hover,pressed]){
   assert.equal(state.shadow,'none','Text tabs must not gain a rectangular shadow')
   assert.equal(state.background,normal.background,'Text tabs must not gain a filled rectangle')
  }
  assert.equal(await locator.evaluate(el=>el.matches(':focus-visible')),false,'Mouse presses do not show a keyboard focus ring')
 }
 if(stationary){const pressedBox=await locator.boundingBox();assert.equal(pressedBox.x,base.x);assert.equal(pressedBox.y,base.y)}
 await page.mouse.up();if(clickAfter)await clickAfter()
}
test('shared interactions cover actual controls, keyboard, disabled/busy states, touch and motion preferences',{skip:process.env.INTERACTIONS_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),built=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.INTERACTIONS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await mount(page,built)
  for(const dark of [false,true]){
   await page.evaluate(value=>window.interactionQa.isDark.value=value,dark)
   await feedback(page,page.getByRole('button',{name:'Edit profile',exact:true}),{clickAfter:async()=>{const modal=page.getByRole('dialog',{name:'Edit profile',exact:true});await modal.waitFor();await modal.getByRole('button',{name:'Cancel',exact:true}).click()}})
   const teamTab=page.getByRole('button',{name:'Team access',exact:true})
   await feedback(page,teamTab,{noFill:true})
   await page.getByRole('button',{name:'Add department',exact:true}).waitFor()
   assert.ok(await teamTab.evaluate(el=>parseFloat(getComputedStyle(el).borderBottomWidth)>0),'Selected tab retains its underline')
   await page.screenshot({path:path.join(output,`tabs-${dark?'dark':'light'}.png`)})
   await feedback(page,page.getByRole('button',{name:'Add department',exact:true}),{clickAfter:async()=>page.getByRole('button',{name:'Cancel',exact:true}).click()})
   await page.getByRole('button',{name:'My account',exact:true}).click()
   await feedback(page,page.getByRole('button',{name:'Notifications',exact:true}),{clickAfter:async()=>page.keyboard.press('Escape')})
   // Native calendar selection does not move the target while pressing it.
   await page.locator('.modern-date-field__trigger').click()
   const calendar=page.getByRole('dialog',{name:'Review date calendar',exact:true})
   await feedback(page,calendar.getByRole('button',{name:'Next month',exact:true}),{stationary:true})
   await page.keyboard.press('Escape')
   await page.locator('#show-report').click()
   const report=page.getByRole('dialog',{name:'Import completed',exact:true});await report.waitFor()
   await feedback(page,report.getByRole('button',{name:'Done review',exact:true}))
   await report.waitFor({state:'hidden'})
   for(const id of ['shared-disabled','auth-disabled','aria-disabled','busy-action']){
    const control=page.locator('#'+id);await rest(page,control);const baseline=await paint(control),geometry=await control.boundingBox()
    await control.hover({force:true});await page.waitForTimeout(220)
    assert.deepEqual(await paint(control),baseline,id+' must not react as an available action')
    assert.deepEqual(await control.boundingBox(),geometry,id+' must not lift')
   }
   // Real keyboard navigation exposes a visible outline, without changing layout.
   const action=page.locator('#shared-action');await action.scrollIntoViewIfNeeded();await page.locator('#busy-action').focus()
   await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab')
   // Skip the ARIA-disabled link and focus the shared action using the keyboard.
   await page.keyboard.press('Shift+Tab')
   await action.focus();const focus=await action.evaluate(el=>({visible:el.matches(':focus-visible'),style:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}))
   assert.equal(focus.visible,true);assert.notEqual(focus.style,'none');assert.ok(focus.width>=2)
   await page.screenshot({path:path.join(output,`keyboard-${dark?'dark':'light'}.png`),fullPage:true})
   const before=await page.evaluate(()=>window.interactionQa.clicks.value);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.interactionQa.clicks.value),before+1)
  }
  await page.emulateMedia({reducedMotion:'reduce'})
  const action=page.locator('#shared-action');await rest(page,action);await action.hover();await page.waitForTimeout(30)
  assert.equal(await action.evaluate(el=>getComputedStyle(el).transform),'none')
  const edit=page.getByRole('button',{name:'Edit profile',exact:true});await edit.hover();await page.mouse.down();assert.equal(await edit.evaluate(el=>getComputedStyle(el).translate),'none');await page.mouse.up();await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.emulateMedia({reducedMotion:'no-preference'})
  // The interaction layer is screen-only and does not tint print output.
  await action.hover();await page.emulateMedia({media:'print'});assert.equal(await action.evaluate(el=>getComputedStyle(el).filter),'none');await page.emulateMedia({media:'screen'})
  const touch=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});touch.on('pageerror',error=>errors.push(error.message));await mount(touch,built)
  assert.equal(await touch.evaluate(()=>matchMedia('(hover: hover)').matches),false)
  await touch.locator('#shared-action').tap();await touch.waitForTimeout(220)
  const touchStyle=await touch.locator('#shared-action').evaluate(el=>({filter:getComputedStyle(el).filter,transform:getComputedStyle(el).transform}))
  assert.equal(touchStyle.filter,'none')
  assert.equal(await touch.locator('#shared-action').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity),true,'No sticky hover elevation after a tap')
  assert.equal(await touch.evaluate(()=>window.interactionQa.clicks.value),1)
  const client=await touch.context().newCDPSession(touch),touchBox=await touch.locator('#shared-action').boundingBox()
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBox.x+touchBox.width/2,y:touchBox.y+touchBox.height/2}]})
  await touch.waitForTimeout(220)
  assert.notEqual(await touch.locator('#shared-action').evaluate(el=>getComputedStyle(el).webkitTapHighlightColor),'rgba(0, 0, 0, 0)','Touch browsers retain native tap feedback')
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await touch.waitForTimeout(220)
  assert.equal(await touch.evaluate(()=>window.interactionQa.clicks.value),2,'Touch handlers fire once per tap')
  assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.deepEqual(await page.evaluate(()=>window.writes),[]);assert.deepEqual(await touch.evaluate(()=>window.writes),[]);assert.deepEqual(errors,[])
 }finally{await browser.close()}
})

test('employee account filters and nested modal actions stay still and respond once per click',{skip:process.env.INTERACTIONS_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),built=await fixture(true),browser=await chromium.launch({headless:true,executablePath:process.env.INTERACTIONS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 fs.mkdirSync(output,{recursive:true})
 try{
  for(const dark of [false,true]){
   const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   await page.route('https://**/*',route=>route.abort())
   await page.setContent(`<html data-theme="${dark?'dark':'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${built.css}</style></head><body><div id="app"></div></body></html>`)
   await page.evaluate(()=>{
    window.accountCalls=[];window.accountClicks=[];window.tabTransitions=[]
    document.addEventListener('click',event=>{const button=event.target.closest('button');if(button)window.accountClicks.push(button.textContent.trim())})
    document.addEventListener('transitionrun',event=>{if(event.target.matches('button[role="tab"]'))window.tabTransitions.push(event.propertyName)})
    const employee={EmployeeID:1,EmployeeNumber:'TEST-01',EmployeeName:'SAMPLE EMPLOYEE',AgencyName:'Test Agency',PositionName:'Test Position',ActiveLoanCount:1,ActiveDeductionCount:1,TotalIssued:2000,OutstandingBalance:2000}
    const records=['Loan','Deduction'].map((EntryType,index)=>({EntryType,RecordID:index+1,AccountReference:'TEST',IssuanceCode:'TEST-'+index,IssuanceDate:'2026-11-01',ItemName:'Sample '+EntryType,Status:'Active',OriginalAmount:1000,OutstandingAmount:1000,RepaymentPeriods:1,RepaymentCutoff:'Second',RepaymentStartDate:'2026-11-01',RepaymentEndDate:'2026-11-30',InstallmentAmount:1000,FinalInstallmentAmount:1000,PlanStatus:'Active',RepaymentSchedule:[],Transactions:[]}))
    window.$fetch=async(url,options={})=>{
     window.accountCalls.push({url,method:options.method||'GET'})
     if(options.method)throw new Error('Unexpected write in account UI QA')
     if(url==='/api/deductions-loans/employee-records')return options.query?.employeeId?{employee,records}:{items:[employee],pagination:{page:1,pageSize:25,total:1,pages:1},agencies:[],catalogItems:[]}
     if(url==='/api/deductions-loans/agency-contributions/history')return{items:[]}
     if(url==='/api/deductions-loans/cash-bonds')return{accounts:[],entries:[],canEdit:false}
     throw new Error('Unexpected fixture request '+url)
    }
   })
   await page.addScriptTag({content:built.script})
   await page.locator('.desktop-list').getByRole('button',{name:'View profile',exact:true}).click()
   const modal=page.getByRole('dialog',{name:'Employee accounts',exact:true});await modal.waitFor()
   await modal.locator('.record-card').first().waitFor()
   const initialCalls=await page.evaluate(()=>window.accountCalls.length)
   async function steadyClick(button){
    await button.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(180)
    const box=await button.boundingBox()
    await button.hover();await page.waitForTimeout(180)
    assert.deepEqual(await button.boundingBox(),box,'Hover must not lift account controls')
    await page.mouse.down();await page.waitForTimeout(90)
    assert.deepEqual(await button.boundingBox(),box,'Pressed controls must not bounce')
    const before=await page.evaluate(()=>window.accountClicks.length)
    await page.mouse.up();await page.waitForTimeout(180)
    assert.equal(await page.evaluate(()=>window.accountClicks.length),before+1,'One click dispatches one action')
   }
   for(const name of ['Archive','Active','All']){
    const list=modal.getByRole('tablist',{name:'Choose issuance status'})
    await steadyClick(list.getByRole('tab',{name:new RegExp(name+' ')}))
    assert.equal(await list.locator('[aria-selected="true"]').count(),1)
    assert.ok((await list.locator('[aria-selected="true"]').innerText()).includes(name))
   }
   for(const name of ['Loan','Deduction','Contributions & Others','All']){
    const list=modal.locator('.type-tabs')
    await steadyClick(list.getByRole('tab',{name:new RegExp(name+' ')}))
    assert.equal(await list.locator('[aria-selected="true"]').count(),1)
   }
   assert.deepEqual(await page.evaluate(()=>window.tabTransitions.filter(property=>property!=='filter')),[],'Selected colors and shadows do not animate across multiple tabs')
   assert.equal(await page.evaluate(()=>window.accountCalls.filter(call=>call.url==='/api/deductions-loans/employee-records').length),2,'Filters do not reload the profile repeatedly')
   const card=modal.locator('.record-card').first(),planButton=card.getByRole('button',{name:'View repayment plan',exact:true})
   await planButton.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(200)
   const cardBox=await card.boundingBox()
   await planButton.hover();await page.waitForTimeout(200)
   assert.deepEqual(await card.boundingBox(),cardBox,'A nested action must not lift its parent card')
   await steadyClick(planButton)
   const plan=page.locator('.plan-modal');await plan.waitFor();await steadyClick(plan.getByRole('button',{name:'Close',exact:true}).last());await plan.waitFor({state:'hidden'})
   await steadyClick(modal.getByRole('button',{name:'+ Add issuance',exact:true}))
   const issuance=page.locator('.issuance-modal');await issuance.waitFor();await steadyClick(issuance.getByRole('button',{name:'Cancel',exact:true}));await issuance.waitFor({state:'hidden'})
   await steadyClick(modal.locator('.clear-history'))
   await page.mouse.move(0,0)
   await page.screenshot({path:path.join(output,`accounts-${dark?'dark':'light'}.png`)})
   await page.emulateMedia({reducedMotion:'reduce'})
   assert.ok(await modal.locator('.scope-filter').first().evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration)<=.00001),'Reduced motion keeps filters still')
   assert.ok(initialCalls>=3)
   assert.equal(await page.evaluate(()=>window.accountCalls.some(call=>call.method!=='GET')),false)
   assert.deepEqual(errors,[])
   await page.close()
  }
 }finally{await browser.close()}
})
