// Actual assistant component; synthetic API responses, no credentials or production writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sfc=require('@vue/compiler-sfc'),esbuild=require('esbuild')
const root=path.resolve(__dirname,'..')
const shared=require('../shared/utils/djaAssistant.ts')
const fixtureAccess={dashboard:{canView:true},deductions:{canView:true},employees:{canView:true},attendance:{canView:true}}
async function fixture(){
 const styles=['base','theme','dashboard'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8'))
 const result=await esbuild.build({stdin:{resolveDir:root,loader:'ts',contents:`
 import {createApp,h,ref,watchEffect} from 'vue';import {ofetch} from 'ofetch';import Assistant from './app/components/DjaAssistant.vue';import {provideAppTheme} from './app/composables/useAppTheme';
 globalThis.$fetch=ofetch;const view=ref('dashboard'),portal=ref(false);window.assistantView=view;window.assistantPortal=portal;
 createApp({setup(){const {isDark}=provideAppTheme();window.assistantTheme=isDark;watchEffect(()=>document.documentElement.dataset.theme=isDark.value?'dark':'light');return()=>h(Assistant,{key:portal.value?'portal':'staff',portal:portal.value,view:portal.value?'employee-portal':view.value,access:portal.value?{portal:{canView:true}}:{dashboard:{canView:true},deductions:{canView:true},employees:{canView:true},attendance:{canView:true}},onNavigate:value=>view.value=value})}}).mount('#app');
 `},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'assistant-fixture',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
  const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
  let contents
  if(descriptor.script||descriptor.scriptSetup)contents=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'}).content
  else{const template=sfc.compileTemplate({source:descriptor.template.content,filename:args.path,id});assert.deepEqual(template.errors,[]);contents=template.code.replace('export function render','function render')+';const Component={render}'}
  for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
  return{contents:contents+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
 })}}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}
