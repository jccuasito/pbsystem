const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse } = require('@vue/compiler-sfc')
const vue = require('vue')
const { employeeStatusCutoffSummary } = require('../shared/utils/employeeStatusSheet.ts')

test('cutoff counts include only assigned dates and keep blanks separate from absence', () => {
  const statuses = { '2026-09-16': 'Absent', '2026-09-18': 'Present', '2026-09-19': 'Absent' }
  const result = employeeStatusCutoffSummary(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-20'],
    day => statuses[day], day => day >= '2026-09-18')
  assert.equal(result.assignedDays, 3)
  assert.equal(result.encodedDays, 2)
  assert.equal(result.missingDays, 1)
  assert.equal(result.counts.Absent, 1)
})

test('leave is grouped while late, half-day, rest day, holiday and reliever remain explicit', () => {
  const statuses = ['Present', 'Absent', 'On-Leave', 'Vacation Leave', 'Sick Leave', 'Suspended', 'Late', 'Half-Day', 'Rest Day', 'Holiday', 'Reliever', null]
  const dates = statuses.map((_, index) => String(index))
  const result = employeeStatusCutoffSummary(dates, day => statuses[Number(day)], () => true)
  assert.equal(result.counts.Leave, 3)
  assert.equal(result.counts.Late, 1)
  assert.equal(result.counts.Suspended, 1)
  assert.equal(result.encodedDays, 11)
  assert.equal(result.missingDays, 1)
  assert.equal(Object.values(result.counts).reduce((sum, value) => sum + value, 0), 11)
})

function workspace(fetch) {
  const { descriptor } = parse(fs.readFileSync('app/pages/employees/status/index.vue', 'utf8'))
  const scope = vue.effectScope(), module = { exports: {} }
  const context = { module, $fetch: fetch, require: name => name === 'vue' ? { ...vue, onMounted() {} }
    : name.includes('attendanceStatuses') ? require('../shared/utils/attendanceStatuses.ts')
    : name.includes('employeeStatusSheet') ? { employeeStatusCutoffSummary }
    : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : {} }
  scope.run(() => vm.runInNewContext(transformSync(descriptor.scriptSetup.content + '\nmodule.exports={employees,deployments,selectedYear,selectedCutoffKey,sheetEmployeeId,sheetOpen,sheetHistory,sheetHistoryLoading,sheetTotals,statusForm,statusReadOnly,canSaveStatus,statusAt,openStatusCell};', { loader: 'ts', format: 'cjs' }).code, context))
  const state = module.exports
  state.employees.value = [{ EmployeeID: 8, EmployeeName: 'Test Employee' }]
  state.deployments.value = [{ EmployeeID: 8, DeploymentID: 1, StartDate: '2026-09-18', EndDate: '2026-09-20' }]
  state.selectedYear.value = '2026'; state.selectedCutoffKey.value = '2026-09-16|2026-09-30'; state.sheetEmployeeId.value = '8'
  return { state, close: () => scope.stop() }
}

test('sheet uses full employee history, counts one record per day, and opens locked details read-only', async () => {
  const requests = [], harness = workspace(async (url, options) => {
    requests.push({ url, options })
    return { history: [
      { EmployeeID: 8, DeploymentID: 2, AttendanceID: 99, AttendanceDate: '2026-09-18', AttendanceStatus: 'Reliever' },
      { EmployeeID: 8, DeploymentID: 1, AttendanceID: 1, AttendanceDate: '2026-09-18', AttendanceStatus: 'Present' },
      { EmployeeID: 8, DeploymentID: 1, AttendanceID: 2, AttendanceDate: '2026-09-19', AttendanceStatus: 'Suspended', BatchID: 71, DtrStatus: 'Computed to Payroll', Remarks: 'HR reference', UpdatedByName: 'Test Encoder', UpdatedAt: '2026-09-21 09:30:00' },
    ] }
  })
  try {
    harness.state.sheetOpen.value = true
    await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await vue.nextTick()
    assert.equal(requests[0].url, '/api/employees/status/8/summary')
    assert.equal(requests[0].options.query.year, '2026')
    assert.equal(harness.state.sheetTotals.value.counts.Present, 1, JSON.stringify({ totals: harness.state.sheetTotals.value, loading: harness.state.sheetHistoryLoading.value, rows: harness.state.sheetHistory.value.length, cutoff: harness.state.selectedCutoffKey.value }))
    assert.equal(harness.state.sheetTotals.value.counts.Suspended, 1)
    assert.equal(harness.state.sheetTotals.value.missingDays, 1)
    harness.state.openStatusCell({ EmployeeID: 8 }, '2026-09-19')
    assert.equal(harness.state.statusReadOnly.value, true)
    assert.equal(harness.state.canSaveStatus.value, false)
    assert.equal(harness.state.statusForm.value.Remarks, 'HR reference')
  } finally { harness.close() }
})

test('changing year ignores a slower response for the previous selection', async () => {
  const pending = [], harness = workspace(() => new Promise(resolve => pending.push(resolve)))
  try {
    harness.state.sheetOpen.value = true
    await vue.nextTick()
    harness.state.selectedYear.value = '2027'
    await vue.nextTick()
    pending[1]({ history: [] }); await vue.nextTick(); await vue.nextTick()
    pending[0]({ history: [{ EmployeeID: 8, AttendanceDate: '2026-09-18', AttendanceStatus: 'Absent' }] })
    await vue.nextTick(); await vue.nextTick()
    assert.equal(harness.state.sheetHistory.value.length, 0)
    assert.equal(harness.state.sheetHistoryLoading.value, false)
  } finally { harness.close() }
})
