// Browser QA uses synthetic snapshots and mocked portal responses, never live accounts.
// Run with NODE_PATH pointing to a Playwright installation and PORTAL_BROWSER_PATH
// pointing to a Chromium browser. No extra application dependency is required.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data','portal-services-tests')
async function buildFixture(component='app/pages/payroll/payslip/index.vue',props={}){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './${component}';const app=createApp(Portal,${JSON.stringify(props)});app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});window.testApp=app;app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>({path:path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2))+'.ts'}))
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-head-fixture',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead = value => { document.title = value.title };export const onBeforeRouteLeave = callback => { window.portalLeaveGuard=callback }',loader:'js'}))
  build.onLoad({filter:/\.vue$/},args=>{
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-'+require('node:crypto').createHash('sha1').update(path.relative(root,args.path)).digest('hex').slice(0,8)
   const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'})
   for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
   return{contents:script.content+`;__component.__scopeId=${JSON.stringify(id)};export default __component;`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}



test('historical import/post and employee correction/reply journeys work on real Vue screens',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),staffFixture=await buildFixture(),employeeFixture=await buildFixture('app/pages/employee-portal/index.vue')
 const pdf=await require('pdf-lib').PDFDocument.create();pdf.addPage([600,300]);const pdfBytes=Buffer.from(await pdf.save())
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true});fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.request().url().endsWith('/images/logo.png')?route.fulfill({path:path.join(root,'public/images/logo.png'),contentType:'image/png'}):route.abort())
  await page.setContent('<!doctype html><base href="http://portal.test"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><div id="app"></div>')
  await page.evaluate(()=>{
   window.calls=[];window.archives=[];window.requests=[]
   const employee={EmployeeID:1,EmployeeName:'SYNTHETIC EMPLOYEE',EmployeeNumber:'TEST-1',AgencyName:'Synthetic agency',PositionName:'Guard',Status:'Active',PortalStatus:'Active',PortalEmail:'test@example.invalid'}
   window.$fetch=async(url,options={})=>{
    const body=options.body;if(options.method==='POST')window.calls.push({url,body})
    if(url.endsWith('/me'))return{account:{...employee,Email:'test@example.invalid',ContactNumber:'09000000000',CurrentSites:[]}}
    if(url==='/api/employee-portal/payslips')return{payslips:[]}
    if(url.endsWith('/payslips/account'))return{canManage:true,account:{Email:'test@example.invalid',Status:'Active'},activity:{items:[],pagination:{page:1,pages:1,total:0}}}
    if(url==='/api/payroll/payslips')return options.query?.employeeId?{employee,cutoffs:[]}:{items:[employee],canManageAccounts:true,accountSummary:{total:1,active:1,inactive:0,unregistered:0},agencies:[],pagination:{page:1,pages:1,total:1}}
    if(url.endsWith('/archive')){
     if(body){if(body.action==='import')window.archives.push({ArchiveID:window.archives.length+1,EmployeeID:1,PeriodStart:body.periodStart,PeriodEnd:body.periodEnd,AgencyName:body.agencyName,SiteLabel:body.siteLabel,FileName:body.fileName,PageCount:1,Status:'Draft'});else window.archives.find(item=>item.ArchiveID===body.archiveId).Status=({post:'Posted',withdraw:'Withdrawn',remove:'Removed'})[body.action];return{success:true,archiveId:window.archives.length}}
     return{items:window.archives.filter(item=>!url.includes('employee-portal')||item.Status==='Posted'),canManage:!url.includes('employee-portal')}
    }
    const fields=[
 ['FirstName','First name','Personal details','SYNTHETIC'],['MiddleName','Middle name','Personal details','TEST'],['LastName','Last name','Personal details','EMPLOYEE'],['Nickname','Nickname','Personal details','Test'],['Birthday','Birthday','Personal details','1993-07-22'],['Gender','Gender','Personal details','Female'],['CivilStatus','Civil status','Personal details','Single'],
 ['Email','Email on employee record','Contact details','test@example.invalid'],['ContactNumber','Contact number on employee record','Contact details','09000000000'],['PresentAddress','Present address','Contact details','Old city'],['PermanentAddress','Permanent address','Contact details','25 Sample Street, Example Village, Antipolo City, Rizal, Region IV-A, 1870'],
 ['EmployeeNumber','Employee number','Employment','TEST-1'],['AgencyName','Agency','Employment','Synthetic agency'],['PositionName','Position','Employment','Security Guard'],['DateHired','Date hired','Employment','2020-06-01'],['Status','Employee status','Employment','Active'],
 ['EmergencyName','Emergency contact name','Emergency contact','SYNTHETIC CONTACT'],['EmergencyRelationship','Relationship','Emergency contact','Sibling'],['EmergencyContactNo','Emergency contact number','Emergency contact','09000000001'],['EmergencyAddress','Emergency contact address','Emergency contact','25 Sample Street, Example Village, Antipolo City, Rizal']
 ].map(([key,label,section,value])=>({key,label,section,value}))
    if(url.endsWith('/information')){
     if(body&&body.action!=='create'){const item=window.requests.find(item=>item.RequestID===body.requestId);item.Version++;if(body.action==='cancel')item.Status='Cancelled';item.messages.push({MessageID:3,Sender:'Employee',Message:body.message||'Employee cancelled this request.',Status:item.Status,CreatedAt:'2026-10-27T05:00:00.000Z'});return{success:true,requestId:item.RequestID}}
     if(body){window.requests.unshift({RequestID:1,Version:1,EmployeeID:1,EmployeeName:employee.EmployeeName,EmployeeNumber:'TEST-1',AgencyName:'Synthetic agency',FieldKey:body.fieldKey,FieldLabel:'Present address',RecordedValue:'Old city',ProposedValue:body.proposedValue,Message:body.message,Status:'Pending',CreatedAt:'2026-10-27T03:00:00.000Z',messages:[{MessageID:1,Sender:'Employee',Message:body.message,Status:'Pending',CreatedAt:'2026-10-27T03:00:00.000Z'}]});return{success:true}}
     return{fields,requestFields:fields,requests:{items:window.requests,pagination:{page:1,pages:1,total:window.requests.length}}}
    }
    if(url.endsWith('/requests')){
     if(body){const item=window.requests.find(item=>item.RequestID===body.requestId);item.Version++;item.Status=body.status;item.messages.push({MessageID:2,Sender:'Staff',StaffName:'Synthetic HR',StaffRole:'Supervisor',StaffDepartment:'Human Resources',Message:body.message,Status:body.status,CreatedAt:'2026-10-27T04:00:00.000Z'});return{success:true}}
     const items=window.requests.filter(item=>!options.query?.status||item.Status===options.query.status);return{items,pagination:{page:1,pages:1,total:items.length}}
    }
    throw Error('Unexpected API '+url)
   }
  })
  async function mount(fixture){await page.evaluate(()=>{window.testApp?.unmount();document.getElementById('app').innerHTML='';document.querySelectorAll('style[data-fixture]').forEach(node=>node.remove())});await page.addStyleTag({content:fixture.css}).then(handle=>handle.evaluate(node=>node.dataset.fixture='1'));await page.addScriptTag({content:fixture.script})}
  async function fits(label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label)}
  await mount(staffFixture);await page.getByRole('button',{name:'Manage account',exact:true}).click();const dialog=page.getByRole('dialog')
  assert.equal(await page.getByRole('button',{name:'Historical imports',exact:true}).count(),0,'Site batch workspace is removed')
  await dialog.getByRole('button',{name:'PDF archive',exact:true}).click();await dialog.getByLabel(/^Year/).selectOption('2026');await dialog.getByLabel(/^Month/).selectOption('09')
  assert.equal(await dialog.locator('.cutoff-group').count(),2)
  for(const [index,range] of ['Sep 1, 2026 - Sep 15, 2026','Sep 16, 2026 - Sep 30, 2026'].entries()){
   const chooser=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Upload PDF for '+range,exact:true}).click();await(await chooser).setFiles({name:'Synthetic-'+index+'.pdf',mimeType:'application/pdf',buffer:pdfBytes})
  }
  assert.equal(await dialog.locator('.badge.selected').count(),2,'Each chosen cutoff retains its own file')
  await dialog.getByRole('button',{name:'Close profile',exact:true}).click();const discard=page.getByRole('alertdialog',{name:'Discard selected PDFs?',exact:true});await discard.waitFor();await discard.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await dialog.locator('.badge.selected').count(),2)
  await page.screenshot({path:path.join(output,'employee-cutoff-ledger.png'),fullPage:true})
  await dialog.getByRole('button',{name:'Review uploads',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0)
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirm upload',exact:true}).click();await dialog.getByRole('status').filter({hasText:'PDF(s) saved'}).waitFor()
  assert.equal(await page.evaluate(()=>window.calls.length),2);assert.ok((await page.evaluate(()=>window.calls)).every(call=>call.body.employeeId===1))
  const septemberFirst=dialog.locator('.cutoff-group').filter({hasText:'Sep 1, 2026 - Sep 15, 2026'});await septemberFirst.getByRole('button',{name:'Post PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),2)
  await page.screenshot({path:path.join(output,'staff-pdf-review.png'),fullPage:true})
  await dialog.getByRole('button',{name:'Confirm post',exact:true}).click();await dialog.locator('.cutoff-table .badge').filter({hasText:'Posted'}).waitFor()
  await dialog.getByRole('button',{name:'Close profile',exact:true}).click()
  await mount(employeeFixture);await page.getByRole('heading',{name:'Your payslips',exact:true}).waitFor()
  await page.getByRole('link',{name:/View PDF/}).waitFor();assert.equal(await page.getByRole('link',{name:/View PDF/}).getAttribute('href'),'/api/employee-portal/archive/1')
  assert.equal(await page.getByRole('button',{name:'Post PDF',exact:true}).count(),0)
  await page.getByRole('button',{name:'My information',exact:true}).click();await page.locator('.information-sections dd').first().waitFor()
  assert.equal(await page.locator('.information-sections dd').count(),20);assert.match(await page.locator('.information-sections').innerText(),/July 22, 1993/);await page.screenshot({path:path.join(output,'employee-information-details-desktop.png'),fullPage:true});await page.setViewportSize({width:375,height:850});await fits('Employee details at 375px');await page.screenshot({path:path.join(output,'employee-information-details-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:900})
  assert.equal(await page.locator('.information-sections input,.information-sections textarea,.information-sections select').count(),0,'HR records are read-only')
  assert.equal(await page.getByRole('button',{name:'Request correction',exact:true}).count(),1,'One clear correction action replaces repeated links');await page.getByRole('button',{name:'Request correction',exact:true}).click();await page.getByLabel(/^Information to correct/).selectOption('PresentAddress')
  await page.getByLabel('Correct information',{exact:true}).fill('New city');await page.getByLabel('Message to HR',{exact:true}).fill('Please correct my recorded address.')
  await page.getByRole('button',{name:'My account',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard your changes?'}).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click()
  assert.equal(await page.getByLabel('Correct information',{exact:true}).inputValue(),'New city')
  await page.getByRole('button',{name:'Review request',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),3)
  await page.setViewportSize({width:320,height:850});await fits('Information at 320px');await page.screenshot({path:path.join(output,'employee-information-mobile.png'),fullPage:true})
  await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('status').filter({hasText:'sent to HR'}).waitFor()
  assert.equal(await page.evaluate(()=>window.calls.length),4)
  assert.match(await page.locator('.information-sections').innerText(),/Old city/,'Submitting a request does not edit the record')
  await page.getByRole('tab',{name:/My requests/}).click();await page.locator('.request-heading').click();await page.getByText('Please correct my recorded address.',{exact:true}).first().waitFor()
  await page.screenshot({path:path.join(output,'employee-request-thread.png'),fullPage:true})
  await page.setViewportSize({width:1280,height:900});await mount(staffFixture)
  await page.getByRole('button',{name:'Information requests',exact:true}).click();await page.locator('.admin-requests .row').click()
  await page.getByLabel('Reply to employee',{exact:true}).fill('HR is checking your address.');await page.getByLabel(/^Set request status/).selectOption('In review')
  await page.getByRole('button',{name:'Review response',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),4)
  await page.screenshot({path:path.join(output,'hr-request-review.png'),fullPage:true})
  await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('status').filter({hasText:'status saved'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),5)
  await mount(employeeFixture);await page.getByRole('button',{name:'My information',exact:true}).click();await page.getByRole('tab',{name:/My requests/}).click();await page.locator('.request-heading').click()
  await page.getByText('HR is checking your address.',{exact:true}).waitFor();assert.match(await page.locator('.my-requests').innerText(),/In review/)
  assert.match(await page.locator('.officer-details').innerText(),/Supervisor.*Human Resources/)
  assert.equal(await page.locator('.message-row.staff:not(.own)').count(),1,'Officer message is received on the left');assert.equal(await page.locator('.message-row.own:not(.staff)').count(),1,'Employee message is on the right')
  await page.screenshot({path:path.join(output,'employee-messages-desktop.png'),fullPage:true});await page.setViewportSize({width:320,height:850});await fits('Message conversation at 320px');await page.screenshot({path:path.join(output,'employee-messages-mobile.png'),fullPage:true})
  await page.getByLabel('Follow-up message',{exact:true}).fill('Thank you. Please let me know if HR needs anything else.');await page.getByRole('button',{name:/Review message/}).click();assert.equal(await page.evaluate(()=>window.calls.length),5,'Review does not send a message');await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.match(await page.getByLabel('Follow-up message',{exact:true}).inputValue(),/Thank you/)
  await page.getByRole('button',{name:/Review message/}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('status').filter({hasText:'Request updated.'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),6);assert.equal(await page.locator('.message-row.own').count(),2);assert.equal(await page.getByLabel('Follow-up message',{exact:true}).inputValue(),'')
  await page.evaluate(()=>window.requests.push({...window.requests[0],RequestID:2,FieldLabel:'Nickname',RecordedValue:'Test',ProposedValue:'Test name',messages:[{MessageID:4,Sender:'Employee',Message:'Please check my nickname.',Status:'Pending',CreatedAt:'2026-10-26T03:00:00.000Z'}]}))
  await mount(employeeFixture);await page.getByRole('button',{name:'My information',exact:true}).click();await page.getByRole('tab',{name:/My requests/}).click();await page.getByLabel('Follow-up message',{exact:true}).fill('Draft for address request');await page.locator('.request-heading').filter({hasText:'Nickname'}).click();assert.equal(await page.getByLabel('Follow-up message',{exact:true}).inputValue(),'');await page.getByLabel('Follow-up message',{exact:true}).fill('Draft for nickname request');await page.locator('.request-heading').filter({hasText:'Present address'}).click();assert.equal(await page.getByLabel('Follow-up message',{exact:true}).inputValue(),'Draft for address request','Switching conversations retains the correct draft')
  await page.getByRole('tab',{name:'Employee details',exact:true}).click();await page.getByRole('tab',{name:/My requests/}).click();assert.equal(await page.getByLabel('Follow-up message',{exact:true}).inputValue(),'Draft for address request');assert.ok(await page.locator('.messages').evaluate(element=>element.scrollTop+element.clientHeight>=element.scrollHeight-2),'Opening the conversation shows the latest message')
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('tab',{name:'Employee details',exact:true}).click();await fits('Employee desktop');await page.screenshot({path:path.join(output,'employee-information-desktop.png'),fullPage:true})
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})


test('employee cutoff ledger handles upload failures, review, filters and mobile layout',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),employee={EmployeeID:1,EmployeeNumber:'EMP-0001',EmployeeName:'SYNTHETIC EMPLOYEE',AgencyName:'Synthetic agency'},fixture=await buildFixture('app/components/ArchivedPayslipsPanel.vue',{employeeId:1,agencyName:'Synthetic agency',employee}),pdf=await require('pdf-lib').PDFDocument.create();pdf.addPage([600,300]);const bytes=Buffer.from(await pdf.save())
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.abort());await page.setContent('<!doctype html><base href="http://portal.test"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:20px;font-family:Arial}</style><div id="app"></div>');await page.addStyleTag({content:fixture.css})
  await page.evaluate(()=>{
   window.records=[];window.calls=[];window.failOnce=true;window.canManage=true
   window.$fetch=async(url,options={})=>{
    if(url!='/api/payroll/payslips/archive')throw Error('Unexpected endpoint '+url)
    if(!options.body)return{items:window.records,canManage:window.canManage}
    const body=options.body;window.calls.push(body)
    if(body.action==='import'){
     const saved=window.records.find(row=>row.PeriodStart===body.periodStart)
     if(saved)throw{status:409,data:{statusMessage:'Already archived.',data:{code:'ARCHIVE_DUPLICATE'}}}
     const record={ArchiveID:window.records.length+1,EmployeeID:body.employeeId,PeriodStart:body.periodStart,PeriodEnd:body.periodEnd,FileName:body.fileName,AgencyName:body.agencyName,SiteLabel:body.siteLabel,Status:'Draft',PageCount:1};window.records.push(record)
     if(body.periodStart==='2026-09-01'&&window.failOnce){window.failOnce=false;throw{data:{statusMessage:'Synthetic response lost. Retry upload.'}}}
     return{success:true,archiveId:record.ArchiveID}
    }
    window.records.find(row=>row.ArchiveID===body.archiveId).Status=({post:'Posted',withdraw:'Withdrawn',remove:'Removed'})[body.action];return{success:true}
   }
  })
  await page.addScriptTag({content:fixture.script});await page.getByLabel(/^Year/).selectOption('2024');await page.getByLabel(/^Month/).selectOption('02');assert.match(await page.locator('.cutoff-table').innerText(),/Feb 29, 2024/)
  await page.getByLabel(/^Year/).selectOption('2026');await page.getByLabel(/^Month/).selectOption('09')
  assert.equal(await page.getByRole('combobox').count(),3,'Only year/month/status selects; no site group builder')
  for(const range of ['Sep 1, 2026 - Sep 15, 2026','Sep 16, 2026 - Sep 30, 2026']){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF for '+range,exact:true}).click();await(await chooser).setFiles({name:range+'.pdf',mimeType:'application/pdf',buffer:bytes})}
  await page.getByLabel(/^Status/).selectOption('selected');assert.equal(await page.locator('.cutoff-group').count(),2)
  await page.setViewportSize({width:320,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Employee cutoff ledger fits 320px');await page.screenshot({path:path.join(output,'employee-cutoff-ledger-mobile.png'),fullPage:true})
  await page.getByRole('button',{name:'Review uploads',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);assert.ok(await page.getByRole('button',{name:'Confirm upload',exact:true}).isDisabled())
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm upload',exact:true}).click();await page.getByRole('status').filter({hasText:'1 upload(s) need attention'}).waitFor()
  assert.equal(await page.evaluate(()=>window.records.length),2);assert.equal(await page.locator('.badge.selected').count(),1,'Only the failed cutoff remains selected')
  await page.getByRole('button',{name:'Review uploads',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm upload',exact:true}).click();await page.getByRole('status').filter({hasText:'1 PDF(s) saved'}).waitFor()
  assert.equal(await page.evaluate(()=>window.records.length),2,'Lost-response retry does not duplicate the archive')
  assert.equal(await page.evaluate(()=>window.calls.length),3)
  await page.getByLabel(/^Status/).selectOption('Draft');assert.equal(await page.locator('.cutoff-group').count(),2)
  const first=page.locator('.cutoff-group').filter({hasText:'Sep 1, 2026 - Sep 15, 2026'});await first.getByRole('button',{name:'Post PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),3)
  await page.getByRole('button',{name:'Confirm post',exact:true}).click();await page.getByRole('status').filter({hasText:'status updated'}).waitFor();await page.getByLabel(/^Status/).selectOption('Posted');assert.equal(await page.locator('.cutoff-group').count(),1)
  await page.setViewportSize({width:1200,height:900});await page.screenshot({path:path.join(output,'employee-cutoff-ledger-posted.png'),fullPage:true})
  await first.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('button',{name:'Confirm withdraw',exact:true}).click();await page.getByRole('status').filter({hasText:'status updated'}).waitFor()
  await page.getByLabel(/^Status/).selectOption('Withdrawn');await first.getByRole('button',{name:'Remove',exact:true}).click();await page.getByRole('button',{name:'Confirm remove',exact:true}).click();await page.getByRole('status').filter({hasText:'status updated'}).waitFor()
  await page.getByLabel(/^Status/).selectOption('');await first.getByRole('button',{name:'Upload PDF for Sep 1, 2026 - Sep 15, 2026',exact:true}).waitFor();await page.locator('.cutoff-table').getByText('Sep 1, 2026 - Sep 15, 2026.pdf',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByText('Sep 1, 2026 - Sep 15, 2026.pdf',{exact:true}).count(),0,'Removed PDF disappears even if a stale API returns it');assert.equal(await page.getByRole('button',{name:'Restore',exact:true}).count(),0);assert.equal(await page.locator('option').filter({hasText:/^Removed$/}).count(),0)
  await first.getByRole('button',{name:'Upload PDF for Sep 1, 2026 - Sep 15, 2026',exact:true}).waitFor()
  assert.ok((await page.evaluate(()=>window.calls)).filter(row=>row.action==='import').every(row=>row.employeeId===1&&row.siteId===undefined),'Imports are scoped to the chosen employee and individual cutoff')
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
