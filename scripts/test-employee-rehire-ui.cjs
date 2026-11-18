// Real Vue components with synthetic HTTP. Does not sign in or modify real records.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const sfc=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),styles=[],output=path.join(root,'.data/employee-rehire-tests')
fs.mkdirSync(output,{recursive:true})
;(async()=>{
 const bundle=await build({stdin:{resolveDir:root,contents:"import{createApp}from'vue';import Page from './app/pages/employees/index.vue';createApp(Page).mount('#app')"},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'vue-fixture',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  if(!args.path.endsWith(path.join('employees','index.vue'))&&!args.path.endsWith('EmployeeRehireModal.vue')&&!args.path.endsWith('ModernDateField.vue')&&!args.path.endsWith('EmployeeActions.vue'))return{contents:'export default {render(){return null}}',loader:'js'}
  const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
  const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
  const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
  for(const style of descriptor.styles)styles.push(sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code)
  return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
 })}}]})
 const browser=await chromium.launch({headless:true,executablePath:process.env.EMPLOYEE_STATUS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const css=['base','theme','components','auth','dashboard'].map(name=>fs.readFileSync(path.join(root,'assets/css/'+name+'.css'),'utf8')).join('\n')
  await page.setContent(`<html><head><style>${css}\n${styles.join('\n')}</style></head><body><div id="app"></div></body></html>`)
  await page.evaluate(()=>{
   window.posts=[];window.viewer=false;window.failLoad=true;window.failSave=false;window.hold=false
   const positions=[{AgencyPositionID:1,AgencyID:1,AgencyName:'Original agency',PositionName:'Guard'},{AgencyPositionID:2,AgencyID:1,AgencyName:'Original agency',PositionName:'Supervisor'},{AgencyPositionID:3,AgencyID:2,AgencyName:'Return agency',PositionName:'Guard'}]
   const employees=[{EmployeeID:7,FirstName:'Test',LastName:'Active',AgencyPositionID:1,AgencyID:1,PositionID:1,Status:'Active',DateHired:'2020-01-01',DeploymentStatus:'Unassigned'},{EmployeeID:8,FirstName:'Test',LastName:'Returned',AgencyPositionID:1,AgencyID:1,PositionID:1,Status:'Inactive',DateHired:'2020-01-01',ResignationDate:'2026-10-20',LastRehireDate:null,DeploymentStatus:'Unassigned'},{EmployeeID:9,FirstName:'Legacy',LastName:'Resigned',AgencyPositionID:1,AgencyID:1,PositionID:1,Status:'Inactive',DateHired:'2020-01-01',ResignationDate:null,LastRehireDate:null,DeploymentStatus:'Unassigned'}]
   const history=[]
   window.$fetch=async(url,options)=>{
    if(url.endsWith('/employment-history')){
     if(window.failLoad){window.failLoad=false;throw{data:{statusMessage:'Temporary history load failure.'}}}
     const e=employees.find(e=>e.EmployeeID===Number(url.split('/')[3]))
     const pos=positions.find(p=>p.AgencyPositionID===e.AgencyPositionID)
     return{employee:{...e,EmployeeName:e.FirstName+' '+e.LastName,AgencyName:pos.AgencyName,PositionName:pos.PositionName},positions,history:history.filter(h=>h.EmployeeID===e.EmployeeID),permissions:{canRehire:!window.viewer&&e.Status==='Inactive'}}
    }
    if(options?.method==='POST'&&url.endsWith('/rehire')){
     window.posts.push(options.body)
     if(window.failSave)throw{data:{statusMessage:'Employment details changed. Refresh employment history before saving.'}}
     if(window.hold)await new Promise(resolve=>window.finish=resolve)
     const e=employees.find(e=>e.EmployeeID===Number(url.split('/')[3])),body=options.body,target=positions.find(p=>p.AgencyPositionID===body.AgencyPositionID)
     history.push({RehireID:history.length+1,EmployeeID:e.EmployeeID,PreviousStartDate:e.DateHired,ResignationDate:e.ResignationDate||body.ResignationDate,RehireDate:body.RehireDate,PreviousAgencyName:'Original agency',PreviousPositionName:'Guard',AgencyName:target.AgencyName,PositionName:target.PositionName,Reason:body.Reason,CreatedByName:'Test reviewer',CreatedAt:'2026-11-18 10:00:00'})
     Object.assign(e,{Status:'Active',LastRehireDate:body.RehireDate,ResignationDate:null,AgencyPositionID:target.AgencyPositionID,AgencyID:target.AgencyID})
     return{success:true}
    }
    return{items:employees.map(e=>({...e})),agencies:[{AgencyID:1,AgencyName:'Original agency'},{AgencyID:2,AgencyName:'Return agency'}],positions:[],agencyPositions:[]}
   }
  })
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.waitForTimeout(200)
  if(errors.length)throw Error(errors.join('; '))
  await page.getByLabel('Employment status',{exact:true}).selectOption('Inactive')
  await page.waitForFunction(()=>document.querySelectorAll('.employee-table tbody tr').length===2)
  const badge=page.locator('.employee-table .status--inactive').first()
  assert.equal(await badge.textContent(),'Resigned')
  assert.equal(await badge.evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap')
  assert.equal(await badge.evaluate(el=>el.getBoundingClientRect().right<=el.closest('td').getBoundingClientRect().right),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  // Every action must remain inside the visible table, including its right edge.
  for(const width of [1920,1440,1100]){
   await page.setViewportSize({width,height:1000})
   for(const scrollEnd of [false,true]){
    await page.locator('.employee-table-wrap').evaluate((el,end)=>{el.scrollLeft=end?el.scrollWidth:0},scrollEnd)
    const actions=await page.locator('.employee-table tbody tr').first().locator('.employee-actions__button').evaluateAll(buttons=>buttons.map(button=>{
     const rect=button.getBoundingClientRect(),wrap=button.closest('.employee-table-wrap').getBoundingClientRect()
     return{label:button.getAttribute('aria-label'),top:rect.top,inside:rect.left>=wrap.left&&rect.right<=wrap.right&&rect.width>=32,hasIcon:!!button.querySelector('svg')}
    }))
    assert.equal(actions.length,2)
    assert.equal(actions[0].top,actions[1].top,'Edit and More stay on one line')
    assert.ok(actions.every(action=>action.inside&&action.hasIcon),JSON.stringify({width,scrollEnd,actions}))
   }
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.locator('.employee-table-wrap').evaluate(el=>{el.scrollLeft=0})
  await page.screenshot({path:path.join(output,'employee-status-desktop.png')})
  const row=page.locator('.employee-table tr').filter({hasText:'EMP-0008'})
  const more=row.getByRole('button',{name:'More employee actions',exact:true})
  const menu=page.getByRole('menu')
  await more.press('ArrowDown')
  await menu.waitFor()
  assert.equal(await more.getAttribute('aria-expanded'),'true')
  assert.equal(await menu.getByRole('menuitem').count(),5)
  assert.equal(await menu.getByRole('menuitem',{name:'Transfer to another agency',exact:true}).isDisabled(),true)
  assert.equal(await menu.getByRole('menuitem',{name:'Deactivate / resign employee',exact:true}).isDisabled(),true)
  await menu.press('End')
  assert.equal(await menu.getByRole('menuitem',{name:'Delete permanently',exact:true}).evaluate(el=>el===document.activeElement),true)
  await menu.press('ArrowDown')
  assert.equal(await menu.getByRole('menuitem',{name:'Change position / history',exact:true}).evaluate(el=>el===document.activeElement),true)
  await menu.press('ArrowUp')
  assert.equal(await menu.getByRole('menuitem',{name:'Delete permanently',exact:true}).evaluate(el=>el===document.activeElement),true)
  await menu.press('Escape')
  assert.equal(await more.evaluate(el=>el===document.activeElement),true)
  await more.click()
  await page.getByRole('heading',{name:'Employee List',exact:true}).click()
  await menu.waitFor({state:'hidden'})
  await more.click()
  await menu.getByRole('menuitem',{name:'Delete permanently',exact:true}).click()
  const deleteDialog=page.getByRole('alertdialog')
  await deleteDialog.waitFor()
  await deleteDialog.getByRole('button',{name:'No',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.posts.length),0)
  await more.click()
  await page.screenshot({path:path.join(output,'employee-more-desktop.png')})
  await menu.getByRole('menuitem',{name:'Rehire employee',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Employment history & rehire'})
  await modal.getByRole('button',{name:'Retry',exact:true}).click()
  await modal.getByRole('heading',{name:'Rehire this employee'}).waitFor()
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden')
  assert.equal(await modal.getByLabel('Return agency',{exact:true}).inputValue(),'1')
  assert.equal(await modal.getByLabel('Return position',{exact:true}).inputValue(),'1')
  await modal.getByLabel('Return agency',{exact:true}).selectOption('2')
  assert.equal(await modal.getByLabel('Return position',{exact:true}).inputValue(),'')
  await modal.getByLabel('Return position',{exact:true}).selectOption('3')
  await modal.getByLabel('Return date',{exact:true}).fill('2026-11-10')
  await modal.getByLabel('Reason / reference').fill('Confirmed return with new agency')
  await page.evaluate(()=>window.failSave=true)
  await modal.getByRole('button',{name:'Confirm rehire',exact:true}).click()
  await modal.getByRole('alert').waitFor()
  assert.match(await modal.getByRole('alert').textContent(),/Employment details changed/)
  assert.equal(await modal.getByLabel('Reason / reference').inputValue(),'Confirmed return with new agency')
  await page.evaluate(()=>{window.failSave=false;window.hold=true})
  await modal.getByRole('button',{name:'Confirm rehire',exact:true}).click()
  await page.waitForFunction(()=>window.finish)
  assert.equal(await modal.getByRole('button',{name:'Saving rehire...',exact:true}).isDisabled(),true)
  await modal.press('Escape');assert.equal(await modal.isVisible(),true)
  assert.equal(await page.evaluate(()=>window.posts.length),2)
  await page.evaluate(()=>window.finish())
  await modal.getByText('Recorded returns',{exact:true}).waitFor()
  await modal.getByText('Returned 2026-11-10',{exact:false}).waitFor()
  assert.equal(await modal.getByRole('button',{name:'Confirm rehire',exact:true}).count(),0)
  const body=await page.evaluate(()=>window.posts[1]);assert.equal(body.AgencyPositionID,3);assert.equal(body.ExpectedResignationDate,'2026-10-20');assert.equal(body.ExpectedLastRehireDate,null)
  await page.evaluate(()=>document.documentElement.dataset.theme='dark')
  await page.screenshot({path:path.join(output,'rehire-history-dark.png')})
  await modal.getByRole('button',{name:'Close',exact:true}).click()
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  await page.getByLabel('Employment status',{exact:true}).selectOption('Active')
  await page.locator('.employee-table').getByText('Returned 2026-11-10',{exact:true}).waitFor()
  await page.getByLabel('Employment status',{exact:true}).selectOption('Inactive')
  await page.setViewportSize({width:390,height:844})
  const mobileMore=page.locator('.employee-card').getByRole('button',{name:'More employee actions',exact:true})
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844})
   await mobileMore.click()
   assert.equal(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),true)
   assert.equal(await menu.getByRole('menuitem',{name:'Delete permanently',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44),true)
   await page.screenshot({path:path.join(output,`employee-more-mobile-${width}.png`)})
   await menu.press('Escape')
  }
  await mobileMore.click()
  await menu.getByRole('menuitem',{name:'Rehire employee',exact:true}).click()
  await modal.getByLabel('Previous resignation date',{exact:false}).waitFor()
  assert.equal(await modal.getByRole('button',{name:'Confirm rehire',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(output,'rehire-legacy-mobile.png')})
  await modal.getByRole('button',{name:'Close',exact:true}).click()
  await page.evaluate(()=>window.viewer=true)
  await mobileMore.click()
  await menu.getByRole('menuitem',{name:'Rehire employee',exact:true}).click()
  await modal.getByText('Rehiring requires Employees edit access.',{exact:false}).waitFor()
  assert.equal(await modal.getByRole('button',{name:'Confirm rehire',exact:true}).count(),0)
  await modal.press('Escape');await modal.waitFor({state:'hidden'})
  assert.deepEqual(errors,[])
  console.log('PASS: Edit/More desktop and mobile actions, keyboard and outside dismissal, delete confirmation, desktop badge/filter, same/different agency options, failed-load retry, retained errors, single submit, audited success, legacy date, Viewer read-only, dark mode and mobile width.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
