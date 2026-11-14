// Actual Vue pages + ofetch, with synthetic HTTP responses. No live credentials or writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const sfc=require('@vue/compiler-sfc'),esbuild=require('esbuild'),root=path.resolve(__dirname,'..')
async function fixture(){
 const styles=['base','theme','components','auth','dashboard','payroll-processing'].map(name=>fs.readFileSync(path.join(root,'assets/css',name+'.css'),'utf8'))
 const result=await esbuild.build({stdin:{resolveDir:root,loader:'ts',contents:`
  import {createApp,h,ref} from 'vue';import {ofetch} from 'ofetch';
  import Dtr from './app/pages/attendance/daily-time-records/index.vue';
  import Portal from './app/pages/employee-portal/index.vue';
  globalThis.$fetch=ofetch;const scene=ref('dtr');window.errorScene=scene;
  const app=createApp({setup:()=>()=>scene.value==='portal'?h(Portal):h('div',{class:'page dash-page'},h(Dtr))});
  app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});app.mount('#app');
 `},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'error-fixture',setup(build){
  build.onResolve({filter:/^#(?:imports|app)$/},()=>({path:'nuxt',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead=()=>{};export const onBeforeRouteLeave=()=>{};export const useRouter=()=>({});export const useRoute=()=>({query:{}})',loader:'js'}))
  build.onLoad({filter:/\.vue$/},args=>{
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
   const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'})
   for(const style of descriptor.styles){const c=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(c.errors,[]);styles.push(c.code)}
   const auto=['ref','computed','reactive','watch','watchEffect','onMounted','onBeforeUnmount','nextTick','useId'].filter(name=>!Object.hasOwn(script.bindings,name)&&new RegExp('\\b'+name+'\\s*(?:<[^;]+?>)?\\(').test(script.content))
   return{contents:(auto.length?`import {${auto.join(',')}} from 'vue';`:'')+script.content+`;Component.__scopeId='${id}';export default Component`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:styles.join('\n')}
}
test('DTR and employee portal hide 503/network diagnostics, retain validation, and recover',{skip:process.env.ERROR_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),built=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.ERROR_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});let mode='healthy',apiCalls=0;const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.pathname.startsWith('/api/')){
    assert.equal(request.method(),'GET','QA never submits a mutation');apiCalls++
    if(mode==='offline')return route.abort('failed')
    if(mode==='unavailable')return route.fulfill({status:503,contentType:'text/html',body:'<html>Private upstream stack: SELECT Password FROM user at D:/server/private.ts:12</html>'})
    if(mode==='validation')return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({statusCode:409,statusMessage:'This DTR was changed by another user. Refresh before saving.'})})
    if(url.pathname==='/api/attendance/dtr')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[{BatchID:99,AgencyName:'Synthetic Agency',SiteName:'Synthetic Site',ClientName:'Test Client',PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30',CreatedAt:'2026-09-16',Status:'Draft',PeopleCount:2}],agencies:[],clients:[],sites:[]})})
    return route.fulfill({status:401,contentType:'application/json',body:'{"statusCode":401}'})
   }
   if(url.pathname==='/images/logo.png')return route.fulfill({path:path.join(root,'public/images/logo.png'),contentType:'image/png'})
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="app"></div></body></html>'})
  })
  await page.goto('http://errors.test');await page.addStyleTag({content:built.css});await page.addScriptTag({content:built.script})
  await page.locator('.dtr-list-row').waitFor()
  mode='unavailable';await page.getByRole('button',{name:'Search',exact:true}).click()
  await page.getByText('The service is temporarily unavailable. Please try again shortly.',{exact:true}).waitFor()
  assert.equal(await page.locator('.dtr-list-row').count(),1,'The last loaded rows are retained')
  assert.doesNotMatch(await page.locator('.dtr-page').innerText(),/\/api\/|\[GET\]|503|SELECT|Password|private\.ts/)
  mode='healthy';await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('.dtr-page .error').waitFor({state:'hidden'})
  mode='offline';await page.getByRole('button',{name:'Search',exact:true}).click()
  await page.getByText('Cannot connect to the server. Please check your connection and try again.',{exact:true}).waitFor()
  mode='validation';await page.getByRole('button',{name:'Search',exact:true}).click()
  await page.getByText('This DTR was changed by another user. Refresh before saving.',{exact:true}).waitFor()
  mode='unavailable';await page.evaluate(()=>window.errorScene.value='portal')
  await page.locator('.portal-auth .portal-error').waitFor()
  assert.equal(await page.locator('.portal-auth .portal-error').innerText(),'The service is temporarily unavailable. Please try again shortly.')
  assert.doesNotMatch(await page.locator('.employee-portal').innerText(),/\/api\/|\[GET\]|503|SELECT|Password FROM|private\.ts/)
  assert.deepEqual(errors,[]);assert.ok(apiCalls>=5)
 }finally{await browser.close()}
})
