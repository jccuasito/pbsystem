// Actual Vue employee page and date picker; synthetic HTTP only, no persistent writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const sfc=require('@vue/compiler-sfc'),{build}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),styles=[]
const bundlePromise=build({stdin:{contents:`import{createApp}from'vue';import Page from './app/pages/employees/index.vue';createApp(Page).mount('#app')`,resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',alias:{'~~':root,'~':path.join(root,'app')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 const id='data-v-'+crypto.createHash('sha1').update(args.path).digest('hex').slice(0,8)
 const {descriptor}=sfc.parse(fs.readFileSync(args.path,'utf8'),{filename:args.path})
 if(!args.path.endsWith('ModernDateField.vue')&&!args.path.endsWith(path.join('employees','index.vue')))return {contents:'export default {render(){return null}}',loader:'js'}
 let contents=sfc.compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'}).content
 styles.push(...descriptor.styles.map(style=>sfc.compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code))
 contents+=`;Component.__scopeId='${id}';export default Component`
 return{contents,loader:'ts',resolveDir:path.dirname(args.path)}
 })}}]}).then(result=>result.outputFiles[0].text)
;(async()=>{const bundle=await bundlePromise;const browser=await chromium.launch({headless:true,executablePath:process.env.EMPLOYEE_STATUS_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1366,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 const css=['base','theme','components','auth','dashboard'].map(name=>fs.readFileSync(path.join(root,'assets/css/'+name+'.css'),'utf8')).join('\n')
 await page.setContent(`<html><head><style>${css}\n${styles.join('\n')}</style></head><body><div id="app"></div></body></html>`)
 await page.evaluate(()=>{
  window.requests=[];window.failResignation=false;window.delayResignation=false
  const employees=[{EmployeeID:7,FirstName:'Test',LastName:'Active',Status:'Active',DateHired:'2020-01-01'},{EmployeeID:8,FirstName:'Legacy',LastName:'Resigned',Status:'Inactive',ResignationDate:null}]
  window.$fetch=async(url,opts)=>{
   if(opts?.method==='DELETE'){
    window.requests.push({url,body:opts.body})
    if(window.delayResignation)await new Promise(resolve=>{window.finishResignation=resolve})
    if(window.failResignation)throw{data:{statusMessage:'Resignation date cannot be before the date hired.'}}
    employees[0].Status='Inactive';employees[0].ResignationDate=opts.body.ResignationDate
    return{success:true}
   }
   return{items:employees,agencies:[],positions:[],agencyPositions:[]}
  }
 })
 await page.addScriptTag({content:bundle})
 const launch=page.locator('.employee-table').getByRole('button',{name:'Deactivate employee',exact:true}).first()
 await launch.waitFor();await launch.click()
 const modal=page.getByRole('dialog',{name:'Record employee resignation'})
 await modal.waitFor();assert.equal(await modal.evaluate(el=>document.activeElement===el),true)
 await modal.getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.requests.length),0)
 await launch.click();await page.evaluate(()=>window.failResignation=true)
 await modal.getByRole('button',{name:'Confirm resignation',exact:true}).click()
 await modal.getByRole('alert').waitFor();assert.match(await modal.getByRole('alert').textContent(),/before the date hired/)
 await page.evaluate(()=>{window.failResignation=false;window.delayResignation=true;document.documentElement.dataset.theme='dark'})
 await page.screenshot({path:path.join(root,'.data/employee-resignation-dark.png')})
 await modal.getByRole('button',{name:'Confirm resignation',exact:true}).click()
 await page.waitForFunction(()=>window.finishResignation)
 assert.equal(await modal.getByRole('button',{name:'Saving',exact:false}).isDisabled(),true)
 const requests=await page.evaluate(()=>window.requests)
 assert.equal(requests.length,2);assert.equal(requests[1].body.id,7);assert.match(requests[1].body.ResignationDate,/^\d{4}-\d{2}-\d{2}$/)
 await page.evaluate(()=>window.finishResignation())
 await modal.waitFor({state:'hidden'})
 assert.equal(await launch.isDisabled(),true)
 assert.equal(await page.locator('.employee-table .status--inactive').count(),2)
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 console.log('PASS: resignation modal, date payload, cancel, error, duplicate-submit lock, success, legacy label and mobile width')
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
