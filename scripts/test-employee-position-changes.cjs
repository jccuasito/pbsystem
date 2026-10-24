const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')
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

test('position form saves only employee position, effective date, and reason without requesting site details', async () => {
  const scope = vue.effectScope(), posted = []
  const source = parse(fs.readFileSync('app/components/EmployeePositionChangeModal.vue', 'utf8')).descriptor.scriptSetup.content
  const module = { exports: {} }
  const context = { module, require: () => ({ ...vue, onMounted() {}, onBeforeUnmount() {} }),
    defineProps: () => ({ employeeId: 1 }), defineEmits: () => () => {},
    $fetch: async (url, options) => {
      if (options?.method === 'POST') { posted.push(options.body); return { success: true } }
      return { employee: { AgencyPositionID: 1 }, positions: [{ AgencyPositionID: 2 }], history: [], permissions: { canEdit: true } }
    } }
  scope.run(() => vm.runInNewContext(transformSync(source + '\nmodule.exports={load,save,newPosition,reason,canSave,effectiveDate};', { loader: 'ts', format: 'cjs' }).code, context))
  try {
    const state = module.exports
    await state.load(); state.newPosition.value = '2'; state.reason.value = 'Promotion to supervisor'
    assert.ok(state.canSave.value)
    await state.save()
    assert.equal(posted.length, 1)
    assert.deepEqual(Object.keys(posted[0]).sort(), ['AgencyPositionID', 'EffectiveDate', 'ExpectedAgencyPositionID', 'Reason'])
    assert.equal(posted[0].AgencyPositionID, 2)
  } finally { scope.stop() }
})

