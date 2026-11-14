const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { componentAmountCents, payrollDeductionHours } = require('../shared/utils/payrollPreview.ts')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const vue = require('vue')

const root = path.resolve(__dirname, '..')
const statusModule = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'shared/utils/dtrAttendanceStatus.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: statusModule })
const { automaticDtrAttendanceStatus } = statusModule.exports
const attendanceStatusesModule = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'shared/utils/attendanceStatuses.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: attendanceStatusesModule })
const alertModule = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'components/alertmessage/messages.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: alertModule })
const filename = path.join(root, 'app/components/DtrAttendanceWorkspace.vue')
const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const policy = { AutoBreakEnabled: 1, DefaultBreakMinutes: 60, RelieverPositionOverrideEnabled: 1, DayShiftNDEnabled: 0 }
const philtob = { ShiftCodeID: 7, ShiftCode: 'DS0900-1800', ShiftType: 'DS', TimeIn: '09:00:00', TimeOut: '18:00:00', RegularHours: 8, RegularOTCap: 1, WorkdayCount: 1 }
const employee = { EmployeeID: 5, DeploymentType: 'Regular' }
const record = { ...employee, AttendanceDate: '2026-09-01', AttendanceStatus: 'Present', ShiftCodeID: '7', TimeIn: '2026-09-01 09:23:00', TimeOut: '2026-09-01 18:00:00', RegularHours: 8, OTHours: 0, OTExtHours: 0, BreakHours: 1, LateHours: 0.38, UndertimeHours: 0, WorkAgencyPositionID: '2', WorkPayrollRegularRate: '500.00' }

function workspace(shift = philtob, saved = record, sitePolicy = policy, exportResult) {
  const requests = []
  const workbooks = []
  const scope = vue.effectScope()
  const context = {
    Date,
    ...vue, onMounted() {}, defineProps: () => ({ dtr: { BatchID: 11, PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' } }), defineEmits: () => () => {},
    module: { exports: {} }, require: name => name.includes('attendanceFieldControls') ? require('../shared/utils/attendanceFieldControls.ts') : name.includes('dtrAttendanceStatus') ? statusModule.exports : name.includes('attendanceStatuses') ? attendanceStatusesModule.exports : name.endsWith('/messages') ? alertModule.exports : name.endsWith('.vue') ? {} : require(name),
    xlsxForTest: { ...require('xlsx'), writeFile: workbook => workbooks.push(workbook) },
    $fetch: async (url, options) => {
      if (options) requests.push({ url, ...options })
      return exportResult || { records: [employee], attendanceRows: [saved], shifts: [shift], policy: sitePolicy }
    },
  }
  vm.createContext(context)
  scope.run(() => vm.runInContext(transformSync(descriptor.scriptSetup.content.replaceAll("await import('xlsx')", 'xlsxForTest') + '\nmodule.exports = { dayForm, dayOpen, dayTimeConflict, canEditAttendanceField, resetControlledField, editControlledField, shifts, sitePolicy, attendanceRows, relieverElsewhereRows, displayedEntry, elsewhereLabel, totalDays, openDay, saveDay, onHourInput, onMinuteInput, recalculateHoursFromTimes, selectDayShift, statusCellClass, exportDtr, readDtrImportFile, importRows, submitDtrImport, error };', { loader: 'ts', format: 'cjs' }).code, context))
  const state = context.module.exports
  state.shifts.value = [shift]
  state.sitePolicy.value = { ...sitePolicy }
  state.attendanceRows.value = [{ ...saved }]
  return { state, requests, workbooks, close: () => scope.stop() }
}

function backend() {
  const context = { module: { exports: {} }, require: () => ({}) }
  vm.createContext(context)
  const source = fs.readFileSync(path.join(root, 'server/utils/dtrCrud.ts'), 'utf8')
  vm.runInContext(transformSync(source + '\nmodule.exports.calculate = (shift, timeIn, timeOut, policy, reference) => Object.fromEntries(hourColumns.map((key, i) => [key, applyAutoBreak(importedDutyHours(shift, "2026-09-01", timeIn, timeOut, policy, reference), policy)[i]]));', { loader: 'ts', format: 'cjs' }).code, context)
  return context.module.exports.calculate
}
const calculate = backend()

test('Excel import keeps employee codes and incomplete biometric rows available for DTR review', async () => {
  const XLSX = require('xlsx'), harness = workspace()
  try {
    const rows = [
      ['Employee ID', 'Date', 'Shift Code', 'Date In', 'Time In', 'Date Out', 'Time Out'],
      ['DJA-0001', new Date(2026, 8, 16), 'DS0700-1900', new Date(2026, 8, 16), 7 / 24, new Date(2026, 8, 16), 19 / 24],
      ['EMP-0011', new Date(2026, 8, 17), 'NS2200-1000', new Date(2026, 8, 17), 22 / 24, '', ''],
      ['DJA-0001', new Date(2026, 8, 18), 'DS0700-1900', '', '', new Date(2026, 8, 18), 19 / 24],
      ['DJA-0001', new Date(2026, 8, 19), 'NS1900-0700', '', '', '', ''],
      ['EMP-0011', new Date(2026, 8, 20), 'NS2200-1000', new Date(2026, 8, 20), 22 / 24, new Date(2026, 8, 21), 10 / 24],
    ]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    for (let row = 1; row < rows.length; row++) {
      for (const column of [1, 3, 5]) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === 'n') cell.z = 'd-mmm-yy' }
      for (const column of [4, 6]) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === 'n') cell.z = 'h:mm' }
    }
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'DTR')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    await harness.state.readDtrImportFile({ name: 'biometric.xlsx', arrayBuffer: async () => bytes })
    assert.equal(harness.state.error.value, '')
    const parsed = harness.state.importRows.value
    assert.equal(parsed.length, 5)
    assert.equal(parsed[0].EmployeeID, 'DJA-0001')
    assert.equal(parsed[0].AttendanceDate, '2026-09-16')
    assert.equal(parsed[0].TimeIn, '07:00'); assert.equal(parsed[0].TimeOut, '19:00')
    assert.equal(parsed[1].EmployeeID, 'EMP-0011'); assert.equal(parsed[1].TimeIn, '22:00'); assert.equal(parsed[1].TimeOut, '')
    assert.equal(parsed[2].TimeIn, ''); assert.equal(parsed[2].TimeOut, '19:00')
    assert.equal(parsed[3].TimeIn, ''); assert.equal(parsed[3].TimeOut, '')
    assert.equal(parsed[4].DateIn, '2026-09-20'); assert.equal(parsed[4].DateOut, '2026-09-21')
    await harness.state.submitDtrImport()
    assert.equal(harness.requests.length, 1)
    assert.equal(harness.requests[0].url, '/api/attendance/dtr/11/records')
    assert.equal(harness.requests[0].body.ImportRows, true)
    assert.deepEqual(JSON.parse(JSON.stringify(harness.requests[0].body.Rows)), JSON.parse(JSON.stringify(parsed)))
  } finally { harness.close() }
})

