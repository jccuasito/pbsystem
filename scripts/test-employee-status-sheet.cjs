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
    : name.includes('employeeStatusSheet') ? require('../shared/utils/employeeStatusSheet.ts')
    : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : {} }
  scope.run(() => vm.runInNewContext(transformSync(descriptor.scriptSetup.content + '\nmodule.exports={employees,deployments,cutoffs,cutoffHistory,cutoffAssignments,cutoffLoading,cutoffError,loadCutoffHistory,listedEmployees,search,agencyFilter,positionFilter,statusFilter,cutoffSummary,sheetEmployees,openStatusSheet,selectedYear,selectedCutoffKey,sheetEmployeeId,sheetOpen,cutoffRefreshing,refreshError,sheetTotals,summaryOpen,summaryEmployeeId,summaryHistoryRows,summaryLoading,summaryError,openSummary,loadSummary,statusForm,statusReadOnly,canSaveStatus,statusAt,openStatusCell,load,saving,saveStatus,statusOpen,error,alert};', { loader: 'ts', format: 'cjs' }).code, context))
  const state = module.exports
  state.employees.value = [{ EmployeeID: 8, EmployeeName: 'Test Employee' }]
  state.deployments.value = [{ EmployeeID: 8, DeploymentID: 1, StartDate: '2026-09-18', EndDate: '2026-09-20' }]
  state.selectedYear.value = '2026'; state.selectedCutoffKey.value = '2026-09-16|2026-09-30'; state.sheetEmployeeId.value = '8'
  return { state, close: () => scope.stop() }
}

test('sheet uses the complete cutoff, counts one record per day, and opens locked details read-only', async () => {
  const requests = [], harness = workspace(async (url, options) => {
    requests.push({ url, options })
    return { history: [
      { EmployeeID: 8, DeploymentID: 2, AttendanceID: 99, AttendanceDate: '2026-09-18', AttendanceStatus: 'Reliever' },
      { EmployeeID: 8, DeploymentID: 1, AttendanceID: 1, AttendanceDate: '2026-09-18', AttendanceStatus: 'Present' },
      { EmployeeID: 8, DeploymentID: 1, AttendanceID: 2, AttendanceDate: '2026-09-19', AttendanceStatus: 'Suspended', BatchID: 71, DtrStatus: 'Computed to Payroll', Remarks: 'HR reference', UpdatedByName: 'Test Encoder', UpdatedAt: '2026-09-21 09:30:00' },
    ] }
  })
  try {
    await harness.state.openStatusSheet({ EmployeeID: 8 })
    assert.equal(requests[0].url, '/api/employees/status/cutoff')
    assert.equal(requests[0].options.query.startDate, '2026-09-16')
    assert.equal(harness.state.sheetTotals.value.counts.Present, 1, JSON.stringify({ totals: harness.state.sheetTotals.value, loading: harness.state.cutoffLoading.value, rows: harness.state.cutoffHistory.value.length, cutoff: harness.state.selectedCutoffKey.value }))
    assert.equal(harness.state.sheetTotals.value.counts.Suspended, 1)
    assert.equal(harness.state.sheetTotals.value.missingDays, 13)
    harness.state.openStatusCell({ EmployeeID: 8 }, '2026-09-19')
    assert.equal(harness.state.statusReadOnly.value, true)
    assert.equal(harness.state.canSaveStatus.value, false)
    assert.equal(harness.state.statusForm.value.Remarks, 'HR reference')
  } finally { harness.close() }
})

test('rapid summary reopen ignores old success and error responses for another employee', async () => {
  const pending = [], h = workspace(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))), s = h.state
  try {
    const first = s.openSummary({ EmployeeID: 8 })
    s.summaryOpen.value = false
    const second = s.openSummary({ EmployeeID: 9 })
    pending[1].resolve({ year: 2026, history: [{ EmployeeID: 9, AttendanceDate: '2026-09-18', AttendanceStatus: 'Present' }] })
    await second
    pending[0].resolve({ year: 2025, history: [{ EmployeeID: 8, AttendanceDate: '2025-09-18', AttendanceStatus: 'Absent' }] })
    await first
    assert.equal(s.summaryHistoryRows.value[0].EmployeeID, 9)
    assert.equal(s.summaryLoading.value, false)
    s.summaryOpen.value = false
    const third = s.openSummary({ EmployeeID: 8 })
    s.summaryOpen.value = false
    const fourth = s.openSummary({ EmployeeID: 9 })
    pending[2].reject(new Error('old offline request')); await third
    assert.equal(s.summaryError.value, '')
    assert.equal(s.summaryLoading.value, true)
    pending[3].resolve({ year: 2026, history: [] }); await fourth
    assert.equal(s.summaryLoading.value, false)
  } finally { h.close() }
})