test('position changes only update profile/history; cutoff removals preserve shared assignments and earlier DTRs', { skip: process.env.EMPLOYEE_POSITION_TEST_DATABASE !== '1' }, async () => {
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
      [{ ExpectedAgencyPositionID: 2 }, /position changed/], [{ Reason: '' }, /reason/],
    ]) await assert.rejects(() => api.changeEmployeePosition(event(1, { ...body, ...changes })), message)
    await assert.rejects(() => api.changeEmployeePosition(event(1, body, { session: { sub: 1, userType: 'Viewer' } })), /permission/)
    await assert.rejects(() => api.changeEmployeePosition(event(1, body, { context: { moduleCanEdit: false } })), /permission/)
    const snapshot = async () => Object.fromEntries(await Promise.all(['employee_deployment', 'attendance', 'attendance_dtr_employee', 'site_rate', 'payroll_rate', 'billing_rate', 'payroll'].map(async table => [table, (await db.query('SELECT * FROM ' + table))[0]])))
    const before = await snapshot()
    const promoted = await api.changeEmployeePosition(event(1, body))
    assert.equal(promoted.success, true)
    assert.deepEqual(await snapshot(), before, 'A profile position change cannot alter sites, assignments, rates, or attendance')
    const [[employee]] = await db.query('SELECT EmployeeNumber,AgencyPositionID FROM employee WHERE EmployeeID=1')
    assert.equal(employee.EmployeeNumber, 'TEST-1'); assert.equal(employee.AgencyPositionID, 2)
    const history = await api.listEmployeePositionChanges(event(1, null))
    assert.equal(history.history.length, 1); assert.equal(history.history[0].OldPositionName, 'Housekeeping'); assert.equal(history.history[0].NewPositionName, 'Supervisor')
    assert.equal(history.assignment, undefined); assert.equal(history.siteRates, undefined)
    const [[positionHistory]] = await db.query('SELECT OldDeploymentID,NewDeploymentID FROM employee_position_change WHERE EmployeeID=1')
    assert.equal(positionHistory.OldDeploymentID, null); assert.equal(positionHistory.NewDeploymentID, null)
    const oldDtr = await dtr.dtrSummary(event(1, null))
    assert.equal(oldDtr.records[0].PositionName, 'Housekeeping')
    await db.query("INSERT INTO holiday (HolidayID,HolidayName,HolidayDate,HolidayType,Recurring,Status) VALUES (1,'Test legal holiday','2026-09-21','Legal',0,'Active')")
    const records = await dtr.listDtrRecords(event(2, null))
    assert.equal(records.records[0].PositionName, 'Housekeeping', 'DTR keeps its separately assigned position/rate')
    assert.equal(records.records[0].DeploymentStartDate, '2026-01-01')
    assert.equal(records.records[0].DeploymentRanges.length, 1)
    const [[leave]] = await db.query('SELECT BatchID,DeploymentID FROM attendance WHERE AttendanceID=3')
    assert.equal(leave.BatchID, 2); assert.equal(leave.DeploymentID, 1)
    const [[paidHoliday]] = await db.query("SELECT DeploymentID FROM attendance WHERE EmployeeID=1 AND AttendanceDate='2026-09-21'")
    assert.equal(paidHoliday.DeploymentID, 1)
    await dtr.createDtrAttendance(event(2, { EmployeeID: 1, AttendanceDate: '2026-09-25', AttendanceStatus: 'Present', ShiftCodeID: 1, TimeIn: '2026-09-25 09:00', TimeOut: '2026-09-25 18:00', RegularHours: 8 }))
    const [[newDay]] = await db.query("SELECT DeploymentID FROM attendance WHERE EmployeeID=1 AND AttendanceDate='2026-09-25'")
    assert.equal(newDay.DeploymentID, 1)
    await db.query("UPDATE attendance_dtr SET Status='Computed to Payroll'")
    const oldPayroll = await payroll.payrollProcessingData('2026-09-01', '2026-09-15', connection)
    const newPayroll = await payroll.payrollProcessingData('2026-09-16', '2026-09-30', connection)
    assert.equal(oldPayroll.sites[0].employees[0].gross, 640)
    assert.equal(oldPayroll.sites[0].employees[0].PositionName, 'Housekeeping')
    assert.equal(newPayroll.sites[0].employees[0].gross, 1280, 'Position-only changes leave the assigned payroll rate intact')
    assert.equal(newPayroll.sites[0].employees[0].PositionName, 'Housekeeping')
    await api.changeEmployeePosition(event(1, { ...body, ExpectedAgencyPositionID: 2, AgencyPositionID: 1, EffectiveDate: '2026-09-26' }))
    assert.equal((await db.query('SELECT COUNT(*) count FROM employee_deployment'))[0][0].count, 1, 'Computed DTR does not couple a profile change to deployments')
    await assert.rejects(() => api.changeEmployeePosition(event(1, { ...body, EffectiveDate: '2026-09-26' })), /last recorded position change/)
    await db.query("INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (3,1,1,1,'2026-10-01','2026-10-15','Draft',1)")
    await db.query("INSERT INTO attendance_dtr_employee (BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES (3,1,1,'Regular',1,1)")
    await db.query("INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES (11,1,1,3,'2026-10-01','Present',8,1)")
    await db.query("INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,Remarks,CreatedBy) VALUES (12,1,1,3,'2026-10-02','Sick Leave','Keep HR history',1)")
    await db.query("INSERT INTO attendance_dtr_btr (BatchID,AttendanceDate,ReplacedEmployeeID,RelieverEmployeeID,Hours,CreatedBy) VALUES (3,'2026-10-01',1,2,8,1)")
    await assert.rejects(() => dtr.removeDtrEmployee(event(3, { EmployeeID: 1 })), /active BTR coverage/)
    assert.equal((await db.query('SELECT COUNT(*) count FROM attendance WHERE BatchID=3'))[0][0].count, 2)
    await db.query("UPDATE attendance_dtr_btr SET Status='Inactive'")
    const priorAttendance = (await db.query('SELECT * FROM attendance WHERE BatchID IN (1,2) ORDER BY AttendanceID'))[0]
    const priorAssignments = (await db.query('SELECT * FROM employee_deployment'))[0]
    const removed = await dtr.removeDtrEmployee(event(3, { EmployeeID: 1 }))
    assert.equal(removed.deletedAttendanceRows, 1); assert.equal(removed.preservedEmployeeStatusDays, 1)
    assert.deepEqual((await db.query('SELECT * FROM attendance WHERE BatchID IN (1,2) ORDER BY AttendanceID'))[0], priorAttendance)
    assert.deepEqual((await db.query('SELECT * FROM employee_deployment'))[0], priorAssignments)
    assert.equal((await db.query('SELECT BatchID FROM attendance WHERE AttendanceID=12'))[0][0].BatchID, null)
    assert.equal((await dtr.listDtrRecords(event(3, null))).records.length, 0, 'Removed fixed employee stays out after refresh')
    assert.equal((await db.query('SELECT COUNT(*) count FROM attendance_dtr_employee_exclusion WHERE BatchID=3 AND EmployeeID=1'))[0][0].count, 1)
    assert.equal((await dtr.addDtrEmployee(event(3, { EmployeeID: 1, DeploymentType: 'Regular', IsPermanentSite: true }))).success, true)
    assert.equal((await db.query('SELECT COUNT(*) count FROM attendance_dtr_employee_exclusion'))[0][0].count, 0)
    assert.equal((await dtr.listDtrRecords(event(3, null))).records.length, 1, 'Explicit re-add restores the roster')
    assert.equal((await db.query('SELECT BatchID FROM attendance WHERE AttendanceID=12'))[0][0].BatchID, 3)
    await db.query("INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (4,1,1,1,'2026-10-16','2026-10-31','Draft',1)")
    await dtr.removeDtrEmployee(event(3, { EmployeeID: 1 }))
    assert.equal((await dtr.listDtrRecords(event(4, null))).records.length, 1, 'A removal excludes only its own cutoff')
    await assert.rejects(() => dtr.removeDtrEmployee(event(1, { EmployeeID: 1 })), /computed or locked/)
    const unassigned = await api.changeEmployeePosition(event(2, { ...body, SiteRateID: null }))
    assert.equal(unassigned.success, true)
    assert.equal((await db.query('SELECT COUNT(*) count FROM employee_deployment WHERE EmployeeID=2'))[0][0].count, 0)

    // An original, externally-created fixed post may move through Add Regular /
    // Fixed in the next cutoff, without a separate agency-transfer operation.
    await db.query("INSERT INTO employee (EmployeeID,AgencyPositionID,EmployeeNumber,FirstName,LastName,Status) VALUES (3,1,'MOVE-3','Fixed','Posting','Active')")
    await db.query("INSERT INTO site (SiteID,ClientID,SiteName,Status) VALUES (2,1,'New fixed site','Active'),(3,1,'Other agency site','Active')")
    await db.query("INSERT INTO site_rate (SiteRateID,SiteID,PayrollRateID,BillingRateID,Status) VALUES (3,2,1,1,'Active')")
    await db.query("INSERT INTO employee_deployment (DeploymentID,EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate,Remarks) VALUES (3,3,1,1,'Regular',1,'2026-09-01','Original posting from HR')")
    await db.query("INSERT INTO attendance_dtr_employee (BatchID,EmployeeID,DeploymentID,AttendanceType,IsPermanentSite,CreatedBy) VALUES (2,3,3,'Regular',1,1),(3,3,3,'Regular',1,1)")
    await db.query("INSERT INTO attendance (AttendanceID,EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,RegularHours,CreatedBy) VALUES (20,3,3,2,'2026-09-20','Present',8,1),(21,3,3,3,'2026-10-01','Present',8,1)")
    await db.query("INSERT INTO attendance_dtr (BatchID,AgencyID,ClientID,SiteID,PeriodStart,PeriodEnd,Status,CreatedBy) VALUES (5,1,1,2,'2026-10-01','2026-10-15','Draft',1),(6,1,1,2,'2026-10-16','2026-10-31','Draft',1)")
    const fixedBody = { EmployeeID: 3, DeploymentType: 'Regular', IsPermanentSite: true }
    await assert.rejects(() => dtr.addDtrEmployee(event(5, fixedBody)), /Attendance already exists at the previous fixed posting/)
    assert.equal((await db.query('SELECT EndDate FROM employee_deployment WHERE DeploymentID=3'))[0][0].EndDate, null)
    await db.query('DELETE FROM attendance WHERE AttendanceID=21')
    await db.query("INSERT INTO attendance_dtr_btr (BatchID,AttendanceDate,ReplacedEmployeeID,RelieverEmployeeID,Hours,CreatedBy) VALUES (3,'2026-10-01',3,2,8,1)")
    await assert.rejects(() => dtr.addDtrEmployee(event(5, fixedBody)), /Active BTR coverage/)
    await db.query("UPDATE attendance_dtr_btr SET Status='Inactive'")
    await db.query("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=3")
    await assert.rejects(() => dtr.addDtrEmployee(event(5, fixedBody)), /computed or locked DTR/)
    await db.query("UPDATE attendance_dtr SET Status='Draft' WHERE BatchID=3")
    await db.query("INSERT INTO payroll (EmployeeID,DeploymentID,PayrollType,StartDate,EndDate,PayrollDate,GrossPay,TotalDeduction,NetPay,Status) VALUES (3,3,'Regular','2026-10-01','2026-10-15','2026-10-15',640,0,640,'Approved')")
    await assert.rejects(() => dtr.addDtrEmployee(event(5, fixedBody)), /Payroll already covers/)
    await db.query("UPDATE payroll SET Status='Cancelled' WHERE EmployeeID=3")
    await db.query("INSERT INTO payroll (EmployeeID,DeploymentID,PayrollType,StartDate,EndDate,PayrollDate,GrossPay,TotalDeduction,NetPay,Status) VALUES (3,3,'Regular','2026-09-16','2026-09-30','2026-09-30',640,0,640,'Approved')")
    const priorPay = (await db.query("SELECT * FROM payroll WHERE EmployeeID=3 AND Status='Approved'"))[0]
    const priorDay = (await db.query('SELECT * FROM attendance WHERE AttendanceID=20'))[0]
    const moved = await dtr.addDtrEmployee(event(5, fixedBody))
    assert.equal(moved.success, true)
    assert.equal((await db.query('SELECT EndDate FROM employee_deployment WHERE DeploymentID=3'))[0][0].EndDate, '2026-09-30')
    const [[newPosting]] = await db.execute('SELECT * FROM employee_deployment WHERE DeploymentID=?', [moved.deploymentId])
    assert.equal(newPosting.SiteID, 2); assert.equal(newPosting.StartDate, '2026-10-01'); assert.equal(newPosting.EndDate, null)
    assert.deepEqual((await db.query('SELECT * FROM attendance WHERE AttendanceID=20'))[0], priorDay)
    assert.deepEqual((await db.query("SELECT * FROM payroll WHERE EmployeeID=3 AND Status='Approved'"))[0], priorPay)
    assert.equal((await db.query('SELECT COUNT(*) count FROM attendance_dtr_employee WHERE BatchID=3 AND EmployeeID=3'))[0][0].count, 0, 'Empty old-site Draft roster is reconciled')
    assert.equal((await db.query('SELECT COUNT(*) count FROM attendance_dtr_employee WHERE BatchID=2 AND EmployeeID=3'))[0][0].count, 1, 'September roster stays intact')
    const employeeApi = evaluate('server/utils/employeeCrud.ts', common)
    const historyRows = (await employeeApi.listDeployments(event(3, null))).items.filter(row => row.EmployeeID === 3)
    assert.equal(historyRows.length, 2, 'The old and new fixed posts appear directly in Deployment History')
    const [[sameIdentity]] = await db.query('SELECT EmployeeNumber,AgencyPositionID FROM employee WHERE EmployeeID=3')
    assert.equal(sameIdentity.EmployeeNumber, 'MOVE-3'); assert.equal(sameIdentity.AgencyPositionID, 1)
    assert.ok((await dtr.listDtrRecords(event(6, null))).records.some(row => row.EmployeeID === 3))
    assert.ok(!(await dtr.listDtrRecords(event(4, null))).records.some(row => row.EmployeeID === 3))
    const fixedBeforeRelief = (await db.query('SELECT * FROM employee_deployment WHERE EmployeeID=3 AND IsPermanentSite=1 ORDER BY DeploymentID'))[0]
    await dtr.addDtrEmployee(event(4, { EmployeeID: 3, DeploymentType: 'Reliever', IsPermanentSite: false }))
    assert.deepEqual((await db.query('SELECT * FROM employee_deployment WHERE EmployeeID=3 AND IsPermanentSite=1 ORDER BY DeploymentID'))[0], fixedBeforeRelief, 'Reliever work never moves the fixed post')
    await assert.rejects(() => employeeApi.transferEmployee(event(3, { SiteRateID: 1, SiteID: 1, StartDate: '2026-10-16' })), /different agency/)
    await db.query("INSERT INTO payroll_rate (PayrollRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (3,3,90,'2026-01-01','Active')")
    await db.query("INSERT INTO billing_rate (BillingRateID,AgencyPositionID,RegularRate,EffectiveDate,Status) VALUES (3,3,110,'2026-01-01','Active')")
    await db.query("INSERT INTO site_rate (SiteRateID,SiteID,PayrollRateID,BillingRateID,Status) VALUES (4,3,3,3,'Active')")
    assert.equal((await employeeApi.transferEmployee(event(3, { SiteRateID: 4, SiteID: 3, StartDate: '2026-10-16' }))).success, true, 'Agency transfer remains available for a different agency')
    assert.equal((await db.query('SELECT AgencyPositionID FROM employee WHERE EmployeeID=3'))[0][0].AgencyPositionID, 3)
  } finally { await db.end() }
})