test('position changes keep both dated assignment windows open without enabling assignment gaps', () => {
  const harness = workspace()
  const row = { ...employee, DeploymentStartDate: '2026-09-01', DeploymentEndDate: null,
    DeploymentRanges: [{ StartDate: '2026-09-01', EndDate: '2026-09-05' }, { StartDate: '2026-09-08', EndDate: null }] }
  try {
    harness.state.openDay(row, '2026-09-05'); assert.equal(harness.state.dayOpen.value, true)
    harness.state.dayOpen.value = false
    harness.state.openDay(row, '2026-09-06'); assert.equal(harness.state.dayOpen.value, false)
    harness.state.openDay(row, '2026-09-08'); assert.equal(harness.state.dayOpen.value, true)
  } finally { harness.close() }
})

test('automatic DTR break reaches payroll exactly once for day and overnight duties', () => {
  for (const [shift, timeIn, timeOut, expectedPaidHours] of [
    [philtob, '2026-09-01 09:00', '2026-09-01 18:00', 8],
    [{ ...philtob, ShiftType: 'NS', TimeIn: '19:00', TimeOut: '07:00', RegularOTCap: 4 }, '2026-09-01 19:00', '2026-09-02 07:00', 11],
  ]) {
    const day = calculate(shift, timeIn, timeOut, policy)
    assert.equal(day.RegularHours + day.OTHours + day.OTExtHours, expectedPaidHours)
    assert.equal(day.BreakHours, 1)
    const gross = componentAmountCents(day.RegularHours + day.OTHours + day.OTExtHours, 80)
    const breakDeduction = componentAmountCents(payrollDeductionHours('BreakHours', day, policy), 80)
    assert.equal(gross - breakDeduction, expectedPaidHours * 8000)
  }
})
const overlap = (() => {
  const context = { module: { exports: {} }, require: name => name.includes('attendanceStatuses') ? attendanceStatusesModule.exports : name.includes('employeeStatusCrud') ? { employeeStatusAttendanceStatuses: ['On-Leave', 'Vacation Leave', 'Sick Leave', 'Suspended'] } : {} }
  vm.createContext(context)
  vm.runInContext(transformSync(fs.readFileSync(path.join(root, 'server/utils/dtrCrud.ts'), 'utf8') + '\nmodule.exports.policy = { timeOverlap, attendanceConflict };', { loader: 'ts', format: 'cjs' }).code, context)
  return context.module.exports.policy
})()

test('day reliever and night fixed shifts share a calendar day only without overlapping', () => {
  assert.equal(overlap.timeOverlap('2026-09-21 07:00:00', '2026-09-21 19:00:00', '2026-09-21 19:00:00', '2026-09-22 07:00:00'), false)
  assert.equal(overlap.timeOverlap('2026-09-21 07:00:00', '2026-09-21 19:00:00', '2026-09-21 18:30:00', '2026-09-22 06:30:00'), true)
  assert.equal(overlap.timeOverlap('2026-09-21 19:00:00', '2026-09-22 07:00:00', '2026-09-22 06:00:00', '2026-09-22 18:00:00'), true)
  const other = { AttendanceDate: '2026-09-21', AttendanceStatus: 'Present', SiteName: 'Pasig BLVD', TimeIn: '2026-09-21 07:00:00', TimeOut: '2026-09-21 19:00:00' }
  assert.equal(overlap.attendanceConflict([other], '2026-09-21', '2026-09-21 19:00:00', '2026-09-22 07:00:00'), null)
  assert.match(overlap.attendanceConflict([other], '2026-09-21', '2026-09-21 18:00:00', '2026-09-22 06:00:00'), /overlaps attendance at Pasig BLVD/)
  assert.equal(overlap.attendanceConflict([{ ...other, AttendanceDate: '2026-09-22', TimeIn: '2026-09-22 07:00:00', TimeOut: '2026-09-22 19:00:00' }], '2026-09-21', '2026-09-21 19:00:00', '2026-09-22 07:00:00'), null)
  assert.equal(overlap.attendanceConflict([{ ...other, AttendanceDate: '2026-09-22', TimeIn: '2026-09-22 07:00:00', TimeOut: '2026-09-22 19:00:00' }], '2026-09-21', null, null, true), null)
})

