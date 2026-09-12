const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const vue = require('vue')

const root = path.resolve(__dirname, '..')
const statusModule = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'shared/utils/dtrAttendanceStatus.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: statusModule })
const { automaticDtrAttendanceStatus } = statusModule.exports
const filename = path.join(root, 'app/components/DtrAttendanceWorkspace.vue')
const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const policy = { AutoBreakEnabled: 1, DefaultBreakMinutes: 60, RelieverPositionOverrideEnabled: 1, DayShiftNDEnabled: 0 }
const philtob = { ShiftCodeID: 7, ShiftCode: 'DS0900-1800', ShiftType: 'DS', TimeIn: '09:00:00', TimeOut: '18:00:00', RegularHours: 8, RegularOTCap: 1, WorkdayCount: 1 }
const employee = { EmployeeID: 5, DeploymentType: 'Regular' }
const record = { ...employee, AttendanceDate: '2026-09-01', AttendanceStatus: 'Present', ShiftCodeID: '7', TimeIn: '2026-09-01 09:23:00', TimeOut: '2026-09-01 18:00:00', RegularHours: 8, OTHours: 0, OTExtHours: 0, BreakHours: 1, LateHours: 0.38, UndertimeHours: 0, WorkAgencyPositionID: '2', WorkPayrollRegularRate: '500.00' }

function workspace(shift = philtob, saved = record, sitePolicy = policy) {
  const requests = []
  const scope = vue.effectScope()
  const context = {
    ...vue, onMounted() {}, defineProps: () => ({ dtr: { BatchID: 11, PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' } }), defineEmits: () => () => {},
    module: { exports: {} }, require: name => name.includes('dtrAttendanceStatus') ? statusModule.exports : require(name),
    $fetch: async (url, options) => {
      if (options) requests.push({ url, ...options })
      return { records: [employee], attendanceRows: [saved], shifts: [shift], policy: sitePolicy }
    },
  }
  vm.createContext(context)
  scope.run(() => vm.runInContext(transformSync(descriptor.scriptSetup.content + '\nmodule.exports = { dayForm, dayOpen, shifts, sitePolicy, attendanceRows, openDay, saveDay, onHourInput, recalculateHoursFromTimes, selectDayShift, statusCellClass };', { loader: 'ts', format: 'cjs' }).code, context))
  const state = context.module.exports
  state.shifts.value = [shift]
  state.sitePolicy.value = { ...sitePolicy }
  state.attendanceRows.value = [{ ...saved }]
  return { state, requests, close: () => scope.stop() }
}

function backend() {
  const context = { module: { exports: {} }, require: () => ({}) }
  vm.createContext(context)
  const source = fs.readFileSync(path.join(root, 'server/utils/dtrCrud.ts'), 'utf8')
  vm.runInContext(transformSync(source + '\nmodule.exports.calculate = (shift, timeIn, timeOut, policy, reference) => Object.fromEntries(hourColumns.map((key, i) => [key, applyAutoBreak(importedDutyHours(shift, "2026-09-01", timeIn, timeOut, policy, reference), policy)[i]]));', { loader: 'ts', format: 'cjs' }).code, context)
  return context.module.exports.calculate
}
const calculate = backend()

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
