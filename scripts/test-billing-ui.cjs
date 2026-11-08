// Synthetic browser fixtures only. No live accounts, invoices or payroll writes.
// NODE_PATH must expose Playwright. BILLING_BROWSER_PATH optionally selects Chromium.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {PDFDocument}=require('pdf-lib')
const {parse,compileScript,compileStyle}=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),styles=[]
async function fixture(){return (await build({stdin:{contents:`import{createApp}from'vue';import Billing from './app/components/BillingWorkspace.vue';import{defaultBillingProfile,profileBillingLines}from'./shared/utils/billingProfile';import{calculateBillingDraft}from'./shared/utils/billingDraft';import{renderBillingInvoice}from'./shared/utils/billingInvoicePrint';window.billingTools={defaultBillingProfile,profileBillingLines,calculateBillingDraft,renderBillingInvoice};let app;window.mountBilling=(history=false)=>{app?.unmount();app=createApp(Billing,{history});app.mount('#app')};window.mountBilling();`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'billing-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  const {descriptor}=parse(fs.readFileSync(args.path,'utf8'),{filename:args.path}),id='data-v-'+require('node:crypto').createHash('sha1').update(args.path).digest('hex').slice(0,8)
  const script=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
  for(const style of descriptor.styles)styles.push(compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code)
  return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
})}}]})).outputFiles[0].text}
const dtrPrintCss=parse(fs.readFileSync(path.join(root,'app/components/DtrCompactPrintView.vue'),'utf8')).descriptor.styles.map(style=>style.content).join('\n')
const globalCss=['base','theme','components','dashboard','payroll-processing'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8')).join('\n')
;(async()=>{
 const bundle=await fixture()
 async function captureInvoice(page,name,htmlOverride){const html=htmlOverride||await page.evaluate(()=>window.printedInvoiceHtml);assert.match(html,/SERVICE<br>INVOICE/);const preview=await browser.newPage({viewport:{width:794,height:1123}});try{await preview.setContent(html);await preview.emulateMedia({media:'print'});assert.equal(await preview.locator('.invoice').evaluate(node=>getComputedStyle(node).visibility),'visible');const bytes=await preview.pdf({path:path.join(root,`.data/${name}.pdf`),preferCSSPageSize:true,printBackground:true});const pdf=await PDFDocument.load(bytes);if(name.endsWith('multipage'))assert.ok(pdf.getPageCount()>1);else assert.equal(pdf.getPageCount(),1,`${name} should fit one A4 page`);await preview.screenshot({path:path.join(root,`.data/${name}.png`),fullPage:true})}finally{await preview.close()}}
 const browser=await chromium.launch({headless:true,executablePath:process.env.BILLING_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{for(const width of [1918,1366,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1100}}),errors=[]
  const expectedIds=width===390?[2]:[1,2]
  page.setDefaultTimeout(15000)
  await page.addInitScript(()=>{window.print=()=>{if(window!==window.parent){window.parent.printCalls++;window.parent.printedInvoiceHtml=document.documentElement.outerHTML;window.parent.printedInvoiceVisible=getComputedStyle(document.querySelector('.invoice')).visibility;window.dispatchEvent(new Event('afterprint'))}}})
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.setContent(`<html><head><style>${globalCss}\n${styles.join('\n')}\n${dtrPrintCss}\nbody{background:#f7f9fc;font-family:Arial,sans-serif}</style></head><body><div id="app"></div></body></html>`)
  await page.evaluate(()=>{
   window.calls=[];window.printCalls=0;window.print=()=>{throw Error('Billing must print its isolated invoice document, not the dashboard')}
   const accounts=[{AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',profile:null},{AgencyID:1,AgencyName:'Agency A',ClientID:2,ClientName:'Client B',profile:null}]
   const sources=[{BatchID:1,AgencyID:1,ClientID:1,SiteID:1,SiteName:'North Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',PeopleCount:1},{BatchID:2,AgencyID:1,ClientID:1,SiteID:2,SiteName:'South Site',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',PeopleCount:1}]
   const drafts=[],history=[];let stored=null
   const source=(ids=[1,2])=>{
    const config=accounts[0].profile.config, selectedSources=sources.filter(item=>ids.includes(item.BatchID))
    const people=selectedSources.map((item,i)=>({employeeId:item.BatchID,name:'Synthetic Employee '+item.BatchID,type:item.BatchID===2?'Reliever':'Regular',SiteName:item.SiteName,siteName:item.SiteName,PositionName:'Guard',workedDays:2,regularHours:16,otHours:4,nightHours:2,extensionHours:0,components:[{code:'RegularHours',hours:16},{code:'OTHours',hours:4},{code:'NightDiffHours',hours:2}],billingRate:{RegularRate:100,OTRate:120,NightDiffRate:10}}))
    return{batch:{BatchID:ids[0],BatchIDs:ids,AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',SiteID:selectedSources.length===1?selectedSources[0].SiteID:null,SiteName:selectedSources.map(item=>item.SiteName).join(', '),PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'},lines:window.billingTools.profileBillingLines(people,config),employees:people,workedDays:people.length*2,settings:{...config.settings,retirementQuantity:people.length*2,uniformQuantity:people.length*2},profile:config,profileRevision:1,sourceHash:'fixture-hash',warnings:[]}
   }
   window.$fetch=async(url,options={})=>{
    window.calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(JSON.stringify(options.body)):null})
    await new Promise(resolve=>setTimeout(resolve,80))
    if(!accounts[0].profile&&window.billingTools){const config=window.billingTools.defaultBillingProfile();config.mode='client';config.rules.forEach(rule=>rule.enabled=['RegularHours','OTHours','NightDiffHours'].includes(rule.code));accounts[0].profile={revision:1,config}}
    if(url==='/api/billing/profiles'){
     if(window.failSetup){window.failSetup=false;throw{data:{statusMessage:'Simulated setup save failure'}}}
     const account=accounts.find(item=>item.ClientID===options.body.clientId);account.profile={revision:1,config:options.body.config};return{success:true,revision:1}
    }
    if(url==='/api/billing/drafts/7/status'){
     const body=options.body
     if(window.failStatus){window.failStatus=false;throw{data:{statusMessage:'Simulated connection failure. Please retry.'}}}
     if(body.revision!==drafts[0].Revision)throw{data:{statusMessage:'Bill changed'}}
     const status=body.action==='finalize'?'Finalized':'Draft',revision=drafts[0].Revision+1
     drafts[0].Status=status;drafts[0].Revision=revision
     stored.workflow={status,action:body.action==='finalize'?'Finalized':'Reopened',reason:body.reason||''}
     history.unshift({Revision:revision,ActorName:'Synthetic Billing Officer',CreatedAt:'2026-10-03 10:00:00',action:stored.workflow.action,reason:stored.workflow.reason})
     return{success:true,billingId:7,revision,status}
    }
    if(options.method==='POST'){
     const body=options.body
     if(!Array.isArray(body.batchIds)||!body.batchIds.length)throw{data:{statusMessage:'Select between 1 and 100 finalized payroll sources.'}}
     const original=source(body.batchIds),totals=window.billingTools.calculateBillingDraft(body.lines,body.settings)
     stored={source:original.batch,profile:original.profile,profileRevision:1,sourceHash:body.sourceHash,lines:body.lines,settings:body.settings,totals,billingDate:body.billingDate,notes:body.notes,employees:original.employees,warnings:[]}
     const revision=(drafts[0]?.Revision||0)+1
     history.unshift({Revision:revision,ActorName:'Synthetic Billing Officer',CreatedAt:'2026-10-03 09:00:00',action:'Saved',reason:''})
     drafts.splice(0,drafts.length,{BillingID:7,AgencyID:1,AgencyName:'Agency A',ClientID:1,ClientName:'Client A',SiteName:original.batch.SiteName,PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',Status:'Draft',Revision:revision,TotalAmount:totals.totalDue})
     sources.filter(item=>body.batchIds.includes(item.BatchID)).forEach(item=>item.BillingID=7);return{success:true,billingId:7,revision}
    }
    if(url==='/api/billing/drafts/preview')return{source:source(options.query.batchIds.split(',').map(Number)),draft:null,history:[],permissions:{canEdit:true}}
    if(url==='/api/billing/drafts/7'){const finalized=drafts[0].Status==='Finalized';return JSON.parse(JSON.stringify({source:finalized?null:source(stored.source.BatchIDs),draft:{billingId:7,revision:drafts[0].Revision,status:drafts[0].Status,sourceHash:'fixture-hash',snapshot:stored},history,permissions:{canEdit:!finalized,canFinalize:!finalized,canReopen:finalized}}))}
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
  if(width!==390)await checks.nth(0).click();await checks.nth(1).click()
  await clients.first().getByRole('button',{name:'Review selected bill',exact:true}).click()
  const modal=page.locator('.billing-draft-dialog')
  await modal.waitFor();assert.equal(await modal.locator('.invoice-table tbody tr').count(),3)
  await modal.getByRole('button',{name:'Finalized payroll',exact:true}).click()
  assert.equal(await modal.locator('.source-table tbody tr').count(),expectedIds.length)
  assert.match(await modal.locator('.source-table tbody').textContent(),/Reliever/)
  await modal.getByRole('button',{name:'Activity history',exact:true}).click()
  assert.match(await modal.locator('.modal-content').textContent(),/not been saved/)
  await modal.getByRole('button',{name:'Billing statement',exact:true}).click()
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
  await modal.locator('.charges>summary').click()
  await modal.getByRole('button',{name:'Use client charge settings',exact:true}).click()
  assert.equal(await modal.locator('.billing-date .print-only').isVisible(),false)
  assert.equal(await modal.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),true)
  await modal.getByRole('button',{name:'Print draft',exact:true}).click()
  await page.waitForFunction(()=>window.printCalls===1)
  assert.equal(await page.evaluate(()=>window.printedInvoiceVisible),'visible')
  assert.match(await page.evaluate(()=>window.printedInvoiceHtml),/Contract adjustment/,'Print includes unsaved invoice edits')
  assert.ok(await page.locator('#billing-invoice-print-frame').count(),'Keep document alive for asynchronous print preview')
  assert.ok(!await page.evaluate(()=>document.body.classList.contains('printing-billing-draft')))
  await page.screenshot({path:path.join(root,`.data/billing-preview-${width}.png`),fullPage:true})
  if(width===1366)await captureInvoice(page,'billing-invoice-draft')
  await modal.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.waitForFunction(()=>window.calls.some(call=>call.url==='/api/billing/drafts'&&call.method==='POST'))
  assert.deepEqual(await page.evaluate(()=>window.calls.find(call=>call.url==='/api/billing/drafts'&&call.method==='POST').body.batchIds),expectedIds,'Save must carry the complete preview source set')
  await modal.getByRole('button',{name:'Review & finalize',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.url==='/api/billing/drafts'&&call.method==='POST').length),1)
  assert.equal(await page.evaluate(()=>window.calls.find(call=>call.url==='/api/billing/drafts'&&call.method==='POST').body.lines.length),4)
  await modal.getByRole('button',{name:'Activity history',exact:true}).click()
  assert.match(await modal.locator('.revision').textContent(),/Revision 1/)
  await modal.getByRole('button',{name:'Billing statement',exact:true}).click()
  await modal.locator('.invoice-notes textarea').fill('Contract reviewed with client')
  assert.equal(await modal.getByRole('button',{name:'Review & finalize',exact:true}).isDisabled(),true,'Unsaved changes must be saved before finalizing')
  await modal.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.waitForFunction(()=>window.calls.filter(call=>call.url==='/api/billing/drafts'&&call.method==='POST').length===2)
  const edited=await page.evaluate(()=>window.calls.filter(call=>call.url==='/api/billing/drafts'&&call.method==='POST')[1].body)
  assert.deepEqual(edited.batchIds,expectedIds,'Editing retains the saved source set after picker selections are cleared')
  assert.equal(edited.billingId,7);assert.equal(edited.revision,1)
  await page.waitForFunction(()=>document.querySelector('.footer-help')?.textContent.includes('BILL-0007')&&!document.querySelector('.footer-help')?.textContent.includes('Unsaved'))
  await modal.getByRole('button',{name:'Review & finalize',exact:true}).click()
  await modal.getByRole('heading',{name:'Ready to finalize this bill?',exact:true}).waitFor()
  await page.screenshot({path:path.join(root,`.data/billing-final-review-${width}.png`),fullPage:true})
  await modal.getByRole('button',{name:'Back to bill',exact:true}).click()
  assert.equal(await modal.getByRole('button',{name:'Review & finalize',exact:true}).isEnabled(),true)
  await modal.getByRole('button',{name:'Review & finalize',exact:true}).click()
  await page.evaluate(()=>window.failStatus=true)
  await modal.getByRole('button',{name:'Confirm finalization',exact:true}).click()
  await modal.getByRole('alert').waitFor()
  assert.match(await modal.getByRole('alert').textContent(),/connection failure/)
  await modal.getByRole('button',{name:'Confirm finalization',exact:true}).click()
  await modal.getByRole('button',{name:'Print billing',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.modal-footer button:disabled'))
  assert.equal(await modal.getByRole('button',{name:'Save draft',exact:true}).count(),0)
  assert.equal(await modal.locator('.invoice-table input:visible').count(),0,'Finalized bills display readable values instead of disabled forms')
  assert.equal(await modal.locator('.billing-date .print-only').isVisible(),true)
  await page.screenshot({path:path.join(root,`.data/billing-finalized-${width}.png`),fullPage:true})
  await modal.getByRole('button',{name:'Print billing',exact:true}).click()
  await page.waitForFunction(()=>window.printCalls===2)
  assert.match(await page.evaluate(()=>window.printedInvoiceHtml),/FINALIZED BILLING STATEMENT/)
  assert.ok(!/Contract reviewed with client/.test(await page.evaluate(()=>window.printedInvoiceHtml)),'Internal notes stay out of client printouts')
  if(width===1366){
   await captureInvoice(page,'billing-invoice-finalized')
   const examples=await page.evaluate(()=>{
    const metadata={AgencyName:'Example Security Services Incorporated',AgencyAddress:'169 Example Street, Barangay Example\nFourth District, Example City 1300',AgencyContact:'02 8000 0000',ClientName:'Example Residences Condominium Corporation',ClientAddress:'Lot 4, Example Road, Barangay Example\nExample City, Metro Manila',SiteName:'Example Residences - Main Building and CCTV',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'}
    const settings={adminPercent:20,adminBase:'service',vatPercent:12,vatBase:'administrative',withholdingPercent:2,withholdingBase:'administrative',retirementQuantity:96,retirementRate:19,uniformQuantity:96,uniformRate:3}
    const lines=[{id:'regular',description:'Regular Pay',quantity:96,unit:'day',rate:1300,direction:'Charge',category:'Service'},{id:'ot',description:'Overtime',quantity:4,unit:'hour',rate:120,direction:'Charge',category:'Service'},{id:'nd',description:'Night Differential - CCTV and Main Building',quantity:384,unit:'hour',rate:9,direction:'Charge',category:'Service'},{id:'ut',description:'UT / Tardiness',quantity:1,unit:'hour',rate:100,direction:'Credit',category:'Service'}]
    const invoice={metadata,settings,lines,billingDate:'2026-10-03',reference:'BILL-TEST',finalized:false}
    return{detailed:window.billingTools.renderBillingInvoice(invoice),long:window.billingTools.renderBillingInvoice({...invoice,lines:Array.from({length:75},(_,i)=>({...lines[0],id:'line-'+i,description:'Contract service line '+(i+1)}))})}
   })
   await captureInvoice(page,'billing-invoice-detailed',examples.detailed)
   await captureInvoice(page,'billing-invoice-multipage',examples.long)
  }
  await modal.getByRole('button',{name:'Reopen as draft',exact:true}).click()
  assert.equal(await modal.getByRole('button',{name:'Reopen as draft',exact:true}).isDisabled(),true)
  await modal.getByLabel('Reason for reopening',{exact:false}).fill('Correct contract adjustment description')
  await modal.getByRole('button',{name:'Reopen as draft',exact:true}).click()
  await modal.getByRole('button',{name:'Review & finalize',exact:true}).waitFor()
  await modal.getByRole('button',{name:'Activity history',exact:true}).click()
  assert.match(await modal.locator('.revision').first().textContent(),/Correct contract adjustment description/)
  assert.equal(await modal.locator('.revision').count(),4)
  await modal.getByRole('button',{name:'Billing statement',exact:true}).click()
  await modal.getByRole('button',{name:'Review & finalize',exact:true}).click()
  await modal.getByRole('button',{name:'Confirm finalization',exact:true}).click()
  await modal.getByRole('button',{name:'Print billing',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.modal-footer button:disabled'))
  await modal.getByRole('button',{name:'Close billing draft',exact:true}).click()
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  assert.equal(await page.locator('#billing-invoice-print-frame').count(),0,'Closing the modal removes the print document')
  await page.evaluate(()=>window.mountBilling(true))
  await page.getByRole('heading',{name:'Billing History',exact:true}).waitFor()
  await page.locator('.client-toggle').first().click()
  await page.getByRole('button',{name:'Open bill',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Client billing setup',exact:true}).count(),0)
  await page.getByRole('button',{name:/^Drafts/}).click()
  assert.equal(await page.locator('.saved-row').count(),0)
  await page.getByRole('button',{name:/^Finalized/}).click()
  assert.equal(await page.locator('.saved-row').count(),1)
  assert.match(await page.locator('.bill-badge').textContent(),/Finalized/)
  await page.screenshot({path:path.join(root,`.data/billing-history-${width}.png`),fullPage:true})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')
  assert.deepEqual(errors,[])
  console.log(`PASS ${width}px: client setup/retry, component switches, consolidated selection, invoice edits, source view, print, save, finalize/retry, locked billing, reopen/audit and status filters`)
  await page.close()
 }}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
