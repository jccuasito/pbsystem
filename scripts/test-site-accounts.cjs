const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {test}=require('node:test'),{transformSync}=require('esbuild'),sfc=require('@vue/compiler-sfc'),vue=require('vue')
function evaluate(file,requireMock,globals={},extra=''){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8')+extra,{loader:'ts',format:'cjs'}).code,{module,require:requireMock,...globals});return module.exports}
const h3={createError:d=>Object.assign(new Error(d.statusMessage),d),getQuery:e=>e.query||{},getRouterParam:e=>e.resource,readBody:async e=>e.body}
const auth={requireSession:e=>{if(e.anonymous)throw h3.createError({statusCode:401});return e.session||{sub:1,userType:'Admin'}}}
function backend(file,db={execute:async()=>[[]]}){return evaluate(file,name=>name==='h3'?h3:name.includes('dbconnect')?db:name.endsWith('/auth')?auth:{})}
const summary=backend('server/utils/siteAccountSummary.ts')
test('account aggregation uses cents, keeps unassigned sites and reports incomplete payroll',()=>{
 const result=summary.groupSiteAccountSummary([{SiteAccountID:1,SiteAccountName:'OtherPosts',Status:'Active'}],[{SiteAccountID:1,DtrCount:1,FinalizedDtrCount:1,PayrollEntries:1,Gross:'0.10',Deductions:'0.01',Net:'0.09'},{SiteAccountID:1,DtrCount:1,FinalizedDtrCount:0,PayrollEntries:0,Gross:'0.20',Deductions:'0.02',Net:'0.18'},{SiteAccountID:null,DtrCount:0}])
 assert.equal(result.accounts[0].Gross,0.3);assert.equal(result.accounts[0].Net,0.27);assert.equal(result.accounts[0].Ready,false)
 assert.equal(result.accounts[1].SiteAccountName,'Unassigned sites');assert.equal(result.accounts[1].SitesWithoutDtr,1)
})
test('summary validates session and cutoff; route uses Payroll access rather than Organization access',async()=>{
 const api=backend('server/utils/siteAccountSummary.ts')
 await assert.rejects(()=>api.listSiteAccountPayroll({anonymous:true}),e=>e.statusCode===401)
 for(const query of [{periodStart:'2026-02-30',periodEnd:'2026-03-15'},{periodStart:'2026-10-16'},{periodStart:['2026-10-01'],periodEnd:'2026-10-15'},{periodStart:'2026-10-16',periodEnd:'2026-10-01'}]) await assert.rejects(()=>api.listSiteAccountPayroll({query}),e=>e.statusCode===400)
 const permissions=evaluate('server/utils/settingsAccess.ts',name=>name==='h3'?h3:name.endsWith('/auth')?auth:{})
 assert.equal(permissions.moduleForPath('/api/payroll/site-accounts'),'payroll')
 assert.equal(permissions.moduleForPath('/api/organization/site-account'),'organization')
})
test('site account UI and navigation compile, use an independent name, and keep counts numeric',()=>{
 for(const file of ['app/pages/organization/site-accounts/index.vue','app/pages/payroll/summary/index.vue','app/pages/organization/site/index.vue','components/OrganizationCrud.vue','app/pages/dashboard/index.vue']){
  const {descriptor,errors}=sfc.parse(fs.readFileSync(file,'utf8'),{filename:file});assert.deepEqual(errors,[])
  const script=sfc.compileScript(descriptor,{id:file});assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
  for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename:file,id:file,scoped:style.scoped}).errors,[])
 }
 const page=fs.readFileSync('app/pages/organization/site-accounts/index.vue','utf8')
 assert.ok(!page.match(/key:'AgencyID'/));assert.ok(!page.includes('/api/payroll/'));assert.ok(!page.includes('account-tabs'));assert.match(fs.readFileSync('app/pages/payroll/summary/index.vue','utf8'),/current Site Account assignment/)
 const navigation=fs.readFileSync('app/pages/dashboard/index.vue','utf8');assert.match(navigation,/label: 'Site Accounts'/);assert.match(navigation,/'organization-site-accounts': SiteAccountsPage/);assert.ok(navigation.includes("label: 'Payroll Summary', to: '/payroll/summary', icon: 'chart-bar', view: 'payroll-summary'"));assert.match(navigation,/'payroll-summary': PayrollSummaryPage/)
 const component=fs.readFileSync('components/OrganizationCrud.vue','utf8')
 const script=sfc.parse(component).descriptor.scriptSetup.content,module={exports:{}}
 vm.runInNewContext(transformSync(script+'\nmodule.exports={display,idKey};',{loader:'ts',format:'cjs'}).code,{module,defineProps:()=>({resource:'site-account',title:'Site Accounts',fields:[],columns:[]}),defineEmits:()=>()=>{},require:name=>name==='vue'?{...vue,onMounted(){}}:name.includes('useRealtimeRefresh')?{useRealtimeRefresh(){}}:{}})
 assert.equal(module.exports.idKey.value,'SiteAccountID');assert.equal(module.exports.display({SiteCount:0},{key:'SiteCount'}),'0');assert.equal(module.exports.display({SiteCount:1},{key:'SiteCount'}),'1')
})
test('summary ignores stale responses and hides money when Payroll access is denied',async()=>{
 const scope=vue.effectScope(),pending=[]
 const source=sfc.parse(fs.readFileSync('app/pages/payroll/summary/index.vue','utf8')).descriptor.scriptSetup.content
 const module={exports:{}}
 scope.run(()=>vm.runInNewContext(transformSync(source+'\nmodule.exports={loadSummary,report,cutoff,restricted};',{loader:'ts',format:'cjs'}).code,{module,defineEmits:()=>()=>{},require:name=>name==='vue'?{...vue,onActivated(){}}:name.includes('useRealtimeRefresh')?{useRealtimeRefresh(){}}:{},$fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}))
 try{
  const s=module.exports,first=s.loadSummary();s.cutoff.value='2026-10-01:2026-10-15';const second=s.loadSummary()
  pending[1].resolve({accounts:[],totals:{Gross:200},cutoffs:[],period:{PeriodStart:'2026-10-01',PeriodEnd:'2026-10-15'}});await second
  pending[0].resolve({accounts:[],totals:{Gross:100},cutoffs:[],period:{PeriodStart:'2026-09-16',PeriodEnd:'2026-09-30'}});await first
  assert.equal(s.report.value.totals.Gross,200)
  const denied=s.loadSummary();pending[2].reject({status:403});await denied;assert.equal(s.restricted.value,true);assert.equal(s.report.value.totals.Gross,undefined)
 }finally{scope.stop()}
})

