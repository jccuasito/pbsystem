// Actual bell component, synthetic responses only; no accounts or business data changed.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const sfc=require('@vue/compiler-sfc'),esbuild=require('esbuild'),root=path.resolve(__dirname,'..')
async function fixture(){
 const styles=['base','theme','dashboard','interactions'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8'))
 const built=await esbuild.build({stdin:{resolveDir:root,loader:'ts',contents:`
 import {createApp,h,ref,watchEffect} from 'vue';import {ofetch} from 'ofetch';import Bell from './app/components/NotificationBell.vue';import {provideAppTheme} from './app/composables/useAppTheme';
 globalThis.$fetch=ofetch;const portal=ref(false),authenticated=ref(true);window.portal=portal;window.authenticated=authenticated;window.navigation=[];
 createApp({setup(){const {isDark}=provideAppTheme();window.theme=isDark;watchEffect(()=>document.documentElement.dataset.theme=isDark.value?'dark':'light');return()=>h('div',{class:'dash-main',style:'margin:0;min-height:100vh'},[h('header',{class:'dash-topbar',style:'justify-content:flex-end'},authenticated.value?h(Bell,{key:portal.value?'portal':'staff',portal:portal.value,onNavigate:target=>window.navigation.push(target)}):[]),h('main',{style:'padding:30px'},'Notification fixture')])}}).mount('#app');
 `},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'notification-fixture',setup(build){build.onLoad({filter:/\.vue$/},args=>{
  const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
  const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
  const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'}).content
  for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
  return{contents:script+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
 })}}]})
 return{script:built.outputFiles[0].text,css:styles.join('\n')}
}
const entry=(key,title,target)=>({key,revision:'a'.repeat(64),kind:key,title,message:'Please review the current records using the available controls.',severity:'warning',updatedAt:'2026-11-15T01:30:00.000Z',target,read:false})
test('bell read state, safe errors, navigation, keyboard, mobile and portal isolation',{skip:process.env.NOTIFICATIONS_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),built=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.NOTIFICATIONS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),calls=[],errors=[]
  let mode='healthy',rows=[entry('dtr-review','DTRs need review',{view:'attendance-dtr'}),entry('portal-requests','Employee requests need a response',{view:'employees-portal-accounts',section:'requests'})]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.pathname.startsWith('/api/')){
    calls.push({path:url.pathname,query:url.search,method:req.method(),body:req.postDataJSON()})
    if(mode==='unavailable')return route.fulfill({status:503,contentType:'text/html',body:'SELECT Password FROM user at D:/private.ts:12'})
    if(req.method()==='POST'){
     const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['items'])
     if(mode==='conflict'){mode='healthy';rows=rows.map(item=>({...item,revision:'b'.repeat(64)}));return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({statusMessage:'Notifications changed. Refresh the list and try again.'})})}
     for(const read of body.items){assert.deepEqual(Object.keys(read),['key','revision']);const item=rows.find(row=>row.key===read.key);assert.equal(read.revision,item.revision);item.read=true}
     return route.fulfill({contentType:'application/json',body:'{"success":true}'})
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({items:rows,unreadCount:rows.filter(item=>!item.read).length,generatedAt:new Date().toISOString()})})
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><div id="app"></div></body></html>'})
  })
  await page.goto('http://notifications.test');await page.addStyleTag({content:built.css});await page.addScriptTag({content:built.script})
  const bell=page.getByRole('button',{name:'Notifications',exact:true}),dialog=page.getByRole('dialog',{name:'Notifications'})
  await page.locator('.notification-count').getByText('2',{exact:false}).waitFor();await bell.click();await dialog.waitFor()
  assert.equal(await dialog.evaluate(el=>el===document.activeElement),true)
  await page.getByRole('button',{name:'Mark as read',exact:true}).first().click();await page.locator('.read-label').waitFor()
  await page.getByRole('button',{name:'Unread 1',exact:true}).click();assert.equal(await page.locator('.notification-list article').count(),1)
  await page.getByRole('button',{name:'Mark all as read',exact:true}).click();await page.getByText('You have no unread notifications.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('You have no unread notifications.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'All',exact:true}).click();assert.equal(await page.locator('.read-label').count(),2)
  await page.getByRole('button',{name:/Employee requests need a response/}).click();assert.equal(await dialog.count(),0)
  assert.deepEqual(await page.evaluate(()=>window.navigation),[{view:'employees-portal-accounts',section:'requests'}])
  mode='unavailable';await bell.click();await page.getByRole('alert').waitFor()
  assert.doesNotMatch(await page.getByRole('alert').innerText(),/SELECT|Password|private\.ts|503|\/api\//)
  mode='healthy';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'})
  rows=rows.map(row=>({...row,read:false,revision:'c'.repeat(64)}));await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Mark as read',exact:true}).first().waitFor()
  mode='conflict';await page.getByRole('button',{name:/DTRs need review/}).click()
  // A stale alert refreshes instead of navigating or hiding the panel.
  await page.waitForFunction(()=>document.querySelector('.notification-panel')?.getAttribute('aria-busy')==='false')
  assert.equal(await dialog.count(),1);assert.equal((await page.evaluate(()=>window.navigation)).length,1)
  await page.getByRole('button',{name:'Mark all as read',exact:true}).click();await page.locator('.notification-count').waitFor({state:'hidden'})
  for(const dark of [false,true]){
   await page.evaluate(value=>window.theme.value=value,dark)
   const color=await dialog.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(color,dark?'rgb(21, 32, 58)':'rgb(255, 255, 255)')
   fs.mkdirSync('.data/notification-tests',{recursive:true});await page.screenshot({path:`.data/notification-tests/desktop-${dark?'dark':'light'}.png`})
  }
  for(const width of [320,390]){
   await page.setViewportSize({width,height:568})
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=568)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:`.data/notification-tests/mobile-${width}.png`})
  }
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await bell.evaluate(el=>el===document.activeElement),true)
  await bell.click();await page.mouse.click(2,550);assert.equal(await dialog.count(),0)
  await page.emulateMedia({media:'print'});assert.equal(await bell.isVisible(),false);await page.emulateMedia({media:'screen'})
  const before=calls.length;rows=[entry('own-payslip:1','A payslip is available',{view:'payslips'})]
  await page.evaluate(()=>window.portal.value=true);await bell.click();await page.getByText('Only your account is shown.',{exact:true}).waitFor()
  await page.getByRole('button',{name:/A payslip is available/}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual((await page.evaluate(()=>window.navigation)).at(-1),{view:'payslips'})
  assert.ok(calls.slice(before).every(call=>call.path.startsWith('/api/employee-portal/notifications')&&!call.query))
  await page.evaluate(()=>window.authenticated.value=false);await bell.waitFor({state:'hidden'})
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