test('assistant keyboard, bilingual context, navigation, errors, clear, mobile and dark view',{skip:process.env.ASSISTANT_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),built=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.ASSISTANT_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:950}}),calls=[],errors=[];let mode='healthy'
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).pathname==='/api/assistant/query'){
    assert.equal(route.request().method(),'POST');const body=route.request().postDataJSON();calls.push(body)
    if(mode==='unavailable')return route.fulfill({status:503,contentType:'text/html',body:'SELECT Password FROM user at D:/private.ts:12'})
    if(mode==='denied')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({statusCode:403,statusMessage:'You do not have view access to the requested module.'})})
    if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,200))
    const found=body.guideId?{guide:shared.assistantGuides.find(item=>item.id===body.guideId),unsupportedAction:false}:shared.findAssistantGuide(body.prompt,body.view,body.contextGuide)
    if(found?.guide)return route.fulfill({contentType:'application/json',body:JSON.stringify(shared.assistantGuideReply(found.guide,shared.assistantLanguage(body.prompt,body.locale),new Date('2026-11-14T05:00:00Z'),found.unsupportedAction,fixtureAccess))})
    if(['help','unsupported'].includes(shared.parseAssistantCommand(body.prompt,body.view,body.locale).intent))return route.fulfill({contentType:'application/json',body:JSON.stringify(shared.assistantClarificationReply(body.prompt,fixtureAccess,shared.assistantLanguage(body.prompt,body.locale))||shared.assistantScopeReply(shared.assistantLanguage(body.prompt,body.locale)))})
    const answer={text:'Current Active records, including paused loans. Current page filters are not applied.',generatedAt:'2026-11-14T05:00:00Z',source:'Employee Loans & Deductions',scope:'2026-11-14 · Asia/Manila',metric:{label:body.locale==='fil'?'Active loan records ngayon':'Active loan records now',value:6,format:'count'},link:{view:'employee-loans-deductions',label:'Employee Loans & Deductions'}}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(answer)})
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main><h1>Dashboard fixture</h1></main><div id="app"></div></body></html>'})
  })
  await page.goto('http://assistant.test');await page.addStyleTag({content:built.css});await page.addScriptTag({content:built.script})
  const launcher=page.getByRole('button',{name:'Open DJA Assistant'});await launcher.click()
  const input=page.getByRole('textbox',{name:'Ask DJA Assistant'});await input.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true)
  assert.equal(await page.getByRole('button',{name:'Total billing this month',exact:true}).count(),0,'Billing suggestion hidden without Billing permission')
  await input.fill('Hey DJA AI, can you show me how many active loans this month?');await input.press('Enter');await page.locator('.dja-assistant__metric strong').waitFor()
  assert.equal(await page.locator('.dja-assistant__metric strong').innerText(),'6');assert.equal(calls[0].view,'dashboard');assert.equal(calls[0].locale,'auto')
  await page.getByRole('button',{name:/^Open Employee Loans & Deductions/}).click();assert.equal(await page.getByRole('dialog').count(),0)
  await launcher.click();await page.locator('.dja-assistant__context strong').filter({hasText:'Employee Loans & Deductions'}).waitFor()
  await page.getByRole('combobox',{name:'Reply language'}).selectOption('fil');await page.getByRole('button',{name:'Ilan ang active loans ngayong buwan?',exact:true}).click()
  await page.getByText('Active loan records ngayon',{exact:true}).waitFor();assert.equal(calls[1].view,'employee-loans-deductions');assert.equal(calls[1].locale,'fil')
  mode='unavailable';await input.fill('Active loans');await input.press('Enter');await page.getByRole('alert').waitFor()
  assert.doesNotMatch(await page.getByRole('alert').innerText(),/SELECT|Password|private\.ts|503|\/api\//)
  mode='denied';await input.fill('Active loans');await input.press('Enter');await page.getByText(/You do not have/).waitFor()
  mode='slow';await input.fill('Active loans');await input.press('Enter');await page.getByRole('button',{name:'Clear chat',exact:true}).click();await page.waitForTimeout(250)
  assert.equal(await page.locator('.dja-assistant__message').count(),0,'Late response cannot restore cleared history')
  mode='healthy';await input.fill('Active loans');await input.press('Enter');await page.locator('.dja-assistant__metric').waitFor()
  await page.getByRole('button',{name:'Clear chat',exact:true}).click()
  await page.evaluate(()=>window.assistantView.value='employees-list')
  await input.fill('Pano mag create ng records for employee?');await input.press('Enter')
  await page.getByRole('heading',{name:'Gumawa ng employee record',exact:true}).waitFor()
  assert.equal(await page.locator('.dja-assistant__steps li').count(),5);assert.match(await page.locator('.dja-assistant__steps').innerText(),/Save employee/)
  await page.getByRole('button',{name:'Mag-edit ng employee details',exact:true}).click()
  await page.getByRole('heading',{name:'Mag-edit ng employee details',exact:true}).waitFor();assert.equal(calls.at(-1).guideId,'employee-edit')
  await input.fill('Pano mag create nito?');await input.press('Enter');await page.getByRole('heading',{name:'Gumawa ng employee record',exact:true}).last().waitFor()
  assert.equal(calls.at(-1).contextGuide,'employee-edit')
  await input.fill('ano ang english ng bakit?');await input.press('Enter');await page.getByRole('heading',{name:'Saklaw at limitasyon',exact:true}).waitFor()
  const boundary=page.locator('.dja-assistant__answer').last();assert.match(await boundary.innerText(),/Paumanhin/);assert.equal(await boundary.locator('ol,.dja-assistant__metric,.dja-assistant__link').count(),0)
  await page.getByRole('button',{name:'Clear chat',exact:true}).click()
  await page.evaluate(()=>window.assistantView.value='employees-portal-accounts')
  await input.fill('ano ba muna step by step para mapatakbo tong system?');await input.press('Enter')
  await page.getByRole('heading',{name:'Simulan ang paggamit ng payroll system nang sunod-sunod',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Paandarin ang local system server',exact:true}).count(),0)
  assert.equal(await page.getByRole('combobox',{name:'Help topic',exact:true}).locator('option[value="system-local-start"]').count(),0)
  assert.match(await page.locator('.dja-assistant__steps').innerText(),/Employee List/)
  assert.doesNotMatch(await page.locator('.dja-assistant__steps').innerText(),/Generate Billing|Site Rates|Payroll Processing/)
  assert.equal(await page.getByRole('button',{name:'Maghanda ng billing draft',exact:true}).count(),0)
  fs.mkdirSync('.data/assistant-tests',{recursive:true});await page.screenshot({path:'.data/assistant-tests/system-orientation.png'})
  await page.getByRole('button',{name:'Gumawa ng employee record',exact:true}).click()
  await page.getByRole('heading',{name:'Gumawa ng employee record',exact:true}).waitFor()
  await input.fill('ano ang kasunod?');await input.press('Enter')
  await page.getByRole('heading',{name:'Magdagdag ng dokumento o ID scan',exact:true}).waitFor()
  await input.fill('How many active loans for Agency X?');await input.press('Enter')
  await page.getByRole('heading',{name:'Linawin ang nais mong gawin',exact:true}).waitFor()
  await page.locator('.dja-assistant__browse summary').click();await page.getByRole('combobox',{name:'Help topic',exact:true}).selectOption('dtr-import')
  await page.getByRole('button',{name:'Show steps',exact:true}).click();await page.getByRole('heading',{name:'Mag-import ng attendance mula sa Excel',exact:true}).waitFor()
  assert.equal(calls.at(-1).guideId,'dtr-import');await page.locator('.dja-assistant__browse summary').click()
  await page.getByRole('button',{name:'Clear chat',exact:true}).click();await input.fill('Pano mag create ng records for employee?');await input.press('Enter');await page.locator('.dja-assistant__steps').waitFor()
  await page.locator('.dja-assistant__transcript').evaluate(el=>el.scrollTop=0)
  fs.mkdirSync('.data/assistant-tests',{recursive:true});await page.screenshot({path:'.data/assistant-tests/workflow-light.png'})
  await page.evaluate(()=>window.assistantTheme.value=true);await page.locator('.dja-assistant--dark').waitFor()
  const colors=await page.locator('.dja-assistant__panel').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color}));assert.equal(colors.bg,'rgb(21, 32, 58)');assert.equal(colors.ink,'rgb(238, 243, 255)')
  await page.screenshot({path:'.data/assistant-tests/desktop-dark.png'})
  for(const width of [320,390]){
   await page.setViewportSize({width,height:740});const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=740)
   await page.screenshot({path:`.data/assistant-tests/mobile-${width}.png`})
  }
  await page.setViewportSize({width:320,height:568});await page.locator('.dja-assistant__browse summary').click()
  const shortPanel=await page.getByRole('dialog').boundingBox(),shortForm=await page.locator('.dja-assistant__form').boundingBox()
  assert.ok(shortForm.y>=shortPanel.y&&shortForm.y+shortForm.height<=shortPanel.y+shortPanel.height,'Send controls remain visible on a short phone with the topic browser open')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.locator('.dja-assistant__browse summary').click();await page.setViewportSize({width:390,height:740})
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('.dja-assistant').isVisible(),false);await page.emulateMedia({media:'screen'})
  await input.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await launcher.evaluate(el=>el===document.activeElement),true)
  const beforePortal=calls.length;await page.evaluate(()=>window.assistantPortal.value=true);await launcher.click()
  await input.fill('Paano mag save ng payslip as PNG?');await input.press('Enter');await page.locator('.dja-assistant__steps').waitFor()
  assert.match(await page.locator('.dja-assistant__steps').innerText(),/Save as PNG/)
  await page.locator('.dja-assistant__browse summary').click()
  const topics=await page.getByRole('combobox',{name:'Help topic',exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean))
  assert.ok(topics.length>=3&&topics.every(topic=>topic.startsWith('portal-')))
  await input.fill('How many active loans?');await input.press('Enter');await page.getByText(/This helper provides portal guides/).waitFor()
  assert.equal(await page.locator('.dja-assistant__metric').count(),0);assert.equal(calls.length,beforePortal,'Portal helper makes no company API request')
  await page.screenshot({path:'.data/assistant-tests/portal-dark.png'})
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
