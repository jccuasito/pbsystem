const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')

const moduleState = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync('server/utils/dtrCrud.ts', 'utf8') + '\nmodule.exports.holidays={holidayHours,hourColumns,syncBatchHolidays,previousHolidayDate,workedAttendanceCondition};', { loader: 'ts', format: 'cjs' }).code, { module: moduleState, require: () => ({}) })
const { holidayHours, hourColumns, syncBatchHolidays, previousHolidayDate, workedAttendanceCondition } = moduleState.exports.holidays
const legal = { HolidayID: 1, HolidayName: 'Test LH', HolidayType: 'Legal' }
const special = { ...legal, HolidayID: 2, HolidayType: 'Special' }
function allocation(fields, status, holiday, eligible = false) {
  const result = holidayHours(hourColumns.map(key => fields[key] || 0), status, null, null, holiday, eligible)
  return { ...result, hours: Object.fromEntries(hourColumns.map((key, i) => [key, result.values[i]])) }
}

test('unworked LH grants eight LH hours only; SH remains no work no pay', () => {
  const paid = allocation({}, 'Absent', legal, true)
  assert.equal(paid.paidUnworked, true)
  assert.equal(paid.hours.LegalHolidayHours, 8)
  assert.equal(paid.values.reduce((a, b) => a + b, 0), 8)
  for (const status of ['Absent', 'Rest Day', 'On-Leave', 'Reliever']) {
    assert.equal(allocation({}, status, special, true).hours.SpecialHolidayHours, 0)
    assert.equal(allocation({}, status, legal, false).hours.LegalHolidayHours, 0)
  }
  assert.equal(allocation({ LegalHolidayHours: 8 }, 'Absent', undefined, true).hours.LegalHolidayHours, 0)
})

test('worked LH and SH use recorded hours and OT, with one daily holiday allocation', () => {
  for (const holiday of [legal, special]) {
    const prefix = holiday.HolidayType === 'Legal' ? 'LegalHoliday' : 'SpecialHoliday'
    const regular = allocation({ RegularHours: 8, OTHours: 4 }, 'Present', holiday)
    assert.equal(regular.hours[prefix + 'Hours'], 8)
    assert.equal(regular.hours[prefix + 'OTHours'], 4)
    assert.equal(regular.hours.RegularHours, 8)
    assert.equal(regular.hours.OTHours, 4)
    assert.equal(allocation({ RegularHours: 8 }, 'Present', holiday).hours[prefix + 'OTHours'], 0)
    const straight = allocation({ RegularHours: 16, OTHours: 8, OTExtHours: 2 }, 'Present', holiday)
    assert.equal(straight.hours[prefix + 'Hours'], 8)
    assert.equal(straight.hours[prefix + 'OTHours'], 4)
  }
  assert.equal(previousHolidayDate('2026-09-01'), '2026-08-31')
  assert.equal(previousHolidayDate('2028-03-01'), '2028-02-29')
})

test('paid unworked LH appears in totals only, with a blank cell and no worked days, OT, or WDO', () => {
  const filename = 'app/components/DtrAttendanceWorkspace.vue'
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'holiday-test' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'holiday-test', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, filename, id: 'holiday-test', scoped: true }).errors, [])
  const status = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('shared/utils/dtrAttendanceStatus.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: status })
  const context = { ...vue, onMounted() {}, defineProps: () => ({ dtr: {} }), defineEmits: () => () => {}, require: () => status.exports, module: { exports: {} } }
  const scope = vue.effectScope()
  try {
    scope.run(() => vm.runInNewContext(transformSync(descriptor.scriptSetup.content + '\nmodule.exports={cellText,cellSub,dayCellClass,isWorkedDay,totalDays,wdoDays,attendanceRows,summaryValue};', { loader: 'ts', format: 'cjs' }).code, context))
    const ui = context.module.exports
    const paid = { EmployeeID: 1, AttendanceDate: '2026-08-31', AttendanceStatus: 'Absent', LegalHolidayHours: 8, LegalHolidayOTHours: 0, WorkdayCount: 1, IsWDO: 0 }
    ui.attendanceRows.value = [paid]
    assert.equal(ui.cellText(paid), '')
    assert.equal(ui.cellSub(paid), '')
    assert.equal(ui.dayCellClass(paid, paid), '')
    assert.equal(ui.isWorkedDay(paid), false)
    assert.equal(ui.totalDays(paid), 0)
    assert.equal(ui.wdoDays(paid), 0)
    assert.equal(ui.summaryValue(paid, 'LegalHolidayHours'), 8)
    assert.equal(ui.summaryValue(paid, 'RegularHours'), 0)
    assert.equal(ui.summaryValue(paid, 'LegalHolidayOTHours'), 0)
    const worked = { ...paid, AttendanceStatus: 'Present', RegularHours: 8, OTHours: 4, LegalHolidayOTHours: 4 }
    assert.equal(ui.cellText(worked), '8.00')
    assert.equal(ui.cellSub(worked), '4.00')
  } finally { scope.stop() }
})

