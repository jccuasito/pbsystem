// Real report component, synthetic import results and browser downloads; no database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const sfc=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright'),XLSX=require('xlsx')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data/dtr-import-review-tests'),styles=[]
fs.mkdirSync(output,{recursive:true})
const base={employeeId:11,employeeName:'GARCIA, MARIA REYES',employeeNumber:'',sourceEmployee:'EMP-0011',attendanceDate:'2026-09-23',shiftCode:'NS2200-1000',sourceStatus:'',timeIn:'2026-09-23 22:16:00',timeOut:'2026-09-24 10:00:00',expectedTimeIn:'2026-09-23 22:00:00',expectedTimeOut:'2026-09-24 10:00:00',lateMinutes:16,undertimeMinutes:0,outcome:'updated',flags:['late'],reason:'Duty imported; review any flags before payroll.',canReview:true}
const rows=[
 {...base,row:27},
 {...base,row:11,employeeId:10,employeeName:'DELA CRUZ, JUAN SANTOS',employeeNumber:'DJA-0001',attendanceDate:'2026-09-22',timeOut:null,lateMinutes:0,outcome:'blank',flags:['missing-out'],reason:'Time-out is missing; confirm punches or non-work status.'},
 {...base,row:22,attendanceDate:'2026-09-18',timeIn:null,timeOut:null,lateMinutes:0,outcome:'blank',flags:['no-punches'],reason:'No punches recorded. A blank does not confirm absence.'},
 {...base,row:30,attendanceDate:'2026-09-26',shiftCode:'DS0930-2130',lateMinutes:0,outcome:'skipped',flags:['skipped'],reason:'Shift code "DS0930-2130" does not exist or is inactive for this DTR agency.'},
 {...base,row:40,sourceStatus:'On-Leave',lateMinutes:0,outcome:'preserved',flags:['preserved'],reason:'HR-approved On-Leave was preserved.'},
 ...Array.from({length:60},(_,i)=>({...base,row:100+i,lateMinutes:0,flags:[],employeeName:i===0?'=FORMULA IS A NAME':'SAMPLE EMPLOYEE '+i,reason:'Duty imported.'})),
]
;(async()=>{
 const bundle=await build({stdin:{resolveDir:root,contents:`import{createApp,h,ref}from'vue';import Report from './app/components/DtrImportResultModal.vue';import Workspace from './app/components/DtrAttendanceWorkspace.vue';const result=ref(window.fixture),visible=ref(true),scene=ref('report'),workspaceKey=ref(0);window.remountWorkspace=()=>workspaceKey.value++;window.replaceReport=value=>result.value=value;window.reopen=()=>result.value=window.fixture;window.toggleReport=value=>visible.value=value;window.startWorkspace=()=>scene.value='workspace';createApp({setup(){return()=>scene.value==='workspace'?h(Workspace,{dtr:window.dtrFixture,key:workspaceKey.value}):h(Report,{result:result.value,visible:visible.value,fileName:'Biometrics.xlsx',sheetName:'DTR',onClose(){result.value=null},onDone(){result.value=null},onReview(row){window.reviewed=row;result.value=null}})}}).mount('#app')`},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  let {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
  const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
  if(args.path.endsWith('DtrAttendanceWorkspace.vue')){
   const content=fs.readFileSync(args.path,'utf8').replace('<script setup lang="ts">', '<script setup lang="ts">\nimport {ref,computed,watch,onMounted,nextTick,useId} from \'vue\';').replace('</script>','window.workspaceTest={importResult,importReportOpen,dayOpen,dayForm,importReviewRow,openDay,rows,importFileName,importSheetName};\n</script>')
   descriptor=sfc.parse(content,{filename:args.path}).descriptor
  }
  const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
  styles.push(...descriptor.styles.map(style=>sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code))
  return{contents:script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
 })}}]})
 const browser=await chromium.launch({headless:true,executablePath:process.env.THEME_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://**/*',route=>route.abort())
  const css=['base','theme','components','auth','dashboard'].map(name=>fs.readFileSync(path.join(root,'assets/css/'+name+'.css'),'utf8')).join('\n')
  await page.setContent(`<html><head><style>${css}\n${styles.join('\n')}</style></head><body><div id="app"></div></body></html>`)
  await page.evaluate(reviewRows=>window.fixture={imported:0,updated:61,skipped:2,blank:2,preservedEmployeeStatusDays:1,issues:[{row:30,reason:reviewRows[3].reason}],reviewRows},rows)
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  const dialog=page.getByRole('dialog',{name:'Import completed with notes'})
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(el=>el.scrollTop),0)
  assert.equal(await dialog.locator('.review-table tbody tr').count(),0,'Detailed rows stay hidden initially')
  const priority=dialog.getByRole('region',{name:'Shift codes to fix first'})
  await priority.getByText('DS0930-2130',{exact:true}).waitFor()
  await page.screenshot({path:path.join(output,'summary-shift-desktop.png')})
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844})
   await priority.getByText('DS0930-2130',{exact:true}).waitFor()
   assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true)
   await page.screenshot({path:path.join(output,`summary-shift-mobile-${width}.png`)})
  }
  await page.setViewportSize({width:1440,height:1100})
  await priority.getByRole('button',{name:'Review shift code DS0930-2130',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),1)
  await dialog.getByText('Excel row 30',{exact:true}).waitFor()
  await dialog.getByRole('button',{name:'Back to summary',exact:false}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),0)

  await dialog.getByRole('button',{name:'Late 1',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),1)
  await dialog.getByText('Late · 16 min',{exact:true}).waitFor()
  await dialog.getByText('Excel row 27',{exact:true}).waitFor()
  await dialog.locator('.row-extra summary').click()
  assert.match(await dialog.locator('.review-punches').innerText(),/2026-09-24 10:00/)
  await page.screenshot({path:path.join(output,'review-late-desktop.png')})
  // The download includes every source row even when Late is the selected filter.
  const downloadPromise=page.waitForEvent('download')
  await dialog.getByRole('button',{name:'Download report',exact:true}).click()
  const download=await downloadPromise
  assert.equal(download.suggestedFilename(),'Biometrics_import-review.xlsx')
  const file=path.join(output,download.suggestedFilename());await download.saveAs(file)
  const book=XLSX.readFile(file),exported=XLSX.utils.sheet_to_json(book.Sheets['Row details'])
  assert.equal(exported.length,65);assert.equal(exported[0]['Late minutes'],16)
  assert.equal(exported[0]['Excel row'],27);assert.equal(book.Sheets['Row details'].B7.t,'s');assert.equal(book.Sheets['Row details'].B7.f,undefined);assert.equal(book.Sheets['Row details'].B7.v,'=FORMULA IS A NAME')
  await dialog.getByRole('button',{name:'All rows 65',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),50)
  await dialog.getByRole('button',{name:'Show 50 more',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),65)
  await dialog.getByLabel('Search import rows',{exact:true}).fill('DJA-0001')
  assert.equal(await dialog.locator('.review-table tbody tr').count(),1)
  await dialog.getByText('Missing time-out',{exact:true}).waitFor()
  await dialog.getByLabel('Search import rows',{exact:true}).fill('')
  await dialog.getByRole('button',{name:'No punches 1',exact:true}).click()
  await dialog.getByText('Excel row 22',{exact:true}).waitFor()
  await page.evaluate(()=>window.toggleReport(false));await dialog.waitFor({state:'hidden'})
  await page.evaluate(()=>window.toggleReport(true));await dialog.waitFor()
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844})
   await page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',width===320)
   await dialog.getByRole('combobox',{name:'Show import rows',exact:true}).selectOption('late')
   await dialog.getByText('Excel row 27',{exact:true}).waitFor()
   await dialog.locator('.review-table tbody tr').first().scrollIntoViewIfNeeded()
   assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true)
   await page.screenshot({path:path.join(output,`review-mobile-${width}.png`)})
  }
  await dialog.getByRole('combobox',{name:'Show import rows',exact:true}).selectOption('no-punches')
  await dialog.getByRole('button',{name:'Review in DTR',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  const selected=await page.evaluate(()=>window.reviewed)
  assert.equal(selected.row,22);assert.equal(selected.employeeId,11);assert.equal(selected.attendanceDate,'2026-09-18')
  await page.evaluate(()=>window.reopen())
  await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
  // All review rows, including those beyond legacy notes, are grouped by missing code.
  await page.setViewportSize({width:1440,height:1100})
  await page.evaluate(()=>window.replaceReport({skipped:3,reviewRows:[window.fixture.reviewRows[3],{...window.fixture.reviewRows[3],row:130},{...window.fixture.reviewRows[3],row:131,shiftCode:'',reason:'Shift code is blank.'}],issues:[]}))
  await dialog.waitFor()
  await dialog.getByRole('region',{name:'Shift codes to fix first'}).getByText('2 affected rows', {exact:false}).waitFor()
  await dialog.getByRole('button',{name:'Review shift code DS0930-2130',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),2)
  await dialog.getByRole('button',{name:'Shift codes 3',exact:true}).click()
  assert.equal(await dialog.locator('.review-table tbody tr').count(),3)
  await dialog.getByRole('button',{name:'Back to summary',exact:false}).click()
  await dialog.getByText('Blank shift code',{exact:true}).waitFor()
  await page.evaluate(()=>window.replaceReport({skipped:1,issues:[{row:21,reason:'Shift code TEST is missing.'}]}))
  await dialog.getByRole('region',{name:'Shift codes to fix first'}).getByText('TEST',{exact:true}).waitFor()
  assert.equal(await dialog.locator('.review-table').count(),0)
  await page.evaluate(()=>window.replaceReport({skipped:7,issues:Array.from({length:7},(_,index)=>({row:200+index,reason:'Shift code "MISSING'+index+'" does not exist or is inactive for this DTR agency.'}))}))
  assert.equal(await dialog.locator('.shift-priority li').count(),5)
  await dialog.getByRole('button',{name:'Show 2 more shift codes',exact:true}).click()
  assert.equal(await dialog.locator('.shift-priority li').count(),7)
  await page.evaluate(()=>window.replaceReport({imported:4,updated:0,skipped:0,reviewRows:[]}))
  await page.getByRole('dialog',{name:'Import completed',exact:true}).waitFor()
  assert.equal(await dialog.locator('.shift-priority').count(),0)
  await page.keyboard.press('Escape')
  // Exercise the actual workspace/report/editor stack against synthetic HTTP only.
  await page.setViewportSize({width:1440,height:1000})
  await page.evaluate(()=>{
   document.documentElement.dataset.theme='light'
   window.dtrFixture={BatchID:11,AgencyID:1,AgencyName:'TEST AGENCY',ClientName:'SAMPLE CLIENT',SiteName:'SAMPLE SITE',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',Status:'Draft'}
   window.savedRequests=[];window.failSave=false;window.delaySave=false
   window.dtrPayload={records:[{EmployeeID:10,EmployeeNumber:'DJA-0001',EmployeeName:'DELA CRUZ, JUAN SANTOS',DeploymentType:'Regular',Days:0},{EmployeeID:11,EmployeeName:'GARCIA, MARIA REYES',DeploymentType:'Regular',Days:1}],attendanceRows:[{EmployeeID:11,AttendanceDate:'2026-09-23',AttendanceStatus:'Present',ShiftCodeID:7,TimeIn:'2026-09-23 22:16:00',TimeOut:'2026-09-24 10:00:00',RegularHours:8,OTHours:4,LateHours:16/60}],shifts:[{ShiftCodeID:7,AgencyID:1,ShiftCode:'NS2200-1000',ShiftName:'Night shift',ShiftType:'NS',TimeIn:'22:00',TimeOut:'10:00',RegularHours:8,RegularOTCap:4,Status:'Active'}],policy:{AutoBreakEnabled:0}}
   window.$fetch=async(url,options)=>{
    if(options?.method==='POST'){
     window.savedRequests.push({url,...options})
     if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve)
     if(window.failSave)throw new Error('Synthetic save failure')
     return{success:true}
    }
    return window.dtrPayload
   }
   window.startWorkspace()
  })
  await page.waitForFunction(()=>window.workspaceTest?.rows.value.length===2)
  const toolbarGeometry=()=>page.locator('.dtr-attendance-layer .workspace>.toolbar').evaluate(el=>({width:el.clientWidth,height:el.getBoundingClientRect().height,buttons:[...el.querySelectorAll('button')].map(button=>({text:button.innerText,height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width}))}))
  const initialToolbar=await toolbarGeometry()

  await page.evaluate(()=>{
   window.workspaceTest.importResult.value=window.fixture
   window.workspaceTest.importFileName.value='Biometrics.xlsx'
   window.workspaceTest.importSheetName.value='DTR'
   window.workspaceTest.importReportOpen.value=true
  })
  const report=page.locator('dialog.dtr-import-result'),editor=page.getByRole('dialog',{name:'Review imported attendance',exact:true})
  await report.waitFor()
  const importedToolbar=await toolbarGeometry()
  assert.equal(importedToolbar.height,initialToolbar.height,'An import must not resize the toolbar')
  assert.deepEqual(importedToolbar.buttons,initialToolbar.buttons,'Button geometry stays stable after import')
  assert.ok(importedToolbar.buttons.every(button=>button.height===44),'All toolbar buttons remain 44px tall')
  await report.getByRole('button',{name:'View row details',exact:true}).click()
  await report.getByRole('button',{name:'Missing one punch 1',exact:true}).click()
  await report.getByLabel('Search import rows',{exact:true}).fill('DJA-0001')
  const reviewButton=report.getByRole('button',{name:'Review in DTR',exact:true})
  await reviewButton.scrollIntoViewIfNeeded()
  const reportScroll=await report.evaluate(el=>el.scrollTop)
  await reviewButton.click();await editor.waitFor()
  assert.equal(await report.evaluate(el=>el.open),true)
  assert.equal(await editor.evaluate(el=>el.matches(':modal')),true)
  assert.equal(await page.evaluate(()=>window.savedRequests.length),0)
  await editor.getByRole('complementary',{name:'Original Excel row'}).getByText('Time-out is missing; confirm punches or non-work status.',{exact:true}).waitFor()
  assert.equal(await editor.getByLabel('Time in',{exact:true}).inputValue(),'')
  assert.equal(await editor.getByLabel('Time out',{exact:true}).inputValue(),'')
  const reviewWidth=(await editor.boundingBox()).width
  await page.screenshot({path:path.join(output,'review-editor-desktop.png')})
  await editor.getByRole('button',{name:'Back to report',exact:true}).click()
  await editor.waitFor({state:'hidden'})
  assert.equal(await report.getByLabel('Search import rows',{exact:true}).inputValue(),'DJA-0001')
  assert.ok(Math.abs(await report.evaluate(el=>el.scrollTop)-reportScroll)<2)
  assert.equal(await reviewButton.evaluate(el=>el===document.activeElement),true)
  await reviewButton.click();await editor.waitFor();await page.keyboard.press('Escape')
  await editor.waitFor({state:'hidden'});assert.equal(await report.evaluate(el=>el.open),true)
  await reviewButton.click();await editor.waitFor()
  await editor.getByRole('button',{name:'Close attendance editor',exact:true}).click()
  await editor.waitFor({state:'hidden'})
  // Save failures stay in review; a successful save returns to the unchanged report.
  await reviewButton.click();await editor.waitFor()
  await editor.getByLabel('Status',{exact:true}).selectOption('Absent')
  await page.evaluate(()=>window.failSave=true)
  await editor.getByRole('button',{name:'Save and return to report',exact:true}).click()
  await editor.getByRole('alert').filter({hasText:'Synthetic save failure'}).waitFor()
  assert.equal(await editor.evaluate(el=>el.open),true)
  await page.evaluate(()=>{window.failSave=false;window.delaySave=true})
  await editor.getByRole('button',{name:'Save and return to report',exact:true}).click()
  await page.waitForFunction(()=>Boolean(window.releaseSave))
  await page.keyboard.press('Escape')
  assert.equal(await editor.evaluate(el=>el.open),true)
  await page.evaluate(()=>{window.delaySave=false;window.releaseSave()})
  await editor.waitFor({state:'hidden'})
  assert.equal(await report.evaluate(el=>el.open),true)
  assert.equal(await report.getByLabel('Search import rows',{exact:true}).inputValue(),'DJA-0001')
  assert.equal(await page.evaluate(()=>window.savedRequests.at(-1).body.AttendanceStatus),'Absent')
  // The original report does not pretend saved corrections changed the upload.
  await report.getByText('Missing time-out',{exact:true}).waitFor()
  // Nested shift creation remains operable above both native dialogs.
  await reviewButton.click();await editor.waitFor()
  const shiftInput=editor.getByPlaceholder('Type shift code or name')
  await shiftInput.fill('DS0700-1900')
  await editor.getByRole('button',{name:/Create shift code/}).click()
  const shiftDialog=page.getByRole('dialog',{name:'Create shift code',exact:true})
  await shiftDialog.waitFor();await shiftDialog.getByLabel('Shift name',{exact:true}).fill('New day shift')
  await page.keyboard.press('Escape');await shiftDialog.waitFor({state:'hidden'})
  assert.equal(await editor.evaluate(el=>el.matches(':modal')),true)
  await editor.getByRole('button',{name:'Back to report',exact:true}).click()
  await report.getByRole('button',{name:'Close report',exact:true}).click();await report.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'Import report',exact:true}).click();await report.waitFor()
  assert.equal(await report.getByLabel('Search import rows',{exact:true}).inputValue(),'DJA-0001')
  // Normal editing has the same width and no source-review context.
  await report.getByRole('button',{name:'Close report',exact:true}).click()
  await page.evaluate(()=>window.workspaceTest.openDay(window.workspaceTest.rows.value[0],'2026-09-22'))
  const regular=page.getByRole('dialog',{name:'Attendance input',exact:true});await regular.waitFor()
  assert.equal((await regular.boundingBox()).width,reviewWidth)
  assert.equal(await regular.locator('.import-source-context').count(),0)
  await regular.getByRole('button',{name:'Cancel',exact:true}).click();await regular.waitFor({state:'hidden'})
  // Mobile and dark mode have one scrolling body and a visible, reachable footer.
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844})
   await page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',width===320)
   await page.getByRole('button',{name:'Import report',exact:true}).click();await report.waitFor()
   await report.getByRole('button',{name:'Review in DTR',exact:true}).click();await editor.waitFor()
   assert.equal(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth),true)
   const bounds=await editor.boundingBox(),footer=await editor.locator('footer').boundingBox()
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1)
   assert.ok(footer.y+footer.height<=844&&footer.y>=0)
   await editor.locator('.day-dialog-body').evaluate(el=>el.scrollTop=el.scrollHeight)
   await page.screenshot({path:path.join(output,`review-editor-mobile-${width}.png`)})
   await editor.getByRole('button',{name:'Back to report',exact:true}).click()
   await report.getByRole('button',{name:'Close report',exact:true}).click()
  }
  await page.getByRole('button',{name:'Import report',exact:true}).click();await report.waitFor()
  await report.getByRole('button',{name:'Done review',exact:true}).click();await report.waitFor({state:'hidden'})
  assert.equal(await page.getByRole('button',{name:'Import report',exact:true}).isDisabled(),true)
  // Before/after report availability and workspace remount use the same layout.
  for(const width of [1916,1440,1280,768,390,320]){
   await page.setViewportSize({width,height:1000})
   await page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',width===320)
   const fresh=await toolbarGeometry()
   assert.ok(fresh.buttons.every(button=>button.height===44))
   await page.evaluate(()=>window.workspaceTest.importResult.value=window.fixture)
   await page.waitForFunction(()=>!document.querySelector('.dtr-toolbar-actions button[title^="View the latest"]').disabled)
   const imported=await toolbarGeometry()
   assert.equal(imported.height,fresh.height,`Stable toolbar at ${width}px`)
   assert.deepEqual(imported.buttons,fresh.buttons)
   assert.equal(await page.locator('.dtr-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth),true)
   await page.screenshot({path:path.join(output,`workspace-toolbar-${width}.png`)})
   await page.evaluate(()=>window.remountWorkspace())
   await page.waitForFunction(()=>window.workspaceTest.rows.value.length===2&&document.querySelector('.dtr-toolbar-actions button[title^="Available after"]').disabled)
   const reopened=await toolbarGeometry()
   assert.equal(reopened.height,imported.height,`Reopening DTR keeps toolbar height at ${width}px`)
   assert.deepEqual(reopened.buttons,imported.buttons)

  }
  assert.equal(await page.evaluate(()=>window.workspaceTest.importResult.value),null)
  assert.deepEqual(errors,[])
  console.log('PASS: shift-first compact summary, grouped/blank/legacy shift warnings, collapsed details, row filters/search, complete XLSX download, 50-row rendering, mobile/dark layout, DTR review event, stacked workspace review, Save/Cancel/Escape/failure, nested shift creation, stable sizing, toolbar geometry before/after import across six widths and explicit completion.')
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
