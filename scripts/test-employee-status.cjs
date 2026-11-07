const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')

function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}

test('employee status leave sheet and DTR workspace compile with synchronized statuses', () => {
  for (const filename of ['app/pages/employees/status/index.vue', 'app/components/DtrAttendanceWorkspace.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
  }
  const page = fs.readFileSync('app/pages/employees/status/index.vue', 'utf8')
  assert.match(page, /class="status-grid"/)
  assert.match(page, /class="employee-table"/)
  assert.match(page, /Employee status sheet/)
  assert.doesNotMatch(page, /\+ Add cutoff/)
  assert.match(page, /Click to add/)
  assert.match(page, /openStatusCell/)
  assert.match(page, /EMPLOYEE STATUS HISTORY/)
  assert.match(page, /summaryPeriods/)
  assert.match(page, /groupStatusRanges/)
  assert.match(page, /\/api\/employees\/status\/\$\{employeeId\}\/summary/)
  assert.doesNotMatch(page, /â|Ã|Â/)
  assert.doesNotMatch(page, /Transfer to site|Site transfer/)
  const dtr = fs.readFileSync('app/components/DtrAttendanceWorkspace.vue', 'utf8')
  assert.match(dtr, /import \{ attendanceStatuses \} from/)
  const statusCrud = fs.readFileSync('server/utils/employeeStatusCrud.ts', 'utf8')
  assert.match(statusCrud, /\['On-Leave', 'Vacation Leave', 'Sick Leave', 'Suspended'\]/)
  assert.match(statusCrud, /reasonRequiredAttendanceStatuses\.has\(attendanceStatus\)/)
  assert.match(page, /reasonRequired \? 'Reason \(required\)' : 'Notes \(optional\)'/)
  const statusRules = evaluate(fs.readFileSync('shared/utils/attendanceStatuses.ts', 'utf8'))
  assert.deepEqual([...statusRules.attendanceStatuses], ['Present', 'Absent', 'Late', 'Half-Day', 'On-Leave', 'Vacation Leave', 'Holiday', 'Rest Day', 'Reliever', 'Sick Leave', 'Suspended'])
  assert.deepEqual([...statusRules.reasonRequiredAttendanceStatuses], ['Absent', 'Half-Day', 'On-Leave', 'Vacation Leave', 'Sick Leave', 'Suspended'])
  assert.match(statusCrud, /export async function getEmployeeStatusSummary/)
  assert.match(statusCrud, /at\.EmployeeID = \? AND at\.AttendanceDate BETWEEN \? AND \?/)
  assert.match(dtr, /dateWithinDeployment/)
  const dtrCrud = fs.readFileSync('server/utils/dtrCrud.ts', 'utf8')
  assert.match(dtrCrud, /attachPendingEmployeeStatuses\(connection, batch, createdBy\)/)
  assert.match(dtrCrud, /isEmployeeStatusLeave\(current\.AttendanceStatus\)/)
  assert.match(dtrCrud, /attachPendingEmployeeStatuses\(connection, batch, session\.sub\)/)
  assert.match(dtrCrud, /isEmployeeStatusLeave\(existing\.AttendanceStatus\)/)
  assert.match(dtrCrud, /HR-approved.*was preserved; the Excel row was not applied/)
  assert.match(dtrCrud, /preservedEmployeeStatusDays: preservedEmployeeStatusDates\.size/)
  assert.match(dtrCrud, /AttendanceStatus NOT IN \(\$\{employeeStatusAttendanceStatuses\.map/)
  assert.match(dtrCrud, /HR-approved status cannot be cleared from the DTR/)
  assert.match(dtrCrud, /HR-approved status cannot be changed from the DTR/)
  assert.match(dtrCrud, /UPDATE attendance SET BatchID = NULL, UpdatedBy = \?/)
  assert.match(dtr, /HR-approved On-Leave, Vacation Leave, Sick Leave, and Suspended dates are preserved/)
  assert.match(dtr, /importResult\.preservedEmployeeStatusDays/)
  assert.match(dtr, /HR-approved status dates will remain/)
  assert.match(dtrCrud, /SELECT COUNT\(\*\) FROM attendance_dtr_employee roster WHERE roster\.BatchID = d\.BatchID/)
  const dtrStatusRules = evaluate(fs.readFileSync('shared/utils/dtrAttendanceStatus.ts', 'utf8'))
  assert.equal(dtrStatusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Late' }, 8), 'Late')
  assert.equal(dtrStatusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Half-Day' }, 8), 'Half-Day')
  assert.equal(dtrStatusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Vacation Leave' }, 8), 'Vacation Leave')
  assert.equal(dtrStatusRules.automaticDtrAttendanceStatus({ AttendanceStatus: 'Suspended', RegularHours: 8, LateHours: 1 }, 8), 'Suspended')
})

test('status can be saved before a DTR, attaches later, and never duplicates a date', { skip: process.env.EMPLOYEE_STATUS_TEST_DATABASE !== '1' }, async () => {
  const mysql = require('mysql2/promise')
  const env = { ...require('util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const c = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD, database: env.DB_NAME || 'pbsystem', dateStrings: true })
  try {
    const tables = {
      user: 'UserID INT PRIMARY KEY, FirstName VARCHAR(50), LastName VARCHAR(50)',
      employee: 'EmployeeID INT PRIMARY KEY, EmployeeNumber VARCHAR(30), AgencyPositionID INT, FirstName VARCHAR(50), MiddleName VARCHAR(50), LastName VARCHAR(50), Status VARCHAR(20)',
      agency_position: 'AgencyPositionID INT PRIMARY KEY, AgencyID INT, PositionID INT',
      agency: 'AgencyID INT PRIMARY KEY, AgencyName VARCHAR(100)',
      position: 'PositionID INT PRIMARY KEY, PositionName VARCHAR(100)',
      payroll_rate: 'PayrollRateID INT PRIMARY KEY, AgencyPositionID INT, Status VARCHAR(20)',
      site_rate: 'SiteRateID INT PRIMARY KEY, SiteID INT, PayrollRateID INT, Status VARCHAR(20)',
      client: 'ClientID INT PRIMARY KEY, ClientName VARCHAR(100), Status VARCHAR(20)',
      site: 'SiteID INT PRIMARY KEY, ClientID INT, SiteName VARCHAR(100), Status VARCHAR(20)',
      employee_deployment: 'DeploymentID INT AUTO_INCREMENT PRIMARY KEY, EmployeeID INT, SiteRateID INT, SiteID INT, DeploymentType VARCHAR(20), IsPermanentSite TINYINT, StartDate DATE, EndDate DATE',
      attendance_dtr: 'BatchID INT PRIMARY KEY, AgencyID INT, ClientID INT, SiteID INT, PeriodStart DATE, PeriodEnd DATE, Status VARCHAR(30)',
      attendance_dtr_employee: 'BatchID INT, EmployeeID INT, DeploymentID INT, AttendanceType VARCHAR(20), IsPermanentSite TINYINT, CreatedBy INT, PRIMARY KEY(BatchID,EmployeeID)',
      attendance: `AttendanceID INT AUTO_INCREMENT PRIMARY KEY, EmployeeID INT, DeploymentID INT, BatchID INT NULL, AttendanceDate DATE, ManualFieldOverrides JSON NULL, ShiftCodeID INT, TimeIn DATETIME, TimeOut DATETIME, AttendanceStatus VARCHAR(30), AttendanceType VARCHAR(20), IsWDO TINYINT DEFAULT 0, IsManualEdit TINYINT DEFAULT 0, Remarks VARCHAR(255), CreatedBy INT, UpdatedBy INT, CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, UpdatedAt DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
        RegularHours DECIMAL(8,2) DEFAULT 0, OTHours DECIMAL(8,2) DEFAULT 0, OTExtHours DECIMAL(8,2) DEFAULT 0, NightDiffHours DECIMAL(8,2) DEFAULT 0, RestDayHours DECIMAL(8,2) DEFAULT 0, RestDayOTHours DECIMAL(8,2) DEFAULT 0, LegalHolidayHours DECIMAL(8,2) DEFAULT 0, LegalHolidayOTHours DECIMAL(8,2) DEFAULT 0, RestDayLegalHolidayHours DECIMAL(8,2) DEFAULT 0, RestDayLegalHolidayOTHours DECIMAL(8,2) DEFAULT 0, SpecialHolidayHours DECIMAL(8,2) DEFAULT 0, SpecialHolidayOTHours DECIMAL(8,2) DEFAULT 0, RestDaySpecialHolidayHours DECIMAL(8,2) DEFAULT 0, RestDaySpecialHolidayOTHours DECIMAL(8,2) DEFAULT 0, LateHours DECIMAL(8,2) DEFAULT 0, UndertimeHours DECIMAL(8,2) DEFAULT 0, BreakHours DECIMAL(8,2) DEFAULT 0, HolidayID INT, AttendanceScopeBatchID INT GENERATED ALWAYS AS (COALESCE(BatchID, 0)) PERSISTENT, UNIQUE(EmployeeID,AttendanceDate,AttendanceScopeBatchID)`,
      attendance_duty: 'AttendanceDutyID INT AUTO_INCREMENT PRIMARY KEY, AttendanceID INT',
    }
    for (const [name, columns] of Object.entries(tables)) await c.query(`CREATE TEMPORARY TABLE \`${name}\` (${columns}) ENGINE=InnoDB`)
    await c.query("INSERT INTO `user` VALUES (14,'Test','Encoder')")
    await c.query("INSERT INTO employee VALUES (8,'DJA-0001',11,'John','Doe','Example','Active')")
    await c.query('INSERT INTO agency_position VALUES (11,3,4)')
    await c.query("INSERT INTO agency VALUES (3,'DJA Security Services INC.')")
    await c.query("INSERT INTO `position` VALUES (4,'Security Guard')")
    await c.query("INSERT INTO payroll_rate VALUES (21,11,'Active')")
    await c.query("INSERT INTO site_rate VALUES (31,51,21,'Active')")
    await c.query("INSERT INTO client VALUES (41,'Samsung','Active')")
    await c.query("INSERT INTO site VALUES (51,41,'Samsung S.E.P.C.O','Active')")
    await c.query("INSERT INTO employee_deployment (EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate) VALUES (8,31,51,'Regular',1,'2026-09-01')")
    const connection = { execute: (sql, args) => c.execute(sql, args), beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release() {} }
    const pool = { execute: (sql, args) => c.execute(sql, args), getConnection: async () => connection }
    const api = evaluate(fs.readFileSync('server/utils/employeeStatusCrud.ts', 'utf8'), { require: name => name === 'h3' ? {
      readBody: async event => event.body,
      getQuery: event => event.query || {},
      getRouterParam: (event, key) => event.params?.[key],
      createError: details => Object.assign(new Error(details.statusMessage), details),
    } : name.includes('dbconnect') ? pool : name === './auth' ? { requireSession: () => ({ sub: 14 }) } : name.includes('attendanceStatuses') ? evaluate(fs.readFileSync('shared/utils/attendanceStatuses.ts', 'utf8')) : {} })

    const range = { EmployeeID: 8, AttendanceStatus: 'Sick Leave', StartDate: '2026-09-24', EndDate: '2026-09-26', Remarks: 'Medical certificate to follow' }
    const first = await api.updateEmployeeDailyStatus({ body: range })
    assert.equal(first.created, 3)
    assert.equal(first.pending, 3)
    const [pending] = await c.query('SELECT BatchID,AttendanceStatus FROM attendance ORDER BY AttendanceDate')
    assert.ok(pending.every(row => row.BatchID === null && row.AttendanceStatus === 'Sick Leave'))

    await c.query("INSERT INTO attendance_dtr VALUES (71,3,41,51,'2026-09-16','2026-09-30','Draft')")
    await c.query("INSERT INTO attendance_dtr_employee VALUES (71,8,1,'Regular',1,14)")
    const attached = await api.attachPendingEmployeeStatuses(connection, { BatchID: 71, AgencyID: 3, ClientID: 41, SiteID: 51, PeriodStart: '2026-09-16', PeriodEnd: '2026-09-30', Status: 'Draft' }, 14)
    assert.equal(attached, 3)
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance WHERE BatchID=71'))[0][0].count, 3)

    const second = await api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Vacation Leave' } })
    assert.equal(second.created, 0)
    assert.equal(second.updated, 3)
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance'))[0][0].count, 3)
    assert.ok((await c.query('SELECT AttendanceStatus FROM attendance'))[0].every(row => row.AttendanceStatus === 'Vacation Leave'))
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Half-Day', Remarks: '' } }), /A reason is required for Half-Day/)
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Unknown' } }), /Select a valid attendance status/)
    await c.query("UPDATE attendance SET AttendanceStatus='Late' WHERE EmployeeID=8 AND AttendanceDate='2026-09-26'")
    const listed = await api.listEmployeeStatus({})
    assert.equal(listed.employees.length, 1)
    assert.equal(listed.cutoffs.length, 1)
    assert.equal(listed.dtrCutoffs.length, 1)
    assert.equal(listed.history.length, 3)
    assert.equal(listed.history[0].AttendanceStatus, 'Late')
    assert.equal(listed.history[0].UpdatedByName, 'Test Encoder')
    assert.ok(listed.history[0].UpdatedAt)
    const summary = await api.getEmployeeStatusSummary({ params: { id: '8' }, query: { year: '2026' } })
    assert.equal(summary.employee.EmployeeID, 8)
    assert.equal(summary.year, 2026)
    assert.deepEqual([...summary.availableYears], [2026])
    assert.equal(summary.cutoffs.length, 1)
    assert.equal(summary.history.length, 3)
    assert.equal(summary.history[0].AttendanceStatus, 'Late')
    await assert.rejects(() => api.getEmployeeStatusSummary({ params: { id: '8' }, query: { year: 'bad' } }), /Year must be between/)
    const present = await api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Present', StartDate: '2026-09-24', EndDate: '2026-09-24', Remarks: '' } })
    assert.equal(present.updated, 1)
    assert.equal((await c.query("SELECT AttendanceStatus FROM attendance WHERE AttendanceDate='2026-09-24'"))[0][0].AttendanceStatus, 'Present')
    await c.query("UPDATE attendance SET ManualFieldOverrides=JSON_OBJECT('NightDiffHours',2), RegularHours=8, TimeIn='2026-09-24 07:00:00', TimeOut='2026-09-24 15:00:00' WHERE AttendanceDate='2026-09-24'")
    await c.query("INSERT INTO attendance_duty (AttendanceID) SELECT AttendanceID FROM attendance WHERE AttendanceDate='2026-09-24'")
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Suspended', Remarks: '' } }), /A reason is required for Suspended/)
    await api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Suspended', StartDate: '2026-09-24', EndDate: '2026-09-24', Remarks: 'HR suspension reference' } })
    const [absentRows] = await c.query("SELECT AttendanceStatus, RegularHours, TimeIn, Remarks, ManualFieldOverrides FROM attendance WHERE AttendanceDate='2026-09-24'")
    assert.equal(absentRows[0].AttendanceStatus, 'Suspended')
    assert.equal(Number(absentRows[0].RegularHours), 0)
    assert.equal(absentRows[0].TimeIn, null)
    assert.equal(absentRows[0].ManualFieldOverrides, null)
    assert.equal(absentRows[0].Remarks, 'HR suspension reference')
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance_duty'))[0][0].count, 0)
    assert.equal((await c.query('SELECT Status FROM employee WHERE EmployeeID=8'))[0][0].Status, 'Active')
    const suspendedSummary = await api.getEmployeeStatusSummary({ params: { id: '8' }, query: { year: '2026' } })
    assert.ok(suspendedSummary.history.some(row => row.AttendanceStatus === 'Suspended' && row.Remarks === 'HR suspension reference'))
    assert.equal(suspendedSummary.history.find(row => row.AttendanceStatus === 'Suspended').UpdatedByName, 'Test Encoder')
    await c.query("UPDATE attendance SET UpdatedBy=99,UpdatedAt='2026-09-27 09:30:00' WHERE AttendanceDate='2026-09-24'")
    const unknownActor = await api.getEmployeeStatusSummary({ params: { id: '8' }, query: { year: '2026' } })
    const unknownRecord = unknownActor.history.find(row => row.AttendanceStatus === 'Suspended')
    assert.equal(unknownRecord.UpdatedByName, null)
    assert.equal(unknownRecord.UpdatedAt, '2026-09-27 09:30:00')
    await c.query("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=71")
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { ...range, AttendanceStatus: 'Suspended' } }), /DTR covering/)

    // These employees have no fixed posting, no cutoff roster and no DTR in 2027.
    await c.query("INSERT INTO employee VALUES (9,NULL,11,'Pending','','Reliever','Active'),(10,NULL,11,'Pending','','Regular','Active')")
    for (const id of [9, 10]) {
      const beforeDtr = await api.updateEmployeeDailyStatus({ body: { EmployeeID: id, AttendanceStatus: 'Sick Leave', StartDate: '2027-01-17', Remarks: 'HR before assignment' } })
      assert.equal(beforeDtr.created, 1)
      assert.equal(beforeDtr.pending, 1)
      const edited = await api.updateEmployeeDailyStatus({ body: { EmployeeID: id, AttendanceStatus: 'Suspended', StartDate: '2027-01-17', Remarks: 'Updated HR reference' } })
      assert.equal(edited.updated, 1)
      assert.equal(edited.created, 0)
      const summary = await api.getEmployeeStatusSummary({ params: { id: String(id) }, query: { year: '2027' } })
      assert.equal(summary.history.length, 1)
      assert.equal(summary.history[0].DeploymentID, null)
      assert.equal(summary.history[0].BatchID, null)
      assert.equal(summary.history[0].UpdatedByName, 'Test Encoder')
      assert.equal(summary.history[0].AttendanceStatus, 'Suspended')
    }
    assert.equal((await c.query('SELECT COUNT(*) count FROM employee_deployment WHERE EmployeeID IN (9,10)'))[0][0].count, 0)
    assert.equal((await c.query('SELECT COUNT(*) count FROM attendance_dtr_employee WHERE EmployeeID IN (9,10)'))[0][0].count, 0)
    assert.equal((await api.listEmployeeStatus({})).history.filter(row => row.DeploymentID === null).length, 2)
    const pendingCutoff = await api.getEmployeeStatusCutoff({ query: { startDate: '2027-01-16', endDate: '2027-01-31' } })
    assert.equal(pendingCutoff.history.length, 2)
    assert.ok(pendingCutoff.history.every(row => row.DeploymentID === null && row.BatchID === null))
    assert.equal(pendingCutoff.cutoffs.length, 0)
    const lockedCutoff = await api.getEmployeeStatusCutoff({ query: { startDate: '2026-09-16', endDate: '2026-09-30' } })
    assert.equal(lockedCutoff.history.length, 3)
    assert.equal(lockedCutoff.cutoffs[0].DtrStatus, 'Computed to Payroll')
    for (const query of [{}, { startDate: '2027-02-30', endDate: '2027-03-01' }, { startDate: '2027-02-02', endDate: '2027-02-01' }, { startDate: '2027-01-01', endDate: '2027-02-02' }]) {
      await assert.rejects(() => api.getEmployeeStatusCutoff({ query }), error => error.statusCode === 400)
    }

    const batch = { BatchID: 72, AgencyID: 3, ClientID: 41, SiteID: 51, PeriodStart: '2027-01-16', PeriodEnd: '2027-01-31', Status: 'Draft' }
    await c.query("INSERT INTO attendance_dtr VALUES (72,3,41,51,'2027-01-16','2027-01-31','Draft')")
    assert.equal(await api.attachPendingEmployeeStatuses(connection, batch, 14), 0, 'Never auto-enroll an unassigned employee')
    for (const [id, type, permanent] of [[9, 'Reliever', 0], [10, 'Regular', 1]]) {
      const [saved] = await c.execute("INSERT INTO employee_deployment (EmployeeID,SiteRateID,SiteID,DeploymentType,IsPermanentSite,StartDate,EndDate) VALUES (?,31,51,?,?,'2027-01-16','2027-01-31')", [id,type,permanent])
      await c.execute('INSERT INTO attendance_dtr_employee VALUES (72,?,?,?,?,14)', [id,saved.insertId,type,permanent])
    }
    assert.equal(await api.attachPendingEmployeeStatuses(connection, { ...batch, Status: 'Computed to Payroll' }, 14), 0)
    assert.equal(await api.attachPendingEmployeeStatuses(connection, { ...batch, SiteID: 99 }, 14), 0)
    assert.equal(await api.attachPendingEmployeeStatuses(connection, batch, 14), 2)
    assert.equal(await api.attachPendingEmployeeStatuses(connection, batch, 14), 0, 'Attach only once')
    const [attachedRows] = await c.query('SELECT EmployeeID,DeploymentID,BatchID,AttendanceType,AttendanceStatus,RegularHours,TimeIn FROM attendance WHERE EmployeeID IN (9,10) ORDER BY EmployeeID')
    assert.equal(attachedRows[0].AttendanceType, 'Reliever')
    assert.equal(attachedRows[1].AttendanceType, 'Regular')
    assert.ok(attachedRows.every(row => row.BatchID === 72 && row.DeploymentID > 0 && row.AttendanceStatus === 'Suspended' && Number(row.RegularHours) === 0 && row.TimeIn === null))
    await api.updateEmployeeDailyStatus({ body: { EmployeeID: 9, AttendanceStatus: 'Vacation Leave', StartDate: '2027-01-17', Remarks: 'HR update after enrollment' } })
    const [[reliever]] = await c.query('SELECT AttendanceType,IsPermanentSite FROM attendance_dtr_employee WHERE BatchID=72 AND EmployeeID=9')
    assert.equal(reliever.AttendanceType, 'Reliever')
    assert.equal(reliever.IsPermanentSite, 0)
    await c.query("UPDATE attendance_dtr SET Status='Computed to Payroll' WHERE BatchID=72")
    await assert.rejects(() => api.updateEmployeeDailyStatus({ body: { EmployeeID: 9, AttendanceStatus: 'Present', StartDate: '2027-01-18' } }), /DTR covering/)
    assert.equal((await c.query("SELECT COUNT(*) count FROM attendance WHERE EmployeeID=9 AND AttendanceDate='2027-01-18'"))[0][0].count, 0)
    // More than the old recent-history cap, all in TEMPORARY tables.
    const manyEmployees = Array.from({ length: 70 }, (_, i) => [300 + i, null, 11, 'Cutoff', '', String(i), 'Active'])
    await c.query('INSERT INTO employee VALUES ?', [manyEmployees])
    const manyDays = manyEmployees.flatMap(employee => Array.from({ length: 15 }, (_, i) => [employee[0], null, null, `2028-02-${String(i + 1).padStart(2,'0')}`, 'Present', 14]))
    await c.query('INSERT INTO attendance (EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,CreatedBy) VALUES ?', [manyDays])
    await c.query("INSERT INTO employee VALUES (400,NULL,11,'Inactive','','Employee','Inactive')")
    await c.query("INSERT INTO attendance (EmployeeID,AttendanceDate,AttendanceStatus,CreatedBy) VALUES (400,'2028-02-01','Absent',14),(300,'2028-02-16','Absent',14)")
    const fullCutoff = await api.getEmployeeStatusCutoff({ query: { startDate: '2028-02-01', endDate: '2028-02-15' } })
    assert.equal(fullCutoff.history.length, 1050)
    assert.ok(fullCutoff.history.every(row => row.EmployeeID !== 400 && row.AttendanceDate <= '2028-02-15'))
    assert.ok((await api.listEmployeeStatus({})).availableYears.includes(2028))
    await c.query("INSERT INTO client VALUES (42,'Historical client','Active')")
    await c.query("INSERT INTO site VALUES (52,42,'Actual cutoff site','Active')")
    await c.query("INSERT INTO attendance_dtr VALUES (73,3,42,52,'2027-01-16','2027-01-31','Draft')")
    await c.query("INSERT INTO attendance (EmployeeID,DeploymentID,BatchID,AttendanceDate,AttendanceStatus,CreatedBy) SELECT 9,DeploymentID,73,'2027-01-19','Present',14 FROM employee_deployment WHERE EmployeeID=9 LIMIT 1")
    const actualSite = await api.getEmployeeStatusCutoff({ query: { startDate: '2027-01-16', endDate: '2027-01-31' } })
    const siteRecord = actualSite.history.find(row => row.BatchID === 73)
    assert.equal(siteRecord.SiteID, 52)
    assert.equal(siteRecord.SiteName, 'Actual cutoff site')
    assert.equal(siteRecord.ClientName, 'Historical client')
    const yearSites = await api.getEmployeeStatusSummary({ params: { id: '9' }, query: { year: '2027' } })
    assert.equal(yearSites.history.find(row => row.BatchID === 73).SiteID, 52)



  } finally {
    await c.end()
  }
})
