// Browser QA uses synthetic snapshots and mocked portal responses, never live accounts.
// Run with NODE_PATH pointing to a Playwright installation and PORTAL_BROWSER_PATH
// pointing to a Chromium browser. No extra application dependency is required.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data','portal-mobile-tests')
const employee={EmployeeID:999999,EmployeeNumber:'TEST-ONLY',EmployeeName:'TEST EMPLOYEE',AgencyName:'Synthetic Agency',PositionName:'Supervisor'}
const snapshot={publicationId:1,postedAt:'2026-10-25T03:35:00.000Z',employee,cutoff:{key:'test',status:'Approved',assignmentType:'Regular',periodStart:'2026-10-01',periodEnd:'2026-10-15',payrollIds:[1,2],gross:12345.67,deductions:1700,net:10645.67,lines:[{section:'earnings',label:'Regular',hours:104,amount:10400},{section:'earnings',label:'OT',hours:12,amount:1440},{section:'adjustment',label:'Adjustment · Verified prior-period allowance correction',hours:0,amount:505.67},{section:'government',label:'SSS · Premium',amount:1100},{section:'government',label:'PhilHealth',amount:350},{section:'government',label:'Pag-ibig · Premium',amount:250}],sources:[{payrollId:1,siteName:'Test North Site',clientName:'Synthetic Client',batchId:1,gross:10000,net:8300},{payrollId:2,siteName:'Test South Site',clientName:'Synthetic Client',batchId:2,gross:2345.67,net:2345.67}]}}

async function buildFixture(){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './app/pages/employee-portal/index.vue';const app=createApp(Portal);app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>({path:path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2))+'.ts'}))
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

