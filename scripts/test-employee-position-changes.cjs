const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
function evaluate(file, requireMock) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, require: requireMock })
  return module.exports
}

test('position-change UI and employee list compile', () => {
  for (const filename of ['app/components/EmployeePositionChangeModal.vue', 'app/pages/employees/index.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
  }
})

test('same-agency promotion retains old DTR rates, supports unassigned staff, and rejects unsafe changes', { skip: process.env.EMPLOYEE_POSITION_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true })
  try {
    // Connection-local tables shadow every application table. User data is never written.
    const [tables] = await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
    for (const row of tables) {
      assert.match(row.TABLE_NAME, /^[a-zA-Z0-9_]+$/)
      const [[definition]] = await db.query('SHOW CREATE TABLE `' + row.TABLE_NAME + '`')
      const sql = definition['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE').split('\n').filter(line => !/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g, '\n)')
      await db.query(sql)
    }
    const seed = [
      "INSERT INTO `user` (UserID,FirstName,LastName,Gender,Email,UserType,Status) VALUES (1,'Test','Admin','Prefer not to say','position-test@example.invalid','Admin','Active')",
      "INSERT INTO agency (AgencyID,AgencyName,Status) VALUES (1,'Test Services','Active'),(2,'Other agency','Active')",
      "INSERT INTO `position` (PositionID,PositionName,Status) VALUES (1,'Housekeeping','Active'),(2,'Supervisor','Active'),(3,'Other role','Active')",
      "INSERT INTO agency_position (AgencyPositionID,AgencyID,PositionID,Status) VALUES (1,1,1,'Active'),(2,1,2,'Active'),(3,2,3,'Active')",
      "INSERT INTO client (ClientID,ClientName,Status) VALUES (1,'Test client','Active')",
      "INSERT INTO site (SiteID,ClientID,SiteName,Status) VALUES (1,1,'Same site','Active')",
      "INSERT INTO payroll_rate (PayrollRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (1,1,80,'2026-01-01','Active'),(2,2,120,'2026-01-01','Active')",
      "INSERT INTO billing_rate (BillingRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (1,1,100,'2026-01-01','Active'),(2,2,150,'2026-01-01','Active')",
      "INSERT INTO site_rate (SiteRateID,SiteID,PayrollRateID,BillingRateID,Status) VALUES (1,1,1,1,'Active'),(2,1,2,2,'Active')",
      "INSERT INTO shift_code (ShiftCodeID,AgencyID,ShiftCode,ShiftName,ShiftType,TimeIn,TimeOut,RegularHours,RegularOTCap,Status) VALUES (1,1,'DS','Day','DS','09:00','18:00',8,1,'Active')",
      "INSERT INTO employee (EmployeeID,AgencyPositionID,EmployeeNumber,FirstName,LastName,DateHired,Status) VALUES (1,1,'TEST-1','Deployed','Employee','2026-01-01','Active'),(2,1,NULL,'Unassigned','Employee','2026-01-01','Active')",
      "INSERT INTO employee_deployment (DeploymentID,EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES (1,1,1,1,'Regular',1,'2026-01-01')",
      "INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (1,1,1,1,'2026-09-01','2026-09-15','Draft',1),(2,1,1,1,'2026-09-16','2026-09-30','Draft',1)",
      "INSERT INTO attendance_dtr_employee (BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES (1,1,1,'Regular',1,1),(2,1,1,'Regular',1,1)",
      "INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES (1,1,1,1,'2026-09-10','Present',8,1),(2,1,1,2,'2026-09-20','Present',8,1)",
      "INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,Remarks,CreatedBy) VALUES (3,1,1,NULL,'2026-09-18','Sick Leave','HR-approved leave',1)",
    ]
    for (const sql of seed) await db.query(sql)
    const connection = { execute: (sql, args) => db.execute(sql, args), beginTransaction: () => db.beginTransaction(), commit: () => db.commit(), rollback: () => db.rollback(), release() {} }
    const pool = { execute: connection.execute, getConnection: async () => connection }
    const h3 = { readBody: async event => event.body, getQuery: event => event.query || {}, getRouterParam: (event, key) => event.params[key], createError: details => Object.assign(new Error(details.statusMessage), details) }
    const versions = evaluate('server/utils/rateVersions.ts', name => name.includes('rateFields') ? require('../shared/utils/rateFields.ts') : {})
    const auth = { requireSession: event => event.session || { sub: 1, userType: 'Admin' } }
    const common = name => name === 'h3' ? h3 : name.includes('dbconnect') ? pool : name.endsWith('/auth') || name === './auth' ? auth
      : name.includes('rateVersions') ? versions : name.includes('payrollPreview') ? require('../shared/utils/payrollPreview.ts')
      : name.includes('attendanceStatuses') ? require('../shared/utils/attendanceStatuses.ts')
      : name.includes('dtrAttendanceStatus') ? require('../shared/utils/dtrAttendanceStatus.ts')
      : name.includes('dtrDeploymentDates') ? require('../server/utils/dtrDeploymentDates.ts') : {}
    const api = evaluate('server/utils/employeePositionCrud.ts', common)
    const statusApi = evaluate('server/utils/employeeStatusCrud.ts', common)
    const dtr = evaluate('server/utils/dtrCrud.ts', name => name.includes('employeeStatusCrud') ? statusApi : common(name))
    const payroll = evaluate('server/utils/payrollProcessingCrud.ts', common)
    const event = (employeeId, body, extra = {}) => ({ params: { id: String(employeeId) }, body, context: {}, ...extra })
    const body = { ExpectedAgencyPositionID: 1, AgencyPositionID: 2, EffectiveDate: '2026-09-24', SiteRateID: 2, Reason: 'Promotion to supervisor' }
    for (const [changes, message] of [
      [{ AgencyPositionID: 3 }, /same agency/], [{ AgencyPositionID: 1 }, /different position/],
      [{ EffectiveDate: '2100-01-01' }, /Future position changes/], [{ EffectiveDate: '2026-99-99' }, /valid effective date/],
      [{ EffectiveDate: '2026-09-20' }, /Attendance already exists/], [{ SiteRateID: 1 }, /active payroll and billing rate/],
      [{ ExpectedAgencyPositionID: 2 }, /position changed/], [{ Reason: '' }, /reason/],
    ]) await assert.rejects(() => api.changeEmployeePosition(event(1, { ...body, ...changes })), message)
    await assert.rejects(() => api.changeEmployeePosition(event(1, body, { session: { sub: 1, userType: 'Viewer' } })), /Viewer/)
    const before = (await db.query('SELECT * FROM attendance ORDER BY AttendanceID'))[0]
    const promoted = await api.changeEmployeePosition(event(1, body))
    assert.ok(promoted.newDeploymentId)
    assert.deepEqual((await db.query('SELECT * FROM attendance ORDER BY AttendanceID'))[0], before)
    const [[oldAssignment]] = await db.query('SELECT * FROM employee_deployment WHERE DeploymentID=1')
    assert.equal(oldAssignment.EndDate, '2026-09-23')
    const [[newAssignment]] = await db.query('SELECT * FROM employee_deployment WHERE DeploymentID=?', [promoted.newDeploymentId])
    assert.equal(newAssignment.SiteID, 1); assert.equal(newAssignment.SiteRateID, 2); assert.equal(newAssignment.IsPermanentSite, 1)
    const [[employee]] = await db.query('SELECT EmployeeNumber,AgencyPositionID FROM employee WHERE EmployeeID=1')
    assert.equal(employee.EmployeeNumber, 'TEST-1'); assert.equal(employee.AgencyPositionID, 2)
    const history = await api.listEmployeePositionChanges(event(1, null))
    assert.equal(history.history.length, 1); assert.equal(history.history[0].OldPositionName, 'Housekeeping'); assert.equal(history.history[0].NewPositionName, 'Supervisor')
    const dated = require('../server/utils/dtrDeploymentDates.ts').dtrDeploymentAtDate
    assert.equal((await dated(connection, { DeploymentID: promoted.newDeploymentId }, 1, '2026-09-20')).DeploymentID, 1)
    assert.equal((await dated(connection, { DeploymentID: promoted.newDeploymentId }, 1, '2026-09-24')).DeploymentID, promoted.newDeploymentId)
    const oldDtr = await dtr.dtrSummary(event(1, null))
    assert.equal(oldDtr.records[0].PositionName, 'Housekeeping')
    await db.query("INSERT INTO holiday (HolidayID,HolidayName,HolidayDate,HolidayType,Recurring,Status) VALUES (1,'Test legal holiday','2026-09-21','Legal',0,'Active')")
    const records = await dtr.listDtrRecords(event(2, null))
    assert.equal(records.records[0].PositionName, 'Supervisor')
    assert.equal(records.records[0].DeploymentStartDate, '2026-01-01')
    assert.equal(records.records[0].DeploymentRanges.length, 2)
    const [[leave]] = await db.query('SELECT BatchID,DeploymentID FROM attendance WHERE AttendanceID=3')
    assert.equal(leave.BatchID, 2); assert.equal(leave.DeploymentID, 1)
    const [[paidHoliday]] = await db.query("SELECT DeploymentID FROM attendance WHERE EmployeeID=1 AND AttendanceDate='2026-09-21'")
    assert.equal(paidHoliday.DeploymentID, 1)
    await dtr.createDtrAttendance(event(2, { EmployeeID: 1, AttendanceDate: '2026-09-25', AttendanceStatus: 'Present', ShiftCodeID: 1, TimeIn: '2026-09-25 09:00', TimeOut: '2026-09-25 18:00', RegularHours: 8 }))
    const [[newDay]] = await db.query("SELECT DeploymentID FROM attendance WHERE EmployeeID=1 AND AttendanceDate='2026-09-25'")
    assert.equal(newDay.DeploymentID, promoted.newDeploymentId)
    await db.query("UPDATE attendance_dtr SET Status='Computed to Payroll'")
    const oldPayroll = await payroll.payrollProcessingData('2026-09-01', '2026-09-15', connection)
    const newPayroll = await payroll.payrollProcessingData('2026-09-16', '2026-09-30', connection)
    assert.equal(oldPayroll.sites[0].employees[0].gross, 640)
    assert.equal(oldPayroll.sites[0].employees[0].PositionName, 'Housekeeping')
    assert.equal(newPayroll.sites[0].employees[0].gross, 1600, 'Old day uses 80/hour and new day uses 120/hour')
    assert.equal(newPayroll.sites[0].employees[0].PositionName, 'Supervisor')
    await db.query("INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (3,1,1,1,'2026-10-01','2026-10-15','Draft',1)")
    await db.execute("INSERT INTO attendance_dtr_employee (BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES (3,1,?,'Regular',1,1)", [promoted.newDeploymentId])
    const adjustments = evaluate('server/utils/payrollAdjustmentCrud.ts', common)
    const adjustment = await adjustments.createPayrollAdjustment(event(1, { EmployeeID: 1, SourceBatchID: 2, TargetBatchID: 3,
      Reason: 'Verified missed ordinary days', ManualDays: ['2026-09-23', '2026-09-26'].map(SourceDate => ({ SourceDate, RegularHours: 8, OTHours: 0, OTExtHours: 0, NightDiffHours: 0 })) }))
    assert.equal(adjustment.totalAmount, 1600, 'Verified missed days also use their original dated assignment rates')
    await assert.rejects(() => api.changeEmployeePosition(event(1, { ...body, ExpectedAgencyPositionID: 2, AgencyPositionID: 1, EffectiveDate: '2026-09-26' })), /computed or locked DTR/)
    await assert.rejects(() => api.changeEmployeePosition(event(1, { ...body, ExpectedAgencyPositionID: 2, AgencyPositionID: 1, EffectiveDate: '2026-09-24' })), /last recorded position change/)
    const unassigned = await api.changeEmployeePosition(event(2, { ...body, SiteRateID: null }))
    assert.equal(unassigned.newDeploymentId, null)
    assert.equal((await db.query('SELECT COUNT(*) count FROM employee_deployment WHERE EmployeeID=2'))[0][0].count, 0)
  } finally { await db.end() }
})
