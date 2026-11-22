const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
function load(file,deps,globals={}){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,require:n=>{if(n in deps)return deps[n];throw Error(n)},Buffer,console,Date,...globals});return module.exports}
function cache(){
 let epoch='one',fail=false
 const pending=new Map(),pool={execute:async sql=>{if(fail)throw Error('offline');if(sql.startsWith('UPDATE')){epoch+='x';return[{affectedRows:1}]};return[[{CacheEpoch:epoch}]]}}
 const coalesceRead=(key,read)=>{if(pending.has(key))return pending.get(key);const p=Promise.resolve().then(read).finally(()=>pending.delete(key));pending.set(key,p);return p}
 return{api:load('server/utils/lookupCache.ts',{'../connection/dbconnect':pool,'./requestCapacity':{coalesceRead}}),advance:()=>{epoch+='y'},offline:()=>{fail=true}}
}
test('metadata values are shared while pending, cloned per caller, and invalidated across processes',async()=>{
 const {api,advance}=cache();let reads=0
 const read=async()=>{reads++;await new Promise(r=>setTimeout(r,2));return{items:[{name:'old'}]}}
 const all=await Promise.all(Array.from({length:50},()=>api.cachedLookup('agency',read)))
 assert.equal(reads,1);all[0].items[0].name='changed';assert.equal(all[1].items[0].name,'old')
 await api.cachedLookup('agency',read);assert.equal(reads,1)
 advance();await api.cachedLookup('agency',read);assert.equal(reads,2)
 await api.invalidateLookupCache();await api.cachedLookup('agency',read);assert.equal(reads,3)
})
test('an old in-flight read cannot populate a newly invalidated generation',async()=>{
 const {api}=cache();let finish
 const old=api.cachedLookup('site',()=>new Promise(r=>{finish=r}))
 while(!finish)await new Promise(r=>setTimeout(r,0))
 await api.invalidateLookupCache();finish({version:'old'});await old
 assert.equal((await api.cachedLookup('site',async()=>({version:'new'}))).version,'new')
})
test('cache bypasses unavailable epochs, failures and oversized values; memory stays bounded',async()=>{
 const {api,offline}=cache();let reads=0
 await assert.rejects(api.cachedLookup('bad',async()=>{throw Error('not cached')}))
 for(let i=0;i<2;i++)await api.cachedLookup('large',async()=>{reads++;return'x'.repeat(600*1024)})
 assert.equal(reads,2)
 for(let i=0;i<150;i++)await api.cachedLookup('page:'+i,async()=>({i}))
 assert.ok(api.lookupCacheMetrics().entries<=128);assert.ok(api.lookupCacheMetrics().bytes<=8*1024*1024)
 offline();assert.equal(await api.cachedLookup('page:149',async()=>99),99)
})
test('review hashes ignore display history and bind financial changes independent of object-key order',()=>{
 const {payrollReviewHash:hash}=load('server/utils/payrollReviewHash.ts',{'node:crypto':require('node:crypto')})
 const a={BatchID:1,Status:'Computed to Payroll',employees:[{EmployeeID:1,gross:100,netPreview:90}],gross:100,deductions:10,netPreview:90}
 assert.equal(hash(a),hash({...a,history:[{when:'later'}]}))
 assert.equal(hash(a),hash({...a,employees:[{netPreview:90,gross:100,EmployeeID:1}]}))
 assert.notEqual(hash(a),hash({...a,employees:[{EmployeeID:1,gross:101,netPreview:91}]}))
})
