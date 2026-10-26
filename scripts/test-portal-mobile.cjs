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
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './app/pages/employee-portal/index.vue';const app=createApp(Portal);app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});window.portalApp=app;app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>({path:path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2))+'.ts'}))
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-head-fixture',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead = value => { document.title = value.title }; export const onBeforeRouteLeave = callback => { window.portalLeaveGuard = callback }',loader:'js'}))
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

test('mobile portal cards, historical sites and full PNG download work in Chromium',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.request().url().endsWith('/images/logo.png')?route.fulfill({path:path.join(root,'public/images/logo.png'),contentType:'image/png'}):route.abort())
  async function load(slip=snapshot,account=true,employeeNumber=employee.EmployeeNumber){
   await page.evaluate(()=>window.portalApp?.unmount())
   await page.setContent('<!doctype html><base href="http://portal.test"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><div id="app"></div>')
   await page.addStyleTag({content:fixture.css})
   await page.evaluate(({slip,employee,account,employeeNumber})=>{window.$fetch=async(url)=>{
    if(!account)throw{status:401}
    if(url.endsWith('/me'))return{account:{...employee,EmployeeNumber:employeeNumber,Email:'employee@example.invalid',ContactNumber:'09000000000',CurrentSites:[{SiteID:3,SiteName:'Current Test Site',ClientName:'Synthetic Client',IsPermanentSite:1,DeploymentType:'Regular'}]}}
    if(url.endsWith('/payslips'))return{payslips:[slip]}
    throw new Error('Unexpected fixture request: '+url)
   }},{slip,employee,account,employeeNumber})
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
   assert.equal(await page.title(),'Payslip Portal - DJA Group of Companies')
   await page.getByRole('link',{name:/Payslip Portal/}).waitFor()
   assert.equal(await page.locator('.portal-mobile-payslips').isVisible(),width<=760)
   assert.equal(await page.locator('.portal-table').isVisible(),width>760)
   await page.getByText('Current Test Site',{exact:true}).waitFor()
   assert.equal(await page.locator('.welcome-agency strong').innerText(),'Synthetic Agency','The employee agency is shown explicitly on phone and desktop')
   assert.equal(await page.locator('.welcome-meta').innerText(),'TEST-ONLY')
   if(width===375)await page.screenshot({path:path.join(output,'mobile-list.png'),fullPage:true})
   if(width===1280)await page.screenshot({path:path.join(output,'desktop-list.png'),fullPage:true})
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
  for(const width of [320,375,1280]){
   await page.setViewportSize({width,height:850});await load(snapshot,false);await assertFits('Sign in '+width)
   await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.locator('#portal-password').getAttribute('type'),'text')
   await page.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await page.locator('#portal-password').getAttribute('type'),'password')
   assert.equal(await page.getByRole('button',{name:/Google|OTP/}).count(),0)
   await page.screenshot({path:path.join(output,'login-'+width+'.png'),fullPage:true})
  }
  await page.setViewportSize({width:375,height:850});await load()
  await page.getByRole('button',{name:'My account',exact:true}).click();await assertFits('My account')
  await page.screenshot({path:path.join(output,'mobile-account.png'),fullPage:true})
  assert.ok(await page.getByRole('button',{name:'Save account details',exact:true}).isDisabled(),'Unchanged details cannot be saved')
  await page.evaluate(()=>{
   window.profileSubmissions=[];window.logoutSubmissions=0;window.profileFailOnce=false
   const original=window.$fetch
   window.$fetch=async(url,options)=>{
    if(url.endsWith('/profile')){window.profileSubmissions.push(options.body);if(window.profileFailOnce){window.profileFailOnce=false;throw{data:{statusMessage:'Synthetic save failure. Please verify your current password.'}}}if(window.delayProfile)await new Promise(resolve=>{window.finishProfile=resolve});return{success:true}}
    if(url.endsWith('/logout')){window.logoutSubmissions++;return{success:true}}
    return original(url,options)
   }
  })
  const loginEmail=page.getByLabel('Login email',{exact:true})
  await loginEmail.fill('updated@example.invalid')
  await page.getByLabel('Current password',{exact:true}).fill('CurrentPassword123')
  await page.getByLabel('New password (optional)',{exact:true}).fill('NewSecretPassword123')
  await page.getByLabel('Confirm new password',{exact:true}).fill('NewSecretPassword123')
  await page.getByRole('button',{name:'My account',exact:true}).click();assert.equal(await loginEmail.inputValue(),'updated@example.invalid','Opening the active settings tab does not reset edits')
  assert.equal(await page.evaluate(()=>window.profileSubmissions.length),0,'Typing does not save details')
  const saveDialog=page.getByRole('alertdialog',{name:'Save these account changes?',exact:true})
  await page.getByRole('button',{name:'Save account details',exact:true}).click();await saveDialog.waitFor()
  assert.equal(await page.evaluate(()=>window.profileSubmissions.length),0,'Review does not save before confirmation')
  assert.match(await saveDialog.innerText(),/employee@example.invalid/);assert.match(await saveDialog.innerText(),/updated@example.invalid/)
  assert.doesNotMatch(await saveDialog.innerText(),/CurrentPassword123|NewSecretPassword123/,'Passwords are never rendered in the review')
  assert.match(await saveDialog.innerText(),/Your password will be changed/)
  assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Keep editing','The safe action receives focus')
  await page.setViewportSize({width:320,height:850});await assertFits('Save confirmation at 320px');await page.setViewportSize({width:375,height:850});await assertFits('Save confirmation');await page.screenshot({path:path.join(output,'mobile-save-confirmation.png'),fullPage:true})
  await saveDialog.getByRole('button',{name:'Keep editing',exact:true}).click();await saveDialog.waitFor({state:'hidden'})
  assert.equal(await loginEmail.inputValue(),'updated@example.invalid');assert.equal(await page.evaluate(()=>window.profileSubmissions.length),0)
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  const discardDialog=page.getByRole('alertdialog',{name:'Discard your changes?',exact:true})
  await page.getByRole('button',{name:/Back to payslips/}).click();await discardDialog.waitFor();await page.keyboard.press('Escape');await discardDialog.waitFor({state:'hidden'})
  assert.equal(await loginEmail.inputValue(),'updated@example.invalid','Escape preserves unsaved edits')
  const unloadPrevented=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented});assert.ok(unloadPrevented)
  await page.evaluate(()=>{window.leaveResult='pending';Promise.resolve(window.portalLeaveGuard()).then(value=>{window.leaveResult=value})})
  await discardDialog.waitFor();await discardDialog.getByRole('button',{name:'Keep editing',exact:true}).click()
  await page.waitForFunction(()=>window.leaveResult===false)
  const signoutDialog=page.getByRole('alertdialog',{name:'Sign out of Payslip Portal?',exact:true})
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await signoutDialog.waitFor()
  assert.match(await signoutDialog.innerText(),/unsaved account changes/);assert.equal(await page.evaluate(()=>window.logoutSubmissions),0)
  await signoutDialog.getByRole('button',{name:'Stay signed in',exact:true}).click();await signoutDialog.waitFor({state:'hidden'})
  assert.equal(await loginEmail.inputValue(),'updated@example.invalid')
  await page.evaluate(()=>{window.profileFailOnce=true})
  await page.getByRole('button',{name:'Save account details',exact:true}).click();await saveDialog.getByRole('button',{name:'Confirm and save',exact:true}).click()
  await saveDialog.getByRole('alert').filter({hasText:'Synthetic save failure'}).waitFor();assert.equal(await page.evaluate(()=>window.profileSubmissions.length),1)
  await saveDialog.getByRole('button',{name:'Keep editing',exact:true}).click()
  await page.evaluate(()=>{window.delayProfile=true})
  await page.getByRole('button',{name:'Save account details',exact:true}).click();await saveDialog.getByRole('button',{name:'Confirm and save',exact:true}).click()
  assert.ok(await saveDialog.getByRole('button',{name:'Saving...',exact:true}).isDisabled());await page.keyboard.press('Escape');assert.ok(await saveDialog.isVisible(),'A pending save cannot be dismissed')
  assert.equal(await page.evaluate(()=>window.profileSubmissions.length),2,'Busy state does not duplicate writes')
  await page.evaluate(()=>window.finishProfile())
  await page.getByRole('status').filter({hasText:'were updated'}).waitFor()
  assert.equal((await page.evaluate(()=>window.profileSubmissions.at(-1))).email,'updated@example.invalid')
  assert.equal(await page.evaluate(()=>window.profileSubmissions.length),2,'Only explicit confirmations send writes')
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  // Explicit discard abandons edits without saving, while route cancellation retains them.
  await page.getByRole('button',{name:'My account',exact:true}).click();await page.getByLabel('Contact number',{exact:true}).fill('09999999999')
  await page.getByRole('button',{name:/Back to payslips/}).click();await discardDialog.waitFor();await discardDialog.getByRole('button',{name:'Discard changes',exact:true}).click()
  await page.getByRole('heading',{name:'Your payslips',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.profileSubmissions.length),2)
  await page.getByRole('button',{name:'My account',exact:true}).click();assert.equal(await page.getByLabel('Contact number',{exact:true}).inputValue(),'09000000000')
  await page.getByRole('button',{name:/Back to payslips/}).click()
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await signoutDialog.waitFor()
  await page.screenshot({path:path.join(output,'mobile-signout-confirmation.png'),fullPage:true})
  assert.equal(await page.evaluate(()=>window.logoutSubmissions),0)
  await signoutDialog.getByRole('button',{name:'Yes, sign out',exact:true}).click()
  await page.getByRole('heading',{name:'Sign in to your account',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.logoutSubmissions),1)
  for(const number of [null,'','   ']){
   await page.setViewportSize({width:320,height:850});await load(snapshot,true,number)
   assert.equal(await page.locator('.welcome-meta').innerText(),'EMP-999999','Missing or blank employee numbers fall back to the formatted employee ID')
   await page.getByRole('button',{name:'My account',exact:true}).click()
   assert.match(await page.locator('.settings-identity').innerText(),/EMP-999999/)
   await assertFits('Employee ID fallback')
  }
  await load(snapshot,true,'  CUSTOM-7  ');assert.equal(await page.locator('.welcome-meta').innerText(),'CUSTOM-7','Employee numbers are trimmed before display')
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
  const signupSubmit=page.locator('.portal-form').getByRole('button',{name:'Create account',exact:true});assert.ok(await signupSubmit.isDisabled())
  await page.getByRole('combobox',{name:'Government ID type',exact:true}).click();await page.getByRole('option',{name:'SSS',exact:true}).click()
  await page.getByLabel('ID number',{exact:false}).fill('1234567890')
  await page.getByRole('button',{name:'Read privacy notice and account terms',exact:true}).click()
  const privacy=page.getByRole('dialog',{name:'Your payslip portal information',exact:true});await privacy.waitFor()
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden')
  await assertFits('Privacy notice');await page.screenshot({path:path.join(output,'mobile-privacy.png'),fullPage:true})
  await page.keyboard.press('Escape');await privacy.waitFor({state:'hidden'});assert.ok(await signupSubmit.isDisabled(),'Closing notice does not accept it')
  await page.getByRole('button',{name:'Read privacy notice and account terms',exact:true}).click()
  await privacy.getByRole('button',{name:'I agree to the privacy notice and account terms',exact:true}).click()
  assert.ok(await page.getByRole('checkbox').isChecked());assert.ok(await signupSubmit.isEnabled())
  await page.getByLabel('Last name',{exact:true}).fill('person');await page.getByLabel('Contact number',{exact:true}).fill('09000000000')
  await page.locator('.portal-form input[type="email"]').fill('signup@example.invalid')
  await page.getByLabel('Create password',{exact:true}).fill('SignupPassword123');await page.getByLabel('Confirm password',{exact:true}).fill('SignupPassword123')
  await page.setViewportSize({width:375,height:850});await page.screenshot({path:path.join(output,'mobile-signup.png'),fullPage:true})
  await page.setViewportSize({width:1280,height:850});await page.screenshot({path:path.join(output,'desktop-signup.png'),fullPage:true});await assertFits('Desktop signup')
  await page.evaluate(()=>{window.$fetch=async(url,options)=>{window.signupSubmission={url,body:options.body};throw{data:{statusMessage:'Synthetic signup response'}}}})
  await signupSubmit.click();await page.getByRole('alert').filter({hasText:'Synthetic signup response'}).waitFor()
  const registration=await page.evaluate(()=>window.signupSubmission);assert.equal(registration.url,'/api/employee-portal/auth/signup');assert.equal(registration.body.firstName,'TEST');assert.equal(registration.body.lastName,'PERSON');assert.equal(registration.body.agreementAccepted,true)
  await page.setViewportSize({width:320,height:740})
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click()
  await page.getByRole('button',{name:'Forgot password? Use an HR recovery code'}).click()
  const recoveryCode=page.locator('.portal-recovery-code')
  await recoveryCode.fill('0a1234');assert.equal(await recoveryCode.inputValue(),'01234','Code input only accepts digits')
  await recoveryCode.fill('000007');assert.equal(await recoveryCode.inputValue(),'000007','Leading zeroes are preserved')
  assert.equal(await recoveryCode.getAttribute('inputmode'),'numeric')
  await page.locator('.portal-form input[type="email"]').fill('test@example.invalid')
  await page.locator('.portal-form input[type="password"]').nth(0).fill('RecoveryTestPassword123')
  await page.locator('.portal-form input[type="password"]').nth(1).fill('RecoveryTestPassword123')
  await assertFits('Recovery form')
  await page.setViewportSize({width:375,height:850});await page.screenshot({path:path.join(output,'mobile-recovery.png'),fullPage:true})
  await page.evaluate(()=>{window.$fetch=async(url,options)=>{window.recoverySubmission={url,body:options.body};throw{data:{statusMessage:'Synthetic recovery response'}}}})
  await page.getByRole('button',{name:'Set new password',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Synthetic recovery response'}).waitFor()
  const submitted=await page.evaluate(()=>window.recoverySubmission)
  assert.equal(submitted.url,'/api/employee-portal/auth/recovery');assert.equal(submitted.body.email,'test@example.invalid');assert.equal(submitted.body.code,'000007')
  assert.deepEqual(errors,[],'No runtime errors')
  await context.close()
 }finally{await browser.close()}
})
