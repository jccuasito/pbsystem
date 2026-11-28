// Synthetic browser fixture; no real employee data, cookies or database writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sfc=require('@vue/compiler-sfc'),esbuild=require('esbuild')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data/activity-history-ui')
async function fixture(){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import History from './app/components/ActivityHistoryButton.vue';createApp({render:()=>h(History,{view:'organization-agency',access:{organization:{canView:true},employees:{canView:true},payroll:{canView:true}}})}).mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'history-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>{const file=path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2));return{path:path.extname(file)?file:file+'.ts'}})
  build.onLoad({filter:/\.vue$/},args=>{
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-history',script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'})
   for(const style of descriptor.styles){const css=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(css.errors,[]);styles.push(css.code)}
   return{contents:script.content+`;__component.__scopeId=${JSON.stringify(id)};export default __component;`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:fs.readFileSync('assets/css/theme.css','utf8').replace(/^@import[^\r\n]+/,'')+'\n'+styles.join('\n')}
}

test('history modal is on-demand, paged, keyboard accessible, and fits mobile/desktop in both themes',{skip:process.env.ACTIVITY_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),ui=await fixture(),browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--paper)}</style><div id="app"></div>')
  await page.addStyleTag({content:ui.css})
  await page.evaluate(()=>{
   window.calls=[];window.deny=false
   window.$fetch=async(url,options={})=>{
    window.calls.push({url,query:options.query})
    if(window.deny)throw Object.assign(Error('History access denied'),{statusCode:403,data:{statusMessage:'History access denied'}})
    if(window.failMore&&options.query.before)throw Object.assign(Error('Temporary history failure'),{statusCode:503,data:{statusMessage:'Temporary history failure'}})
    await new Promise(resolve=>setTimeout(resolve,20))
    const offset=Number(options.query.before||0),first=1000-offset
    return{items:Array.from({length:25},(_,i)=>({id:String(first-i),at:options.query.period==='archive'?'2026-11-15T06:15:00.000Z':'2026-11-28T06:15:00.000Z',scope:'organization-agency',actorId:1,actorName:'Sample Staff '+(first-i),actorRole:'Admin',action:i===2?'Delete':'Update',operation:i===2?'delete agency':'update agency',outcome:'Completed',references:['AgencyID #18'],fields:['AgencyName','AgencyAddress','Status'],subjects:[{kind:'agency',id:'18',label:'SAMPLE AGENCY INC.'}],changedFields:['AgencyAddress'],counts:{updated:1}})),nextCursor:offset<475?String(offset+25):null,period:options.query.period,asOf:options.query.asOf||'2026-11-28T00:00:00.000Z',cutoff:'2026-11-21T00:00:00.000Z',visibility:'Team',cachedSeconds:0}
   }
  })
  await page.addScriptTag({content:ui.script})
  assert.equal(await page.evaluate(()=>window.calls.length),0)
  await page.getByRole('button',{name:'View activity history',exact:true}).click()
  await page.getByText('Sample Staff 1000',{exact:true}).waitFor()
  assert.equal((await page.evaluate(()=>window.calls[0])).query.scope,'organization-agency')
  assert.equal(await page.getByRole('group',{name:'History period'}).count(),0)
  const firstEntry=page.locator('.activity-timeline li').first()
  assert.match(await firstEntry.locator('.activity-summary').innerText(),/Sample Staff 1000 changed the address for agency SAMPLE AGENCY INC\./)
  assert.ok(!(await firstEntry.innerText()).includes('AgencyID #18'))
  assert.ok(!(await firstEntry.innerText()).includes('Admin'))
  await page.getByRole('button',{name:'View details',exact:true}).first().click()
  await page.locator('.activity-details').waitFor();assert.match(await page.locator('.activity-details').innerText(),/What changed[\s\S]*Address/);await page.getByText('SAMPLE AGENCY INC.',{exact:true}).first().waitFor()
  assert.ok(!(await firstEntry.innerText()).includes('AgencyID #18'))
  await firstEntry.getByText('Technical references',{exact:true}).click()
  assert.ok((await firstEntry.innerText()).includes('AgencyID #18'))
  await firstEntry.getByRole('button',{name:'Hide details',exact:true}).click()
  await page.getByLabel('Action',{exact:true}).selectOption('Update')
  assert.equal((await page.evaluate(()=>window.calls.at(-1))).query.action,'Update')
  await page.waitForFunction(()=>document.querySelectorAll('.activity-timeline li').length===25)
  assert.equal(await page.locator('.activity-timeline li').count(),25)
  const beforeCalls=await page.evaluate(()=>window.calls.length)
  await page.locator('.activity-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;for(let i=0;i<5;i++)el.dispatchEvent(new Event('scroll'))})
  await page.waitForFunction(()=>document.querySelectorAll('.activity-timeline li').length===50)
  assert.equal(await page.evaluate(()=>window.calls.length),beforeCalls+1)
  assert.equal((await page.evaluate(()=>window.calls.at(-1))).query.asOf,'2026-11-28T00:00:00.000Z')
  assert.equal(await page.locator('.activity-timeline li').count(),50)
  for(let i=0;i<9;i++){
   const calls=await page.evaluate(()=>window.calls.length)
   await page.locator('.activity-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))})
   await page.waitForFunction(calls=>window.calls.length>calls,calls)
   await page.waitForFunction(()=>document.querySelector('.activity-scroll').getAttribute('aria-busy')==='false')
  }
  assert.equal(await page.locator('.activity-timeline li').count(),250)
  await page.getByRole('button',{name:'Back to latest',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.activity-timeline li').length===25)
  await page.getByRole('button',{name:'View archived activity',exact:true}).click()
  await page.waitForFunction(()=>window.calls.at(-1).query.period==='archive'&&document.querySelector('.activity-scroll').getAttribute('aria-busy')==='false')
  await page.getByRole('dialog',{name:'Activity archive',exact:true}).waitFor()
  assert.equal(await page.locator('.activity-timeline li').count(),25)
  await page.getByText('Older activity is kept here automatically. No history is deleted.',{exact:true}).waitFor()
  for(const width of[1280,375])for(const theme of['light','dark']){
   await page.setViewportSize({width,height:850});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
   const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.y>=0&&box.y+box.height<=850)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:path.join(output,`history-${width}-${theme}.png`),animations:'disabled'})
  }
  await page.evaluate(()=>window.failMore=true)
  await page.locator('.activity-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))})
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.activity-timeline li').count(),25)
  await page.evaluate(()=>window.failMore=false)
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.activity-timeline li').length===50)
  await page.getByRole('button',{name:'Done',exact:true}).focus();await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('button',{name:'Back to recent activity',exact:true}).evaluate(el=>el===document.activeElement),true)
  await page.getByRole('button',{name:'Back to recent activity',exact:true}).click()
  await page.waitForFunction(()=>window.calls.at(-1).query.period==='recent'&&document.querySelector('.activity-scroll').getAttribute('aria-busy')==='false')
  await page.getByRole('dialog',{name:'Activity history',exact:true}).waitFor()
  await page.evaluate(()=>window.deny=true)
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.activity-timeline li').count(),0)
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
  assert.equal(await page.getByRole('button',{name:'View activity history',exact:true}).evaluate(el=>el===document.activeElement),true)
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
