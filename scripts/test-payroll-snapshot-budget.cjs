const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild')
const moduleValue={exports:{}}
vm.runInNewContext(transformSync(fs.readFileSync('server/utils/payrollSnapshotBudget.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:moduleValue,Buffer,require:()=>({createError:body=>Object.assign(new Error(body.statusMessage),body)})})
const {payrollSnapshotJson}=moduleValue.exports
const connection=limit=>({execute:async sql=>{assert.equal(sql,'SELECT @@max_allowed_packet AS MaxPacketBytes');return [[{MaxPacketBytes:limit}]]}})
test('small and configured-large payroll snapshots preserve exact JSON',async()=>{
 const value={employees:[{name:'TEST',gross:123.45}]}
 assert.equal(await payrollSnapshotJson(connection(1048576),value),JSON.stringify(value))
 const large={employees:'x'.repeat(2800000)}
 assert.equal(await payrollSnapshotJson(connection(16777216),large),JSON.stringify(large))
})
test('oversized UTF-8 snapshot fails before financial inserts, with a nonretryable response',async()=>{
 await assert.rejects(payrollSnapshotJson(connection(1048576),{employees:'x'.repeat(2800000)}),error=>error.statusCode===413)
 await assert.rejects(payrollSnapshotJson(connection(1048576),{employees:'界'.repeat(400000)}),error=>error.statusCode===413)
})