test('mobile portal cards, historical sites and full PNG download work in Chromium',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  async function load(slip=snapshot,account=true){
   await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><div id="app"></div>')
   await page.addStyleTag({content:fixture.css})
   await page.evaluate(({slip,employee,account})=>{window.$fetch=async(url)=>{
    if(!account)throw{status:401}
    if(url.endsWith('/me'))return{account:{...employee,CurrentSites:[{SiteID:3,SiteName:'Current Test Site',ClientName:'Synthetic Client',IsPermanentSite:1,DeploymentType:'Regular'}]}}
    if(url.endsWith('/payslips'))return{payslips:[slip]}
    throw new Error('Unexpected fixture request: '+url)
   }},{slip,employee,account})
   await page.addScriptTag({content:fixture.script})
   await page.locator('.portal-loading').waitFor({state:'hidden'})
  }
  async function assertFits(label){
   const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,5).map(el=>el.className)}))
   assert.ok(sizes.scroll<=sizes.width+1,label+': '+JSON.stringify(sizes))
  }
  for(const width of [320,375,430,1280]){
   await page.setViewportSize({width,height:850});await load()
   await assertFits('List '+width)
   await page.getByRole('link',{name:/Employee Portal/}).waitFor()
   assert.equal(await page.locator('.portal-mobile-payslips').isVisible(),width<=760)
   assert.equal(await page.locator('.portal-table').isVisible(),width>760)
   await page.getByText('Current Test Site',{exact:true}).waitFor()
   if(width===375)await page.screenshot({path:path.join(output,'mobile-list.png'),fullPage:true})
   await page.getByRole('button',{name:'View payslip',exact:true}).filter({visible:true}).click()
   assert.match(await page.locator('.sheet-site').innerText(),/Test North Site \/ Test South Site/)
   assert.equal(await page.locator('.sheet-note').count(),0,'Employee portal hides staff record explanation')
   assert.equal(await page.locator('.portal-posted strong').innerText(),'Oct 25, 2026, 11:35 AM')
   await assertFits('Payslip '+width)
   if(width===375){
    await page.screenshot({path:path.join(output,'mobile-payslip.png'),fullPage:true})
    await page.getByRole('button',{name:'Save as PNG',exact:true}).click()
    const preview=page.getByRole('dialog',{name:'Save your payslip'});await preview.waitFor()
    await assertFits('PNG preview '+width)
    await page.screenshot({path:path.join(output,'mobile-image-preview.png'),fullPage:true})
    const closeSize=await preview.getByRole('button',{name:'Close image preview'}).boundingBox()
    assert.ok(Math.abs(closeSize.width-closeSize.height)<1,'Preview close control is square')
    const dimensions=await preview.locator('img').evaluate(async img=>{await img.decode();return{width:img.naturalWidth,height:img.naturalHeight}})
    assert.ok(dimensions.width>=1600&&dimensions.width>dimensions.height,'Saved PNG uses a landscape payslip layout')
    const downloadPromise=page.waitForEvent('download');await preview.getByRole('link',{name:'Download PNG'}).click()
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),'Payslip-TEST-ONLY-2026-10-01-2026-10-15.png')
    const pngPath=path.join(output,'test-payslip.png');await download.saveAs(pngPath)
    assert.equal(fs.readFileSync(pngPath).subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    await preview.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('.portal-image-modal').count(),0)
    await page.evaluate(()=>{const original=window.$fetch;window.$fetch=async url=>{const result=await original(url);return url.endsWith('/payslips')?{payslips:result.payslips.map(item=>({...item,postedAt:'2026-10-25T03:45:00.000Z'}))}:result}})
    await page.getByRole('button',{name:'Refresh',exact:true}).click()
    await page.locator('.portal-loading').waitFor({state:'hidden'})
    assert.equal(await page.locator('.portal-posted strong').innerText(),'Oct 25, 2026, 11:45 AM','Refresh updates the open payslip snapshot')
   }
   if(width===1280){await page.screenshot({path:path.join(output,'desktop-payslip.png'),fullPage:true});await page.getByRole('button',{name:'Save as PNG',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Save your payslip'});await dialog.waitFor();await page.screenshot({path:path.join(output,'desktop-image-preview.png'),fullPage:true});await dialog.getByRole('button',{name:'Close',exact:true}).click()}
   await page.getByRole('button',{name:'← Back to payslips'}).click()
   await page.getByPlaceholder('Cutoff or site').fill('no matching site');assert.equal(await page.locator('.mobile-payslip-card').count(),0)
  }
  // Stress long names/labels as well as the sign-up layout at the narrowest width.
  const long=structuredClone(snapshot);long.employee.EmployeeName='SYNTHETIC VERY LONG EMPLOYEE NAME FOR MOBILE WRAPPING';long.cutoff.sources[0].siteName='Test Site '+ 'VeryLongSiteName'.repeat(6);long.cutoff.lines[0].label='VeryLongEarningDescription'.repeat(3)
  await page.setViewportSize({width:320,height:740});await load(long)
  await page.getByRole('button',{name:'View payslip',exact:true}).filter({visible:true}).click();await assertFits('Long content')
  long.cutoff.lines.push(...Array.from({length:36},(_,index)=>({section:'other',label:'Synthetic deduction reference '+index,amount:10})))
  await load(long);await page.getByRole('button',{name:'View payslip',exact:true}).filter({visible:true}).click()
  await page.getByRole('button',{name:'Save as PNG',exact:true}).click()
  const longPreview=page.getByRole('dialog',{name:'Save your payslip'});await longPreview.waitFor()
  const longDimensions=await longPreview.locator('img').evaluate(async img=>{await img.decode();return{width:img.naturalWidth,height:img.naturalHeight}})
  assert.ok(longDimensions.width>longDimensions.height,'Long itemized exports stay landscape')
  const longDownloadPromise=page.waitForEvent('download');await longPreview.getByRole('link',{name:'Download PNG'}).click()
  await(await longDownloadPromise).saveAs(path.join(output,'test-payslip-long.png'))
  await load(snapshot,false);await page.getByRole('button',{name:'Create account',exact:true}).first().click();await assertFits('Sign up')
  const first=page.getByLabel('First name',{exact:true});await first.fill('test');assert.equal(await first.inputValue(),'TEST')
  assert.deepEqual(errors,[],'No runtime errors')
  await context.close()
 }finally{await browser.close()}
})
