const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}
const identities = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
const messages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const deployments = evaluate(fs.readFileSync('shared/utils/deployment.ts', 'utf8'))
const source = parse(fs.readFileSync('app/pages/employees/deployment-history/index.vue', 'utf8')).descriptor.scriptSetup.content
function history() {
  const scope = vue.effectScope()
  let requests = 0
  const state = scope.run(() => evaluate(source + '\nmodule.exports={openDetails,selectedEmployee,dtrAssignments,historyCutoff,historyAssignment,employeeHistoryCutoffs,filteredFixedHistory,filteredEmployeeDtrHistory,clearHistoryFilters};', {
    require: name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : name.includes('utils/employee') ? identities : name.includes('alertmessage/messages') ? messages : name.includes('utils/deployment') ? deployments : {},
    $fetch: async () => { requests++; return {} },
  }))
  state.dtrAssignments.value = [
    { EmployeeID: 1, BatchID: 3, AttendanceType: 'Regular', PeriodStart: '2026-10-01', PeriodEnd: '2026-10-15' },
    { EmployeeID: 1, BatchID: 4, AttendanceType: 'Reliever', PeriodStart: '2026-10-01', PeriodEnd: '2026-10-15' },
    { EmployeeID: 1, BatchID: 2, AttendanceType: 'Regular', PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30' },
    { EmployeeID: 1, BatchID: 1, AttendanceType: 'Reliever', PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' },
    { EmployeeID: 2, BatchID: 5, PeriodStart: '2026-08-16', PeriodEnd: '2026-08-31' },
  ]
  state.openDetails({ EmployeeID: 1, history: [
    { DeploymentID: 3, DeploymentType: 'Regular', StartDate: '2026-10-01', EndDate: null },
    { DeploymentID: 2, DeploymentType: 'Regular', StartDate: '2026-09-16', EndDate: '2026-09-30' },
    { DeploymentID: 1, DeploymentType: 'Regular', StartDate: '2026-09-01', EndDate: '2026-09-15' },
  ] })
  return { state, requests: () => requests, close: () => scope.stop() }
}

test('cutoff finds the overlapping fixed posting and its DTR entries', () => {
  const h = history()
  try {
    for (const [cutoff, deploymentId, dtrCount] of [['2026-09-16|2026-09-30', 2, 1], ['2026-10-01|2026-10-15', 3, 2]]) {
      h.state.historyCutoff.value = cutoff
      assert.equal(h.state.filteredFixedHistory.value.length, 1)
      assert.equal(h.state.filteredFixedHistory.value[0].DeploymentID, deploymentId)
      assert.equal(h.state.filteredEmployeeDtrHistory.value.length, dtrCount)
    }
  } finally { h.close() }
})

test('assignment filters each list using its assignment type', () => {
  const h = history()
  try {
    h.state.historyAssignment.value = 'Regular'
    assert.equal(h.state.filteredFixedHistory.value.length, 3)
    assert.equal(h.state.filteredEmployeeDtrHistory.value.length, 2)
    h.state.historyAssignment.value = 'Reliever'
    assert.equal(h.state.filteredFixedHistory.value.length, 0)
    assert.equal(h.state.filteredEmployeeDtrHistory.value.length, 2)
    h.state.selectedEmployee.value.history[0].DeploymentType = 'Reliever'
    assert.equal(h.state.filteredFixedHistory.value.length, 1)
  } finally { h.close() }
})

test('cutoff and assignment combine without changing the available cutoff options', () => {
  const h = history()
  try {
    assert.equal(h.state.employeeHistoryCutoffs.value.length, 3)
    h.state.historyCutoff.value = '2026-10-01|2026-10-15'
    h.state.historyAssignment.value = 'Reliever'
    assert.equal(h.state.filteredFixedHistory.value.length, 0)
    assert.equal(h.state.filteredEmployeeDtrHistory.value.length, 1)
    assert.equal(h.state.filteredEmployeeDtrHistory.value[0].BatchID, 4)
    assert.equal(h.state.employeeHistoryCutoffs.value.length, 3)
    h.state.historyAssignment.value = 'Regular'
    assert.equal(h.state.filteredFixedHistory.value.length, 1)
    assert.equal(h.state.filteredEmployeeDtrHistory.value[0].BatchID, 3)
  } finally { h.close() }
})

test('clearing restores all records without requests or record mutations', () => {
  const h = history()
  try {
    const original = JSON.stringify([h.state.selectedEmployee.value.history, h.state.dtrAssignments.value])
    h.state.historyCutoff.value = '2026-10-01|2026-10-15'
    h.state.historyAssignment.value = 'Reliever'
    assert.equal(h.state.filteredEmployeeDtrHistory.value.length, 1)
    h.state.clearHistoryFilters()
    assert.equal(h.state.historyCutoff.value, '')
    assert.equal(h.state.historyAssignment.value, '')
    assert.equal(h.state.filteredFixedHistory.value.length, 3)
    assert.equal(h.state.filteredEmployeeDtrHistory.value.length, 4)
    assert.equal(JSON.stringify([h.state.selectedEmployee.value.history, h.state.dtrAssignments.value]), original)
    assert.equal(h.requests(), 0)
  } finally { h.close() }
})

test('opening another employee clears filters and scopes the available cutoffs', () => {
  const h = history()
  try {
    h.state.historyCutoff.value = '2026-10-01|2026-10-15'
    h.state.historyAssignment.value = 'Reliever'
    h.state.openDetails({ EmployeeID: 2, history: [] })
    assert.equal(h.state.historyCutoff.value, '')
    assert.equal(h.state.historyAssignment.value, '')
    assert.equal(h.state.employeeHistoryCutoffs.value.length, 1)
    assert.equal(h.state.employeeHistoryCutoffs.value[0].key, '2026-08-16|2026-08-31')
  } finally { h.close() }
})
