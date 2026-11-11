const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc');const root=process.cwd(),out=path.join(root,'.data','thirteenth-month-ui');fs.mkdirSync(out,{recursive:true});
async function build(file){const css=[];const result=await esbuild.build({stdin:{contents:`import {createApp,h,KeepAlive,ref} from 'vue';import Page from './${file}';window.annualVisible=ref(true);createApp({setup:()=>()=>h(KeepAlive,{},()=>window.annualVisible.value?h(Page):h('div','Other workspace'))}).mount('#app')`,loader:'js',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',define:{'import.meta.client':'true',__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'vue-fixture',setup(b){b.onResolve({filter:/^(~~\/|~\/)/},args=>{const p=path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2));return{path:path.extname(p)?p:p+'.ts'}});b.onLoad({filter:/\.vue$/},args=>{const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const id='data-v-'+require('node:crypto').createHash('sha1').update(args.path).digest('hex').slice(0,8);const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'});for(const style of descriptor.styles)css.push(sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code);return{contents:script.content+`;__component.__scopeId='${id}';export default __component`,loader:'ts',resolveDir:path.dirname(args.path)}})}}]});return{script:result.outputFiles[0].text,css:css.join('\n')}}

// UI requests are synthetic; the companion integration test exercises real SQL on temporary tables.
(async()=>{
 const fixture=JSON.parse(fs.readFileSync('.data/thirteenth-month-fixture.json','utf8'))
 const {chromium}=require('playwright'),browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f7f9fc}</style><div id="app"></div>')
  await page.evaluate(initial=>{
   window.fixture=initial;window.calls=[];window.failNext=false
   window.$fetch=async(url,options={})=>{
    window.calls.push({url,...structuredClone(options)})
    if(options.method==='POST'){
     await new Promise(r=>setTimeout(r,25))
     if(window.failNext){window.failNext=false;throw{data:{statusMessage:'Synthetic connection error; your entries are retained.'}}}
     const b=options.body,p=window.fixture.items[0]
     if(b.action==='save'||b.action==='approve'){
      Object.assign(p.header,{Status:b.action==='approve'?'Approved':'Draft',SourceHash:p.sourceHash,CoverageStart:b.coverageStart,CoverageEnd:b.coverageEnd,ReviewNote:b.reason,EligibilityConfirmed:b.eligibilityConfirmed?1:0,ThirteenthMonthAmount:p.summary.entitlement})
      p.sourceChanged=false;p.saved={summary:structuredClone(p.summary),coverageStart:b.coverageStart,coverageEnd:b.coverageEnd}
     }
     if(b.action==='release'||b.action==='previous-payment'){
      p.releases.unshift({ReleaseID:p.releases.length+1,Amount:Number(b.amount),Withholding:Number(b.withholding),NetAmount:Number(b.amount)-Number(b.withholding),PaymentDate:b.paymentDate,Reference:b.reference,Reason:b.reason,EntryKind:b.action==='release'?'Release':'Previous payment',Status:'Active',ActorName:'Test Admin'})
      p.summary.paid+=Number(b.amount);p.summary.balance=p.summary.entitlement-p.summary.paid
      if(p.summary.balance<=0)p.header.Status='Released'
     }
     if(b.action==='reopen')p.header.Status='Draft'
     p.header.Revision++;return{success:true,recordId:p.header.ThirteenthMonthID}
    }
    const result=structuredClone(window.fixture)
    if(options.query?.agencyId)result.items=result.items.filter(row=>row.AgencyID===Number(options.query.agencyId))
    return result
   }
  },fixture)
  const built=await build('app/pages/payroll/thirteenth-month/index.vue')
  await page.addStyleTag({content:built.css});await page.addScriptTag({content:built.script})
  await page.getByRole('button',{name:'Review earnings',exact:true}).filter({visible:true}).waitFor()
  const fonts=await page.evaluate(()=>Object.fromEntries(['.annual-page','.annual-page table','.annual-page button'].map(selector=>[selector,getComputedStyle(document.querySelector(selector)).fontFamily])))
  assert.equal(fonts['.annual-page table'],fonts['.annual-page']);assert.equal(fonts['.annual-page button'],fonts['.annual-page'])
  assert.equal(await page.locator('tbody tr').count(),1)
  await page.screenshot({path:path.join(out,'computation-desktop.png'),fullPage:true})
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const download=await downloadPromise
  const workbookPath=path.join(out,download.suggestedFilename());await download.saveAs(workbookPath)
  const x=require('xlsx'),book=x.readFile(workbookPath);assert.deepEqual(book.SheetNames,['Annual summary','Earnings details','Payments']);assert.equal(x.utils.sheet_to_json(book.Sheets['Annual summary'])[0]['Current basic earned'],24000)
  await page.getByRole('button',{name:'Review earnings',exact:true}).filter({visible:true}).click()
  let modal=page.getByRole('dialog',{name:'Test Employee',exact:true})
  await modal.waitFor();await page.keyboard.press('Shift+Tab');assert.ok(await modal.evaluate(el=>el.contains(document.activeElement)))
  await modal.getByLabel('Review note',{exact:true}).fill('Unsaved coverage note retained when navigating')
  await modal.getByRole('button',{name:'Import Previous Earnings',exact:true}).click()
  const templatePromise=page.waitForEvent('download');await modal.getByRole('button',{name:'Download Excel template'}).click();const templateDownload=await templatePromise;await templateDownload.saveAs(path.join(out,templateDownload.suggestedFilename()))
  const importBook=x.utils.book_new();x.utils.book_append_sheet(importBook,x.utils.json_to_sheet([{start:'2026-02-01',end:'2026-02-28',basic:20000,reference:'MANUAL-FEB',kind:'Previous earnings'}]),'Earnings')
  await modal.locator('input[type=file]').setInputFiles({name:'verified.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:x.write(importBook,{type:'buffer',bookType:'xlsx'})})
  await modal.getByLabel('Reference',{exact:true}).waitFor();assert.equal(await modal.getByLabel('Reference',{exact:true}).inputValue(),'MANUAL-FEB')
  await modal.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await modal.getByLabel('Review note',{exact:true}).inputValue(),'Unsaved coverage note retained when navigating')
  await page.evaluate(()=>{window.failNext=true})
  await modal.getByRole('button',{name:'Save draft',exact:true}).click();await modal.getByRole('alert').waitFor();assert.equal(await modal.getByLabel('Review note',{exact:true}).inputValue(),'Unsaved coverage note retained when navigating')
  const before=await page.evaluate(()=>window.calls.filter(c=>c.method==='POST').length)
  await modal.getByRole('button',{name:'Save draft',exact:true}).evaluate(el=>{el.click();el.click()})
  await modal.getByRole('alert').waitFor({state:'hidden'});await page.waitForFunction(n=>window.calls.filter(c=>c.method==='POST').length===n+1,before)
  await modal.getByRole('button',{name:'Approve computation',exact:true}).click();await modal.getByRole('button',{name:'Record payment',exact:true}).waitFor()
  await modal.getByRole('button',{name:'Record payment',exact:true}).click()
  await modal.getByLabel('Verified withholding',{exact:true}).fill('100')
  await modal.locator('.modern-date-field__trigger').click();await modal.getByLabel('Payment date month',{exact:true}).selectOption('1');await modal.getByRole('button',{name:'2026-02-01',exact:true}).click()
  await modal.getByLabel('Payment reference',{exact:true}).fill('UI-PAY-001');await modal.getByLabel('Payment note',{exact:true}).fill('Verified actual payment by test admin')
  await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Confirm and save',exact:true}).click()
  await modal.getByText('UI-PAY-001',{exact:false}).waitFor();await modal.getByRole('button',{name:'Reopen for review',exact:true}).waitFor()
  await modal.getByRole('button',{name:'Print saved computation',exact:true}).click()
  const printFrame=page.frameLocator('#thirteenth-month-print');await printFrame.getByRole('heading',{name:'13th-Month Pay Statement | 2026',exact:true}).waitFor();await printFrame.getByText('UI-PAY-001',{exact:false}).waitFor()
  const html=await page.locator('#thirteenth-month-print').getAttribute('srcdoc'),printPage=await browser.newPage();await printPage.setContent(html);await printPage.pdf({path:path.join(out,'statement.pdf'),format:'A4',printBackground:true});await printPage.screenshot({path:path.join(out,'statement.png'),fullPage:true});assert.equal((await require('pdf-lib').PDFDocument.load(fs.readFileSync(path.join(out,'statement.pdf')))).getPageCount(),1);await printPage.close()
  await modal.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Release History',exact:true}).click();await page.getByRole('button',{name:'View record',exact:true}).waitFor();await page.screenshot({path:path.join(out,'history-desktop.png'),fullPage:true})
  await page.getByRole('button',{name:'Computation',exact:true}).click()
  for(const width of [375,320]){
   await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page fits viewport')
   await page.getByRole('button',{name:'Review earnings',exact:true}).filter({visible:true}).click();modal=page.getByRole('dialog',{name:'Test Employee',exact:true});assert.ok(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Mobile modal fits viewport');await page.screenshot({path:path.join(out,`employee-mobile-${width}.png`)});await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  }
  await page.getByLabel('Search employee',{exact:true}).fill('missing employee');await page.getByText('No employees match your filters.',{exact:true}).filter({visible:true}).waitFor();await page.getByLabel('Search employee',{exact:true}).fill('')
  await page.getByLabel('Agency',{exact:true}).selectOption('2');await page.getByText('No employees match your filters.',{exact:true}).filter({visible:true}).waitFor();await page.getByLabel('Agency',{exact:true}).selectOption('')
  await page.getByRole('button',{name:'Review earnings',exact:true}).filter({visible:true}).click()
  await page.evaluate(()=>{window.annualVisible.value=false})
  await page.getByRole('dialog',{name:'Test Employee',exact:true}).waitFor({state:'hidden',timeout:3000})
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Navigation releases the page scroll lock')
  await page.evaluate(()=>{window.annualVisible.value=true})
  await page.getByRole('button',{name:'Review earnings',exact:true}).filter({visible:true}).waitFor()
  assert.equal(await page.locator('.annual-backdrop').count(),0)
  assert.deepEqual(errors,[])
  console.log('Browser checks passed: filters, retained form entries, error recovery, double-click guard, approve/release UI, Excel import/export, nonblank one-page print, keyboard focus, and 320/375 px layout.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
