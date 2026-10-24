const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {test}=require('node:test'),{transformSync}=require('esbuild'),vue=require('vue'),sfc=require('@vue/compiler-sfc')
const snapshot=JSON.parse(fs.readFileSync('server/assets/addresses/philippines.json','utf8'))
const h3={createError:d=>Object.assign(new Error(d.statusMessage),d),getQuery:e=>e.query||{}}
function evaluate(source,globals={}){const module={exports:{}};vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,Buffer,process,...globals});return module.exports}
const server=evaluate(fs.readFileSync('server/utils/philippineAddress.ts','utf8'),{require:name=>name==='h3'?h3:name.endsWith('/auth')?{requireSession:e=>{if(e.anonymous)throw h3.createError({statusCode:401});return{sub:1}}}:snapshot})
function client(fetch){return evaluate(fs.readFileSync('app/utils/philippineAddress.ts','utf8'),{$fetch:fetch})}

test('complete local hierarchy includes NCR, independent cities, NIR, SGA and every barangay parent',()=>{
 assert.equal(snapshot.regions.length,18);assert.equal(snapshot.barangays.length,42010)
 const regionCodes=new Set(snapshot.regions.map(r=>r.code)),cityCodes=new Set(snapshot.cities.map(r=>r.code))
 for(const row of snapshot.provinces)assert.ok(regionCodes.has(row.region))
 for(const row of snapshot.cities)assert.ok(regionCodes.has(row.region))
 for(const row of snapshot.barangays)assert.ok(cityCodes.has(row.city))
 assert.ok(server.addressChoices('regions').some(r=>r.name.includes('Negros Island')))
 const ncr=server.addressChoices('provinces','1300000000')
 assert.deepEqual(JSON.parse(JSON.stringify(ncr)),[{code:'none:1300000000',name:'No province / NCR'}])
 const manila=server.addressChoices('cities','none:1300000000').find(r=>r.name==='City of Manila')
 assert.equal(server.addressChoices('barangays',manila.code).length,897,'Manila submunicipality barangays are grouped under City of Manila')
 assert.ok(server.addressChoices('provinces','1900000000').some(r=>r.name==='Special Geographic Area'))
 const bulacan=server.addressChoices('provinces','0300000000').find(r=>r.name==='Bulacan')
 assert.ok(server.addressChoices('cities',bulacan.code).some(r=>r.name==='City of Malolos'))
 assert.ok(!server.addressChoices('cities',bulacan.code).some(r=>r.name==='City of Manila'))
})
test('address endpoint is authenticated, filters by valid parents, and rejects malformed queries',async()=>{
 await assert.rejects(()=>server.listAddressOptions({anonymous:true}),e=>e.statusCode===401)
 assert.equal((await server.listAddressOptions({query:{level:'regions'}})).items.length,18)
 for(const query of [{level:'unknown'},{level:'cities',parent:'9999999999'},{level:'barangays',parent:'invalid'},{level:['regions','cities']},{level:'provinces',parent:'1300000000 OR 1=1'}])await assert.rejects(()=>server.listAddressOptions({query}),e=>e.statusCode===400)
})
test('address lookup requests are shared and failed requests can be retried',async()=>{
 let calls=0,fail=false
 const helpers=client(async()=>{calls++;if(fail)throw Error('offline');return{items:[{code:'x',name:'Test'}]}})
 await Promise.all([helpers.loadAddressOptions('regions'),helpers.loadAddressOptions('regions')]);assert.equal(calls,1)
 fail=true;await assert.rejects(()=>helpers.loadAddressOptions('cities','test'));fail=false
 await helpers.loadAddressOptions('cities','test');assert.equal(calls,3)
})
function component(address,fetch=async(level,parent)=>server.addressChoices(level,parent)){
 const scope=vue.effectScope(),props=vue.reactive({modelValue:address,disabled:false}),emits=[]
 const helper=client(()=>{})
 const content=sfc.parse(fs.readFileSync('app/components/EmployeeAddressFields.vue','utf8')).descriptor.scriptSetup.content
 const state=scope.run(()=>evaluate(content+'\nmodule.exports={syncOptions,choose,clearLocation,regions,provinces,cities,barangays,selection,error};',{
  require:name=>name==='vue'?{...vue,onMounted(){},onBeforeUnmount(){}}:name.includes('philippineAddress')?{...helper,loadAddressOptions:fetch}:{},
  withDefaults:x=>x,defineProps:()=>props,defineEmits:()=>((event,value)=>{emits.push(value);props.modelValue=value}),
 }))
 return{state,props,emits,close:()=>scope.stop()}
}
const blank={UnitHouseNumber:'12A',Street:'Test Street',Subdivision:'Sample',Region:'',Province:'',CityMunicipality:'',Barangay:'',PostalCode:''}
test('cascading selection clears only dependent locations and keeps typed street details',async()=>{
 const h=component({...blank,Region:'Region III',Province:'Bulacan',CityMunicipality:'City of Malolos',Barangay:'Atlag',PostalCode:'3000'})
 try{
  await h.state.syncOptions();assert.equal(h.emits.length,0)
  assert.ok(h.state.barangays.value.some(r=>r.name==='Atlag'))
  h.state.choose('Region','1300000000');await h.state.syncOptions()
  assert.equal(h.props.modelValue.Street,'Test Street');assert.equal(h.props.modelValue.Province,'');assert.equal(h.props.modelValue.CityMunicipality,'');assert.equal(h.props.modelValue.Barangay,'');assert.equal(h.props.modelValue.PostalCode,'')
  assert.equal(h.state.selection(h.state.provinces.value,'Province'),'none:1300000000')
  assert.ok(h.state.cities.value.some(r=>r.name==='City of Manila'))
  const before=JSON.stringify(h.props.modelValue);h.state.choose('Region','');assert.equal(JSON.stringify(h.props.modelValue),before,'Typing a search must not erase the address')
  h.props.disabled=true;h.state.choose('Region','0300000000');assert.equal(JSON.stringify(h.props.modelValue),before)
 }finally{h.close()}
})
test('opening a legacy address preserves its typed values and late replies cannot replace the current choices',async()=>{
 const h=component({...blank,Region:'Old region text',Province:'Old province',CityMunicipality:'Old town',Barangay:'Old barangay'})
 try{await h.state.syncOptions();assert.equal(h.emits.length,0);assert.equal(h.props.modelValue.Barangay,'Old barangay');assert.equal(h.state.selection(h.state.regions.value,'Region'),'saved')}finally{h.close()}
 const pending=[]
 const race=component({...blank,Region:'Region III'},(level,parent)=>level==='regions'?Promise.resolve(snapshot.regions):new Promise(resolve=>pending.push({parent,resolve})))
 try{
  const first=race.state.syncOptions();await new Promise(setImmediate)
  race.props.modelValue={...blank,Region:'National Capital Region (NCR)'}
  const next=race.state.syncOptions();await new Promise(setImmediate)
  pending.find(r=>r.parent==='0300000000').resolve(server.addressChoices('provinces','0300000000'));await first
  pending.find(r=>r.parent==='1300000000').resolve(server.addressChoices('provinces','1300000000'));await new Promise(setImmediate)
  pending.find(r=>r.parent==='none:1300000000').resolve(server.addressChoices('cities','none:1300000000'));await next
  assert.equal(race.state.provinces.value[0].code,'none:1300000000')
 }finally{race.close()}
})
test('address editor and employee form compile with aligned searchable controls and measurement units',()=>{
 for(const file of ['app/components/EmployeeAddressFields.vue','app/pages/employees/index.vue']){
  const {descriptor,errors}=sfc.parse(fs.readFileSync(file,'utf8'),{filename:file});assert.deepEqual(errors,[])
  const compiled=sfc.compileScript(descriptor,{id:file})
  assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:compiled.bindings}}).errors,[])
  for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename:file,id:file,scoped:style.scoped}).errors,[])
 }
 const page=fs.readFileSync('app/pages/employees/index.vue','utf8');assert.match(page,/Height \(cm\)/);assert.match(page,/Weight \(kg\)/);assert.match(page,/EmployeeAddressFields v-model="presentAddress" :disabled="sameAsPermanentAddress"/)
})

