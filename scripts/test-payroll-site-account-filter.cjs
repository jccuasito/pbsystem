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



test('searchable account filter handles large lists, combined filters, counters and cutoff changes',{skip:process.env.PORTAL_MOBILE_BROWSER_TEST!=='1'},async()=>{
 const {chromium}=require('playwright'),fixture=await buildFixture()
 const browser=await chromium.launch({executablePath:process.env.PORTAL_BROWSER_PATH||undefined,headless:true})
 fs.mkdirSync(output,{recursive:true})
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px}</style><div id="app"></div>')
  await page.addStyleTag({content:fixture.css})
  await page.evaluate(()=>{
   window.requests=[]
   const make=(id,agency,client,account,name,status,gross)=>({BatchID:id,AgencyID:agency,AgencyName:'Agency '+agency,ClientID:client,ClientName:'Client '+client,SiteID:id,SiteName:id<=2?'Shared site':'Site '+id,SiteAccountID:account,SiteAccountName:name,ReviewStatus:status,employees:[],peopleCount:1,gross,deductions:0,netPreview:gross})
   const sites=[make(1,1,1,10,'DJA OtherPosts','Approved',1000),make(2,2,1,20,'GSSI Residential','Approved',2000),make(3,1,2,10,'DJA OtherPosts','Pending',500),make(4,1,1,null,null,'Pending',100),make(5,1,1,10,'DJA OtherPosts','Cancelled',300),make(6,1,1,10,'DJA OtherPosts','Rejected',400),...Array.from({length:160},(_,index)=>make(100+index,3,3,100+index,'Extra Account '+String(index).padStart(3,'0'),'Pending',1000+index))]
   const cutoffs=[{start:'2026-10-01',end:'2026-10-15'},{start:'2026-09-16',end:'2026-09-30'}]
   window.$fetch=async(url,options)=>{window.requests.push({url,...options});return{cutoffs,selectedCutoff:options.query?.periodStart==='2026-10-01'?cutoffs[0]:cutoffs[1],sites:options.query?.periodStart==='2026-10-01'?[{...sites[0],SiteAccountID:30,SiteAccountName:'DJA Updated'}]:sites,permissions:{canReview:false}}}
  })
  await page.addScriptTag({content:fixture.script})
  await page.getByRole('combobox',{name:'Site Account',exact:true}).waitFor()
  const account=page.getByRole('combobox',{name:'Site Account',exact:true})
  await account.click();await page.getByRole('status').filter({hasText:'Showing 100 of'}).waitFor()
  await account.fill('Extra Account 159');await page.getByRole('option',{name:'Extra Account 159',exact:true}).click()
  assert.equal(await page.locator('.processing-table tbody tr').count(),1)
  assert.match(await page.locator('.summary-strip').innerText(),/1,159.00/)
  await account.click();await account.fill('DJA OtherPosts');await account.press('ArrowDown');await account.press('Enter')
  assert.equal(await page.locator('.processing-table tbody tr').count(),2)
  assert.match(await page.locator('.summary-strip').innerText(),/1,500.00/)
  for(const [name,count] of [['Current',2],['To review',1],['Finalized',1],['Returned',1],['Cancelled',1]])assert.equal(await page.getByRole('button',{name:new RegExp('^'+name+' '+count+'$')}).count(),1,'Counters follow account filter')
  await page.getByRole('button',{name:'Finalized 1',exact:true}).click();assert.equal(await page.locator('.processing-table tbody tr').count(),1)
  assert.match(await page.locator('.processing-table tbody').innerText(),/DJA OtherPosts/)
  await page.getByRole('button',{name:'Current 2',exact:true}).click()
  for(const width of [1280,375]){await page.setViewportSize({width,height:850});const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.ok(fits,'Page fits '+width);await page.screenshot({path:path.join(output,'account-filter-'+width+'.png'),fullPage:true})}
  await page.getByRole('combobox',{name:/^Agency/}).selectOption('1')
  assert.equal(await account.inputValue(),'All site accounts','Changing agency resets dependent account')
  await page.getByRole('combobox',{name:/^Client/}).selectOption('1')
  await account.click();await account.fill('Unassigned');await page.getByRole('option',{name:'Unassigned Site Account',exact:true}).click()
  assert.equal(await page.locator('.processing-table tbody tr').count(),1);assert.match(await page.locator('.processing-table tbody').innerText(),/Site 4/)
  assert.equal(await page.evaluate(()=>window.requests.length),1,'Filters operate locally without repeated payroll requests')
  await account.click();await account.fill('DJA OtherPosts');await page.getByRole('option',{name:'DJA OtherPosts',exact:true}).click()
  await page.getByRole('combobox',{name:/^Cutoff/}).selectOption('2026-10-01:2026-10-15')
  await page.getByText('Site Account: DJA Updated',{exact:true}).waitFor()
  assert.equal(await account.inputValue(),'All site accounts','Cutoff removes unavailable account selection')
  assert.equal(await page.evaluate(()=>window.requests.length),2)
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
