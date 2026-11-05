const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const controls = require('../shared/utils/attendanceFieldControls.ts')
const shift = { ShiftType: 'DS', TimeIn: '07:00', TimeOut: '19:00', WorkdayCount: 1 }
const day = { AttendanceDate: '2026-09-01', TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', RegularHours: 8, OTHours: 4, OTExtHours: 0, BreakHours: 0, LateHours: 0, UndertimeHours: 0 }
function backend(db, body = {}) {
  const state = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('server/utils/dtrCrud.ts', 'utf8') + '\nmodule.exports.fields={hourColumns,checkedManualOverrides,applySavedAttendanceOverrides,restoreDisabledAttendanceOverrides};', { loader: 'ts', format: 'cjs' }).code, {
    module: state,
    require: name => name.includes('attendanceFieldControls') ? controls
      : name.includes('attendanceStatuses') ? require('../shared/utils/attendanceStatuses.ts')
      : name.includes('dbconnect') ? { getConnection: async () => ({ execute: db.execute.bind(db), beginTransaction: db.beginTransaction.bind(db), commit: db.commit.bind(db), rollback: db.rollback.bind(db), release() {} }) }
      : name === 'h3' ? { createError: info => Object.assign(Error(info.statusMessage), info), getRouterParam: () => '91', readBody: async () => body }
      : name === './auth' ? { requireSession: () => ({ sub: 1 }) } : {},
  })
  return state.exports
}

test('manual fields are whitelisted, finite and explicitly enabled on the server', () => {
  const { checkedManualOverrides } = backend().fields
  assert.equal(Object.keys(checkedManualOverrides(undefined, {})).length, 0)
  for (const value of [{ NightDiffHours: 3 }, { Unknown: 1 }, { RegularHours: -1 }, { RegularHours: 25 }, { RegularHours: '8' }, []]) {
    assert.throws(() => checkedManualOverrides(value, { AttendanceEditableFields: ['RegularHours'] }), error => error.statusCode === 400)
  }
  assert.equal(checkedManualOverrides({ NightDiffHours: 3 }, { AttendanceEditableFields: ['NightDiffHours'] }).NightDiffHours, 3)
})

test('late edits cannot move fixed Time in, and overlapping categories add no duration', () => {
  assert.match(controls.previewAttendanceFieldEdit({ ...day, LateHours: 1 }, 'LateHours', shift).conflict, /Time in/)
  const rest = controls.previewAttendanceFieldEdit({ ...day, RestDayHours: 8 }, 'RestDayHours', shift)
  assert.equal(rest.timeOut, day.TimeOut)
  assert.equal(rest.conflict, '')
  assert.ok(controls.previewAttendanceFieldEdit({ ...day, SpecialHolidayHours: 13 }, 'SpecialHolidayHours', shift).conflict)
  assert.ok(controls.attendanceTimeConflict({ ...day, NightDiffHours: 3 }, { NightDiffHours: 3 }, shift))
})

test('manual break participates once in elapsed time and keeps automatic extension/undertime consistent', () => {
  const edited = { ...day, RegularHours: 8, OTHours: 3, BreakHours: 2 }
  const preview = controls.previewAttendanceFieldEdit(edited, 'BreakHours', shift, { AutoBreakEnabled: 1 })
  assert.equal(preview.timeOut, '2026-09-01 20:00')
  const reconciled = controls.reconcileAttendanceAllocations({ ...edited, TimeOut: preview.timeOut }, { BreakHours: 2 }, { AutoBreakEnabled: 1 })
  assert.equal(reconciled.OTExtHours, 0)
  assert.equal(reconciled.UndertimeHours, 0)
  assert.equal(controls.attendanceTimeConflict(reconciled, { BreakHours: 2 }, shift, { AutoBreakEnabled: 1 }), '')
})

test('manual break with automatic break off remains a single payroll deduction', () => {
  const { payrollDeductionHours } = require('../shared/utils/payrollPreview.ts')
  const edited = { ...day, BreakHours: 2 }
  const preview = controls.previewAttendanceFieldEdit(edited, 'BreakHours', shift, { AutoBreakEnabled: 0 })
  assert.equal(preview.timeOut, day.TimeOut)
  const values = controls.reconcileAttendanceAllocations(edited, { BreakHours: 2 }, { AutoBreakEnabled: 0 })
  const paid = values.RegularHours + values.OTHours + values.OTExtHours - payrollDeductionHours('BreakHours', values, { AutoBreakEnabled: 0 })
  assert.equal(paid, 10)
  assert.equal(controls.attendanceTimeConflict(values, { BreakHours: 2 }, shift, { AutoBreakEnabled: 0 }), '')
})

test('manual overrides require valid bounded timestamps even when ND is zero', () => {
  assert.match(controls.attendanceTimeConflict({ ...day, TimeIn: null }, { NightDiffHours: 0 }, shift), /valid Time in/)
  assert.match(controls.attendanceTimeConflict({ ...day, TimeOut: '2026-09-04 07:00', NightDiffHours: 24 }, { NightDiffHours: 24 }, shift), /within 24 hours/)
})

