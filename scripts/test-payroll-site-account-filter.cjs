// Browser QA uses synthetic snapshots and mocked portal responses, never live accounts.
// Run with NODE_PATH pointing to a Playwright installation and PORTAL_BROWSER_PATH
// pointing to a Chromium browser. No extra application dependency is required.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const esbuild=require('esbuild'),sfc=require('@vue/compiler-sfc')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.data','processing-account-filter-tests')
async function buildFixture(){
 const styles=[]
 const result=await esbuild.build({stdin:{contents:`import {createApp,h} from 'vue';import Portal from './app/pages/payroll/processing/index.vue';const app=createApp(Portal);app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});app.mount('#app');`,resolveDir:root,loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'portal-fixture',setup(build){
  build.onResolve({filter:/^(~~\/|~\/)/},args=>{const target=path.resolve(root,args.path.startsWith('~~/')?args.path.slice(3):'app/'+args.path.slice(2));return{path:path.extname(target)?target:target+'.ts'}})
  build.onResolve({filter:/^#imports$/},()=>({path:'nuxt-head-fixture',namespace:'fixture'}))
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useHead = value => { document.title = value.title }',loader:'js'}))
  build.onLoad({filter:/\.vue$/},args=>{
   if(args.path.endsWith('PayrollProcessingDetailModal.vue'))return{contents:"import {h} from 'vue';export default {props:['modelValue','options'],setup:()=>()=>h('select',{},[h('option','Select ID type')])}",loader:'js'}
   const {descriptor,errors}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[])
   const id='data-v-'+Buffer.from(path.relative(root,args.path)).toString('hex').slice(-18)
   const script=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'__component'})
   for(const style of descriptor.styles){const compiled=sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(compiled.errors,[]);styles.push(compiled.code)}
   return{contents:script.content+`;__component.__scopeId=${JSON.stringify(id)};export default __component;`,loader:'ts',resolveDir:path.dirname(args.path)}
  })
 }}]})
 return{script:result.outputFiles[0].text,css:fs.readFileSync(path.join(root,'assets/css/payroll-processing.css'),'utf8')+'\n'+styles.join('\n')}
}



test('payroll directory batches server results and searches unloaded employees', {skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'}, async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px}</style><div id="app"></div>')
  await page.addStyleTag({content:fixture.css})
  await page.evaluate(()=>{
   window.requests=[];window.IntersectionObserver=class {observe(){}disconnect(){}}
   const cutoffs=[{start:'2026-10-01',end:'2026-10-15'},{start:'2026-09-16',end:'2026-09-30'}]
   const sites=Array.from({length:72},(_,i)=>({BatchID:i+1,AgencyID:i%2+1,AgencyName:'Agency '+(i%2+1),ClientID:i%3+1,ClientName:'Client '+(i%3+1),SiteName:'Site '+(i+1),SiteAccountID:i+1,SiteAccountName:'Account '+String(i+1).padStart(3,'0'),ReviewStatus:i%4===0?'Approved':'Pending',employees:[{EmployeeName:'Worker '+(i+1)}],peopleCount:1,gross:1000+i,deductions:10,netPreview:990+i}))
   window.$fetch=async(url,options)=>{
    window.requests.push({url,query:options.query});const q=options.query||{}
    await new Promise(r=>setTimeout(r,25))
    const directory=q.periodStart==='2026-10-01'?[{...sites[0],SiteAccountID:99,SiteAccountName:'Updated Account'}]:sites
    const matching=directory.filter(s=>(!q.search||('site '+s.BatchID+' '+s.employees[0].EmployeeName).toLowerCase().includes(q.search.toLowerCase()))&&(!q.agencyId||String(s.AgencyID)===q.agencyId)&&(!q.clientId||String(s.ClientID)===q.clientId)&&(!q.siteAccountId||String(s.SiteAccountID)===q.siteAccountId))
    const counts={current:matching.length,Pending:matching.filter(s=>s.ReviewStatus==='Pending').length,Approved:matching.filter(s=>s.ReviewStatus==='Approved').length}
    const selected=matching.filter(s=>!q.status||q.status==='current'||s.ReviewStatus===q.status),pages=Math.max(1,Math.ceil(selected.length/25)),page=Math.min(q.page,pages)
    return{items:selected.slice((page-1)*25,page*25),pagination:{page,pages,pageSize:25,total:selected.length},cutoffs,selectedCutoff:cutoffs[q.periodStart==='2026-10-01'?0:1],counts,...(q.includeLookups==='0'?{}:{directory}),permissions:{canReview:false}}
   }
  })
  await page.addScriptTag({content:fixture.script})
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===25)
  assert.equal(await page.evaluate(()=>window.requests.length),1)
  await page.getByRole('button',{name:'Load more',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===50)
  assert.equal(await page.evaluate(()=>window.requests[1].query.page),2)
  const search=page.getByRole('searchbox')
  await search.fill('Worker 72')
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===1&&document.querySelector('.processing-table tbody').textContent.includes('Site 72'))
  assert.equal(await page.evaluate(()=>window.requests.at(-1).query.page),1)
  await search.fill('')
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===25)
  const account=page.getByRole('combobox',{name:'Site Account',exact:true})
  await account.fill('Account 071');await page.getByRole('option',{name:'Account 071',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===1&&document.querySelector('.processing-table tbody').textContent.includes('Site 71'))
  assert.equal(await page.getByRole('button',{name:'To review 1',exact:true}).count(),1)
  await page.getByRole('combobox',{name:/^Agency/}).selectOption('1')
  await page.waitForFunction(()=>document.querySelectorAll('.processing-table tbody tr').length===25)
  assert.equal(await account.inputValue(),'All site accounts')
  for(const width of [1280,375]){
   await page.setViewportSize({width,height:850})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Fits '+width)
   await page.screenshot({path:path.join(output,'server-batches-'+width+'.png'),fullPage:true})
  }
  await page.getByRole('combobox',{name:/^Cutoff/}).selectOption('2026-10-01:2026-10-15')
  await page.getByText('Site Account: Updated Account',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
