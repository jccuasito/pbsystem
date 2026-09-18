const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}
const messages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const helpers = evaluate(fs.readFileSync('shared/utils/deployment.ts', 'utf8'))
const identities = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
test('conflicts use employee identity and inclusive periods, not display names or DTR-only rows', () => {
  const rows = [{ EmployeeID: 7, IsPermanentSite: 1, StartDate: '2026-09-03', EndDate: '2026-10-10' }]
  for (const [start,end] of [['2026-09-03',''],['2026-09-01','2026-09-03'],['2026-10-10','2026-10-11']]) assert.ok(helpers.findDeploymentConflict(rows,'7',start,end))
  assert.equal(helpers.findDeploymentConflict(rows,7,'2026-10-11'), undefined)
  assert.equal(helpers.findDeploymentConflict(rows,7,'2026-09-01','2026-09-02'), undefined)
  assert.equal(helpers.findDeploymentConflict(rows,8,'2026-09-03'), undefined)
  assert.equal(helpers.findDeploymentConflict([{...rows[0],IsPermanentSite:0}],7,'2026-09-03'), undefined)
})
test('deployment form shows shared alert for local conflict and stale-server conflict', async () => {
  const scope = vue.effectScope()
  let posts = 0, stale = false
  const source = parse(fs.readFileSync('app/pages/employees/deployment-history/index.vue','utf8')).descriptor.scriptSetup.content
  const state = scope.run(() => evaluate(source+'\nmodule.exports={openNewDeployment,items,form,save,deploymentAlert,modalOpen,busy};', {
    require: name => name === 'vue' ? {...vue,onMounted(){}} : name.includes('useRealtimeRefresh') ? {useRealtimeRefresh(){}} : name.includes('utils/employee') ? identities : name.includes('alertmessage/messages') ? messages : name.includes('utils/deployment') ? helpers : {},
    $fetch: async (url, options) => {
      if (options?.method === 'POST') { posts++; if(stale) throw {data:{data:{code:messages.DEPLOYMENT_ALREADY_EXISTS}}}; return {success:true} }
      return {employees:[{EmployeeID:7,AgencyID:3,AgencyPositionID:3,EmployeeName:'Ian'}], clientRates:[{ClientRateID:1,AgencyID:3,AgencyPositionID:3,ClientID:1}],sites:[{SiteID:1,ClientID:1}],agencyShiftCodes:[{ShiftCodeID:7,AgencyID:3}]}
    },
  }))
  try {
    await state.openNewDeployment()
    Object.assign(state.form.value,{EmployeeID:'7',ClientRateID:'1',SiteID:'1',ShiftCodeID:'7',StartDate:'2026-09-19'})
    state.items.value=[{EmployeeID:7,IsPermanentSite:1,StartDate:'2026-09-01',EndDate:null}]
    await state.save(); assert.equal(posts,0); assert.equal(state.deploymentAlert.value.title,'Employee already deployed'); assert.equal(state.modalOpen.value,true)
    state.items.value=[]; stale=true; state.deploymentAlert.value=null
    await state.save(); assert.equal(posts,1); assert.equal(state.deploymentAlert.value.title,'Employee already deployed'); assert.equal(state.modalOpen.value,true); assert.equal(state.busy.value,false)
    stale=false; state.deploymentAlert.value=null
    await state.save(); assert.equal(posts,2); assert.equal(state.modalOpen.value,false)
  } finally {scope.stop()}
})
test('deployment form compiles with its warning and alert', () => {
  const filename='app/pages/employees/deployment-history/index.vue'
  const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename})
  assert.deepEqual(errors,[])
  const script=compileScript(descriptor,{id:'deployment'})
  assert.deepEqual(compileTemplate({source:descriptor.template.content,filename,id:'deployment',compilerOptions:{bindingMetadata:script.bindings}}).errors,[])
  for(const style of descriptor.styles) assert.deepEqual(compileStyle({source:style.content,filename,id:'deployment',scoped:style.scoped}).errors,[])
})