test('HR suspension blocks overlapping work at another site until HR corrects the status', () => {
  const suspended = { AttendanceDate: '2026-09-21', AttendanceStatus: 'Suspended', TimeIn: null, TimeOut: null }
  assert.match(overlap.attendanceConflict([suspended], '2026-09-21', '2026-09-21 07:00:00', '2026-09-21 19:00:00'), /HR-approved Suspended.*Employee Status first/)
  assert.match(overlap.attendanceConflict([suspended], '2026-09-20', '2026-09-20 19:00:00', '2026-09-21 07:00:00'), /HR-approved Suspended/)
  assert.equal(overlap.attendanceConflict([suspended], '2026-09-22', '2026-09-22 07:00:00', '2026-09-22 19:00:00'), null)
})

test('reliever duty at another site is visible without adding hours to this DTR', () => {
  const harness = workspace()
  try {
    harness.state.attendanceRows.value = []
    harness.state.relieverElsewhereRows.value = [{ EmployeeID: 5, AttendanceDate: '2026-09-01', SiteName: 'Pasig BLVD', ShiftCode: 'DS', TimeIn: '2026-09-01 07:00:00', TimeOut: '2026-09-01 19:00:00' }]
    assert.equal(harness.state.displayedEntry(employee, '2026-09-01').AttendanceStatus, 'Reliever')
    assert.match(harness.state.elsewhereLabel(employee, '2026-09-01'), /Pasig BLVD.*07:00.*19:00/)
    assert.equal(harness.state.totalDays(employee), 0)
    harness.state.openDay(employee, '2026-09-01')
    assert.equal(harness.state.dayForm.value.AttendanceStatus, 'Present')
  } finally { harness.close() }
})

test('DJA 07:23–18:02 retains 8 regular + 4 OT with separate 23 late / 58 undertime minutes', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const saved = { ...record, TimeIn: '2026-09-01 07:23', TimeOut: '2026-09-01 18:02', OTHours: 3.03, BreakHours: 0, UndertimeHours: 0.97 }
  const harness = workspace(shift, saved, { AutoBreakEnabled: 0 })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    state.recalculateHoursFromTimes()
    assert.equal(state.dayForm.value.RegularHours, 8)
    assert.equal(state.dayForm.value.OTHours, 4)
    assert.equal(state.dayForm.value.OTExtHours, 0)
    assert.equal(state.dayForm.value.LateMinutes, 23)
    assert.equal(state.dayForm.value.UndertimeMinutes, 58)
    for (const field of ['RegularHours', 'OTHours']) state.onHourInput(field)
    assert.equal(state.dayForm.value.TimeIn, saved.TimeIn)
    assert.equal(state.dayForm.value.TimeOut, saved.TimeOut)
    assert.equal(state.dayForm.value.AttendanceStatus, 'Late')
    await state.saveDay()
    assert.equal(harness.requests[0].body.OTHours, 4)
    const imported = calculate(shift, saved.TimeIn, saved.TimeOut, { AutoBreakEnabled: 0 })
    assert.equal(imported.RegularHours, 8)
    assert.equal(imported.OTHours, 4)
    assert.equal(Math.round(imported.LateHours * 60), 23)
    assert.equal(Math.round(imported.UndertimeHours * 60), 58)
    // Half-Day is based on actual work, even with full gross allocations.
    state.dayForm.value.TimeOut = '2026-09-01 11:23'
    state.recalculateHoursFromTimes()
    assert.equal(state.dayForm.value.RegularHours, 8)
    assert.equal(state.dayForm.value.OTHours, 4)
    assert.equal(state.dayForm.value.AttendanceStatus, 'Half-Day')
    assert.equal(automaticDtrAttendanceStatus({ RegularHours: 8, OTHours: 4, UndertimeHours: 8 }, 8), 'Half-Day')
  } finally { harness.close() }
})

test('referenced augmentation keeps gross hours while standalone Flexible uses actual duration', () => {
  const shift = { ShiftType: 'Flexible', RegularHours: 8, RegularOTCap: 4 }
  const result = calculate(shift, '2026-09-01 19:12', '2026-09-02 06:36', { AutoBreakEnabled: 0 }, { TimeIn: '07:00', TimeOut: '19:00' })
  assert.equal(result.RegularHours, 8)
  assert.equal(result.OTHours, 4)
  assert.equal(result.LateHours, 0.2)
  assert.equal(result.UndertimeHours, 0.4)
  assert.equal(result.OTExtHours, 0)
})