test('HR can encode any cutoff day without a deployment or DTR, for later Regular or Reliever enrollment', async () => {
  const harness = workspace(async () => ({ history: [] }))
  try {
    const state = harness.state
    state.deployments.value = []
    state.sheetOpen.value = true
    await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await vue.nextTick()
    assert.equal(state.sheetEmployees.value.length, 1)
    assert.equal(state.sheetTotals.value.assignedDays, 15)
    assert.equal(state.sheetTotals.value.missingDays, 15)
    state.openStatusCell({ EmployeeID: 8 }, '2026-09-16')
    state.statusForm.value.AttendanceStatus = 'Sick Leave'
    state.statusForm.value.Remarks = 'HR medical certificate'
    assert.equal(state.canSaveStatus.value, true)
    assert.equal(state.statusReadOnly.value, false)
    // A computed roster locks even an otherwise blank attendance date.
    state.cutoffs.value = [{ EmployeeID: 8, BatchID: 5, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', DtrStatus: 'Computed to Payroll' }]
    assert.equal(state.statusReadOnly.value, true)
    assert.equal(state.canSaveStatus.value, false)
  } finally { harness.close() }
})


test('cutoff summary and exact status filters include pending dates, group leave and deduplicate calendar days', async () => {
  const h = workspace(async () => ({})), s = h.state
  try {
    s.employees.value = [
      { EmployeeID: 8, EmployeeName: 'One', AgencyName: 'A', PositionName: 'Guard' },
      { EmployeeID: 9, EmployeeName: 'Two', AgencyName: 'B', PositionName: 'Clerk' },
    ]
    s.cutoffHistory.value = [
      { EmployeeID: 8, AttendanceID: 1, DeploymentID: 1, AttendanceDate: '2026-09-18', AttendanceStatus: 'Present' },
      { EmployeeID: 8, AttendanceID: 99, DeploymentID: 2, AttendanceDate: '2026-09-18', AttendanceStatus: 'Absent' },
      { EmployeeID: 8, AttendanceID: 2, DeploymentID: null, AttendanceDate: '2026-09-19', AttendanceStatus: 'Sick Leave' },
      { EmployeeID: 8, AttendanceID: 3, AttendanceDate: '2026-09-20', AttendanceStatus: 'Vacation Leave' },
      { EmployeeID: 9, AttendanceID: 4, AttendanceDate: '2026-09-19', AttendanceStatus: 'Absent' },
      { EmployeeID: 9, AttendanceID: 5, AttendanceDate: '2026-10-01', AttendanceStatus: 'Present' },
    ]
    assert.equal(s.cutoffSummary(8).counts.Present, 1)
    assert.equal(s.cutoffSummary(8).counts.Leave, 2)
    assert.equal(s.cutoffSummary(8).counts.Absent, 0)
    assert.equal(s.cutoffSummary(8).missingDays, 12)
    s.statusFilter.value = 'Sick Leave'
    assert.deepEqual(Array.from(s.listedEmployees.value, e => e.EmployeeID), [8])
    s.sheetEmployeeId.value = ''
    assert.equal(s.sheetEmployees.value.length, 1)
    assert.equal(s.sheetTotals.value.counts.Leave, 2)
    s.statusFilter.value = 'Absent'
    assert.deepEqual(Array.from(s.listedEmployees.value, e => e.EmployeeID), [9])
    s.agencyFilter.value = 'A'
    assert.equal(s.sheetEmployees.value.length, 0)
    s.statusFilter.value = ''; s.agencyFilter.value = ''; s.positionFilter.value = 'Clerk'
    assert.deepEqual(Array.from(s.listedEmployees.value, e => e.EmployeeID), [9])
    s.positionFilter.value = ''; s.search.value = 'one'
    assert.equal(s.listedEmployees.value.length, 1)
    s.search.value = ''; s.statusFilter.value = 'not-encoded'
    assert.equal(s.listedEmployees.value.length, 2)
    s.selectedCutoffKey.value = '2026-10-01|2026-10-15'
    assert.equal(s.cutoffSummary(8).encodedDays, 0)
    assert.equal(s.cutoffSummary(9).counts.Present, 1)
  } finally { h.close() }
})

test('cutoff changes ignore stale responses and errors never masquerade as unencoded dates', async () => {
  const pending = [], h = workspace(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))), s = h.state
  try {
    const first = s.loadCutoffHistory()
    s.selectedCutoffKey.value = '2026-10-01|2026-10-15'
    const second = s.loadCutoffHistory()
    pending[1].resolve({ history: [{ EmployeeID: 8, AttendanceID: 2, AttendanceDate: '2026-10-01', AttendanceStatus: 'Absent' }], cutoffs: [] })
    await second
    pending[0].resolve({ history: [{ EmployeeID: 8, AttendanceID: 1, AttendanceDate: '2026-09-16', AttendanceStatus: 'Present' }], cutoffs: [] })
    await first
    assert.equal(s.cutoffSummary(8).counts.Absent, 1)
    assert.equal(s.cutoffSummary(8).counts.Present, 0)
    const failed = s.loadCutoffHistory()
    pending[2].reject(new Error('offline'))
    await failed
    assert.ok(s.cutoffError.value)
    assert.equal(s.cutoffLoading.value, false)
    s.statusForm.value = { EmployeeID: '8', AttendanceStatus: 'Present', StartDate: '2026-10-01', EndDate: '2026-10-01', Remarks: '' }
    assert.equal(s.canSaveStatus.value, false)
  } finally { h.close() }
})