test('MySQL holiday sync handles empty cells, edits, cross-cutoff eligibility and immutable snapshots', { skip: process.env.HOLIDAY_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const db = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    // Connection-local temporary tables shadow the real tables. No user records are changed.
    await db.query(`CREATE TEMPORARY TABLE attendance (AttendanceID INT AUTO_INCREMENT PRIMARY KEY,
      EmployeeID INT NOT NULL, DeploymentID INT NOT NULL, BatchID INT, AttendanceDate DATE,
      AttendanceStatus VARCHAR(20), AttendanceType VARCHAR(20) DEFAULT 'Regular', WorkdayCount INT DEFAULT 1,
      TimeIn DATETIME NULL, TimeOut DATETIME NULL, HolidayID INT NULL, IsManualEdit INT DEFAULT 0,
      CreatedBy INT NULL, UpdatedBy INT NULL, ${hourColumns.map(column => column + ' DECIMAL(10,2) DEFAULT 0').join(', ')},
      UNIQUE KEY employee_date (EmployeeID, AttendanceDate))`)
    await db.query('CREATE TEMPORARY TABLE attendance_dtr (BatchID INT PRIMARY KEY, AgencyID INT)')
    await db.query('CREATE TEMPORARY TABLE attendance_dtr_employee (BatchID INT, EmployeeID INT, DeploymentID INT, AttendanceType VARCHAR(20))')
    await db.query('CREATE TEMPORARY TABLE holiday (HolidayID INT PRIMARY KEY, HolidayName VARCHAR(80), HolidayDate DATE, HolidayType VARCHAR(20), Recurring INT, Status VARCHAR(20))')
    await db.execute('INSERT INTO attendance_dtr VALUES (?, ?), (?, ?), (?, ?)', [1, 1, 2, 1, 3, 2])
    for (const id of [1, 2, 3, 4, 5]) await db.execute('INSERT INTO attendance_dtr_employee VALUES (?, ?, ?, ?)', [2, id, id, 'Regular'])
    await db.execute('INSERT INTO holiday VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)', [1, 'Test LH', '2026-09-01', 'Legal', 0, 'Active', 2, 'Test SH', '2026-09-03', 'Special', 0, 'Active'])
    const insert = (employee, batch, date, status, regular = 0, ot = 0) => db.execute('INSERT INTO attendance (EmployeeID, DeploymentID, BatchID, AttendanceDate, AttendanceStatus, RegularHours, OTHours) VALUES (?, ?, ?, ?, ?, ?, ?)', [employee, employee, batch, date, status, regular, ot])
    await insert(1, 1, '2026-08-31', 'Present', 8, 4)
    await insert(2, 1, '2026-08-31', 'Absent')
    await insert(3, 3, '2026-08-31', 'Present', 8, 4) // other agency is not eligible
    await insert(4, 1, '2026-08-31', 'Present', 8)
    await insert(4, 3, '2026-09-01', 'Absent') // must not take another batch's row
    await insert(5, 1, '2026-08-31', 'Present', 8)
    await insert(5, 2, '2026-09-01', 'Present') // blank status must not count as work
    const batch = { BatchID: 2, AgencyID: 1, Status: 'Draft', PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15' }
    await syncBatchHolidays(db, batch, null)
    let [rows] = await db.execute('SELECT * FROM attendance WHERE BatchID = ? ORDER BY EmployeeID', [2])
    assert.deepEqual(rows.map(row => row.EmployeeID), [1, 5])
    for (const row of rows) {
      assert.equal(Number(row.LegalHolidayHours), 8)
      assert.equal(row.AttendanceStatus, 'Absent')
      assert.equal(row.TimeIn, null); assert.equal(row.TimeOut, null)
      assert.equal(Number(row.OTHours), 0); assert.equal(Number(row.LegalHolidayOTHours), 0)
    }
    const [[worked]] = await db.execute('SELECT COUNT(*) AS n FROM attendance WHERE BatchID = ? AND ' + workedAttendanceCondition(), [2])
    assert.equal(worked.n, 0)
    assert.equal(await syncBatchHolidays(db, batch, null), 0, 'Repeated reads are idempotent')
    await db.execute('UPDATE attendance SET AttendanceStatus = ?, RegularHours = 0, OTHours = 0 WHERE EmployeeID = ? AND AttendanceDate = ?', ['Absent', 1, '2026-08-31'])
    await syncBatchHolidays(db, { ...batch, Status: 'Computed to Payroll' }, null)
    const [[snapshot]] = await db.execute('SELECT LegalHolidayHours FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ?', [1, '2026-09-01'])
    assert.equal(Number(snapshot.LegalHolidayHours), 8)
    await syncBatchHolidays(db, batch, null)
    const [[revoked]] = await db.execute('SELECT LegalHolidayHours, HolidayID FROM attendance WHERE EmployeeID = ? AND AttendanceDate = ?', [1, '2026-09-01'])
    assert.equal(Number(revoked.LegalHolidayHours), 0); assert.equal(revoked.HolidayID, null)
    await db.execute('UPDATE attendance SET AttendanceStatus = ?, RegularHours = 8, OTHours = 4 WHERE EmployeeID = ? AND AttendanceDate = ?', ['Present', 1, '2026-09-01'])
    await insert(1, 2, '2026-09-02', 'Present', 8, 4)
    await insert(1, 2, '2026-09-03', 'Absent')
    await syncBatchHolidays(db, batch, null)
    ;[rows] = await db.execute('SELECT * FROM attendance WHERE EmployeeID = ? AND BatchID = ? ORDER BY AttendanceDate', [1, 2])
    assert.equal(Number(rows[0].LegalHolidayHours), 8); assert.equal(Number(rows[0].LegalHolidayOTHours), 4)
    assert.equal(Number(rows[2].SpecialHolidayHours), 0); assert.equal(Number(rows[2].SpecialHolidayOTHours), 0)
  } finally { await db.end() }
})