test('MySQL field settings preserve manual hours, restore disabled fields and protect snapshots', { skip: process.env.ATTENDANCE_FIELD_TEST_DATABASE !== '1' }, async () => {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  const { hourColumns } = backend().fields
  const batch = { BatchID: 91, AgencyID: 1, SiteID: 1, Status: 'Draft', PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' }
  try {
    // Every table touched is connection-local. Real attendance and policies are never written.
    await db.query(`CREATE TEMPORARY TABLE attendance (AttendanceID INT PRIMARY KEY, EmployeeID INT, DeploymentID INT, BatchID INT, ShiftCodeID INT, AttendanceDate DATE, AttendanceStatus VARCHAR(30), TimeIn DATETIME, TimeOut DATETIME, WorkdayCount INT DEFAULT 1, HolidayID INT NULL, IsWDO INT DEFAULT 0, UpdatedBy INT, ManualFieldOverrides JSON NULL, ${hourColumns.map(key => key + ' DECIMAL(10,2) DEFAULT 0').join(', ')})`)
    await db.query('CREATE TEMPORARY TABLE attendance_dtr (BatchID INT PRIMARY KEY, AgencyID INT, ClientID INT, SiteID INT, PeriodStart DATE, PeriodEnd DATE, Status VARCHAR(40))')
    await db.query('CREATE TEMPORARY TABLE attendance_dtr_employee (BatchID INT, EmployeeID INT, DeploymentID INT, AttendanceType VARCHAR(20))')
    await db.query('CREATE TEMPORARY TABLE site (SiteID INT PRIMARY KEY)')
    await db.query('CREATE TEMPORARY TABLE site_policy (SiteID INT, Status VARCHAR(20), DayShiftNDEnabled INT, AutoBreakEnabled INT, DefaultBreakMinutes INT, RelieverPositionOverrideEnabled INT, AutoWDOEnabled INT, SundayWDOOTEnabled INT)')
    await db.query('CREATE TEMPORARY TABLE site_attendance_field_control (SiteID INT PRIMARY KEY, EditableFields JSON, UpdatedBy INT)')
    await db.query('CREATE TEMPORARY TABLE holiday (HolidayID INT, HolidayName VARCHAR(80), HolidayDate DATE, HolidayType VARCHAR(20), Recurring INT, Status VARCHAR(20))')
    await db.query('CREATE TEMPORARY TABLE site_special_holiday (SiteID INT, HolidayID INT)')
    await db.query('CREATE TEMPORARY TABLE shift_code (ShiftCodeID INT PRIMARY KEY, ShiftType VARCHAR(20), TimeIn TIME, TimeOut TIME, RegularHours DECIMAL(10,2), RegularOTCap DECIMAL(10,2), NDEnabled INT, NDStartTime TIME, NDEndTime TIME)')
    await db.execute('INSERT INTO attendance_dtr VALUES (91,1,1,1,?,?,?)', [batch.PeriodStart, batch.PeriodEnd, 'Draft'])
    await db.execute('INSERT INTO site VALUES (1)')
    await db.execute("INSERT INTO site_policy VALUES (1,'Active',0,0,0,0,0,0)")
    await db.execute("INSERT INTO shift_code VALUES (7,'DS','07:00','19:00',8,4,0,NULL,NULL)")
    await db.execute('INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,ShiftCodeID,AttendanceDate,AttendanceStatus,TimeIn,TimeOut,RegularHours,OTHours,OTExtHours,NightDiffHours,RestDayHours,ManualFieldOverrides) VALUES (1,1,1,91,7,?,?,?,?,8,4,6,3,2,?)', ['2026-09-01','Present','2026-09-01 07:00','2026-09-02 01:00', JSON.stringify({ NightDiffHours: 3, RestDayHours: 2 })])
    const request = { FieldControlsOnly: true, AttendanceEditableFields: ['NightDiffHours', 'RestDayHours'] }
    const api = backend(db, request)
    await api.updateDtrSitePolicy({})
    let [[saved]] = await db.execute('SELECT * FROM attendance WHERE AttendanceID=1')
    assert.equal(Number(saved.NightDiffHours), 3)
    assert.equal(Number(saved.RestDayHours), 2)
    assert.equal(Number(saved.IsWDO), 1)
    await db.execute('UPDATE attendance SET NightDiffHours=0, RestDayHours=0, IsWDO=0 WHERE AttendanceID=1')
    await api.fields.applySavedAttendanceOverrides(db, batch)
    ;[[saved]] = await db.execute('SELECT * FROM attendance WHERE AttendanceID=1')
    assert.equal(Number(saved.NightDiffHours), 3)
    assert.equal(Number(saved.RestDayHours), 2)
    request.AttendanceEditableFields = []
    const result = await api.updateDtrSitePolicy({})
    assert.equal(result.restoredRecords, 1)
    ;[[saved]] = await db.execute('SELECT * FROM attendance WHERE AttendanceID=1')
    assert.equal(saved.ManualFieldOverrides, null)
    assert.equal(Number(saved.NightDiffHours), 0)
    assert.equal(Number(saved.RegularHours), 8)
    assert.equal(Number(saved.OTHours), 4)
    assert.equal(Number(saved.OTExtHours), 6)
    assert.equal(saved.TimeIn, '2026-09-01 07:00:00')
    assert.equal(saved.TimeOut, '2026-09-02 01:00:00')
    await db.execute('UPDATE attendance_dtr SET Status=? WHERE BatchID=91', ['Computed to Payroll'])
    request.AttendanceEditableFields = ['NightDiffHours']
    await assert.rejects(api.updateDtrSitePolicy({}), error => error.statusCode === 409)
    const [[config]] = await db.execute('SELECT EditableFields FROM site_attendance_field_control WHERE SiteID=1')
    assert.deepEqual(JSON.parse(config.EditableFields), [])
    assert.equal(await api.fields.restoreDisabledAttendanceOverrides(db, { ...batch, Status: 'Computed to Payroll' }, {}), 0)
  } finally { await db.end() }
})