test('manual 24-minute undertime and 56-minute late change timestamps and survive Excel export/reimport', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const harness = workspace(shift, { ...record, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', LateHours: 0, OTHours: 4, BreakHours: 0 }, { AutoBreakEnabled: 0 })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.UndertimeMinutes = 24
    state.onMinuteInput('UndertimeMinutes')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:36')
    assert.equal(state.dayForm.value.OTHours, 4)
    assert.equal(state.dayForm.value.RegularHours, 8)
    assert.equal(state.dayForm.value.UndertimeMinutes, 24)
    state.dayForm.value.OTHours = 4
    state.onHourInput('OTHours')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:36')
    assert.equal(state.dayForm.value.UndertimeMinutes, 24)
    state.dayForm.value.UndertimeMinutes = 24
    state.onMinuteInput('UndertimeMinutes')
    state.dayForm.value.LateMinutes = 56
    state.onMinuteInput('LateMinutes')
    assert.equal(state.dayForm.value.TimeIn, '2026-09-01 07:56')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:36')
    state.onMinuteInput('UndertimeMinutes')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:36')
    await state.saveDay()
    const body = harness.requests[0].body
    assert.equal(body.UndertimeHours, 0.4)
    assert.equal(body.LateHours, 56 / 60)
    const exporter = workspace(shift, record, {}, { records: [employee], shifts: [shift], dutyRows: [{ ...body, ShiftCode: shift.ShiftCode }] })
    try {
      await exporter.state.exportDtr()
      const XLSX = require('xlsx')
      const bytes = XLSX.write(exporter.workbooks[0], { type: 'buffer', bookType: 'xlsx' })
      const reopened = XLSX.read(bytes, { type: 'buffer' })
      const exported = XLSX.utils.sheet_to_json(reopened.Sheets.DTR, { raw: false })[0]
      assert.equal(exported['Time In'], '7:56')
      assert.equal(exported['Time Out'], '18:36')
      assert.equal(exported['Date In'], '1-Sep-26')
      assert.equal(exported['Date Out'], '1-Sep-26')
      const imported = calculate(shift, '2026-09-01 ' + exported['Time In'].padStart(5, '0'), '2026-09-01 ' + exported['Time Out'].padStart(5, '0'), { AutoBreakEnabled: 0 })
      assert.equal(imported.UndertimeHours, 0.4)
      assert.equal(Math.round(imported.LateHours * 60), 56)
      assert.equal(imported.RegularHours, 8)
      assert.equal(imported.OTHours, 4)
    } finally { exporter.close() }
  } finally { harness.close() }
})

test('manual minute adjustments preserve overnight dates and the one-hour Philtob break', () => {
  for (const [shift, sitePolicy, input, output, regular, ot] of [
    [{ ...philtob, ShiftType: 'NS', TimeIn: '22:00', TimeOut: '10:00', RegularOTCap: 4 }, { AutoBreakEnabled: 0 }, '2026-09-01 22:00', '2026-09-02 09:36', 8, 4],
    [philtob, policy, '2026-09-01 09:00', '2026-09-01 17:36', 8, 0],
  ]) {
    const harness = workspace(shift, { ...record, TimeIn: input, LateHours: 0 }, sitePolicy)
    try {
      harness.state.openDay(employee, record.AttendanceDate)
      harness.state.dayForm.value.UndertimeMinutes = 24
      harness.state.onMinuteInput('UndertimeMinutes')
      assert.equal(harness.state.dayForm.value.TimeOut, output)
      assert.equal(harness.state.dayForm.value.RegularHours, regular)
      assert.equal(harness.state.dayForm.value.OTHours, ot)
      assert.equal(harness.state.dayForm.value.UndertimeMinutes, 24)
      harness.state.dayForm.value.UndertimeMinutes = 0
      harness.state.onMinuteInput('UndertimeMinutes')
      assert.equal(harness.state.dayForm.value.TimeOut.slice(-5), shift.TimeOut.slice(0, 5))
    } finally { harness.close() }
  }
})

test('automatic status uses half of regular hours, excludes ND/holiday duplication, and prioritizes Half-Day', () => {
  const base = { AttendanceStatus: 'Present', RegularHours: 4, OTHours: 0, LateHours: 0 }
  assert.equal(automaticDtrAttendanceStatus(base, 8), 'Half-Day')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 4.02 }, 8), 'Present')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 3, LateHours: 0.5 }, 8), 'Half-Day')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 8, LateHours: 0.5 }, 8), 'Late')
  assert.equal(automaticDtrAttendanceStatus({ ...base, SpecialHolidayHours: 4, NightDiffHours: 4 }, 8), 'Half-Day')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 8 }, 16), 'Half-Day')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 0 }, 8), 'Present')
  assert.equal(automaticDtrAttendanceStatus({ ...base, AttendanceStatus: 'Late', RegularHours: 8 }, 8), 'Present')
  assert.equal(automaticDtrAttendanceStatus({ ...base, RegularHours: 8, TimeIn: '2026-09-01 13:00', TimeOut: '2026-09-01 17:00' }, 8), 'Half-Day')
  for (const status of ['Absent', 'Rest Day', 'On-Leave', 'Reliever']) assert.equal(automaticDtrAttendanceStatus({ ...base, AttendanceStatus: status, LateHours: 1 }, 8), status)
})