test('background refresh retains statuses and buttons, coalesces requests and preserves data when offline', async () => {
  const pending = [], h = workspace(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))), s = h.state
  try {
    const initial = s.loadCutoffHistory()
    pending[0].resolve({ history: [{ EmployeeID: 8, AttendanceID: 1, AttendanceDate: '2026-09-18', AttendanceStatus: 'Present' }], cutoffs: [] })
    await initial
    const background = s.loadCutoffHistory({ background: true })
    const same = s.loadCutoffHistory({ background: true })
    assert.equal(pending.length, 2)
    assert.equal(s.cutoffLoading.value, false)
    assert.equal(s.cutoffRefreshing.value, true)
    assert.equal(s.cutoffSummary(8).counts.Present, 1)
    pending[1].reject(new Error('offline')); await Promise.all([background, same])
    assert.equal(s.cutoffError.value, '')
    assert.match(s.refreshError.value, /Unable to refresh/)
    assert.equal(s.cutoffSummary(8).counts.Present, 1)
    assert.equal(s.cutoffRefreshing.value, false)
    const retry = s.loadCutoffHistory({ background: true })
    pending[2].resolve({ history: [], cutoffs: [] }); await retry
    assert.equal(s.refreshError.value, '')
    assert.equal(s.cutoffSummary(8).encodedDays, 0)
  } finally { h.close() }
})

test('fresh cutoff rosters supersede stale computed locks in metadata after reopening a Draft', async () => {
  const h = workspace(async () => ({ history: [], cutoffs: [{ EmployeeID: 8, BatchID: 5, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', DtrStatus: 'Draft' }] })), s = h.state
  try {
    s.cutoffs.value = [{ EmployeeID: 8, BatchID: 5, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', DtrStatus: 'Computed to Payroll' }]
    s.openStatusCell({ EmployeeID: 8 }, '2026-09-18')
    assert.equal(s.statusReadOnly.value, true)
    await s.loadCutoffHistory()
    assert.equal(s.statusReadOnly.value, false)
  } finally { h.close() }
})


test('metadata refresh is coalesced and a failed silent request keeps the loaded employees', async () => {
  const pending = [], h = workspace((url) => url.endsWith('/cutoff') ? Promise.resolve({ history: [], cutoffs: [] }) : new Promise((resolve, reject) => pending.push({ resolve, reject }))), s = h.state
  try {
    const initial = s.load()
    const duplicate = s.load(true)
    assert.equal(pending.length, 1)
    pending[0].resolve({ employees: [{ EmployeeID: 8, EmployeeName: 'Loaded Employee' }] })
    await Promise.all([initial, duplicate])
    const refresh = s.load(true)
    pending[1].reject(new Error('network disconnected')); await refresh
    assert.equal(s.employees.value[0].EmployeeName, 'Loaded Employee')
    assert.equal(s.error.value, '')
    assert.match(s.refreshError.value, /Unable to refresh/)
    const retry = s.load(true)
    pending[2].resolve({ employees: [{ EmployeeID: 8, EmployeeName: 'Loaded Employee' }] }); await retry
    assert.equal(s.refreshError.value, '')
  } finally { h.close() }
})

test('rapid Save sends one POST and failed saves keep the editor and reason for retry', async () => {
  const pending = [], h = workspace((url, options) => options?.method === 'POST' ? new Promise((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve({ history: [], cutoffs: [] })), s = h.state
  try {
    s.openStatusCell({ EmployeeID: 8 }, '2026-09-18')
    s.statusForm.value.AttendanceStatus = 'Sick Leave'; s.statusForm.value.Remarks = 'Medical certificate'
    const failed = s.saveStatus()
    await s.saveStatus()
    assert.equal(pending.length, 1)
    assert.equal(s.saving.value, true)
    pending[0].reject({ data: { statusMessage: 'Connection lost' } }); await failed
    assert.equal(s.statusOpen.value, true)
    assert.equal(s.statusForm.value.Remarks, 'Medical certificate')
    assert.equal(s.error.value, 'Connection lost')
    assert.equal(s.canSaveStatus.value, true)
    const retry = s.saveStatus()
    pending[1].resolve({ pending: 1 }); await retry
    assert.equal(s.statusOpen.value, false)
    assert.equal(s.saving.value, false)
    assert.equal(s.alert.value.tone, 'success')
  } finally { h.close() }
})