test('employee form restores saved measurements, maps addresses, and keeps Same as permanent synchronized',async()=>{
 const scope=vue.effectScope(),helper=client(()=>{})
 const source=sfc.parse(fs.readFileSync('app/pages/employees/index.vue','utf8')).descriptor.scriptSetup.content
 const employeeUtils=evaluate(fs.readFileSync('app/utils/employee.ts','utf8'),{require:()=>({})})
 const messages=evaluate(fs.readFileSync('components/alertmessage/messages.ts','utf8'),{require:()=>({})})
 const state=scope.run(()=>evaluate(source+'\nmodule.exports={form,reset,permanentAddress,presentAddress,toggleSameAsPermanentAddress,employeeFormDirty};',{
  require:name=>name==='vue'?{...vue,onMounted(){},onBeforeUnmount(){}}:name.includes('philippineAddress')?helper:name.includes('utils/employee')?employeeUtils:name.includes('alertmessage/messages')?messages:name.includes('useRealtimeRefresh')?{useRealtimeRefresh(){}}:{},defineEmits:()=>()=>{},
 }))
 try{
  state.reset({Height:'165.25',Weight:'60.50',PermanentRegion:'Region III',PermanentProvince:'Bulacan',PermanentStreet:'Saved street'})
  assert.equal(state.form.value.Height,'165.25');assert.equal(state.form.value.Weight,'60.50');assert.equal(state.employeeFormDirty.value,false)
  assert.equal(state.permanentAddress.value.Province,'Bulacan')
  state.toggleSameAsPermanentAddress({target:{checked:true}})
  assert.equal(state.presentAddress.value.Street,'Saved street')
  state.permanentAddress.value={...state.permanentAddress.value,Region:'National Capital Region (NCR)',Province:'',CityMunicipality:'City of Manila',Barangay:'Barangay 1'}
  await vue.nextTick()
  assert.equal(state.presentAddress.value.Region,'National Capital Region (NCR)');assert.equal(state.presentAddress.value.Barangay,'Barangay 1')
 }finally{scope.stop()}
})
