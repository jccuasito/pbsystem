// Synthetic browser fixtures only. No live accounts, invoices or payroll writes.
// NODE_PATH must expose Playwright. BILLING_BROWSER_PATH optionally selects Chromium.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {parse,compileScript,compileStyle}=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),styles=[]
async function fixture(){return (await build({stdin:{contents:`import{createApp}from'vue';import Billing from './app/components/BillingWorkspace.vue';import{defaultBillingProfile,profileBillingLines}from'./shared/utils/billingProfile';import{calculateBillingDraft}from'./shared/utils/billingDraft';window.billingTools={defaultBillingProfile,profileBillingLines,calculateBillingDraft};let app;window.mountBilling=(history=false)=>{app?.unmount();app=createApp(Billing,{history});app.mount('#app')};window.mountBilling();`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'billing-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  const {descriptor}=parse(fs.readFileSync(args.path,'utf8'),{filename:args.path}),id='data-v-'+require('node:crypto').createHash('sha1').update(args.path).digest('hex').slice(0,8)
  const script=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
  for(const style of descriptor.styles)styles.push(compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code)
  return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
})}}]})).outputFiles[0].text}
const globalCss=['base','theme','components','dashboard','payroll-processing'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8')).join('\n')
;(async()=>{
 const bundle=await fixture()
 const browser=await chromium.launch({headless:true,executablePath:process.env.BILLING_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{for(const width of [1918,1366,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1100}}),errors=[]
  page.setDefaultTimeout(10000)
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.setContent(`<html><head><style>${globalCss}\n${styles.join('\n')}\nbody{background:#f7f9fc;font-family:Arial,sans-serif}</style></head><body><div id="app"></div></body></html>`)
  await page.evaluate(()=>{
   window.calls=[];window.printCalls=0;window.print=()=>{window.printCalls++;window.wasPrintClass=document.body.classList.contains('printing-billing-draft')}
   const accounts=[{AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',profile:null},{AgencyID:1,AgencyName:'Agency A',ClientID:2,ClientName:'Client B',profile:null}]
   const sources=[{BatchID:1,AgencyID:1,ClientID:1,SiteID:1,SiteName:'North Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',PeopleCount:1},{BatchID:2,AgencyID:1,ClientID:1,SiteID:2,SiteName:'South Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',PeopleCount:1}]
   const drafts=[];let stored=null
   const source=()=>{
    const config=accounts[0].profile.config
    const people=sources.map((item,i)=>({employeeId:i+1,name:'Synthetic Employee '+(i+1),type:i?'Reliever':'Regular',SiteName:item.SiteName,siteName:item.SiteName,PositionName:'Guard',workedDays:2,regularHours:16,otHours:4,nightHours:2,extensionHours:0,components:[{code:'RegularHours',hours:16},{code:'OTHours',hours:4},{code:'NightDiffHours',hours:2}],billingRate:{RegularRate:100,OTRate:120,NightDiffRate:10}}))
    return{batch:{BatchID:1,BatchIDs:[1,2],AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',SiteID:null,SiteName:'North Site, South Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'},lines:window.billingTools.profileBillingLines(people,config),employees:people,workedDays:4,settings:{...config.settings,retirementQuantity:4,uniformQuantity:4},profile:config,profileRevision:1,sourceHash:'fixture-hash',warnings:[]}
   }
   window.$fetch=async(url,options={})=>{
    window.calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(JSON.stringify(options.body)):null})
    await new Promise(resolve=>setTimeout(resolve,80))
    if(!accounts[0].profile&&window.billingTools){const config=window.billingTools.defaultBillingProfile();config.mode='client';config.rules.forEach(rule=>rule.enabled=['RegularHours','OTHours','NightDiffHours'].includes(rule.code));accounts[0].profile={revision:1,config}}
    if(url==='/api/billing/profiles'){
     if(window.failSetup){window.failSetup=false;throw{data:{statusMessage:'Simulated setup save failure'}}}
     const account=accounts.find(item=>item.ClientID===options.body.clientId);account.profile={revision:1,config:options.body.config};return{success:true,revision:1}
    }
    if(options.method==='POST'){
     const original=source(),body=options.body,totals=window.billingTools.calculateBillingDraft(body.lines,body.settings)
     stored={source:original.source,profile:original.profile,profileRevision:1,sourceHash:body.sourceHash,lines:body.lines,settings:body.settings,totals,billingDate:body.billingDate,notes:body.notes,employees:original.employees,warnings:[]}
     const revision=(drafts[0]?.Revision||0)+1
     drafts.splice(0,drafts.length,{BillingID:7,AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',SiteName:'North Site, South Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',Status:'Draft',Revision:revision,TotalAmount:totals.totalDue})
     sources.forEach(item=>item.BillingID=7);return{success:true,billingId:7,revision}
    }
    if(url==='/api/billing/drafts/preview')return{source:source(),draft:null,history:[],permissions:{canEdit:true}}
    if(url==='/api/billing/drafts/7')return{source:source(),draft:{billingId:7,revision:drafts[0].Revision,sourceHash:'fixture-hash',snapshot:stored},history:[{Revision:1,ActorName:'Synthetic Billing Officer',CreatedAt:'2026-10-03'}],permissions:{canEdit:true}}
    return JSON.parse(JSON.stringify({accounts,sources,drafts,permissions:{canEdit:true}}))
   }
  })
  await page.addScriptTag({content:bundle})
  await page.getByRole('button',{name:'Client A',exact:false}).first().waitFor()
  const clients=page.locator('.client-card')
  await page.screenshot({path:path.join(root,`.data/billing-clients-${width}.png`),fullPage:true})
  await clients.nth(1).getByRole('button',{name:'Set up billing',exact:true}).click()
  const setup=page.locator('.billing-setup')
  const regular=setup.getByRole('switch',{name:'Bill RegularHours',exact:true})
  await regular.click();assert.equal(await regular.getAttribute('aria-checked'),'true')
  assert.ok((await regular.boundingBox()).width<45,'Switch must not stretch under global input CSS')
  await setup.getByLabel(/^Invoice scope/).selectOption('site')
  await setup.getByLabel(/Hours per billing day/).fill('12')
  await setup.getByLabel('RegularHours unit',{exact:true}).selectOption('day')
  await setup.getByLabel('RegularHours hours per unit',{exact:true}).fill('12')
  await setup.getByLabel('RegularHours pricing',{exact:true}).selectOption('fixed')
  await setup.getByLabel('RegularHours contract rate',{exact:true}).fill('1200')
  await page.screenshot({path:path.join(root,`.data/billing-client-setup-${width}.png`),fullPage:true})
  await page.evaluate(()=>window.failSetup=true)
  await setup.getByRole('button',{name:'Save client setup',exact:true}).click()
  await setup.getByRole('alert').waitFor();assert.equal(await regular.getAttribute('aria-checked'),'true')
  await setup.getByRole('button',{name:'Save client setup',exact:true}).click()
  await setup.waitFor({state:'hidden'})
  await clients.first().locator('.client-toggle').click()
  const checks=clients.first().getByRole('checkbox')
  await checks.nth(0).click();await checks.nth(1).click()
  await clients.first().getByRole('button',{name:'Review selected bill',exact:true}).click()
  const modal=page.locator('.billing-draft-dialog')
  await modal.waitFor();assert.equal(await modal.locator('.invoice-table tbody tr').count(),3)
  await modal.getByRole('button',{name:'Finalized payroll',exact:true}).click()
  assert.equal(await modal.locator('.source-table tbody tr').count(),2)
  assert.match(await modal.locator('.source-table tbody').textContent(),/Reliever/)
  await modal.getByRole('button',{name:'Saved revisions',exact:true}).click()
  assert.match(await modal.locator('.modal-content').textContent(),/not been saved/)
  await modal.getByRole('button',{name:'Invoice draft',exact:true}).click()
  await modal.getByRole('button',{name:'+ Add line',exact:true}).click()
  await modal.locator('.invoice-table tbody tr').nth(3).waitFor()
  assert.equal(await modal.locator('.invoice-table tbody tr').count(),4)
  const added=modal.locator('.invoice-table tbody tr').last()
  await added.locator('.description input').fill('Contract adjustment')
  await added.locator('.numeric').nth(1).fill('50')
  await modal.getByRole('button',{name:'Remove line 4',exact:true}).click()
  await modal.getByRole('button',{name:'Reload source values',exact:true}).click()
  assert.equal(await modal.locator('.invoice-table tbody tr').count(),3)
  await modal.getByRole('button',{name:'+ Add line',exact:true}).click()
  await modal.locator('.invoice-table tbody tr').nth(3).waitFor()
  await added.locator('.description input').fill('Contract adjustment')
  await added.locator('.numeric').nth(1).fill('50')
  await modal.getByRole('button',{name:'Use client charge settings',exact:true}).click()
  assert.equal(await modal.locator('.billing-date .print-only').isVisible(),false)
  assert.equal(await modal.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),true)
  await modal.getByRole('button',{name:'Print draft',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.printCalls),1);assert.equal(await page.evaluate(()=>window.wasPrintClass),true)
  await page.screenshot({path:path.join(root,`.data/billing-preview-${width}.png`),fullPage:true})
  if(width===1366){
   await page.setViewportSize({width:794,height:1123});await page.emulateMedia({media:'print'})
   await page.evaluate(()=>document.body.classList.add('printing-billing-draft'))
   assert.equal(await modal.locator('.modal-footer').isVisible(),false)
   assert.equal(await modal.locator('.billing-date .print-only').isVisible(),true)
   await page.screenshot({path:path.join(root,'.data/billing-print-preview.png'),fullPage:true})
   await page.evaluate(()=>document.body.classList.remove('printing-billing-draft'))
   await page.emulateMedia({media:'screen'});await page.setViewportSize({width,height:1100})
  }
  await modal.getByRole('button',{name:'Save draft',exact:true}).click()
  await modal.waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.url==='/api/billing/drafts'&&call.method==='POST').length),1)
  assert.equal(await page.evaluate(()=>window.calls.find(call=>call.url==='/api/billing/drafts'&&call.method==='POST').body.lines.length),4)
  await clients.first().getByRole('button',{name:'Open bill',exact:true}).click();await modal.waitFor()
  await modal.getByRole('button',{name:'Saved revisions',exact:true}).click()
  assert.match(await modal.locator('.revision').textContent(),/Revision 1/)
  await modal.getByRole('button',{name:'Close billing draft',exact:true}).click()
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  await page.evaluate(()=>window.mountBilling(true))
  await page.getByRole('heading',{name:'Billing History',exact:true}).waitFor()
  await page.locator('.client-toggle').first().click()
  await page.getByRole('button',{name:'Open bill',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Client billing setup',exact:true}).count(),0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')
  assert.deepEqual(errors,[])
  console.log(`PASS ${width}px: client setup/retry, component switches, consolidated selection, invoice edits, frozen source view, print, save and history`)
  await page.close()
 }}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
