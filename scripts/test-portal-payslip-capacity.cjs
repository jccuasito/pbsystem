const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
function handler({read,posted,auth}={}){
 let leases=0,releases=0
 const connection={execute:async(_sql,values)=>{assert.equal(values[0],42);return[posted||[]]},release:()=>releases++}
 const module={exports:{}}
 const imports={
  '../../connection/dbconnect':{getConnection:async()=>{leases++;return connection}},
  '../../utils/employeePortalAuth':{requireEmployeeSession:auth||(async()=>({EmployeeID:42}))},
  '../../utils/payslipCrud':{readEmployeePayslips:async(id,db)=>{assert.equal(id,42);assert.equal(db,connection);return read?read():{cutoffs:[{key:'valid',publicationStatus:'Posted'}]}}},
 }
 vm.runInNewContext(transformSync(fs.readFileSync('server/api/employee-portal/payslips.get.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,require:name=>{assert.ok(imports[name],name);return imports[name]},defineEventHandler:value=>value})
 return{run:module.exports.default,counts:()=>({leases,releases})}
}
test('portal payslip read uses one connection, filters stale sources, and takes employee identity only from session',async()=>{
 const h=handler({posted:[{PublicationID:1,GroupKey:'valid',SnapshotJson:JSON.stringify({employee:{EmployeeID:42}})},{PublicationID:2,GroupKey:'stale',SnapshotJson:'{}'}]})
 const result=await h.run({query:{employeeId:999}})
 assert.equal(result.payslips.length,1);assert.equal(result.payslips[0].employee.EmployeeID,42)
 assert.deepEqual(h.counts(),{leases:1,releases:1})
})
test('portal payslip read releases its lease after a profile error',async()=>{
 const failure=Error('query failed'),h=handler({read:()=>{throw failure}})
 await assert.rejects(h.run({}),error=>error===failure)
 assert.deepEqual(h.counts(),{leases:1,releases:1})
})
test('unauthorized portal read cannot acquire a financial database lease',async()=>{
 const h=handler({auth:async()=>{throw Error('unauthorized')}})
 await assert.rejects(h.run({}),/unauthorized/);assert.deepEqual(h.counts(),{leases:0,releases:0})
})