test('independent site UI edits and activates only the selected site record',async()=>{
 const source=sfc.parse(fs.readFileSync('components/OrganizationCrud.vue','utf8')).descriptor.scriptSetup.content
 const module={exports:{}},calls=[]
 const fixture={SiteID:1,SiteName:'Independent site',Status:'Inactive',AgencyIDs:[1],AgencyAccounts:[{AgencyID:1,AgencyName:'Company A',SiteAccountID:11,SiteAccountName:'Residential'}]}
 vm.runInNewContext(transformSync(source+'\nmodule.exports={load,displayItems,filteredItems,agencyFilter,edit,form,save,activate};',{loader:'ts',format:'cjs'}).code,{module,defineProps:()=>({resource:'site',title:'Sites',fields:[{key:'SiteName'},{key:'AgencyID'},{key:'SiteAccountID'},{key:'Status'}],columns:[{key:'SiteName'},{key:'AgencyNames'},{key:'SiteAccountName'}]}),defineEmits:()=>()=>{},require:name=>name==='vue'?{...vue,onMounted(){}}:name.includes('useRealtimeRefresh')?{useRealtimeRefresh(){}}:{},$fetch:async(url,options)=>{if(options)calls.push(options.body);return{items:[fixture,{...fixture,SiteID:2,AgencyIDs:[2],AgencyAccounts:[{AgencyID:2,AgencyName:'Company B',SiteAccountID:12,SiteAccountName:'Other Posts'}]}],agencies:[{AgencyID:1},{AgencyID:2}]}}})
 const state=module.exports;await state.load()
 assert.equal(state.displayItems.value.length,2);assert.equal(state.displayItems.value[1].SiteAccountName,'Other Posts')
 state.agencyFilter.value='2';assert.equal(state.filteredItems.value.length,1)
 state.edit(state.filteredItems.value[0]);assert.equal(state.form.value.AgencyID,2)
 state.form.value.SiteAccountID=13;await state.save();assert.equal(calls[0].id,2);assert.equal(calls[0].SiteAccountID,13);assert.equal(JSON.stringify(calls[0].AgencyIDs),'[2]')
 await state.activate(fixture);assert.equal(calls[1].id,1);assert.equal(calls[1].Status,'Active');assert.equal(calls[1].AgencyAccounts,undefined,'Status activation retains existing account without touching another site')
})