test('two undertime minutes immediately change status, clear correctly, and persist on save', async () => {
  const harness = workspace(philtob, { ...record, TimeIn: '2026-09-01 09:00', LateHours: 0 })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    assert.equal(state.dayForm.value.AttendanceStatus, 'Present')
    state.dayForm.value.UndertimeMinutes = 2
    assert.equal(state.dayForm.value.AttendanceStatus, 'Late')
    assert.equal(state.statusCellClass(state.dayForm.value), 'status-late')
    assert.equal(state.dayForm.value.LateMinutes, 0)
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:00')
    state.dayForm.value.UndertimeMinutes = 0
    assert.equal(state.dayForm.value.AttendanceStatus, 'Present')
    state.dayForm.value.LateMinutes = 1
    state.dayForm.value.UndertimeMinutes = 2
    state.dayForm.value.UndertimeMinutes = 0
    assert.equal(state.dayForm.value.AttendanceStatus, 'Late')
    state.dayForm.value.LateMinutes = 0
    state.dayForm.value.UndertimeMinutes = 2
    await state.saveDay()
    const body = harness.requests[0].body
    assert.equal(body.AttendanceStatus, 'Late')
    assert.equal(body.UndertimeHours, 2 / 60)
    assert.equal(body.LateHours, 0)
    assert.equal(automaticDtrAttendanceStatus({ ...body, AttendanceStatus: 'Present' }, 8), 'Late')
    assert.equal(automaticDtrAttendanceStatus({ AttendanceStatus: 'Present', RegularHours: 4, UndertimeHours: 2 / 60 }, 8), 'Half-Day')
    assert.equal(automaticDtrAttendanceStatus({ ...body, AttendanceStatus: 'Absent' }, 8), 'Absent')
  } finally { harness.close() }
})

test('form status and bottom-line class follow time/late edits and are submitted on save', async () => {
  const harness = workspace()
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    assert.equal(state.dayForm.value.AttendanceStatus, 'Late')
    assert.equal(state.statusCellClass(state.dayForm.value), 'status-late')
    state.dayForm.value.TimeIn = '2026-09-01 09:00'
    state.dayForm.value.TimeOut = '2026-09-01 13:00'
    state.recalculateHoursFromTimes()
    assert.equal(state.dayForm.value.AttendanceStatus, 'Half-Day')
    assert.equal(state.statusCellClass(state.dayForm.value), 'status-half-day')
    state.dayForm.value.LateMinutes = 30
    assert.equal(state.dayForm.value.AttendanceStatus, 'Half-Day')
    await state.saveDay()
    assert.equal(harness.requests[0].body.AttendanceStatus, 'Half-Day')
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.LateMinutes = 0
    assert.equal(state.dayForm.value.AttendanceStatus, 'Present')
    assert.equal(state.statusCellClass(state.dayForm.value), '')
  } finally { harness.close() }
})

test('Vue script and template compile', () => {
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'dtr-time-test' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'dtr-time-test', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
})

test('opening, closing, reopening and saving September 1 preserve imported time-out and late', async () => {
  const harness = workspace()
  try {
    const { state } = harness
    for (let count = 0; count < 2; count++) {
      state.openDay(employee, record.AttendanceDate)
      assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:00')
      assert.equal(state.dayForm.value.LateMinutes, 23)
      assert.equal(state.dayForm.value.BreakHours, 1)
      state.dayOpen.value = false
    }
    state.openDay(employee, record.AttendanceDate)
    await state.saveDay()
    const body = harness.requests[0].body
    assert.equal(body.TimeOut, '2026-09-01 18:00')
    assert.equal(body.LateHours, 23 / 60)
    assert.equal(body.WorkAgencyPositionID, '2')
    assert.equal(body.WorkPayrollRegularRate, '500.00')
  } finally { harness.close() }
})

test('manual duration edits preview time-out without adding late arrival a second time', () => {
  const harness = workspace()
  try {
    harness.state.openDay(employee, record.AttendanceDate)
    harness.state.dayForm.value.OTExtHours = 0.5
    harness.state.onHourInput('OTExtHours')
    assert.equal(harness.state.dayForm.value.TimeOut, '2026-09-01 18:30')
    assert.equal(harness.state.dayForm.value.LateMinutes, 23)
    harness.state.dayForm.value.BreakHours = 0.5
    harness.state.onHourInput('BreakHours')
    assert.equal(harness.state.dayForm.value.TimeIn, '2026-09-01 09:23')
    assert.equal(harness.state.dayForm.value.TimeOut, '2026-09-01 18:00')
  } finally { harness.close() }
})

