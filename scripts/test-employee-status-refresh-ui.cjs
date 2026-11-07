// Browser regression uses synthetic employees and mocked HTTP responses, never live records.
// Requires Playwright through NODE_PATH; EMPLOYEE_STATUS_BROWSER_PATH optionally selects Chromium.
// Unlike static UI fixtures, this exercises the actual 5-second useRealtimeRefresh composable.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {parse,compileScript,compileStyle}=require('@vue/compiler-sfc'),{buildSync}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),file=path.join(root,'app/pages/employees/status/index.vue'),id='data-v-hr-status-check'
const {descriptor}=parse(fs.readFileSync(file,'utf8'),{filename:file})
let source=compileScript(descriptor,{id,inlineTemplate:true}).content
source=source.replace(/import (\w+) from ['"][^'"]+\.vue['"];?/g,(_,name)=>`const ${name}={render(){return null}}`)

source=source.replace('export default ','const Component=')+`;Component.__scopeId='${id}';import{createApp}from'vue';createApp(Component).mount('#app')`
const bundle=buildSync({stdin:{contents:source,loader:'ts',resolveDir:path.dirname(file)},bundle:true,write:false,platform:'browser',format:'iife',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'}}).outputFiles[0].text
const css=descriptor.styles.map(style=>compileStyle({source:style.content,filename:file,id,scoped:style.scoped}).code).join('\n')
const globals=['base','theme','components','auth','dashboard','payroll-processing'].map(name=>fs.readFileSync(path.join(root,'assets/css/'+name+'.css'),'utf8')).join('\n')


;(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EMPLOYEE_STATUS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1366,height:1000}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.setContent(`<html><head><style>${globals}\n${css}\nbody{background:#f8fafc;font-family:Arial,sans-serif}#app{margin-left:140px}</style></head><body><div id="app"></div></body></html>`)
 await page.evaluate(()=>{
  window.metaCalls=0;window.cutoffCalls=0;window.cutoffPending=false;window.metaPending=false;window.failNextCutoff=false;window.posts=[]
  const employees=Array.from({length:200},(_,i)=>({EmployeeID:i+1,EmployeeNumber:i?'000'+(i+1):null,EmployeeName:'Test Employee '+String(i+1).padStart(3,'0'),AgencyName:'Test Agency',PositionName:'Guard'}))
  window.$fetch=async(url,opts)=>{
   const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
   if(opts?.method==='POST'){window.posts.push(opts.body);return {success:true,created:1,pending:1}}
   if(url==='/api/employees/status/cutoff'){
    window.cutoffCalls++;window.cutoffPending=true
    await delay(window.delayCutoff||450)
    window.cutoffPending=false
    if(window.failNextCutoff){window.failNextCutoff=false;throw Error('Simulated disconnected request')}
    const start=opts.query.startDate,end=opts.query.endDate
    return {history:[{EmployeeID:1,AttendanceID:1,AttendanceDate:start,AttendanceStatus:'Present',SiteID:1,SiteName:'Dated Site',ClientName:'Test Client'}],cutoffs:[]}
   }
   if(url.includes('/summary')){await delay(250);return {year:2026,availableYears:[2026],history:[],cutoffs:[]}}
   window.metaCalls++;window.metaPending=true;await delay(80);window.metaPending=false
   return {employees,deployments:[],cutoffs:[],dtrCutoffs:[],availableYears:[2026]}
  }
 })
 await page.addScriptTag({content:bundle})
 const table=page.getByRole('table',{name:'Employee cutoff summaries'})
 await table.waitFor();assert.equal(await table.locator('tbody tr').count(),200)
 await table.evaluate(el=>{window.originalStatusTable=el;window.originalTableTop=el.getBoundingClientRect().top})
 await page.waitForFunction(()=>window.metaCalls>=2&&window.cutoffPending)
 const count=await table.count()
  assert.equal(count,1,'Background refresh must retain table/buttons')
  assert.equal(await table.evaluate(el=>el===window.originalStatusTable),true,'Keep the same DOM table')
  assert.equal(await table.evaluate(el=>el.getBoundingClientRect().top===window.originalTableTop),true,'Refresh must not shift button positions')
  await table.locator('tbody tr').first().getByRole('button',{name:'Update status',exact:true}).click()
  const sheet=page.locator('.sheet-modal');await sheet.waitFor()
  await sheet.getByRole('table',{name:'Daily employee statuses'}).waitFor()
  assert.equal(await sheet.locator('.person-button').count(),1)
  assert.match(await sheet.locator('.person-button').textContent(),/Test Employee 001/)
  await sheet.locator('footer').getByRole('button',{name:'Close',exact:true}).click()
  await page.evaluate(()=>{window.failNextCutoff=true;window.dispatchEvent(new Event('focus'))})
  await page.getByRole('alert').filter({hasText:/refresh/i}).waitFor()
  assert.equal(await table.count(),1,'Failed background refresh retains cached table')
  await table.locator('tbody tr').nth(1).getByRole('button',{name:'View summary',exact:true}).click()
  await page.locator('.summary-modal').waitFor()
  await page.locator('.summary-modal .modal-close').click()
  await table.locator('tbody tr').nth(2).getByRole('button',{name:'View summary',exact:true}).click()
  await page.locator('.summary-modal').waitFor()
  await page.waitForFunction(()=>!document.querySelector('.summary-state')?.textContent.includes('Loading'))
  assert.match(await page.locator('.summary-modal h2').textContent(),/Test Employee 003/)
  await page.locator('.summary-modal .modal-close').click()
  await page.getByRole('button',{name:'Retry refresh',exact:true}).click()
  await page.waitForFunction(()=>!window.cutoffPending&&!window.metaPending)
  await page.getByRole('alert').filter({hasText:/refresh/i}).waitFor({state:'hidden'})
  assert.deepEqual(errors,[])
  console.log('PASS: real polling with 200 employees, slow responses, stable DOM buttons, update dialog, background failure, rapid summary reopen')
 await page.close()
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