test('DJA DS manual OT extension updates next-day time-out, ND, and saved payload', async () => {
  const shift = { ...philtob, ShiftCodeID: 1, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const saved = { ...record, ShiftCodeID: '1', TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', OTHours: 4, BreakHours: 0, LateHours: 0, SpecialHolidayHours: 8, SpecialHolidayOTHours: 4 }
  const harness = workspace(shift, saved, { ...policy, AutoBreakEnabled: 0, DayShiftNDEnabled: 1 })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    await vue.nextTick()
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 19:00')
    assert.equal(state.dayForm.value.NightDiffHours, 0)
    state.dayForm.value.OTExtHours = 6
    state.onHourInput('OTExtHours')
    assert.equal(state.dayForm.value.TimeIn, '2026-09-01 07:00')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    assert.equal(state.dayForm.value.NightDiffHours, 3)
    state.onHourInput('OTExtHours') // change after input must not add hours twice
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    state.onHourInput('NightDiffHours')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    assert.equal(state.dayForm.value.NightDiffHours, 3)
    const computed = calculate(shift, state.dayForm.value.TimeIn, state.dayForm.value.TimeOut, state.sitePolicy.value)
    assert.equal(computed.NightDiffHours, 3)
    state.sitePolicy.value.DayShiftNDEnabled = 0
    await vue.nextTick()
    assert.equal(state.dayForm.value.NightDiffHours, 0)
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    state.sitePolicy.value.DayShiftNDEnabled = 1
    await vue.nextTick()
    assert.equal(state.dayForm.value.NightDiffHours, 3)
    await state.saveDay()
    assert.equal(harness.requests[0].body.TimeOut, '2026-09-02 01:00')
    assert.equal(harness.requests[0].body.NightDiffHours, 3)
  } finally { harness.close() }
})

test('regular hours, regular OT and explicit timestamps all update the ND preview', () => {
  const shift = { ...philtob, ShiftCodeID: 1, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const harness = workspace(shift, { ...record, ShiftCodeID: '1', TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', OTHours: 4, BreakHours: 0, LateHours: 0 }, { ...policy, AutoBreakEnabled: 0, DayShiftNDEnabled: 1 })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.RegularHours = 12
    state.onHourInput('RegularHours')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 23:00')
    assert.equal(state.dayForm.value.NightDiffHours, 1)
    state.dayForm.value.OTHours = 6
    state.onHourInput('OTHours')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    assert.equal(state.dayForm.value.NightDiffHours, 3)
    state.dayForm.value.TimeOut = '2026-09-02 02:00'
    state.recalculateHoursFromTimes()
    assert.equal(state.dayForm.value.OTExtHours, 7)
    assert.equal(state.dayForm.value.NightDiffHours, 4)
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 02:00')
    state.dayForm.value.TimeIn = '2026-09-01 07:23'
    state.recalculateHoursFromTimes()
    assert.equal(state.dayForm.value.LateMinutes, 23)
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 02:00')
  } finally { harness.close() }
})

test('explicitly selecting a shift fills its schedule and clears previous late/undertime', () => {
  const harness = workspace()
  try {
    harness.state.openDay(employee, record.AttendanceDate)
    harness.state.selectDayShift(philtob)
    const form = harness.state.dayForm.value
    assert.equal(form.TimeIn, '2026-09-01T09:00')
    assert.equal(form.TimeOut, '2026-09-01T18:00')
    assert.equal(form.LateMinutes, 0)
    assert.equal(form.LateHours, 0)
    assert.equal(form.UndertimeMinutes, 0)
    assert.equal(form.RegularHours, 8)
    assert.equal(form.BreakHours, 1)
    assert.equal(form.AutoBreakPreviewApplied, true)
  } finally { harness.close() }
})

test('opening a saved straight duty preserves aggregate hours and timestamps', () => {
  const saved = { ...record, ShiftCodeID: '', IsStraightDuty: 1, TimeIn: '2026-09-01 07:23', TimeOut: '2026-09-02 07:00', RegularHours: 16, OTHours: 8, NightDiffHours: 8, BreakHours: 0 }
  const harness = workspace(philtob, saved, { AutoBreakEnabled: 0 })
  try {
    harness.state.openDay(employee, record.AttendanceDate)
    for (const key of ['TimeIn', 'TimeOut', 'RegularHours', 'OTHours', 'NightDiffHours']) assert.equal(harness.state.dayForm.value[key], saved[key], key)
  } finally { harness.close() }
})

for (const override of [0, 1]) {
  for (const [timeOut, extension] of [['18:00', 0], ['18:30', 0.5], ['19:00', 1]]) {
    test(`Philtob 09:23–${timeOut}: one break, 23 late minutes, ${extension} extension; RP=${override}`, () => {
      const sitePolicy = { ...policy, RelieverPositionOverrideEnabled: override }
      const expected = calculate(philtob, '2026-09-01 09:23:00', `2026-09-01 ${timeOut}:00`, sitePolicy)
      assert.equal(expected.RegularHours, 8)
      assert.equal(expected.OTHours, 0)
      assert.equal(expected.OTExtHours, extension)
      assert.equal(expected.BreakHours, 1)
      assert.equal(Math.round(expected.LateHours * 60), 23)
      const harness = workspace(philtob, record, sitePolicy)
      try {
        harness.state.openDay(employee, record.AttendanceDate)
        harness.state.dayForm.value.TimeOut = `2026-09-01 ${timeOut}`
        harness.state.recalculateHoursFromTimes()
        for (const key of ['RegularHours', 'OTHours', 'OTExtHours', 'BreakHours']) assert.equal(harness.state.dayForm.value[key], expected[key], key)
        assert.equal(harness.state.dayForm.value.LateMinutes, 23)
        assert.equal(harness.state.dayForm.value.TimeOut, `2026-09-01 ${timeOut}`)
      } finally { harness.close() }
    })
  }
}

test('early arrival does not move time-out or introduce late/extension', () => {
  const harness = workspace(philtob, { ...record, TimeIn: '2026-09-01 08:23:00', LateHours: 0 })
  try {
    harness.state.openDay(employee, record.AttendanceDate)
    assert.equal(harness.state.dayForm.value.TimeOut, '2026-09-01 18:00')
    assert.equal(harness.state.dayForm.value.LateMinutes, 0)
  } finally { harness.close() }
})

for (const [name, shift, timeIn, timeOut, regular, ot, ext] of [
  ['DJA DS', { ShiftType: 'DS', TimeIn: '07:00', TimeOut: '19:00', RegularHours: 8, RegularOTCap: 4 }, '2026-09-01 07:23', '2026-09-01 19:30', 8, 4, 0.5],
  ['DJA NS', { ShiftType: 'NS', TimeIn: '22:00', TimeOut: '10:00', RegularHours: 8, RegularOTCap: 4 }, '2026-09-01 22:00', '2026-09-02 10:30', 8, 4, 0.5],
  ['DJA SS', { ShiftType: 'SS', TimeIn: '07:00', TimeOut: '07:00', RegularHours: 16, RegularOTCap: 8 }, '2026-09-01 07:00', '2026-09-02 07:00', 16, 8, 0],
  ['DJA augmentation', { ShiftType: 'Flexible', RegularHours: 8, RegularOTCap: 4 }, '2026-09-01 19:00', '2026-09-02 00:00', 0, 4, 1],
]) {
  test(`${name} keeps existing allocation with break off`, () => {
    const result = calculate(shift, timeIn, timeOut, { AutoBreakEnabled: 0 })
    assert.equal(result.RegularHours, regular)
    assert.equal(result.OTHours, ot)
    assert.equal(result.OTExtHours, ext)
    assert.equal(result.BreakHours, 0)
    const uiShift = { ...shift, ShiftCodeID: 1 }
    const harness = workspace(uiShift, { ...record, ShiftCodeID: '1', TimeIn: timeIn, TimeOut: timeOut, ...result }, { AutoBreakEnabled: 0 })
    try {
      harness.state.openDay(employee, record.AttendanceDate)
      assert.equal(harness.state.dayForm.value.TimeOut, timeOut)
      harness.state.recalculateHoursFromTimes()
      for (const key of ['RegularHours', 'OTHours', 'OTExtHours', 'BreakHours']) assert.equal(harness.state.dayForm.value[key], result[key], key)
    } finally { harness.close() }
  })
}

test('field controls default to automatic and only explicitly enabled hours become editable', () => {
  const automatic = workspace()
  const controlled = workspace(philtob, record, { ...policy, AttendanceEditableFields: ['NightDiffHours'] })
  try {
    automatic.state.openDay(employee, record.AttendanceDate)
    controlled.state.openDay(employee, record.AttendanceDate)
    assert.equal(automatic.state.canEditAttendanceField('NightDiffHours'), false)
    assert.equal(controlled.state.canEditAttendanceField('NightDiffHours'), true)
    assert.equal(controlled.state.canEditAttendanceField('RegularHours'), false)
  } finally { automatic.close(); controlled.close() }
})

test('manual ND keeps Time in, previews next-date Time out and persists an explicit override', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const saved = { ...record, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', LateHours: 0, OTHours: 4, BreakHours: 0 }
  const harness = workspace(shift, saved, { AutoBreakEnabled: 0, AttendanceEditableFields: ['NightDiffHours'] })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.NightDiffHours = 3
    state.onHourInput('NightDiffHours')
    assert.equal(state.dayForm.value.TimeIn, saved.TimeIn)
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    assert.equal(state.dayTimeConflict.value, '')
    state.onHourInput('NightDiffHours') // input + change must not shift the date twice
    assert.equal(state.dayForm.value.TimeOut, '2026-09-02 01:00')
    await state.saveDay()
    assert.equal(harness.requests[0].body.ManualFieldOverrides.NightDiffHours, 3)
    assert.equal(harness.requests[0].body.TimeIn, saved.TimeIn)
    assert.equal(harness.requests[0].body.TimeOut, '2026-09-02 01:00')
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.NightDiffHours = 3; state.onHourInput('NightDiffHours')
    state.resetControlledField('NightDiffHours')
    assert.equal(state.dayForm.value.NightDiffHours, 0) // DS automatic ND is off at this site
    assert.equal(Object.keys(state.dayForm.value.ManualFieldOverrides).length, 0)
  } finally { harness.close() }
})

test('an impossible ND/clock combination stays visible as a conflict and cannot save', async () => {
  const shift = { ...philtob, ShiftType: 'NS', TimeIn: '22:00', TimeOut: '06:00', NDEnabled: 1, NDStartTime: '22:00', NDEndTime: '06:00' }
  const saved = { ...record, TimeIn: '2026-09-01 22:00', TimeOut: '2026-09-02 06:00', NightDiffHours: 8, LateHours: 0, BreakHours: 0 }
  const harness = workspace(shift, saved, { AutoBreakEnabled: 0, AttendanceEditableFields: ['NightDiffHours'] })
  try {
    harness.state.openDay(employee, record.AttendanceDate)
    harness.state.dayForm.value.NightDiffHours = 0
    harness.state.onHourInput('NightDiffHours')
    assert.match(harness.state.dayTimeConflict.value, /no matching Time out/)
    assert.equal(harness.state.dayForm.value.TimeIn, saved.TimeIn)
    await harness.state.saveDay()
    assert.equal(harness.requests.length, 0)
    assert.ok(harness.state.dayTimeConflict.value)
  } finally { harness.close() }
})

test('manual regular allocation adjusts Time out without duplicating extension or undertime', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const harness = workspace(shift, { ...record, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', LateHours: 0, OTHours: 4, BreakHours: 0 }, { AutoBreakEnabled: 0, AttendanceEditableFields: ['RegularHours'] })
  try {
    const { state } = harness
    state.openDay(employee, record.AttendanceDate)
    state.dayForm.value.RegularHours = 12; state.onHourInput('RegularHours')
    assert.equal(state.dayForm.value.TimeIn, '2026-09-01 07:00')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 23:00')
    assert.equal(state.dayForm.value.RegularHours, 12)
    assert.equal(state.dayForm.value.OTHours, 4)
    assert.equal(state.dayForm.value.OTExtHours, 0)
    assert.equal(state.dayForm.value.UndertimeMinutes, 0)
    assert.equal(state.dayTimeConflict.value, '')
    await state.saveDay()
    assert.equal(harness.requests[0].body.ManualFieldOverrides.RegularHours, 12)
  } finally { harness.close() }
})

test('manual undertime keeps custom gross regular and OT allocations through save', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  for (const metadata of [{ OTHours: 5.6 }, null]) {
    const saved = { ...record, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 20:36', LateHours: 0, OTHours: 5.6, OTExtHours: 0, BreakHours: 0, ManualFieldOverrides: metadata }
    const harness = workspace(shift, saved, { AutoBreakEnabled: 0, AttendanceEditableFields: ['RegularHours','OTHours','OTExtHours','UndertimeHours'] })
    try {
      const { state } = harness
      state.openDay(employee, saved.AttendanceDate)
      state.dayForm.value.UndertimeMinutes = 60; state.onMinuteInput('UndertimeMinutes')
      assert.equal(state.dayForm.value.RegularHours, 8)
      assert.equal(state.dayForm.value.OTHours, 5.6)
      assert.equal(state.dayForm.value.OTExtHours, 0)
      assert.equal(state.dayForm.value.TimeOut, '2026-09-01 19:36')
      assert.equal(state.dayForm.value.UndertimeMinutes, 60)
      assert.equal(state.dayTimeConflict.value, '')
      await state.saveDay()
      assert.equal(harness.requests[0].body.RegularHours, 8)
      assert.equal(harness.requests[0].body.OTHours, 5.6)
      assert.equal(harness.requests[0].body.UndertimeHours, 1)
    } finally { harness.close() }
  }
})

test('late and undertime remain separate from gross hours with field controls enabled', async () => {
  const shift = { ...philtob, TimeIn: '07:00', TimeOut: '19:00', RegularOTCap: 4 }
  const saved = { ...record, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', LateHours: 0, OTHours: 4, OTExtHours: 0, BreakHours: 0 }
  const harness = workspace(shift, saved, { AutoBreakEnabled: 0, AttendanceEditableFields: ['LateHours','UndertimeHours'] })
  try {
    const { state } = harness
    state.openDay(employee, saved.AttendanceDate)
    state.dayForm.value.LateMinutes = 60; state.onMinuteInput('LateMinutes')
    state.dayForm.value.UndertimeMinutes = 60; state.onMinuteInput('UndertimeMinutes')
    assert.equal(state.dayForm.value.RegularHours, 8)
    assert.equal(state.dayForm.value.OTHours, 4)
    assert.equal(state.dayForm.value.TimeIn, '2026-09-01 08:00')
    assert.equal(state.dayForm.value.TimeOut, '2026-09-01 18:00')
    assert.equal(state.dayForm.value.LateMinutes, 60)
    assert.equal(state.dayForm.value.UndertimeMinutes, 60)
    assert.equal(state.dayTimeConflict.value, '')
    await state.saveDay()
    assert.equal(harness.requests[0].body.LateHours, 1)
    assert.equal(harness.requests[0].body.UndertimeHours, 1)
    assert.equal(harness.requests[0].body.RegularHours, 8)
    assert.equal(harness.requests[0].body.OTHours, 4)
  } finally { harness.close() }
})

test('manual late updates an overnight Time in date without accumulating or moving Time out', async () => {
  const shift = { ...philtob, ShiftType:'NS', TimeIn:'23:00', TimeOut:'11:00', RegularOTCap:4, NDEnabled:1, NDStartTime:'22:00', NDEndTime:'06:00' }
  const saved = { ...record, TimeIn:'2026-09-01 23:00', TimeOut:'2026-09-02 11:00', RegularHours:8, OTHours:4, OTExtHours:0, BreakHours:0, LateHours:0, NightDiffHours:7 }
  const harness = workspace(shift, saved, { AutoBreakEnabled:0, AttendanceEditableFields:['LateHours'] })
  try {
    const { state } = harness
    state.openDay(employee, saved.AttendanceDate)
    state.dayForm.value.LateMinutes=90; state.onMinuteInput('LateMinutes')
    assert.equal(state.dayForm.value.TimeIn,'2026-09-02 00:30')
    assert.equal(state.dayForm.value.TimeOut,saved.TimeOut)
    assert.equal(state.dayForm.value.NightDiffHours,5.5)
    state.onMinuteInput('LateMinutes')
    assert.equal(state.dayForm.value.TimeIn,'2026-09-02 00:30')
    state.dayForm.value.LateMinutes=30; state.onMinuteInput('LateMinutes')
    assert.equal(state.dayForm.value.TimeIn,'2026-09-01 23:30')
    assert.equal(state.dayForm.value.RegularHours,8); assert.equal(state.dayForm.value.OTHours,4)
    assert.equal(state.dayTimeConflict.value,'')
    await state.saveDay()
    assert.equal(harness.requests[0].body.LateHours,.5)
    assert.equal(harness.requests[0].body.TimeOut,saved.TimeOut)
  } finally { harness.close() }
})
